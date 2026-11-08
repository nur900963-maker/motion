import type { Layer, Scene } from './types';
import { argbToCss, blendToComposite, sampleKeyframes } from './am-xml';

/**
 * Renderer canvas 2D untuk scene Alight Motion.
 *
 * Semua gambar yang terlihat di preview dan yang direkam saat ekspor berasal dari
 * fungsi `drawFrame` yang sama, sehingga hasil ekspor benar-benar hasil render scene.
 *
 * Yang dirender:
 *  - posisi/skala/rotasi/opacity berkeyframe (easing cubic-bezier + elastic/bounce/hold),
 *  - isian media / warna / gradien, bentuk rect/roundrect/circle, mode blend,
 *  - stroke (<path-stroke>) dan glow/bayangan (<shadow>),
 *  - efek transformasi: oscillate, swing, fade, wipe,
 *  - efek piksel via pipeline offscreen: lumakey, randomdisplace, wavewarp, zoomblur,
 *    circularripple, mirror, stretchsegment, displacemap (perkiraan),
 *  - efek kanvas: tile (mirror tile), motionblur (multi-sampling transform),
 *  - efek warna via ctx.filter: exposure, brightcont, gaussianblur, hueshift, satvib,
 *    sharpen, lift,
 *  - overlay: fourcolorgradient, gradientoverlay.
 *
 * Semua efek adalah PERKIRAAN canvas 2D — bukan salinan shader Alight Motion.
 */

export type MediaMap = Record<string, { el: HTMLImageElement | HTMLVideoElement; kind: 'image' | 'video' }>;

export type DrawOptions = {
  timeMs: number;
  media: MediaMap;
  selectedId?: string | null;
  debug?: boolean;
  showSafeArea?: boolean;
  /** false = abaikan efek (mode hemat). Default true. */
  effects?: boolean;
};

const kfValue = (layer: Layer, prop: string, t: number, fb: number) => sampleKeyframes(layer.keyframes[prop], t, 0, fb);
const kfPair = (layer: Layer, prop: string, t: number, fx: number, fy: number): [number, number] => [
  sampleKeyframes(layer.keyframes[prop], t, 0, fx),
  sampleKeyframes(layer.keyframes[prop], t, 1, fy),
];

const baseName = (id: string): string => id.replace(/\d+$/, '');
const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));

function paramAt(layer: Layer, fxIndex: number, name: string, t: number, fallback: number): number {
  const p = layer.effects[fxIndex]?.params?.[name];
  if (!p) return fallback;
  if (p.keyframes?.length) return sampleKeyframes(p.keyframes, t, 0, fallback);
  return p.value[0] ?? fallback;
}

/** Nilai boolean (switch) efek: true kalau nilai pertamanya > 0.5. */
function boolParam(layer: Layer, fxIndex: number, name: string, fallback: boolean): boolean {
  const v = layer.effects[fxIndex]?.params?.[name]?.value[0];
  return v === undefined ? fallback : v > 0.5;
}

/** Komponen vec2 parameter efek (mis. offset "0,200"). */
function vecParam(layer: Layer, fxIndex: number, name: string): number[] {
  return layer.effects[fxIndex]?.params?.[name]?.value ?? [];
}

function colorParamAt(layer: Layer, fxIndex: number, name: string, fallback: string): string {
  const p = layer.effects[fxIndex]?.params?.[name];
  if (!p) return fallback;
  return argbToCss(p.raw || undefined, fallback);
}

/** Semua instance efek aktif dengan nama dasar tertentu (urut sesuai stack XML). */
function findFx(layer: Layer, base: string): { fx: Layer2Effect; index: number }[] {
  const out: { fx: Layer2Effect; index: number }[] = [];
  layer.effects.forEach((fx, index) => {
    if (fx.enabled && baseName(fx.name) === base) out.push({ fx, index });
  });
  return out;
}
type Layer2Effect = Layer['effects'][number];

/* ───────────── kumpulan canvas sementara (di-pakai-ulang antar frame) ───────────── */

const pool: HTMLCanvasElement[] = [];
function getTmp(i: number, w: number, h: number): CanvasRenderingContext2D {
  const cw = Math.max(2, Math.ceil(w));
  const ch = Math.max(2, Math.ceil(h));
  let c = pool[i];
  if (!c) {
    c = document.createElement('canvas');
    pool[i] = c;
  }
  if (c.width !== cw || c.height !== ch) {
    c.width = cw;
    c.height = ch;
  }
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('canvas 2d tidak tersedia');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  return ctx;
}
function tmpCanvas(i: number): HTMLCanvasElement {
  return pool[i];
}

/** PRNG deterministik untuk randomdisplace/displacemap. */
function hash01(seed: number): number {
  let x = (seed | 0) + 0x6d2b79f5;
  x = Math.imul(x ^ (x >>> 15), 1 | x);
  x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
}

/** Gelombang osilasi: 0 = sine, 1 = triangle, lainnya = square. */
function waveShape(type: number, phase: number): number {
  const p = phase - Math.floor(phase);
  if (type === 1) return 4 * Math.abs(p - 0.5) - 1;
  if (type === 2) return p < 0.5 ? 1 : -1;
  return Math.sin(p * Math.PI * 2);
}

/* ───────────── efek warna → ctx.filter ───────────── */

