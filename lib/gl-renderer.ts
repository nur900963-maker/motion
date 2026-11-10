import type { Layer, LayerEffect, Scene } from './types';
import { effectBase } from './am-xml';
import {
  evalLayer,
  fxNum,
  fxVec,
  isDrawable,
  layerIndex,
  type Affine,
  type LayerEval,
} from './scene-eval';

/**
 * Renderer WebGL2 untuk scene Alight Motion.
 *
 * Mengapa WebGL: efek seperti tile / wavewarp / zoomblur / stretch butuh pemrosesan per-piksel,
 * dan `CanvasRenderingContext2D.filter` tidak tersedia di Safari (macOS & iOS). Shader jalan di GPU
 * dan sama di semua browser yang mendukung WebGL2.
 *
 * Alur satu layer:  isi (bentuk/media/embed) → rantai efek → transform → komposit ke scene.
 *  - Efek berjalan di ruang LAYER (ukuran layer), kecuali setelah efek `lift` (HIPOTESIS dari pola data:
 *    hanya muncul di layer shape polos berparameter fill=0): bentuk layer menjadi AREA, efek berikutnya
 *    dijalankan pada gambar di bawahnya (backdrop) di ruang scene, dan hanya tampil di dalam bentuk.
 *  - oscillate / swing / fade mengubah transform & opacity (lihat scene-eval.ts).
 *  - motionblur = rata-rata beberapa sub-frame waktu.
 *
 * SEMUA rumus efek adalah PERKIRAAN dari nama & nilai parameter; implementasi asli Alight Motion tidak
 * dipublikasikan. Kalibrasi butuh hasil render asli Alight Motion sebagai pembanding.
 */

export type GlMedia = Record<string, { el: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement; kind: 'image' | 'video' }>;

export type GlOptions = {
  timeMs: number;
  media: GlMedia;
  /** false = lewati semua efek shader (mode hemat). */
  effects?: boolean;
  /** jumlah sub-frame motion blur (default 5 untuk preview; 9 untuk ekspor). */
  motionSamples?: number;
  /** Debug: nama dasar efek yang dilewati (mis. ['tile','lumakey']). */
  skipEffects?: string[];
  /** Debug: hanya gambar layer dengan id berikut. */
  onlyLayers?: string[];
};

type Tex = { tex: WebGLTexture; fbo: WebGLFramebuffer; w: number; h: number };
type Prog = { p: WebGLProgram; loc: Map<string, WebGLUniformLocation | null> };

/* ───────────────────────── GLSL ───────────────────────── */

const VS_FULL = `#version 300 es
out vec2 vUv;
void main(){
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const VS_QUAD = `#version 300 es
uniform mat3 uM;
uniform vec2 uScene;
uniform vec2 uSize;
out vec2 vUv;
void main(){
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  vec2 local = (c - 0.5) * uSize;
  vec2 sp = (uM * vec3(local, 1.0)).xy;
  gl_Position = vec4(sp.x / uScene.x * 2.0 - 1.0, 1.0 - sp.y / uScene.y * 2.0, 0.0, 1.0);
  vUv = vec2(c.x, 1.0 - c.y);
}`;

const PRELUDE = `#version 300 es
precision highp float;
precision highp int;
in vec2 vUv;
out vec4 o;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform vec2 uTexel;
uniform float uT;
vec2 toP(vec2 uv){ return (vec2(uv.x, 1.0 - uv.y) - 0.5) * uRes; }
vec2 toUV(vec2 P){ return vec2(P.x / uRes.x + 0.5, 1.0 - (P.y / uRes.y + 0.5)); }
vec4 S(vec2 uv){
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec4(0.0);
  return texture(uTex, uv);
}
vec3 unp(vec4 c){ return c.a > 0.0001 ? c.rgb / c.a : vec3(0.0); }
vec4 pm(vec3 rgb, float a){ return vec4(clamp(rgb, 0.0, 1.0) * a, a); }
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
vec3 blendRGB(int m, vec3 b, vec3 s){
  if (m == 1) return min(b + s, 1.0);
  if (m == 2) return b * s;
  if (m == 3) return 1.0 - (1.0 - b) * (1.0 - s);
  if (m == 4) return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, b));
  if (m == 5) return min(b, s);
  if (m == 6) return max(b, s);
  if (m == 7) return min(b / max(1.0 - s, 0.001), 1.0);
  if (m == 8) return 1.0 - min((1.0 - b) / max(s, 0.001), 1.0);
  if (m == 9) return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, s));
  if (m == 10) return (1.0 - 2.0 * s) * b * b + 2.0 * s * b;
  if (m == 11) return abs(b - s);
  if (m == 12) return b + s - 2.0 * b * s;
  return s;
}
`;

const FS: Record<string, string> = {
  copy: `
uniform float uOpacity;
void main(){ o = texture(uTex, vUv) * uOpacity; }`,

  // Komposit dua tekstur: uTex (backdrop) + uSrc (layer) dengan mode blend.
  blend: `
uniform sampler2D uSrc;
uniform float uOpacity;
uniform float uMode;
void main(){
  vec4 b = texture(uTex, vUv);
  vec4 s = texture(uSrc, vUv) * uOpacity;
  vec3 cb = unp(b); vec3 cs = unp(s);
  vec3 mixed = blendRGB(int(uMode + 0.5), cb, cs);
  vec3 rgb = (1.0 - s.a) * b.rgb + (1.0 - b.a) * s.rgb + s.a * b.a * mixed;
  float a = s.a + b.a * (1.0 - s.a);
  o = vec4(rgb, a);
}`,

  // Isi layer: bentuk + warna/gradien/media + garis tepi. Ruang lokal: px layer, y ke bawah.
  content: `
