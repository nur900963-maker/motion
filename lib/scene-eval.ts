import type { Layer, LayerEffect, Scene } from './types';
import { effectBase, sampleKeyframes } from './am-xml';

/**
 * Evaluasi posisi/skala/rotasi/opacity sebuah layer pada waktu t (ms), termasuk:
 *  - efek yang mengubah transform: oscillate, swing, fade
 *  - parent (null object): transform induk berlaku di sekitar titik tengah induk
 *
 * Matriks afin [a,b,c,d,e,f]: x' = a·x + c·y + e,  y' = b·x + d·y + f  (sumbu y ke bawah, seperti Alight Motion).
 */

export type Affine = [number, number, number, number, number, number];
export const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

export const mul = (p: Affine, q: Affine): Affine => [
  p[0] * q[0] + p[2] * q[1],
  p[1] * q[0] + p[3] * q[1],
  p[0] * q[2] + p[2] * q[3],
  p[1] * q[2] + p[3] * q[3],
  p[0] * q[4] + p[2] * q[5] + p[4],
  p[1] * q[4] + p[3] * q[5] + p[5],
];

export const apply = (m: Affine, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

export function invert(m: Affine): Affine | null {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) return null;
  const a = m[3] / det;
  const b = -m[1] / det;
  const c = -m[2] / det;
  const d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

export function trs(x: number, y: number, rotDeg: number, sx: number, sy: number): Affine {
  const r = (rotDeg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return [cos * sx, sin * sx, -sin * sy, cos * sy, x, y];
}

export type LayerEval = {
  m: Affine;
  x: number;
  y: number;
  sx: number;
  sy: number;
  rot: number;
  opacity: number;
  /** detik sejak layer mulai (dikali speed) — dasar animasi efek berbasis waktu */
  tl: number;
};

export const fxNum = (fx: LayerEffect, name: string, t: number, def: number): number => {
  const p = fx.params?.[name];
  if (!p) return def;
  if (p.keyframes?.length) return sampleKeyframes(p.keyframes, t, 0, def);
  return p.value[0] ?? def;
};

export const fxVec = (fx: LayerEffect, name: string, t: number, def: number[]): number[] => {
  const p = fx.params?.[name];
  if (!p) return def;
  if (p.keyframes?.length) return def.map((d, i) => sampleKeyframes(p.keyframes, t, i, d));
  return def.map((d, i) => p.value[i] ?? d);
};

export const hasEffect = (layer: Layer, base: string) => layer.effects.some((e) => e.enabled && effectBase(e.name) === base);

function wave(type: number, x: number): number {
  const f = x - Math.floor(x);
  if (type === 1) return 1 - 4 * Math.abs(f - 0.5); // segitiga
  if (type === 2) return f < 0.5 ? 1 : -1; // kotak
  return Math.sin(2 * Math.PI * x); // sinus (default)
}

export const layerIndex = (layers: Layer[]): Map<string, Layer> => {
  const map = new Map<string, Layer>();
  const walk = (list: Layer[]) => {
    for (const l of list) {
      map.set(l.id, l);
      if (l.children.length) walk(l.children);
    }
  };
  walk(layers);
  return map;
};

function baseState(layer: Layer, t: number) {
  const k = layer.keyframes;
  return {
    x: sampleKeyframes(k.location, t, 0, layer.x),
    y: sampleKeyframes(k.location, t, 1, layer.y),
    sx: sampleKeyframes(k.scale, t, 0, layer.scaleX),
    sy: sampleKeyframes(k.scale, t, 1, layer.scaleY),
    rot: sampleKeyframes(k.rotation, t, 0, layer.rotation),
    op: sampleKeyframes(k.opacity, t, 0, layer.opacity),
  };
}

export function evalLayer(layer: Layer, t: number, index: Map<string, Layer>, depth = 0): LayerEval {
  const b = baseState(layer, t);
  const tl = ((t - layer.start) / 1000) * (layer.speed && layer.speed > 0 ? layer.speed : 1);
  let { x, y, rot } = b;
  let opacity = b.op;

  for (const fx of layer.effects) {
    if (!fx.enabled) continue;
    const base = effectBase(fx.name);
    if (base === 'oscillate') {
      const mag = fxNum(fx, 'mag', t, 0);
      const freq = fxNum(fx, 'freq', t, 1);
      const ang = (fxNum(fx, 'angle', t, 0) * Math.PI) / 180;
      const w = wave(fxNum(fx, 'type', t, 0), freq * tl + fxNum(fx, 'phase', t, 0)) * mag;
      x += Math.cos(ang) * w;
      y += Math.sin(ang) * w;
    } else if (base === 'swing') {
      const a1 = fxNum(fx, 'a1', t, 0);
      const a2 = fxNum(fx, 'a2', t, 0);
      const w = 0.5 + 0.5 * wave(fxNum(fx, 'type', t, 0), fxNum(fx, 'freq', t, 1) * tl + fxNum(fx, 'phase', t, 0));
      rot += a1 + (a2 - a1) * w;
    } else if (base === 'fade') {
      const inT = fxNum(fx, 'inTime', t, 0);
      const outT = fxNum(fx, 'outTime', t, 0);
      const local = (t - layer.start) / 1000;
      const dur = (layer.end - layer.start) / 1000;
      if (inT > 0) opacity *= Math.min(1, Math.max(0, local / inT));
      if (outT > 0) opacity *= Math.min(1, Math.max(0, (dur - local) / outT));
    }
  }

  let m = trs(x, y, rot, b.sx, b.sy);

  // Parent: transform induk berlaku di sekitar titik tengah induk (posisi dasarnya).
  m = mul(parentDelta(layer, t, index, depth), m);
  return { m, x, y, sx: b.sx, sy: b.sy, rot, opacity: Math.min(1, Math.max(0, opacity)), tl };
}

/** Delta gabungan dari rantai parent di atas `layer` (tanpa transform layer itu sendiri). */
function parentDelta(layer: Layer, t: number, index: Map<string, Layer>, depth: number): Affine {
  if (!layer.parent || depth >= 4) return IDENTITY;
  const parent = index.get(layer.parent);
  if (!parent || parent === layer) return IDENTITY;
  const pe = evalLayer(parent, t, index, depth + 1);
  const delta = mul(trs(pe.x, pe.y, pe.rot, pe.sx, pe.sy), [1, 0, 0, 1, -parent.x, -parent.y]);
  return mul(parentDelta(parent, t, index, depth + 1), delta);
}

/** Layer aktif (terlihat) pada waktu t, dalam urutan gambar. Null object & audio tidak digambar. */
export const isDrawable = (l: Layer, t: number) =>
  l.visible && t >= l.start && t <= l.end && l.type !== 'audio' && l.type !== 'null';

/** Waktu (detik) di dalam file video untuk layer video pada waktu timeline t. */
export function videoTimeSec(layer: Layer, t: number): number {
  const speed = layer.speed && layer.speed > 0 ? layer.speed : 1;
  return Math.max(0, ((layer.inTime ?? 0) + (t - layer.start) * speed) / 1000);
}

/** Layer paling atas yang mengenai titik (px,py) pada koordinat scene. */
export function hitTest(scene: Scene, t: number, px: number, py: number): Layer | null {
  const index = layerIndex(scene.layers);
  const list = scene.layers.filter((l) => isDrawable(l, t));
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const l = list[i];
    const ev = evalLayer(l, t, index);
    const inv = invert(ev.m);
    if (!inv) continue;
    const [lx, ly] = apply(inv, px, py);
    const w = l.width || scene.width * 0.4;
    const h = l.height || scene.height * 0.3;
    if (Math.abs(lx) <= w / 2 && Math.abs(ly) <= h / 2) return l;
  }
  return null;
}

/** Empat sudut layer di koordinat scene (untuk overlay pilihan). */
export function layerCorners(scene: Scene, l: Layer, t: number): [number, number][] {
  const ev = evalLayer(l, t, layerIndex(scene.layers));
  const w = (l.width || scene.width * 0.4) / 2;
  const h = (l.height || scene.height * 0.3) / 2;
  return [
    apply(ev.m, -w, -h),
    apply(ev.m, w, -h),
    apply(ev.m, w, h),
    apply(ev.m, -w, h),
  ];
}