function effectFilter(layer: Layer, t: number): string {
  const parts: string[] = [];
  layer.effects.forEach((fx, i) => {
    if (!fx.enabled) return;
    const base = baseName(fx.name);
    if (base === 'gaussianblur') {
      const s = paramAt(layer, i, 'strength', t, 0);
      if (s > 0) parts.push(`blur(${clamp(s * 2, 0, 60).toFixed(2)}px)`);
    } else if (base === 'hueshift') {
      parts.push(`hue-rotate(${paramAt(layer, i, 'hue', t, 0).toFixed(1)}deg)`);
    } else if (base === 'exposure') {
      const ex = paramAt(layer, i, 'exposure', t, 0);
      if (ex) parts.push(`brightness(${Math.pow(2, ex).toFixed(3)})`);
      const gamma = paramAt(layer, i, 'gamma', t, 1);
      if (Math.abs(gamma - 1) > 0.01) parts.push(`contrast(${clamp(Math.pow(gamma, -0.6), 0.2, 3).toFixed(3)})`);
    } else if (base === 'satvib') {
      const sat = paramAt(layer, i, 'saturation', t, 1);
      const vib = paramAt(layer, i, 'vib', t, 0);
      const s = sat + vib * 0.35;
      parts.push(`saturate(${clamp(s, 0, 4).toFixed(3)})`);
    } else if (base === 'sharpen') {
      const s = paramAt(layer, i, 'strength', t, 0);
      if (s > 0) parts.push(`contrast(${clamp(1 + s * 0.35, 1, 2.5).toFixed(3)})`);
    } else if (base === 'brightcont') {
      const br = paramAt(layer, i, 'brightness', t, 0);
      const co = paramAt(layer, i, 'contrast', t, 0);
      if (br) parts.push(`brightness(${clamp(1 + br, 0.05, 4).toFixed(3)})`);
      if (co) parts.push(`contrast(${clamp(1 + co, 0.05, 4).toFixed(3)})`);
    } else if (base === 'lift') {
      // Lift menaikkan level hitam → approximasi brightness lembut.
      const fill = paramAt(layer, i, 'fill', t, 0);
      if (fill > 0) parts.push(`brightness(${clamp(1 + fill * 0.45, 1, 2).toFixed(3)})`);
    }
  });
  return parts.join(' ') || 'none';
}

/* ───────────── bentuk & isi dasar ───────────── */