uniform sampler2D uMedia;
uniform vec2 uSize;
uniform float uPx;
uniform float uKind;
uniform float uRadius;
uniform float uFill;
uniform vec4 uColor;
uniform vec4 uG0;
uniform vec4 uG1;
uniform vec2 uGs;
uniform vec2 uGe;
uniform vec2 uMediaSize;
uniform float uMode;
uniform float uHasMedia;
uniform vec4 uStrokeColor;
uniform float uStrokeW;
float sdBox(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
void main(){
  vec2 P = (vec2(vUv.x, 1.0 - vUv.y) - 0.5) * uSize;
  vec2 hb = uSize * 0.5;
  float d;
  if (uKind > 1.5) d = (length(P / hb) - 1.0) * min(hb.x, hb.y);
  else d = sdBox(P, hb, uKind > 0.5 ? min(uRadius, min(hb.x, hb.y)) : 0.0);
  float cov = clamp(0.5 - d * uPx, 0.0, 1.0);
  vec4 c;
  if (uFill < 0.5) {
    c = vec4(uColor.rgb * uColor.a, uColor.a);
  } else if (uFill < 1.5) {
    vec2 q = P / uSize + 0.5;
    vec2 e = uGe - uGs;
    float t = clamp(dot(q - uGs, e) / max(dot(e, e), 1e-6), 0.0, 1.0);
    vec4 g = mix(uG0, uG1, t);
    c = vec4(g.rgb * g.a, g.a);
  } else if (uHasMedia > 0.5) {
    vec2 box = uSize;
    vec2 cs;
    if (uMode < 0.5) cs = uMediaSize * max(box.x / uMediaSize.x, box.y / uMediaSize.y);
    else if (uMode < 1.5) cs = uMediaSize * min(box.x / uMediaSize.x, box.y / uMediaSize.y);
    else cs = box;
    vec2 m = P / cs + 0.5;
    if (m.x < 0.0 || m.x > 1.0 || m.y < 0.0 || m.y > 1.0) c = vec4(0.0);
    else c = texture(uMedia, vec2(m.x, 1.0 - m.y));
  } else {
    // Slot media kosong: placeholder netral (bukan hitam pekat).
    float edge = smoothstep(2.5, 0.0, abs(d) * uPx);
    c = vec4(0.12, 0.13, 0.17, 0.55) + vec4(0.45, 0.45, 0.5, 0.45) * edge;
    c.rgb *= c.a;
  }
  c *= cov;
  if (uStrokeW > 0.0) {
    float sm = clamp(0.5 - (abs(d) - uStrokeW * 0.5) * uPx, 0.0, 1.0);
    vec4 sc = vec4(uStrokeColor.rgb * uStrokeColor.a, uStrokeColor.a) * sm;
    c = sc + c * (1.0 - sc.a);
  }
  o = c;
}`,

  // Efek "lift": hasil efek pada backdrop (uProc) ditampilkan hanya di area bentuk layer (uMask).
  region: `
uniform sampler2D uProc;
uniform sampler2D uMask;
uniform float uOpacity;
uniform float uFill;
void main(){
  vec4 b = texture(uTex, vUv);
  vec4 f = texture(uProc, vUv);
  vec4 m = texture(uMask, vUv);
  float k = m.a * uOpacity;
  vec3 inner = mix(f.rgb, m.rgb, clamp(uFill, 0.0, 1.0));
  float fa = mix(f.a, 1.0, clamp(uFill, 0.0, 1.0));
  o = vec4(inner * k + b.rgb * (1.0 - fa * k), 1.0);
}`,

  quad: `
uniform float uOpacity;
void main(){ o = texture(uTex, vUv) * uOpacity; }`,

  blur: `
uniform vec2 uDir;
void main(){
  vec4 acc = texture(uTex, vUv) * 0.227027;
  float w[4] = float[4](0.1945946, 0.1216216, 0.054054, 0.016216);
  for (int i = 0; i < 4; i++) {
    vec2 off = uDir * uTexel * float(i + 1) * 1.6;
    acc += (S(vUv + off) + S(vUv - off)) * w[i];
  }
  o = acc;
}`,

  hueshift: `
uniform float uHue;
void main(){
  vec4 c = texture(uTex, vUv); vec3 v = unp(c);
  float a = radians(uHue); float cs = cos(a); float sn = sin(a);
  vec3 r = vec3(
    dot(v, vec3(0.213 + cs * 0.787 - sn * 0.213, 0.715 - cs * 0.715 - sn * 0.715, 0.072 - cs * 0.072 + sn * 0.928)),
    dot(v, vec3(0.213 - cs * 0.213 + sn * 0.143, 0.715 + cs * 0.285 + sn * 0.140, 0.072 - cs * 0.072 - sn * 0.283)),
    dot(v, vec3(0.213 - cs * 0.213 - sn * 0.787, 0.715 - cs * 0.715 + sn * 0.715, 0.072 + cs * 0.928 + sn * 0.072)));
  o = pm(r, c.a);
}`,

  exposure: `
uniform float uExp; uniform float uGamma; uniform float uOff;
void main(){
  vec4 c = texture(uTex, vUv); vec3 v = unp(c);
  v = v * exp2(uExp) + uOff;
  v = pow(max(v, vec3(0.0)), vec3(1.0 / max(uGamma, 0.05)));
  o = pm(v, c.a);
}`,

  brightcont: `
uniform float uBri; uniform float uCon;
void main(){
  vec4 c = texture(uTex, vUv); vec3 v = unp(c);
  v = (v - 0.5) * (1.0 + uCon) + 0.5 + uBri;
  o = pm(v, c.a);
}`,

  satvib: `
uniform float uSat; uniform float uVib;
void main(){
  vec4 c = texture(uTex, vUv); vec3 v = unp(c);
  float l = dot(v, vec3(0.299, 0.587, 0.114));
  float sat = max(v.r, max(v.g, v.b)) - min(v.r, min(v.g, v.b));
  float k = uSat * (1.0 + (uVib - 1.0) * (1.0 - sat));
  v = mix(vec3(l), v, k);
  o = pm(v, c.a);
}`,

  sharpen: `
uniform float uStr;
void main(){
  vec4 c = texture(uTex, vUv);
  vec4 n = (S(vUv + vec2(uTexel.x, 0.0)) + S(vUv - vec2(uTexel.x, 0.0)) + S(vUv + vec2(0.0, uTexel.y)) + S(vUv - vec2(0.0, uTexel.y))) * 0.25;
  vec4 r = c + (c - n) * uStr;
  o = vec4(clamp(r.rgb, 0.0, 1.0), clamp(c.a, 0.0, 1.0));
  o.rgb = min(o.rgb, o.a);
}`,

  lumakey: `
uniform float uLow; uniform float uHigh; uniform float uFeather; uniform float uInvert;
void main(){
  vec4 c = texture(uTex, vUv); vec3 v = unp(c);
  float l = dot(v, vec3(0.299, 0.587, 0.114));
  float f = max(uFeather, 0.0005);
  float m = smoothstep(uLow - f, uLow, l) * (1.0 - smoothstep(uHigh, uHigh + f, l));
  if (uLow <= 0.0) m = 1.0 - smoothstep(uHigh, uHigh + f, l);
  if (uInvert > 0.5) m = 1.0 - m;
  o = c * m;
}`,

  tile: `
uniform float uScale; uniform float uPhase; uniform float uMirror; uniform float uVOff; uniform float uAngle;
void main(){
  vec2 P = toP(vUv);
  float a = radians(uAngle);
  vec2 Q = vec2(cos(a) * P.x + sin(a) * P.y, -sin(a) * P.x + cos(a) * P.y);
  vec2 cell = uRes * max(uScale, 0.001);
  vec2 g = Q / cell + 0.5 + vec2(uPhase, 0.0);
  vec2 id = floor(g);
  vec2 f = g - id;
  if (uVOff > 0.5 && mod(id.x, 2.0) >= 1.0) f.y = fract(f.y + 0.5);
  if (uMirror > 0.5) {
    if (mod(id.x, 2.0) >= 1.0) f.x = 1.0 - f.x;
    if (mod(id.y, 2.0) >= 1.0) f.y = 1.0 - f.y;
  }
  o = S(toUV((f - 0.5) * uRes));
}`,

  wipe: `
uniform float uAngle; uniform float uStart; uniform float uEnd; uniform float uFeather;
void main(){
  vec4 c = texture(uTex, vUv);
  vec2 P = toP(vUv);
  float a = radians(uAngle);
  vec2 d = vec2(cos(a), sin(a));
  float ext = abs(uRes.x * d.x) + abs(uRes.y * d.y);
  float u = dot(P, d) / ext + 0.5;
  float f = max(uFeather / ext, 0.0001);
  float l = uStart <= 0.0 ? 1.0 : smoothstep(uStart - f * 0.5, uStart + f * 0.5, u);
  float r = uEnd >= 1.0 ? 1.0 : 1.0 - smoothstep(uEnd - f * 0.5, uEnd + f * 0.5, u);
  o = c * (l * r);
}`,

  wavewarp: `
uniform float uPhase; uniform float uA1; uniform float uM1; uniform float uA2; uniform float uM2;
void main(){
  vec2 P = toP(vUv);
  float L = max(max(uRes.x, uRes.y) * 0.25, 1.0);
  vec2 d1 = vec2(cos(radians(uA1)), sin(radians(uA1)));
  vec2 d2 = vec2(cos(radians(uA2)), sin(radians(uA2)));
  vec2 n1 = vec2(-d1.y, d1.x); vec2 n2 = vec2(-d2.y, d2.x);
  vec2 disp = d1 * uM1 * sin(6.2831853 * (dot(P, n1) / L + uPhase))
            + d2 * uM2 * sin(6.2831853 * (dot(P, n2) / L + uPhase));
  o = S(toUV(P - disp));
}`,

  randomdisplace: `
uniform float uMag; uniform float uEvo; uniform float uSeed; uniform float uScatter;
void main(){
  vec2 P = toP(vUv);
  float cell = 30.0 / max(uScatter, 0.05);
  vec2 q = P / cell + vec2(uSeed * 17.0, uSeed * 31.0);
  vec2 n = vec2(vnoise(q + vec2(uEvo, 0.0)), vnoise(q + vec2(7.3, uEvo))) - 0.5;
  o = S(toUV(P + n * 2.0 * uMag));
}`,

  zoomblur: `
uniform float uStr;
void main(){
  vec2 P = toP(vUv);
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 24; i++) {
    float s = 1.0 - uStr * float(i) / 23.0;
    acc += S(toUV(P * s));
  }
  o = acc / 24.0;
}`,

  circularripple: `
