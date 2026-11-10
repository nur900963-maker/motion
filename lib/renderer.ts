import type { Layer, Scene } from './types';
import { argbToCss, blendToComposite } from './am-xml';
import { evalLayer, hitTest, isDrawable, layerIndex } from './scene-eval';

/**
 * Renderer canvas 2D — HANYA cadangan bila WebGL2 tidak tersedia.
 * Mendukung transform (termasuk parent, oscillate, swing, fade), isian media/warna/gradien, bentuk,
 * dan mode blend. TIDAK menjalankan efek shader (tile, wavewarp, dst.) — itu hanya ada di gl-renderer.ts.
 */

export type MediaMap = Record<string, { el: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement; kind: 'image' | 'video' }>;

export type DrawOptions = {
  timeMs: number;
  media: MediaMap;
  selectedId?: string | null;
  debug?: boolean;
  showSafeArea?: boolean;
  /** false = abaikan efek filter (mode hemat). Default true. */
  effects?: boolean;
};

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
  el: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement,
  kind: 'image' | 'video',
  w: number,
  h: number,
  mode: string | undefined,
) {
  const iw = kind === 'image' ? (el as HTMLImageElement).naturalWidth || (el as HTMLCanvasElement).width : (el as HTMLVideoElement).videoWidth;
  const ih = kind === 'image' ? (el as HTMLImageElement).naturalHeight || (el as HTMLCanvasElement).height : (el as HTMLVideoElement).videoHeight;
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

function drawLayer(
  ctx: CanvasRenderingContext2D,
  layer: Layer,
  opts: DrawOptions,
  scene: Scene,
  index: Map<string, Layer>,
) {
  const t = opts.timeMs;
  if (!isDrawable(layer, t)) return;

  const ev = evalLayer(layer, t, index);
  ctx.save();
  ctx.globalAlpha = ev.opacity;
  ctx.globalCompositeOperation = blendToComposite(layer.blending);
  ctx.transform(ev.m[0], ev.m[1], ev.m[2], ev.m[3], ev.m[4], ev.m[5]);

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
      shapePath(ctx, kind, w, h, radius);
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.setLineDash([10, 8]);
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.setLineDash([]);
    }
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
  }
  ctx.restore();
  for (const child of layer.children) drawLayer(ctx, child, opts, scene, index);
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

  const index = layerIndex(scene.layers);
  for (const layer of scene.layers) drawLayer(ctx, layer, opts, scene, index);

  if (opts.showSafeArea) {
    ctx.strokeStyle = 'rgba(31,200,238,0.35)';
    ctx.setLineDash([10, 8]);
    ctx.lineWidth = 2;
    ctx.strokeRect(scene.width * 0.05, scene.height * 0.05, scene.width * 0.9, scene.height * 0.9);
    ctx.setLineDash([]);
  }

  ctx.restore();
}

export function layerAt(scene: Scene, t: number, px: number, py: number): Layer | null {
  return hitTest(scene, t, px, py);
}