function shapePath(ctx: CanvasRenderingContext2D, kind: string, w: number, h: number, radius: number) {
  ctx.beginPath();
  if (kind === 'circle' || kind === 'ellipse') {
    ctx.ellipse(0, 0, Math.abs(w) / 2, Math.abs(h) / 2, 0, 0, Math.PI * 2);
    return;
  }
  const r = kind === 'roundrect' ? Math.min(radius, Math.abs(w) / 2, Math.abs(h) / 2) : 0;
  const x = -w / 2;
  const y = -h / 2;
  if (r <= 0) {
    ctx.rect(x, y, w, h);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawMedia(
  ctx: CanvasRenderingContext2D,
  el: HTMLImageElement | HTMLVideoElement,
  kind: 'image' | 'video',
  w: number,
  h: number,
  mode: string | undefined,
) {
  const iw = kind === 'image' ? (el as HTMLImageElement).naturalWidth : (el as HTMLVideoElement).videoWidth;
  const ih = kind === 'image' ? (el as HTMLImageElement).naturalHeight : (el as HTMLVideoElement).videoHeight;
  if (!iw || !ih) return;
  try {
    if (mode === 'stretch') {
      ctx.drawImage(el, -w / 2, -h / 2, w, h);
    } else if (mode === 'fit') {
      const k = Math.min(w / iw, h / ih);
      ctx.drawImage(el, (-iw * k) / 2, (-ih * k) / 2, iw * k, ih * k);
    } else {
      // 'fill' (default Alight Motion) = tutup seluruh bentuk, potong yang berlebih.
      const k = Math.max(w / iw, h / ih);
      ctx.drawImage(el, (-iw * k) / 2, (-ih * k) / 2, iw * k, ih * k);
    }
  } catch {
    /* video belum siap */
  }
}

/** Gambar isi layer (media/teks/bentuk) pada sistem koordinat yang sudah di-translate ke pusat. */
function drawContent(
  ctx: CanvasRenderingContext2D,
  layer: Layer,
  t: number,
  scene: Scene,
  opts: DrawOptions,
  w: number,
  h: number,
) {
  const kind = layer.shape || 'rect';
  const radius = layer.cornerRadius ?? 0;

  if (layer.type === 'image' || layer.type === 'video') {
    const media = layer.mediaRef ? opts.media[layer.mediaRef] : undefined;
    if (media) {
      ctx.save();
      shapePath(ctx, kind, w, h, radius);
      ctx.clip();
      if (media.kind === 'video') {
        // speed layer (mis. 0.585×) → kecepatan pemutaran video mengikuti
        const sp = Number(layer.raw.speed ?? '1');
        const v = media.el as HTMLVideoElement;
        if (Number.isFinite(sp) && sp > 0.01 && Math.abs(v.playbackRate - sp) > 0.005) {
          try {
            v.playbackRate = Math.min(16, sp);
          } catch {
            /* tidak didukung */
          }
        }
      }
      drawMedia(ctx, media.el, media.kind, w, h, layer.fillMode);
      ctx.restore();
    } else {
      // Slot kosong: placeholder yang jelas (bukan data palsu).
      shapePath(ctx, kind, w, h, radius);
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.setLineDash([10, 8]);
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = `${Math.max(14, Math.min(w, h) * 0.07)}px Geist, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Slot media kosong — pasang di tab Media', 0, 0);
    }
  } else if (layer.type === 'text') {
    const size = Math.max(12, h || scene.height * 0.06);
    ctx.fillStyle = layer.color || '#ededeb';
    ctx.font = `700 ${size}px Geist, Inter, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(layer.text || layer.name, 0, 0);
  } else if (layer.type === 'shape') {
    shapePath(ctx, kind, w, h, radius);
    if (layer.fillType === 'gradient' && layer.gradient) {
      const g = layer.gradient;
      const gr = ctx.createLinearGradient(-w / 2 + g.start[0] * w, -h / 2 + g.start[1] * h, -w / 2 + g.end[0] * w, -h / 2 + g.end[1] * h);
      gr.addColorStop(0, g.startColor);
      gr.addColorStop(1, g.endColor);
      ctx.fillStyle = gr;
    } else {
      ctx.fillStyle = layer.color || '#3d4f9a';
    }
    ctx.fill();
    if (layer.stroke && layer.stroke.width > 0) {
      ctx.strokeStyle = layer.stroke.color;
      ctx.lineWidth = layer.stroke.width;
      ctx.stroke();
    }
  } else if (layer.type === 'scene' || layer.type === 'group') {
    if (!layer.children.length) {
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 2;
      shapePath(ctx, 'roundrect', w, h, 10);
      ctx.stroke();
    }
  } else if (layer.type !== 'other' || layer.effects.length) {
    ctx.fillStyle = layer.color || '#3a3a42';
    shapePath(ctx, 'roundrect', w, h, 8);
    ctx.fill();
  }
}

/* ───────────── pipeline efek piksel (offscreen) ───────────── */

/** Margin ekstra di sekeliling konten untuk efek yang menggeser piksel keluar batas. */
function padFor(layer: Layer, t: number): number {
  let pad = 0;
  layer.effects.forEach((fx, i) => {
    if (!fx.enabled) return;
    const base = baseName(fx.name);
    if (base === 'randomdisplace') pad = Math.max(pad, paramAt(layer, i, 'mag', t, 0));
    else if (base === 'displacemap') {
      const offs = fx.params?.['offs']?.value ?? [];
      pad = Math.max(pad, Math.abs(offs[0] ?? 0) + Math.abs(offs[1] ?? 0));
    } else if (base === 'wavewarp') {
      const a1 = Math.abs(paramAt(layer, i, 'a1d', t, 0));
      const a2 = Math.abs(paramAt(layer, i, 'a2d', t, 0));
      pad = Math.max(pad, Math.max(a1, a2));
    } else if (base === 'circularripple') {
      pad = Math.max(pad, Math.abs(paramAt(layer, i, 'strength', t, 0)) * 2);
    } else if (base === 'zoomblur') {
      pad = Math.max(pad, paramAt(layer, i, 'strength', t, 0) * 0.3 * Math.max(layer.width, layer.height));
    }
  });
  return clamp(pad, 0, 240);
}

/** Terapkan lumakey: piksel gelap (atau terang bila invert) dibuat transparan. */
function applyLumakey(canvas: HTMLCanvasElement, low: number, high: number, feather: number, invert: boolean): void {
  const ctx = canvas.getContext('2d');
  if (!ctx || !canvas.width || !canvas.height) return;
  let img: ImageData;
  try {
    img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  } catch {
    return;
  }
  const d = img.data;
  const featherN = Math.max(0.001, feather);
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a === 0) continue;
    // luminance tertimbang (0..1)
    const luma = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
    let keep: number;
    if (!invert) {
      // di bawah low → transparan; di atas high → tetap; di antara → lembut
      keep = clamp((luma - low) / Math.max(high - low, featherN), 0, 1);
      if (feather > 0) {
        const edge = clamp((luma - (low - feather)) / (2 * feather), 0, 1);
        keep = Math.min(keep, edge);
      }
    } else {
      keep = clamp(1 - (luma - low) / Math.max(high - low, featherN), 0, 1);
    }
    d[i + 3] = Math.round(a * keep);
  }
  ctx.putImageData(img, 0, 0);
}

/** Randomdisplace: kotak-kotak konten digeser acak deterministik (seed + evolution). */
function applyRandomDisplace(src: HTMLCanvasElement, mag: number, evolution: number, seed: number, scatter: number): void {
  if (mag <= 0.5) return;
  const w = src.width;
  const h = src.height;
  const cell = clamp(Math.round(Math.min(w, h) / 26), 10, 42);
  const dst = getTmp(3, w, h);
  const cols = Math.ceil(w / cell);
  const evoStep = Math.floor(evolution * 12);
  // vektor dasar (scatter rendah = semua kotak bergeser hampir sama)
  const baseX = (hash01(seed * 7919 + evoStep * 131 + 5) - 0.5) * 2 * mag;
  const baseY = (hash01(seed * 7919 + evoStep * 131 + 6) - 0.5) * 2 * mag;
  const sc = clamp(scatter, 0, 1);
  for (let cy = 0; cy < h; cy += cell) {
    for (let cx = 0; cx < w; cx += cell) {
      const idx = (cy / cell) * cols + (cx / cell);
      const r1 = hash01(seed * 131 + evoStep * 7919 + idx * 3 + 1);
      const r2 = hash01(seed * 131 + evoStep * 7919 + idx * 3 + 2);
      const dx = baseX * (1 - sc) + (r1 - 0.5) * 2 * mag * sc;
      const dy = baseY * (1 - sc) + (r2 - 0.5) * 2 * mag * sc;
      dst.drawImage(src, cx + dx, cy + dy, cell, cell, cx, cy, cell, cell);
    }
  }
  const sctx = src.getContext('2d');
  if (!sctx) return;
  sctx.setTransform(1, 0, 0, 1, 0, 0);
  sctx.clearRect(0, 0, w, h);
  sctx.drawImage(tmpCanvas(3), 0, 0);
}

/**
 * Displacemap tanpa peta: displacement noise halus dua sumbu (perkiraan).
 * invert membalik arah geser; fromctr mengubah noise menjadi geseran radial dari pusat.
 */
function applyDisplaceNoise(
  src: HTMLCanvasElement,
  ox: number,
  oy: number,
  evolution: number,
  invert = false,
  fromctr = false,
): void {
  if (Math.abs(ox) < 0.5 && Math.abs(oy) < 0.5) return;
  const w = src.width;
  const h = src.height;
  const cell = clamp(Math.round(Math.min(w, h) / 30), 8, 36);
  const dst = getTmp(3, w, h);
  const grid = 8 + Math.floor(evolution * 8);
  const sample = (gx: number, gy: number, axis: number) => {
    const v = hash01(gx * 131 + gy * 7919 + axis * 37 + Math.floor(evolution * 20) * 17);
    return v;
  };
  const sign = invert ? -1 : 1;
  for (let cy = 0; cy < h; cy += cell) {
    for (let cx = 0; cx < w; cx += cell) {
      const gx = (cx / w) * grid;
      const gy = (cy / h) * grid;
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const fx = gx - x0;
      const fy = gy - y0;
      const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
      const nx = lerp(lerp(sample(x0, y0, 1), sample(x0 + 1, y0, 1), fx), lerp(sample(x0, y0 + 1, 1), sample(x0 + 1, y0 + 1, 1), fx), fy);
      const ny = lerp(lerp(sample(x0, y0, 2), sample(x0 + 1, y0, 2), fx), lerp(sample(x0, y0 + 1, 2), sample(x0 + 1, y0 + 1, 2), fx), fy);
      let dx = (nx - 0.5) * 2 * ox;
      let dy = (ny - 0.5) * 2 * oy;
      if (fromctr) {
        // geseran radial: arah dari pusat ke kotak ini, besar mengikuti noise
        const ux = cx + cell / 2 - w / 2;
        const uy = cy + cell / 2 - h / 2;
        const len = Math.max(1, Math.hypot(ux, uy));
        const mag = (nx - 0.5) * 2 * Math.max(ox, oy);
        dx = (ux / len) * mag;
        dy = (uy / len) * mag;
      }
      dst.drawImage(src, cx + dx * sign, cy + dy * sign, cell + 1, cell + 1, cx, cy, cell + 1, cell + 1);
    }
  }
  const sctx = src.getContext('2d');
  if (!sctx) return;
  sctx.setTransform(1, 0, 0, 1, 0, 0);
  sctx.clearRect(0, 0, w, h);
  sctx.drawImage(tmpCanvas(3), 0, 0);
}

/**
 * Wavewarp: konten digelombangkan lewat irisan horizontal + vertikal.
 * damping/dampingOrigin/dampingSpace memodulasi amplitudo sepanjang sumbu gelombang
 * (nilai damping negatif = amplitudo membesar menjauhi titik asal — gaya khas AM).
 */
function applyWaveWarp(
  src: HTMLCanvasElement,
  a1: number,
  a2: number,
  m1: number,
  m2: number,
  phase: number,
  damping = 0,
  dampingOrigin = 0.5,
  dampingSpace = 1,
): void {
  if (Math.abs(a1) < 0.5 && Math.abs(a2) < 0.5) return;
  const w = src.width;
  const h = src.height;
  // Faktor redaman: 1 di titik asal, melinier sampai ±|damping| di tepi jangkauan dampingSpace.
  const dampMod = (pos: number): number => {
    if (!damping) return 1;
    const reach = Math.max(0.25, Math.abs(dampingSpace));
    const k = clamp(((pos - dampingOrigin) / reach) * 0.5, -1, 1);
    return clamp(1 - damping * k, 0, 4);
  };
  // Pass 1: geser horizontal per strip baris (amplitudo a1)
  const tmpA = getTmp(3, w, h);
  const strips = clamp(Math.round(h / 4), 24, 80);
  const sh = h / strips;
  for (let i = 0; i < strips; i += 1) {
    const yy = (i + 0.5) / strips;
    const dx = a1 * dampMod(yy) * Math.sin(2 * Math.PI * (yy * m1 + phase));
    tmpA.drawImage(src, 0, i * sh, w, sh + 1, dx, i * sh, w, sh + 1);
  }
  // Pass 2: geser vertikal per strip kolom (amplitudo a2)
  const tmpB = getTmp(4, w, h);
  const cols = clamp(Math.round(w / 4), 24, 80);
  const sw = w / cols;
  for (let i = 0; i < cols; i += 1) {
    const xx = (i + 0.5) / cols;
    const dy = a2 * dampMod(1 - xx) * Math.sin(2 * Math.PI * (xx * m2 + phase * 0.8));
    tmpB.drawImage(tmpCanvas(3), i * sw, 0, sw + 1, h, i * sw, dy, sw + 1, h);
  }
  const sctx = src.getContext('2d');
  if (!sctx) return;
  sctx.setTransform(1, 0, 0, 1, 0, 0);
  sctx.clearRect(0, 0, w, h);
  sctx.drawImage(tmpCanvas(4), 0, 0);
}

/** Zoomblur: beberapa salinan diskalakan dari pusat dengan alpha rendah. */
function applyZoomBlur(src: HTMLCanvasElement, strength: number): void {
  if (strength <= 0.001) return;
  const w = src.width;
  const h = src.height;
  const layers = 10;
  const dst = getTmp(3, w, h);
  for (let i = layers - 1; i >= 1; i -= 1) {
    const k = i / layers;
    const s = 1 + strength * 0.35 * k;
    dst.globalAlpha = clamp(1 - k * 0.75, 0.05, 0.5);
    dst.drawImage(src, (w - w * s) / 2, (h - h * s) / 2, w * s, h * s);
  }
  dst.globalAlpha = 1;
  dst.drawImage(src, 0, 0);
  const sctx = src.getContext('2d');
  if (!sctx) return;
  sctx.setTransform(1, 0, 0, 1, 0, 0);
  sctx.clearRect(0, 0, w, h);
  sctx.drawImage(tmpCanvas(3), 0, 0);
}

/** Circularripple: cincin konsentris digeser radial mengikuti gelombang sinus. */
function applyCircularRipple(src: HTMLCanvasElement, frequency: number, phase: number, radius: number, strength: number): void {
  if (Math.abs(strength) < 0.5) return;
  const w = src.width;
  const h = src.height;
  const cx = w / 2;
  const cy = h / 2;
  const maxR = Math.hypot(cx, cy);
  const wl = clamp(maxR / Math.max(0.35, frequency) / 6, 14, 260);
  const dst = getTmp(3, w, h);
  const rings = clamp(Math.ceil(maxR / (wl / 4)), 16, 64);
  for (let i = rings; i >= 1; i -= 1) {
    const r = (i / rings) * maxR;
    const wave = Math.sin(2 * Math.PI * ((r - radius) / wl) - phase * 2 * Math.PI);
    const fade = clamp(1 - Math.abs(r - radius) / (maxR * 0.9), 0.15, 1);
    const d = strength * wave * fade;
    const s = 1 + d / Math.max(r, 4);
    dst.drawImage(src, cx - cx * s, cy - cy * s, w * s, h * s);
  }
  dst.drawImage(src, 0, 0);
  const sctx = src.getContext('2d');
  if (!sctx) return;
  sctx.setTransform(1, 0, 0, 1, 0, 0);
  sctx.clearRect(0, 0, w, h);
  sctx.drawImage(tmpCanvas(3), 0, 0);
}

/** Mirror: refleksikan konten di sekitar sumbu (type 0 = horizontal, lainnya vertikal). */
function applyMirror(src: HTMLCanvasElement, type: number, offset: number, alpha: number, blend: GlobalCompositeOperation): void {
  const w = src.width;
  const h = src.height;
  const dst = getTmp(3, w, h);
  dst.drawImage(src, 0, 0);
  dst.globalAlpha = clamp(alpha <= 0 ? 1 : alpha, 0, 1);
  dst.globalCompositeOperation = blend;
  if (type === 0) {
    // cermin kiri ↔ kanan pada garis x = offset
    const ax = w / 2 + offset;
    dst.save();
    dst.translate(ax * 2, 0);
    dst.scale(-1, 1);
    dst.drawImage(src, 0, 0);
    dst.restore();
  } else {
    const ay = h / 2 + offset;
    dst.save();
    dst.translate(0, ay * 2);
    dst.scale(1, -1);
    dst.drawImage(src, 0, 0);
    dst.restore();
  }
  dst.globalAlpha = 1;
  dst.globalCompositeOperation = 'source-over';
  const sctx = src.getContext('2d');
  if (!sctx) return;
  sctx.setTransform(1, 0, 0, 1, 0, 0);
  sctx.clearRect(0, 0, w, h);
  sctx.drawImage(tmpCanvas(3), 0, 0);
}

/** Stretchsegment: peregangan sebagian konten sepanjang sumbu sudut tertentu. */
function applyStretchSegment(src: HTMLCanvasElement, angleDeg: number, stretch: number, offset: number, smooth = true): void {
  if (Math.abs(stretch) < 0.01) return;
  const w = src.width;
  const h = src.height;
  const rad = (angleDeg * Math.PI) / 180;
  const dst = getTmp(3, w, h);
  // geser bagian bawah/atas sepanjang sumbu (smear sederhana ala segment stretch)
  const steps = smooth ? 48 : 24;
  for (let i = 0; i < steps; i += 1) {
    const k = i / (steps - 1); // 0 = atas, 1 = bawah
    const along = (k - 0.5 - offset * 0.5) * stretch * 0.08;
    const dx = Math.cos(rad) * along * w;
    const dy = Math.sin(rad) * along * h;
    dst.drawImage(src, 0, (h / steps) * i, w, h / steps + 1, dx, (h / steps) * i + dy * 0.15, w, h / steps + 1);
  }
  const sctx = src.getContext('2d');
  if (!sctx) return;
  sctx.setTransform(1, 0, 0, 1, 0, 0);
  sctx.clearRect(0, 0, w, h);
  sctx.drawImage(tmpCanvas(3), 0, 0);
}

/** Wipe: mask gradien sepanjang sumbu sudut (start..end, feather lembut) via destination-in. */
function applyWipe(canvas: HTMLCanvasElement, angleDeg: number, start: number, end: number, feather: number): void {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const rad = (angleDeg * Math.PI) / 180;
  const cx = w / 2;
  const cy = h / 2;
  // proyeksi kotak konten ke sumbu wipe
  const extent = Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad));
  const dx = (Math.cos(rad) * extent) / 2;
  const dy = (Math.sin(rad) * extent) / 2;
  const f = clamp(feather, 0.001, 0.5);
  const grad = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(clamp(start - f / 2, 0, 1), 'rgba(0,0,0,0)');
  grad.addColorStop(clamp(start + f / 2, 0, 1), 'rgba(0,0,0,1)');
  grad.addColorStop(clamp(end - f / 2, 0, 1), 'rgba(0,0,0,1)');
  grad.addColorStop(clamp(end + f / 2, 0, 1), 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  const mask = getTmp(5, w, h);
  mask.fillStyle = grad;
  mask.fillRect(0, 0, w, h);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(tmpCanvas(5), 0, 0);
  ctx.globalCompositeOperation = 'source-over';
}