uniform float uFreq; uniform float uPhase; uniform float uRadius; uniform float uStr; uniform float uFeather;
void main(){
  vec2 P = toP(vUv);
  float R = 0.5 * min(uRes.x, uRes.y);
  float len = length(P);
  float r = len / R;
  float mask = 1.0 - smoothstep(uRadius - max(uFeather, 0.001), uRadius, r);
  float disp = sin(6.2831853 * (r * uFreq - uPhase)) * uStr * mask * R;
  vec2 dir = len > 0.001 ? P / len : vec2(0.0);
  o = S(toUV(P + dir * disp));
}`,

  displacemap: `
uniform vec2 uOffs; uniform float uTx; uniform float uTy; uniform float uInv;
float chan(vec4 c, float t){
  vec3 v = unp(c);
  if (t < 0.5) return dot(v, vec3(0.299, 0.587, 0.114));
  if (t < 1.5) return v.r;
  if (t < 2.5) return v.g;
  if (t < 3.5) return v.b;
  return c.a;
}
void main(){
  vec4 c = texture(uTex, vUv);
  float dx = chan(c, uTx) - 0.5; float dy = chan(c, uTy) - 0.5;
  if (uInv > 0.5) { dx = -dx; dy = -dy; }
  vec2 P = toP(vUv);
  o = S(toUV(P + vec2(dx * 2.0 * uOffs.x, dy * 2.0 * uOffs.y)));
}`,

  stretchsegment: `
uniform float uAngle; uniform float uStretch; uniform float uOffset;
void main(){
  vec2 P = toP(vUv);
  float a = radians(uAngle);
  vec2 d = vec2(cos(a), sin(a));
  float q = dot(P, d) - uOffset;
  float h = uStretch * 0.5;
  float q2 = abs(q) <= h ? 0.0 : q - sign(q) * h;
  vec2 P2 = P + d * (q2 - q);
  o = S(toUV(P2));
}`,

  mirror: `
uniform float uType; uniform float uAlpha; uniform float uOffset;
void main(){
  vec4 c = texture(uTex, vUv);
  vec2 P = toP(vUv);
  vec2 Pm = uType < 0.5 ? vec2(abs(P.x - uOffset) + uOffset, P.y) : vec2(P.x, abs(P.y - uOffset) + uOffset);
  o = mix(c, S(toUV(Pm)), clamp(uAlpha, 0.0, 1.0));
}`,

  gradientoverlay: `
