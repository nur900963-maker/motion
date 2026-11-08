import type { Layer, Scene } from './types';
import { argbToCss, blendToComposite, sampleKeyframes } from './am-xml';

/**
 * Renderer canvas 2D untuk scene Alight Motion.
 *
 * Semua gambar yang terlihat di preview dan yang direkam saat ekspor berasal dari
 * fungsi `drawFrame` yang sama, sehingga hasil ekspor benar-benar hasil render scene.
 *
 * Yang dirender: posisi/skala/rotasi/opacity berkeyframe (dengan easing cubic-bezier),
 * isian media / warna / gradien, bentuk rect/roundrect/circle, mode blend, dan
 * perkiraan untuk efek gaussianblur, hueshift, exposure, satvib, sharpen.
 * Efek lain (tile, oscillate, wavewarp, dst.) TIDAK dirender.
 */

export type MediaMap = Record<string, { el: HTMLImageElement | HTMLVideoElement; kind: 'image' | 'video' }>;

export type DrawOptions = {
  timeMs: number;
  media: MediaMap;
  selectedId?: string | null;
  debug?: boolean;
  showSafeArea?: boolean;
  /** false = abaikan efek filter (mode hemat). Default true. */
  effects?: boolean;
};

const kfValue = (layer: Layer, prop: string, t: number, fb: number) => sampleKeyframes(layer.keyframes[prop], t, 0, fb);
const kfPair = (layer: Layer, prop: string, t: number, fx: number, fy: number): [number, number] => [
  sampleKeyframes(layer.keyframes[prop], t, 0, fx),
  sampleKeyframes(layer.keyframes[prop], t, 1, fy),
];

function paramAt(layer: Layer, fxIndex: number, name: string, t: number, fallback: number): number {
  const p = layer.effects[fxIndex]?.params?.[name];
  if (!p) return fallback;
  if (p.keyframes?.length) return sampleKeyframes(p.keyframes, t, 0, fallback);
  return p.value[0] ?? fallback;
}

/** Perkiraan efek → ctx.filter. Nilainya pendekatan, bukan salinan shader Alight Motion. */
function effectFilter(layer: Layer, t: number): string {
  const parts: string[] = [];
  layer.effects.forEach((fx, i) => {
    if (!fx.enabled) return;
    const base = fx.name.replace(/\d+$/, '');
    if (base === 'gaussianblur') {
      const s = paramAt(layer, i, 'strength', t, 0);
      if (s > 0) parts.push(`blur(${(s * 2).toFixed(2)}px)`);
    } else if (base === 'hueshift') {
      parts.push(`hue-rotate(${paramAt(layer, i, 'hue', t, 0).toFixed(1)}deg)`);
    } else if (base === 'exposure') {
      const ex = paramAt(layer, i, 'exposure', t, 0);
      if (ex) parts.push(`brightness(${Math.pow(2, ex).toFixed(3)})`);
    } else if (base === 'satvib') {
      parts.push(`saturate(${paramAt(layer, i, 'saturation', t, 1).toFixed(3)})`);
    } else if (base === 'sharpen') {
      const s = paramAt(layer, i, 'strength', t, 0);
      if (s > 0) parts.push(`contrast(${(1 + s * 0.3).toFixed(3)})`);
    }
  });
  return parts.join(' ') || 'none';
}

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

function drawLayer(ctx: CanvasRenderingContext2D, layer: Layer, opts: DrawOptions, scene: Scene) {
  const t = opts.timeMs;
  if (!layer.visible) return;
  if (t < layer.start || t > layer.end) return;
  if (layer.type === 'audio') return;

  const [x, y] = kfPair(layer, 'location', t, layer.x, layer.y);
  const [sx, sy] = kfPair(layer, 'scale', t, layer.scaleX, layer.scaleY);
  const rot = kfValue(layer, 'rotation', t, layer.rotation);
  const op = Math.min(1, Math.max(0, kfValue(layer, 'opacity', t, layer.opacity)));

  ctx.save();
  ctx.globalAlpha = op;
  ctx.globalCompositeOperation = blendToComposite(layer.blending);
  ctx.translate(x, y);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.scale(sx || 0, sy || 0);
  ctx.filter = opts.effects === false ? 'none' : effectFilter(layer, t);

  const w = layer.width || scene.width * 0.4;
  const h = layer.height || scene.height * 0.3;
  const kind = layer.shape || 'rect';
  const radius = layer.cornerRadius ?? 0;

  if (layer.type === 'image' || layer.type === 'video') {
    const media = layer.mediaRef ? opts.media[layer.mediaRef] : undefined;
    if (media) {
      ctx.save();
      shapePath(ctx, kind, w, h, radius);
      ctx.clip();
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
      ctx.fillText('Slot media kosong', 0, 0);
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
  } else if (layer.type === 'scene' || layer.type === 'group') {
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 2;
    shapePath(ctx, 'roundrect', w, h, 10);
    ctx.stroke();
  } else {
    ctx.fillStyle = layer.color || '#3a3a42';
    shapePath(ctx, 'roundrect', w, h, 8);
    ctx.fill();
  }

  if (opts.debug) {
    ctx.filter = 'none';
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = opts.selectedId === layer.id ? '#ff3b3b' : '#35d07f';
    ctx.lineWidth = 2;
    ctx.strokeRect(-w / 2, -h / 2, w, h);
  }

  ctx.restore();

  for (const child of layer.children) drawLayer(ctx, child, opts, scene);
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

  for (const layer of scene.layers) drawLayer(ctx, layer, opts, scene);

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