const AM_BLEND_MODES: GlobalCompositeOperation[] = [
  'source-over',
  'multiply',
  'screen',
  'overlay',
  'lighten',
  'darken',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
  'lighter',
];
const amBlend = (n: number): GlobalCompositeOperation => AM_BLEND_MODES[clamp(Math.round(n), 0, AM_BLEND_MODES.length - 1)];

/** Overlay gradien 4 warna (fourcolorgradient) di atas konten (source-atop). */
function applyFourColorGradient(
  canvas: HTMLCanvasElement,
  layer: Layer,
  fxIndex: number,
  t: number,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  const c1 = colorParamAt(layer, fxIndex, 'color1', '#000000');
  const c2 = colorParamAt(layer, fxIndex, 'color2', '#555555');
  const c3 = colorParamAt(layer, fxIndex, 'color3', '#aaaaaa');
  const c4 = colorParamAt(layer, fxIndex, 'color4', '#ffffff');
  const o1 = layer.effects[fxIndex]?.params?.['offset1']?.value ?? [0, 0];
  const o2 = layer.effects[fxIndex]?.params?.['offset2']?.value ?? [1, 0];
  const o3 = layer.effects[fxIndex]?.params?.['offset3']?.value ?? [0, 1];
  const alpha = clamp(paramAt(layer, fxIndex, 'alpha', t, 1), 0, 1);
  const blend = amBlend(paramAt(layer, fxIndex, 'blendMode', t, 0));
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.globalAlpha = alpha;
  ctx.fillStyle = c1;
  ctx.fillRect(0, 0, w, h);
  const paint = (color: string, ox: number, oy: number) => {
    const px = ox * w;
    const py = oy * h;
    const r = Math.hypot(w, h) * 0.75;
    const g = ctx.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  };
  const blendMain = paramAt(layer, fxIndex, 'blend', t, 1);
  if (blendMain >= 0) {
    ctx.globalCompositeOperation = blend;
    paint(c2, o2[0] ?? 1, o2[1] ?? 0);
    paint(c3, o3[0] ?? 0, o3[1] ?? 1);
    paint(c4, o1[0] ?? 1, o1[1] ?? 1);
  }
  ctx.restore();
}