uniform vec4 uC1; uniform vec4 uC2; uniform float uAngle; uniform float uScale; uniform float uAlpha;
uniform float uType; uniform float uBlend; uniform vec2 uOffs;
void main(){
  vec4 c = texture(uTex, vUv); vec3 v = unp(c);
  vec2 P = toP(vUv) - uOffs;
  float a = radians(uAngle);
  vec2 d = vec2(cos(a), sin(a));
  float ext = abs(uRes.x * d.x) + abs(uRes.y * d.y);
  float t = uType < 0.5 ? dot(P, d) / (ext * max(uScale, 0.01)) + 0.5 : length(P) / (0.5 * min(uRes.x, uRes.y) * max(uScale, 0.01));
  t = clamp(t, 0.0, 1.0);
  vec4 g = mix(uC1, uC2, t);
  vec3 bl = blendRGB(int(uBlend + 0.5), v, g.rgb);
  o = pm(mix(v, bl, uAlpha * g.a), c.a);
}`,

  fourcolorgradient: `
uniform vec4 uC1; uniform vec4 uC2; uniform vec4 uC3; uniform vec4 uC4;
uniform vec2 uO1; uniform vec2 uO2; uniform vec2 uO3; uniform vec2 uO4;
uniform float uAlpha; uniform float uBlend; uniform float uBlendMode;
void main(){
  vec4 c = texture(uTex, vUv); vec3 v = unp(c);
  vec2 P = toP(vUv);
  float R = max(max(uRes.x, uRes.y), 1.0);
  float p = 2.0 + 2.0 * (1.0 - clamp(uBlend, 0.0, 1.0));
  float w1 = 1.0 / pow(length(P - uO1) / R + 0.02, p);
  float w2 = 1.0 / pow(length(P - uO2) / R + 0.02, p);
  float w3 = 1.0 / pow(length(P - uO3) / R + 0.02, p);
  float w4 = 1.0 / pow(length(P - uO4) / R + 0.02, p);
  vec3 g = (uC1.rgb * w1 + uC2.rgb * w2 + uC3.rgb * w3 + uC4.rgb * w4) / (w1 + w2 + w3 + w4);
  vec3 bl = blendRGB(int(uBlendMode + 0.5), v, g);
  o = pm(mix(v, bl, uAlpha), c.a);
}`,
};

const BLEND_INDEX: Record<string, number> = {
  normal: 0, 'linear-dodge': 1, add: 1, multiply: 2, screen: 3, overlay: 4, darken: 5, lighten: 6,
  'color-dodge': 7, 'color-burn': 8, 'hard-light': 9, 'soft-light': 10, difference: 11, exclusion: 12,
};
const blendIndex = (name?: string) => BLEND_INDEX[(name ?? 'normal').toLowerCase()] ?? 0;

/** Ukuran tekstur diskret agar pool tidak membengkak saat layer di-scale terus-menerus. */
const K_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];
const quantK = (k: number) => K_STEPS.find((s) => s >= k) ?? 4;
const MAX_TEX = 2048;

type Main = { cur: Tex; alt: Tex };

type SceneCtx = {
  scene: Scene;
  index: Map<string, Layer>;
  media: GlMedia;
  W: number;
  H: number;
  S: number; // px keluaran per px scene
  opts: GlOptions;
};

type LayerResult = {
  tex: Tex;
  /**
   * 'layer'  = butuh transform quad;
   * 'region' = efek diterapkan ke backdrop dan hanya tampil di area bentuk layer (efek `lift`).
   */
  mode: 'layer' | 'region';
  w: number;
  h: number;
  /** untuk 'region': bentuk layer yang sudah ditransform ke ruang scene (alpha = area) */
  mask?: Tex;
  fill?: number;
};

export class GlRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;
  /** Efek/shader yang gagal dikompilasi (dilaporkan sekali ke UI). */
  readonly failed = new Set<string>();

  private progs = new Map<string, Prog | null>();
  private pool = new Map<string, Tex[]>();
  private mediaTex = new Map<Element, { tex: WebGLTexture; w: number; h: number; stamp: string }>();

  static isSupported(): boolean {
    try {
      const c = document.createElement('canvas');
      return Boolean(c.getContext('webgl2'));
    } catch {
      return false;
    }
  }

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: true,
      premultipliedAlpha: false,
    });
    if (!gl) throw new Error('WebGL2 tidak tersedia di browser ini.');
    this.canvas = canvas;
    this.gl = gl;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
  }

  dispose() {
    const gl = this.gl;
    for (const list of this.pool.values()) for (const t of list) this.destroy(t);
    this.pool.clear();
    for (const m of this.mediaTex.values()) gl.deleteTexture(m.tex);
    this.mediaTex.clear();
    for (const p of this.progs.values()) if (p) gl.deleteProgram(p.p);
    this.progs.clear();
  }

  /* ───────── infrastruktur GL ───────── */

  private compile(type: number, src: string): WebGLShader | null {
    const gl = this.gl;
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.error('[gl] shader gagal dikompilasi:', gl.getShaderInfoLog(sh));
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }

  private program(name: string): Prog | null {
    if (this.progs.has(name)) return this.progs.get(name) ?? null;
    const gl = this.gl;
    const quad = name === 'quad';
    const vs = this.compile(gl.VERTEX_SHADER, quad ? VS_QUAD : VS_FULL);
    const fs = this.compile(gl.FRAGMENT_SHADER, PRELUDE + FS[name]);
    let prog: Prog | null = null;
    if (vs && fs) {
      const p = gl.createProgram()!;
      gl.attachShader(p, vs);
      gl.attachShader(p, fs);
      gl.linkProgram(p);
      if (gl.getProgramParameter(p, gl.LINK_STATUS)) prog = { p, loc: new Map() };
      else console.error('[gl] link gagal:', name, gl.getProgramInfoLog(p));
    }
    if (!prog) this.failed.add(name);
    this.progs.set(name, prog);
    return prog;
  }

  /** Lokasi uniform di-cache: getUniformLocation per pass per frame memboroskan CPU di HP. */
  private ul(prog: Prog, name: string): WebGLUniformLocation | null {
    const cached = prog.loc.get(name);
    if (cached !== undefined) return cached;
    const loc = this.gl.getUniformLocation(prog.p, name);
    prog.loc.set(name, loc);
    return loc;
  }

  private setU(prog: Prog, name: string, v: number | number[] | null | undefined) {
    if (v === null || v === undefined) return;
    const gl = this.gl;
    const loc = this.ul(prog, name);
    if (!loc) return;
    if (typeof v === 'number') gl.uniform1f(loc, v);
    else if (v.length === 2) gl.uniform2f(loc, v[0], v[1]);
    else if (v.length === 3) gl.uniform3f(loc, v[0], v[1], v[2]);
    else if (v.length === 4) gl.uniform4f(loc, v[0], v[1], v[2], v[3]);
    else if (v.length === 9) gl.uniformMatrix3fv(loc, false, v);
  }

  private tex(w: number, h: number): Tex {
    w = Math.max(1, Math.min(4096, Math.round(w)));
    h = Math.max(1, Math.min(4096, Math.round(h)));
    const key = `${w}x${h}`;
    const free = this.pool.get(key)?.pop();
    if (free) return free;
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fbo, w, h };
  }

  private free(t: Tex) {
    const key = `${t.w}x${t.h}`;
    const list = this.pool.get(key) ?? [];
    if (list.length < 6) {
      list.push(t);
      this.pool.set(key, list);
    } else this.destroy(t);
  }

  private destroy(t: Tex) {
    this.gl.deleteFramebuffer(t.fbo);
    this.gl.deleteTexture(t.tex);
  }

  private target(t: Tex | null, w?: number, h?: number) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fbo : null);
    gl.viewport(0, 0, t ? t.w : (w ?? this.canvas.width), t ? t.h : (h ?? this.canvas.height));
  }

  private clear(t: Tex, r = 0, g = 0, b = 0, a = 0) {
    this.target(t);
    this.gl.clearColor(r, g, b, a);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
  }

  private bindTex(unit: number, tex: WebGLTexture | null) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
  }

  /** Satu pass layar penuh: input → output dengan shader `name`. */
  private pass(
    name: string,
    input: Tex | null,
    out: Tex | null,
    logical: [number, number],
    t: number,
    uniforms: Record<string, number | number[]> = {},
    extraIn?: { unit: number; tex: WebGLTexture | null; name: string } | { unit: number; tex: WebGLTexture | null; name: string }[],
  ): boolean {
    const extras = extraIn ? (Array.isArray(extraIn) ? extraIn : [extraIn]) : [];
    const prog = this.program(name);
    if (!prog) return false;
    const gl = this.gl;
    gl.useProgram(prog.p);
    gl.disable(gl.BLEND);
    this.target(out);
    this.bindTex(0, input ? input.tex : null);
    for (const extra of extras) {
      this.bindTex(extra.unit, extra.tex);
      const loc = this.ul(prog, extra.name);
      if (loc) gl.uniform1i(loc, extra.unit);
    }
    const loc0 = this.ul(prog, 'uTex');
    if (loc0) gl.uniform1i(loc0, 0);
    this.setU(prog, 'uRes', logical);
    this.setU(prog, 'uTexel', input ? [1 / input.w, 1 / input.h] : [0, 0]);
    this.setU(prog, 'uT', t);
    for (const [k, v] of Object.entries(uniforms)) this.setU(prog, k, v);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return true;
  }

  /** Gambar tekstur sebagai quad bertransform (ruang layer → ruang scene) dengan blend premultiplied. */
  private drawQuad(
    tex: Tex,
    m: Affine,
    size: [number, number],
    ctx: SceneCtx,
    out: Tex,
    opacity: number,
    additive = false,
  ) {
    const prog = this.program('quad');
    if (!prog) return;
    const gl = this.gl;
    gl.useProgram(prog.p);
    this.target(out);
    this.bindTex(0, tex.tex);
    const l0 = this.ul(prog, 'uTex');
    if (l0) gl.uniform1i(l0, 0);
    // Matriks scene px → piksel keluaran sudah ditangani lewat uScene (NDC dihitung dari ukuran scene).
    this.setU(prog, 'uM', [m[0], m[1], 0, m[2], m[3], 0, m[4], m[5], 1]);
    this.setU(prog, 'uScene', [ctx.scene.width, ctx.scene.height]);
    this.setU(prog, 'uSize', size);
    this.setU(prog, 'uOpacity', opacity);
    gl.enable(gl.BLEND);
    if (additive) gl.blendFunc(gl.ONE, gl.ONE);
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disable(gl.BLEND);
  }

  private drawFull(tex: Tex, out: Tex, opacity: number, additive = false) {
    const prog = this.program('copy');
    if (!prog) return;
    const gl = this.gl;
    gl.useProgram(prog.p);
    this.target(out);
    this.bindTex(0, tex.tex);
    const l0 = this.ul(prog, 'uTex');
    if (l0) gl.uniform1i(l0, 0);
    this.setU(prog, 'uOpacity', opacity);
    gl.enable(gl.BLEND);
    if (additive) gl.blendFunc(gl.ONE, gl.ONE);
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.BLEND);
  }

  /* ───────── media ───────── */

  private mediaTexture(entry: GlMedia[string] | undefined): { tex: WebGLTexture; w: number; h: number } | null {
    if (!entry) return null;
    const gl = this.gl;
    const el = entry.el;
    let w = 0;
    let h = 0;
    let stamp = '';
    if (entry.kind === 'image') {
      if (el instanceof HTMLImageElement) {
        if (!el.complete || !el.naturalWidth) return null;
        w = el.naturalWidth;
        h = el.naturalHeight;
      } else {
        w = (el as HTMLCanvasElement).width;
        h = (el as HTMLCanvasElement).height;
        if (!w || !h) return null;
      }
      stamp = 'img';
    } else {
      const v = el as HTMLVideoElement;
      if (v.readyState < 2 || !v.videoWidth) {
        const old = this.mediaTex.get(el);
        return old ? { tex: old.tex, w: old.w, h: old.h } : null;
      }
      w = v.videoWidth;
      h = v.videoHeight;
      stamp = `${v.currentTime.toFixed(4)}`;
    }
    let rec = this.mediaTex.get(el);
    if (!rec) {
      rec = { tex: gl.createTexture()!, w, h, stamp: '' };
      this.mediaTex.set(el, rec);
    }
    if (rec.stamp !== stamp) {
      gl.bindTexture(gl.TEXTURE_2D, rec.tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el as TexImageSource);
      } catch (err) {
        console.error('[gl] gagal mengunggah media ke GPU:', err);
        return null;
      }
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      const mip = entry.kind === 'image';
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (mip) gl.generateMipmap(gl.TEXTURE_2D);
      rec.w = w;
      rec.h = h;
      rec.stamp = stamp;
    }
    return { tex: rec.tex, w: rec.w, h: rec.h };
  }

  /* ───────── isi layer ───────── */

  private fillColor(layer: Layer): [number, number, number, number] {
    const m = /rgba?\(([^)]+)\)/.exec(layer.color);
    if (m) {
      const p = m[1].split(',').map((x) => Number(x.trim()));
      return [p[0] / 255, p[1] / 255, p[2] / 255, p.length > 3 ? p[3] : 1];
    }
    const h = /^#?([0-9a-f]{6})$/i.exec(layer.color.trim());
    if (h) {
      const n = parseInt(h[1], 16);
      return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
    }
    return [0.24, 0.31, 0.6, 1];
  }

  private cssToVec(css: string): [number, number, number, number] {
    const m = /rgba?\(([^)]+)\)/.exec(css);
    if (m) {
      const p = m[1].split(',').map((x) => Number(x.trim()));
      return [p[0] / 255, p[1] / 255, p[2] / 255, p.length > 3 ? p[3] : 1];
    }
    const h = /^#?([0-9a-f]{6})$/i.exec(css.trim());
    if (h) {
      const n = parseInt(h[1], 16);
      return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
    }
    return [1, 1, 1, 1];
  }

  private renderContent(layer: Layer, w: number, h: number, K: number, ctx: SceneCtx): Tex | null {
    const tw = Math.min(MAX_TEX, Math.ceil(w * K));
    const th = Math.min(MAX_TEX, Math.ceil(h * K));
    const out = this.tex(tw, th);
    const media = layer.mediaRef ? this.mediaTexture(ctx.media[layer.mediaRef]) : null;
    const isMediaLayer = layer.type === 'image' || layer.type === 'video';
    const kind = layer.shape === 'circle' || layer.shape === 'ellipse' ? 2 : layer.shape === 'roundrect' ? 1 : 0;
    const fill = isMediaLayer ? 2 : layer.fillType === 'gradient' && layer.gradient ? 1 : 0;
    const g = layer.gradient;
    const gs = g ? this.cssToVec(g.startColor) : [0, 0, 0, 1];
    const ge = g ? this.cssToVec(g.endColor) : [1, 1, 1, 1];
    const stroke = layer.stroke ? this.cssToVec(layer.stroke.color) : [1, 1, 1, 0];
    const mode = layer.fillMode === 'stretch' ? 2 : layer.fillMode === 'fit' ? 1 : 0;
    const ok = this.pass(
      'content',
      null,
      out,
      [w, h],
      0,
      {
        uSize: [w, h],
        uPx: tw / w,
        uKind: kind,
        uRadius: layer.cornerRadius ?? 0,
        uFill: fill,
        uColor: this.fillColor(layer),
        uG0: gs,
        uG1: ge,
        uGs: g ? g.start : [0, 0],
        uGe: g ? g.end : [1, 1],
        uMediaSize: media ? [media.w, media.h] : [1, 1],
        uMode: mode,
        uHasMedia: media ? 1 : 0,
        uStrokeColor: stroke,
        uStrokeW: layer.stroke?.size ?? 0,
      },
      media ? { unit: 1, tex: media.tex, name: 'uMedia' } : undefined,
    );
    if (!ok) {
      this.free(out);
      return null;
    }
    return out;
  }

  /* ───────── efek ───────── */

  private bool(fx: LayerEffect, name: string, def = false): number {
    const raw = fx.params?.[name]?.raw;
    if (raw === undefined || raw === '') return def ? 1 : 0;
    return raw === 'true' || raw === '1' ? 1 : 0;
  }

  /**
   * Terapkan satu efek shader. Mengembalikan tekstur baru (input sudah dibebaskan bila `owned`),
   * atau input apa adanya bila efek tidak dikenal / gagal.
   */
  private applyEffect(
    fx: LayerEffect,
    cur: Tex,
    owned: boolean,
    logical: [number, number],
    tl: number,
    t: number,
  ): { tex: Tex; owned: boolean } {
    const base = effectBase(fx.name);
    const n = (name: string, d = 0) => fxNum(fx, name, t, d);
    const sizeOf = (tx: Tex) => [tx.w, tx.h] as const;
    const run = (shader: string, u: Record<string, number | number[]>): { tex: Tex; owned: boolean } => {
      const out = this.tex(...sizeOf(cur));
      const ok = this.pass(shader, cur, out, logical, tl, u);
      if (!ok) {
        this.free(out);
        return { tex: cur, owned };
      }
      if (owned) this.free(cur);
      return { tex: out, owned: true };
    };
    const pxPerLogical = cur.w / logical[0];

    switch (base) {
      case 'gaussianblur': {
        const radius = n('strength', 0) * 3 * pxPerLogical; // texel
        if (radius <= 0.01) return { tex: cur, owned };
        const a = this.tex(...sizeOf(cur));
        const b = this.tex(...sizeOf(cur));
        const ok1 = this.pass('blur', cur, a, logical, tl, { uDir: [radius, 0] });
        const ok2 = ok1 && this.pass('blur', a, b, logical, tl, { uDir: [0, radius] });
        this.free(a);
        if (!ok2) {
          this.free(b);
          return { tex: cur, owned };
        }
        if (owned) this.free(cur);
        return { tex: b, owned: true };
      }
      case 'hueshift': return run('hueshift', { uHue: n('hue', 0) });
      case 'exposure': return run('exposure', { uExp: n('exposure', 0), uGamma: n('gamma', 1), uOff: n('offset', 0) });
      case 'brightcont': return run('brightcont', { uBri: n('brightness', 0), uCon: n('contrast', 0) });
      case 'satvib': return run('satvib', { uSat: n('saturation', 1), uVib: n('vib', 1) });
      case 'sharpen': return run('sharpen', { uStr: n('strength', 0) });
      case 'lumakey': return run('lumakey', { uLow: n('lowThreshold', 0), uHigh: n('highThreshold', 1), uFeather: n('feather', 0.05), uInvert: this.bool(fx, 'invert') });
      case 'tile':
        return run('tile', { uScale: n('scale', 1), uPhase: n('phase', 0), uMirror: this.bool(fx, 'mirror'), uVOff: this.bool(fx, 'vertoffs'), uAngle: n('angle', 0) });
      case 'wipe': return run('wipe', { uAngle: n('angle', 0), uStart: n('start', 0), uEnd: n('end', 1), uFeather: n('feather', 0) });
      case 'wavewarp':
        return run('wavewarp', { uPhase: n('phase', 0), uA1: n('a1d', 0), uM1: n('m1', 0), uA2: n('a2d', 0), uM2: n('m2', 0) });
      case 'randomdisplace':
        return run('randomdisplace', { uMag: n('mag', 0), uEvo: n('evolution', 0), uSeed: n('seed', 0), uScatter: n('scatter', 0.5) });
      case 'zoomblur': return run('zoomblur', { uStr: n('strength', 0) });
      case 'circularripple':
        return run('circularripple', { uFreq: n('frequency', 1), uPhase: n('phase', 0), uRadius: n('radius', 1), uStr: n('strength', 0), uFeather: n('feather', 0.1) });
      case 'displacemap': {
        const offs = fxVec(fx, 'offs', t, [0, 0]);
        return run('displacemap', { uOffs: [offs[0], offs[1]], uTx: n('typex', 0), uTy: n('typey', 0), uInv: this.bool(fx, 'invert') });
      }
      case 'stretchsegment': return run('stretchsegment', { uAngle: n('angle', 0), uStretch: n('stretch', 0), uOffset: n('offset', 0) });
      case 'mirror': return run('mirror', { uType: n('type', 0), uAlpha: n('alpha', 1), uOffset: n('offset', 0) });
      case 'gradientoverlay': {
        const c1 = fx.params?.color1?.rgba ?? [1, 1, 1, 1];
        const c2 = fx.params?.color2?.rgba ?? [0, 0, 0, 1];
        const off = fxVec(fx, 'offset', t, [0, 0]);
        return run('gradientoverlay', {
          uC1: [...c1], uC2: [...c2], uAngle: n('angle', 0), uScale: n('scale', 1), uAlpha: n('alpha', 1),
          uType: n('gradType', 0), uBlend: n('blendMode', 0), uOffs: [off[0], off[1]],
        });
      }
      case 'fourcolorgradient': {
        const col = (k: string, d: number[]) => [...(fx.params?.[k]?.rgba ?? d)];
        const off = (k: string) => { const v = fxVec(fx, k, t, [0, 0]); return [v[0], v[1]]; };
        return run('fourcolorgradient', {
          uC1: col('color1', [0, 0, 0, 1]), uC2: col('color2', [1, 1, 1, 1]), uC3: col('color3', [0, 0, 0, 1]), uC4: col('color4', [1, 1, 1, 1]),
          uO1: off('offset1'), uO2: off('offset2'), uO3: off('offset3'), uO4: off('offset4'),
          uAlpha: n('alpha', 1), uBlend: n('blend', 0.5), uBlendMode: n('blendMode', 0),
        });
      }
      default:
        return { tex: cur, owned };
    }
  }

  /* ───────── satu layer ───────── */

  private mainOf(ctx: SceneCtx): Tex {
    return this.tex(ctx.W, ctx.H);
  }

  /** Buat hasil layer (isi + rantai efek) pada waktu tau. Pemanggil membebaskan `tex`. */
  private layerResult(layer: Layer, tau: number, ev: LayerEval, ctx: SceneCtx, main: Main): LayerResult | null {
    const scene = ctx.scene;
    const w = layer.width || (layer.embed ? layer.embed.width : scene.width * 0.4);
    const h = layer.height || (layer.embed ? layer.embed.height : scene.height * 0.3);
    const maxScale = Math.max(Math.abs(ev.sx), Math.abs(ev.sy), 1e-3);
    const K = quantK(Math.min(4, Math.max(0.25, ctx.S * maxScale)));

    let content: Tex | null;
    if (layer.embed) content = this.renderEmbed(layer, tau, K, ctx);
    else content = this.renderContent(layer, w, h, K, ctx);
    if (!content) return null;

    let cur: Tex = content;
    let owned = true;
    let mode: 'layer' | 'region' = 'layer';
    let logical: [number, number] = [w, h];
    let mask: Tex | undefined;
    let fill = 0;

    if (ctx.opts.effects !== false) {
      for (const fx of layer.effects) {
        if (!fx.enabled) continue;
        const base = effectBase(fx.name);
        if (base === 'lift') {
          // Hipotesis: `lift` membuat bentuk layer menjadi AREA; efek sesudahnya diterapkan ke gambar
          // di bawahnya (backdrop) dan hanya terlihat di dalam bentuk. fill = seberapa jauh isi
          // bentuk sendiri ikut tampil (0 = tidak sama sekali).
          if (mode === 'layer') {
            const baked = this.tex(ctx.W, ctx.H);
            this.clear(baked);
            this.drawQuad(cur, ev.m, [w, h], ctx, baked, 1);
            if (owned) this.free(cur);
            const copy = this.tex(ctx.W, ctx.H);
            this.pass('copy', main.cur, copy, [ctx.W, ctx.H], 0, { uOpacity: 1 });
            mask = baked;
            fill = fxNum(fx, 'fill', tau, 0);
            cur = copy;
            owned = true;
            mode = 'region';
            logical = [scene.width, scene.height];
          }
          continue;
        }
        if (['oscillate', 'swing', 'fade', 'motionblur'].includes(base)) continue;
        if (ctx.opts.skipEffects?.includes(base)) continue;
        const r = this.applyEffect(fx, cur, owned, logical, ev.tl, tau);
        cur = r.tex;
        owned = r.owned;
      }
    }
    return { tex: cur, mode, w, h, mask, fill };
  }

  /** Render scene bersarang (embedScene) ke tekstur. */
  private renderEmbed(layer: Layer, tau: number, K: number, ctx: SceneCtx): Tex | null {
    const inner = layer.embed!;
    const S = ctx.S;
    const sub: SceneCtx = {
      scene: inner,
      index: layerIndex(inner.layers),
      media: ctx.media,
      W: Math.min(MAX_TEX, Math.round(inner.width * Math.max(S, K * 0.5))),
      H: Math.min(MAX_TEX, Math.round(inner.height * Math.max(S, K * 0.5))),
      S: Math.max(S, K * 0.5),
      opts: ctx.opts,
    };
    const tInner = Math.max(0, Math.min(inner.duration, tau - layer.start));
    const main = this.renderSceneInto(sub, tInner, [0, 0, 0, 0]);
    this.free(main.alt);
    return main.cur;
  }

  private blendLayer(
    result: LayerResult,
    m: Affine,
    opacity: number,
    blendName: string | undefined,
    main: Main,
    ctx: SceneCtx,
  ) {
    if (result.mode === 'region' && result.mask) {
      const ok = this.pass(
        'region', main.cur, main.alt, [ctx.W, ctx.H], 0,
        { uOpacity: opacity, uFill: result.fill ?? 0 },
        [
          { unit: 1, tex: result.tex.tex, name: 'uProc' },
          { unit: 2, tex: result.mask.tex, name: 'uMask' },
        ],
      );
      if (ok) {
        const t = main.cur;
        main.cur = main.alt;
        main.alt = t;
      }
      return;
    }
    const mode = blendIndex(blendName);
    if (mode === 0) {
      this.drawQuad(result.tex, m, [result.w, result.h], ctx, main.cur, opacity);
      return;
    }
    // Mode blend khusus: render layer ke tekstur sementara lalu campur dengan backdrop.
    const tmp = this.tex(ctx.W, ctx.H);
    this.clear(tmp);
    this.drawQuad(result.tex, m, [result.w, result.h], ctx, tmp, 1);
    this.blendPass(tmp, opacity, mode, main, ctx);
    this.free(tmp);
  }

  private blendPass(src: Tex, opacity: number, mode: number, main: Main, ctx: SceneCtx) {
    const ok = this.pass('blend', main.cur, main.alt, [ctx.W, ctx.H], 0, { uOpacity: opacity, uMode: mode }, { unit: 1, tex: src.tex, name: 'uSrc' });
    if (ok) {
      const t = main.cur;
      main.cur = main.alt;
      main.alt = t;
    }
  }

  private drawLayer(layer: Layer, t: number, main: Main, ctx: SceneCtx) {
    const ev = evalLayer(layer, t, ctx.index);
    if (ev.opacity <= 0.001) return;

    const hasLift = layer.effects.some((f) => f.enabled && effectBase(f.name) === 'lift');
    const mb =
      ctx.opts.effects !== false && !hasLift
        ? layer.effects.find((f) => f.enabled && effectBase(f.name) === 'motionblur')
        : undefined;
    const samples = ctx.opts.motionSamples ?? 5;

    if (mb && samples > 1) {
      const tune = fxNum(mb, 'tune', t, 1);
      const shutter = Math.max(1, (1000 / (ctx.scene.fps || 30)) * 0.75 * tune);
      const acc = this.tex(ctx.W, ctx.H);
      this.clear(acc);
      for (let i = 0; i < samples; i += 1) {
        const tau = t - (shutter * i) / (samples - 1);
        const e = evalLayer(layer, tau, ctx.index);
        const res = this.layerResult(layer, tau, e, ctx, main);
        if (!res) continue;
        this.drawQuad(res.tex, e.m, [res.w, res.h], ctx, acc, 1 / samples, true);
        this.free(res.tex);
      }
      const mode = blendIndex(layer.blending);
      if (mode === 0) this.drawFull(acc, main.cur, ev.opacity);
      else this.blendPass(acc, ev.opacity, mode, main, ctx);
      this.free(acc);
      return;
    }

    const res = this.layerResult(layer, t, ev, ctx, main);
    if (!res) return;
    this.blendLayer(res, ev.m, ev.opacity, layer.blending, main, ctx);
    this.free(res.tex);
    if (res.mask) this.free(res.mask);
  }

  /* ───────── scene ───────── */

  private renderSceneInto(ctx: SceneCtx, t: number, bg: [number, number, number, number]): Main {
    const main: Main = { cur: this.mainOf(ctx), alt: this.mainOf(ctx) };
    this.clear(main.cur, bg[0], bg[1], bg[2], bg[3]);
    for (const layer of ctx.scene.layers) {
      if (!isDrawable(layer, t)) continue;
      if (ctx.opts.onlyLayers && !ctx.opts.onlyLayers.includes(layer.id)) continue;
      if (layer.type === 'scene' && !layer.embed) continue;
      if (layer.type === 'group' && !layer.children.length) continue;
      this.drawLayer(layer, t, main, ctx);
      for (const child of layer.children) {
        if (isDrawable(child, t)) this.drawLayer(child, t, main, ctx);
      }
    }
    return main;
  }

  /** Gambar satu frame ke canvas dengan ukuran canvas.width × canvas.height. */
  render(scene: Scene, opts: GlOptions) {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const ctx: SceneCtx = {
      scene,
      index: layerIndex(scene.layers),
      media: opts.media,
      W,
      H,
      S: W / scene.width,
      opts,
    };
    const bg = this.cssToVec(scene.bgColor ?? '#000000');
    const main = this.renderSceneInto(ctx, opts.timeMs, [bg[0] * bg[3], bg[1] * bg[3], bg[2] * bg[3], 1]);
    // Salin ke canvas (framebuffer default).
    const gl = this.gl;
    const prog = this.program('copy');
    if (prog) {
      gl.useProgram(prog.p);
      gl.disable(gl.BLEND);
      this.target(null, W, H);
      this.bindTex(0, main.cur.tex);
      const l0 = this.ul(prog, 'uTex');
      if (l0) gl.uniform1i(l0, 0);
      this.setU(prog, 'uOpacity', 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    this.free(main.cur);
    this.free(main.alt);
  }
}