/** Overlay gradien (gradientoverlay2) di atas konten: gradType 0 = linear, 1 = radial, plus offset pusat. */
function applyGradientOverlay(canvas: HTMLCanvasElement, layer: Layer, fxIndex: number, t: number): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  const c1 = colorParamAt(layer, fxIndex, 'color1', '#ffffff00');
  const c2 = colorParamAt(layer, fxIndex, 'color2', '#00000000');
  const angle = paramAt(layer, fxIndex, 'angle', t, 90);
  const alpha = clamp(paramAt(layer, fxIndex, 'alpha', t, 1), 0, 1);
  const scale = Math.max(0.05, paramAt(layer, fxIndex, 'scale', t, 1));
  const blend = amBlend(paramAt(layer, fxIndex, 'blendMode', t, 0));
  const gradType = Math.round(paramAt(layer, fxIndex, 'gradType', t, 0));
  const off = vecParam(layer, fxIndex, 'offset');
  const offX = (off[0] ?? 0) * (w / Math.max(1, layer.width || w)) * 0.5;
  const offY = (off[1] ?? 0) * (h / Math.max(1, layer.height || h)) * 0.5;
  ctx.save();
  ctx.globalCompositeOperation = blend === 'source-over' ? 'source-atop' : blend;
  ctx.globalAlpha = alpha;
  if (gradType === 1) {
    const cx = w / 2 + offX;
    const cy = h / 2 + offY;
    const r = Math.max(4, Math.hypot(w, h) * 0.55 * scale);
    const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    gr.addColorStop(0, c1);
    gr.addColorStop(1, c2);
    ctx.fillStyle = gr;
  } else {
    const rad = ((angle - 90) * Math.PI) / 180;
    const dx = Math.cos(rad) * w * 0.5 * scale;
    const dy = Math.sin(rad) * h * 0.5 * scale;
    const grad = ctx.createLinearGradient(w / 2 + offX - dx, h / 2 + offY - dy, w / 2 + offX + dx, h / 2 + offY + dy);
    grad.addColorStop(0, c1);
    grad.addColorStop(1, c2);
    ctx.fillStyle = grad;
  }
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/** Grid tile cermin: konten diduplikasi mengisi area di sekeliling layer. */
function drawTileGrid(
  ctx: CanvasRenderingContext2D,
  content: HTMLCanvasElement,
  scene: Scene,
  layer: Layer,
  fxIndex: number,
  t: number,
): void {
  const scale = Math.max(0.05, paramAt(layer, fxIndex, 'scale', t, 1));
  const phase = paramAt(layer, fxIndex, 'phase', t, 0);
  const mirror = (layer.effects[fxIndex]?.params?.['mirror']?.value[0] ?? 1) > 0.5;
  const vertoffs = (layer.effects[fxIndex]?.params?.['vertoffs']?.value[0] ?? 0) > 0.5;
  const angle = paramAt(layer, fxIndex, 'angle', t, 0);

  const cw = content.width * scale;
  const ch = content.height * scale;
  // berapa kolom/baris agar menutupi seluruh scene dari pusat layer
  const dist = Math.hypot(scene.width, scene.height) / 2;
  const cols = Math.min(10, Math.ceil(dist / Math.max(cw, 2)) + 1);
  const rows = Math.min(10, Math.ceil(dist / Math.max(ch, 2)) + 1);

  ctx.save();
  ctx.rotate((angle * Math.PI) / 180);
  const offX = phase * cw;
  for (let gy = -rows; gy <= rows; gy += 1) {
    for (let gx = -cols; gx <= cols; gx += 1) {
      const flipX = mirror && ((gx + (phase > 0.5 ? 1 : 0)) % 2 !== 0);
      const flipY = mirror && Math.abs(gy) % 2 !== 0;
      const x = gx * cw + offX;
      const y = gy * ch + (vertoffs && Math.abs(gx) % 2 !== 0 ? ch / 2 : 0);
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
      ctx.drawImage(content, -cw / 2, -ch / 2, cw, ch);
      ctx.restore();
    }
  }
  ctx.restore();
}

/* ───────────── efek transformasi (tanpa offscreen) ───────────── */

type Mods = { dx: number; dy: number; drot: number; opMul: number };

/** Oscillate + swing + fade dievaluasi pada waktu t. */
function transformMods(layer: Layer, t: number): Mods {
  const mods: Mods = { dx: 0, dy: 0, drot: 0, opMul: 1 };
  const u = (t - layer.start) / 1000;
  layer.effects.forEach((fx, i) => {
    if (!fx.enabled) return;
    const base = baseName(fx.name);
    if (base === 'oscillate') {
      const angle = (paramAt(layer, i, 'angle', t, 90) * Math.PI) / 180;
      const freq = paramAt(layer, i, 'freq', t, 1);
      const mag = paramAt(layer, i, 'mag', t, 0);
      const type = Math.round(paramAt(layer, i, 'type', t, 0));
      const phase = paramAt(layer, i, 'phase', t, 0);
      const dir = Math.round(paramAt(layer, i, 'direction', t, 0));
      const w = waveShape(type, u * freq + phase + (dir ? 0.5 : 0));
      mods.dx += Math.cos(angle) * mag * w;
      mods.dy += Math.sin(angle) * mag * w;
    } else if (base === 'swing') {
      const freq = paramAt(layer, i, 'freq', t, 1);
      const a1 = paramAt(layer, i, 'a1', t, -2);
      const a2 = paramAt(layer, i, 'a2', t, 2);
      const phase = paramAt(layer, i, 'phase', t, 0.5);
      const type = Math.round(paramAt(layer, i, 'type', t, 0));
      const mid = (a1 + a2) / 2;
      const half = (a2 - a1) / 2;
      mods.drot += mid + half * waveShape(type, u * freq + phase);
    } else if (base === 'fade') {
      // inTime/outTime Alight Motion satuannya DETIK, bukan fraksi durasi layer.
      const inT = paramAt(layer, i, 'inTime', t, 0) * 1000;
      const outT = paramAt(layer, i, 'outTime', t, 0) * 1000;
      if (inT > 0) mods.opMul *= clamp((t - layer.start) / inT, 0, 1);
      if (outT > 0) mods.opMul *= clamp((layer.end - t) / outT, 0, 1);
    }
  });
  return mods;
}

/* ───────────── gambar satu layer ───────────── */

const PIXEL_FX = new Set(['lumakey', 'randomdisplace', 'displacemap', 'wavewarp', 'zoomblur', 'circularripple', 'mirror', 'stretchsegment']);
const OVERLAY_FX = new Set(['fourcolorgradient', 'gradientoverlay']);

function needsPipeline(layer: Layer): boolean {
  return layer.effects.some((fx) => {
    if (!fx.enabled) return false;
    const base = baseName(fx.name);
    return PIXEL_FX.has(base) || OVERLAY_FX.has(base) || base === 'wipe';
  });
}

/** Bangun konten layer (plus efek piksel/overlay/wipe) di canvas offscreen. */
function buildContentCanvas(layer: Layer, t: number, scene: Scene, opts: DrawOptions): HTMLCanvasElement {
  const w = layer.width || scene.width * 0.4;
  const h = layer.height || scene.height * 0.3;
  const pad = padFor(layer, t);
  const scaleDown = Math.min(1, 900 / Math.max(w + pad * 2, h + pad * 2, 1));
  const cw = (w + pad * 2) * scaleDown;
  const chh = (h + pad * 2) * scaleDown;
  const ctx = getTmp(0, cw, chh);
  ctx.scale(scaleDown, scaleDown);
  ctx.translate((w + pad * 2) / 2, (h + pad * 2) / 2);

  ctx.filter = effectFilter(layer, t);
  drawContent(ctx, layer, t, scene, opts, w, h);
  ctx.filter = 'none';

  const canvas = tmpCanvas(0);

  // overlay (fourcolorgradient / gradientoverlay) — dipakai kalau ada
  layer.effects.forEach((fx, i) => {
    if (!fx.enabled) return;
    const base = baseName(fx.name);
    if (base === 'fourcolorgradient') applyFourColorGradient(canvas, layer, i, t);
    else if (base === 'gradientoverlay') applyGradientOverlay(canvas, layer, i, t);
  });

  // rantai efek piksel sesuai urutan stack
  layer.effects.forEach((fx, i) => {
    if (!fx.enabled) return;
    const base = baseName(fx.name);
    if (base === 'lumakey') {
      const low = paramAt(layer, i, 'lowThreshold', t, 0);
      const high = paramAt(layer, i, 'highThreshold', t, 1);
      const feather = paramAt(layer, i, 'feather', t, 0.05);
      const invert = (fx.params?.['invert']?.value[0] ?? 0) > 0.5;
      applyLumakey(canvas, clamp(low, 0, 1), clamp(high, 0, 1), feather, invert);
    } else if (base === 'randomdisplace') {
      applyRandomDisplace(
        canvas,
        paramAt(layer, i, 'mag', t, 0),
        paramAt(layer, i, 'evolution', t, 0),
        paramAt(layer, i, 'seed', t, 0),
        paramAt(layer, i, 'scatter', t, 0.5),
      );
    } else if (base === 'displacemap') {
      const offs = fx.params?.['offs']?.value ?? [];
      applyDisplaceNoise(
        canvas,
        Math.abs(offs[0] ?? 0),
        Math.abs(offs[1] ?? 0),
        paramAt(layer, i, 'phase', t, t / 1000),
        boolParam(layer, i, 'invert', false),
        boolParam(layer, i, 'fromctr', false),
      );
    } else if (base === 'wavewarp') {
      applyWaveWarp(
        canvas,
        paramAt(layer, i, 'a1d', t, 0),
        paramAt(layer, i, 'a2d', t, 0),
        Math.max(0.05, paramAt(layer, i, 'm1', t, 1)),
        Math.max(0.05, paramAt(layer, i, 'm2', t, 1)),
        paramAt(layer, i, 'phase', t, 0),
        paramAt(layer, i, 'damping', t, 0),
        clamp(paramAt(layer, i, 'dampingOrigin', t, 0.5), 0, 1),
        paramAt(layer, i, 'dampingSpace', t, 1),
      );
    } else if (base === 'zoomblur') {
      applyZoomBlur(canvas, paramAt(layer, i, 'strength', t, 0));
    } else if (base === 'circularripple') {
      applyCircularRipple(
        canvas,
        Math.max(0.1, paramAt(layer, i, 'frequency', t, 1)),
        paramAt(layer, i, 'phase', t, 0),
        paramAt(layer, i, 'radius', t, 0),
        paramAt(layer, i, 'strength', t, 0),
      );
    } else if (base === 'mirror') {
      const type = Math.round(paramAt(layer, i, 'type', t, 0));
      const offset = paramAt(layer, i, 'offset', t, 0) * w * 0.5;
      const alpha = paramAt(layer, i, 'alpha', t, 1);
      const blend = amBlend(paramAt(layer, i, 'blendMode', t, 0));
      applyMirror(canvas, type, offset * scaleDown, alpha, blend);
    } else if (base === 'stretchsegment') {
      applyStretchSegment(
        canvas,
        paramAt(layer, i, 'angle', t, 0),
        paramAt(layer, i, 'stretch', t, 0),
        paramAt(layer, i, 'offset', t, 0),
        boolParam(layer, i, 'smooth', true),
      );
    }
  });

  // wipe terakhir (memotong semua hasil)
  const wipe = findFx(layer, 'wipe')[0];
  if (wipe) {
    applyWipe(
      canvas,
      paramAt(layer, wipe.index, 'angle', t, 0),
      clamp(paramAt(layer, wipe.index, 'start', t, 0), 0, 1),
      clamp(paramAt(layer, wipe.index, 'end', t, 1), 0, 1),
      paramAt(layer, wipe.index, 'feather', t, 0.05),
    );
  }

  return canvas;
}

/** Gambar satu kondisi layer pada waktu ts (tanpa motionblur sampling). */
function drawSingle(
  ctx: CanvasRenderingContext2D,
  layer: Layer,
  scene: Scene,
  opts: DrawOptions,
  t: number,
  ts: number,
  mods: Mods,
  alphaMul: number,
  mask?: { pos: boolean; scale: boolean; angle: boolean },
): void {
  // Mask motionblur (usePos/useScale/useAngle): channel yang mati diambil dari waktu kini,
  // bukan dari sampel waktu, supaya channel itu tidak ikut menggelcak.
  const m = mask ?? { pos: true, scale: true, angle: true };
  const [x, y] = kfPair(layer, 'location', m.pos ? ts : t, layer.x, layer.y);
  const [sx, sy] = kfPair(layer, 'scale', m.scale ? ts : t, layer.scaleX, layer.scaleY);
  const rot = kfValue(layer, 'rotation', m.angle ? ts : t, layer.rotation);
  const op = Math.min(1, Math.max(0, kfValue(layer, 'opacity', ts, layer.opacity) * mods.opMul * alphaMul));
  if (op <= 0.002) return;

  const w = layer.width || scene.width * 0.4;
  const h = layer.height || scene.height * 0.3;

  ctx.save();
  ctx.globalAlpha = op;
  ctx.globalCompositeOperation = blendToComposite(layer.blending);
  ctx.translate(x + mods.dx, y + mods.dy);
  ctx.rotate(((rot + mods.drot) * Math.PI) / 180);
  ctx.scale(sx || 0, sy || 0);

  if (layer.shadow) {
    ctx.shadowColor = layer.shadow.color;
    ctx.shadowBlur = layer.shadow.blur;
    ctx.shadowOffsetX = layer.shadow.offsetX;
    ctx.shadowOffsetY = layer.shadow.offsetY;
  }

  if (opts.effects === false) {
    ctx.filter = 'none';
    drawContent(ctx, layer, ts, scene, opts, w, h);
    ctx.restore();
    return;
  }

  const tile = findFx(layer, 'tile')[0];

  if (needsPipeline(layer) || tile) {
    const content = buildContentCanvas(layer, ts, scene, opts);
    if (tile) {
      drawTileGrid(ctx, content, scene, layer, tile.index, t);
    } else {
      ctx.drawImage(content, -content.width / 2, -content.height / 2);
    }
  } else {
    ctx.filter = effectFilter(layer, t);
    drawContent(ctx, layer, ts, scene, opts, w, h);
    ctx.filter = 'none';
  }

  ctx.restore();
}

function drawLayer(ctx: CanvasRenderingContext2D, layer: Layer, scene: Scene, opts: DrawOptions, noBlur = false) {
  const t = opts.timeMs;
  if (!layer.visible || layer.isNull) return;
  if (t < layer.start || t > layer.end) return;
  if (layer.type === 'audio') return;

  const mods = transformMods(layer, t);

  const mb = !noBlur && opts.effects !== false ? findFx(layer, 'motionblur')[0] : undefined;
  if (mb) {
    const tune = clamp(paramAt(layer, mb.index, 'tune', t, 1), 0.1, 3);
    // Switch asli AM: sumur mana yang di-sample untuk blur (posisi/skala/sudut).
    const mask = {
      pos: boolParam(layer, mb.index, 'usePos', true),
      scale: boolParam(layer, mb.index, 'useScale', false),
      angle: boolParam(layer, mb.index, 'useAngle', true),
    };
    const samples = 6;
    const window = clamp(36 * tune, 10, 110);
    for (let i = 0; i < samples; i += 1) {
      const ts = clamp(t - (window * i) / (samples - 1), layer.start, layer.end);
      drawSingle(ctx, layer, scene, opts, t, ts, mods, 1 / samples, mask);
    }
  } else {
    drawSingle(ctx, layer, scene, opts, t, t, mods, 1);
  }

  for (const child of layer.children) drawLayer(ctx, child, scene, opts, noBlur);
}

export function drawFrame(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  opts: DrawOptions,
  canvasW: number,
  canvasH: number,
) {
  const scale = Math.min(canvasW / scene.width, canvasH / scene.height);
  const dw = scene.width * scale;
  const dh = scene.height * scale;
  const ox = (canvasW - dw) / 2;
  const oy = (canvasH - dh) / 2;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvasW, canvasH);

  ctx.translate(ox, oy);
  ctx.scale(scale, scale);
  ctx.beginPath();
  ctx.rect(0, 0, scene.width, scene.height);
  ctx.clip();

  // Latar scene: warna latar dari preset (bgcolor), bukan gradien rekaan.
  ctx.fillStyle = scene.bgColor ? argbToCss(scene.bgColor, '#000') : '#000';
  ctx.fillRect(0, 0, scene.width, scene.height);

  for (const layer of scene.layers) drawLayer(ctx, layer, scene, opts);

  if (opts.showSafeArea) {
    ctx.strokeStyle = 'rgba(31,200,238,0.35)';
    ctx.setLineDash([10, 8]);
    ctx.lineWidth = 2;
    ctx.strokeRect(scene.width * 0.05, scene.height * 0.05, scene.width * 0.9, scene.height * 0.9);
    ctx.setLineDash([]);
  }

  ctx.restore();
}

/** Layer yang aktif pada waktu tertentu (untuk panel inspector). */
export function activeLayers(scene: Scene, t: number): Layer[] {
  return scene.layers.filter((l) => l.visible && t >= l.start && t <= l.end && l.type !== 'audio');
}

export function layerAt(scene: Scene, t: number, px: number, py: number): Layer | null {
  const list = activeLayers(scene, t);
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const l = list[i];
    const [x, y] = kfPair(l, 'location', t, l.x, l.y);
    const [sx, sy] = kfPair(l, 'scale', t, l.scaleX, l.scaleY);
    const w = (l.width || scene.width * 0.4) * Math.abs(sx || 1);
    const h = (l.height || scene.height * 0.3) * Math.abs(sy || 1);
    if (px >= x - w / 2 && px <= x + w / 2 && py >= y - h / 2 && py <= y + h / 2) return l;
  }
  return null;
}
