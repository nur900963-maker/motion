import type { Layer, Scene } from './types';

/**
 * Renderer canvas 2D untuk scene Alight Motion.
 *
 * Semua gambar yang terlihat di preview dan yang direkam saat ekspor berasal dari
 * fungsi `drawFrame` yang sama, sehingga hasil ekspor benar-benar hasil render
 * scene — bukan rekaman UI.
 */

export type MediaMap = Record<string, { el: HTMLImageElement | HTMLVideoElement; kind: 'image' | 'video' }>;

export type DrawOptions = {
  timeMs: number;
  media: MediaMap;
  selectedId?: string | null;
  debug?: boolean;
  showSafeArea?: boolean;
};

function kfValue(layer: Layer, prop: string, t: number, fallback: number): number {
  const kfs = layer.keyframes[prop];
  if (!kfs || !kfs.length) return fallback;
  if (t <= kfs[0].t) return kfs[0].v[0] ?? fallback;
  const last = kfs[kfs.length - 1];
  if (t >= last.t) return last.v[0] ?? fallback;
  for (let i = 0; i < kfs.length - 1; i += 1) {
    const a = kfs[i];
    const b = kfs[i + 1];
    if (t >= a.t && t <= b.t) {
      const k = (t - a.t) / (b.t - a.t || 1);
      const av = a.v[0] ?? fallback;
      const bv = b.v[0] ?? fallback;
      return av + (bv - av) * k;
    }
  }
  return fallback;
}

function kfPair(layer: Layer, prop: string, t: number, fx: number, fy: number): [number, number] {
  const kfs = layer.keyframes[prop];
  if (!kfs || !kfs.length) return [fx, fy];
  const pick = (idx: number, fb: number) => {
    if (t <= kfs[0].t) return kfs[0].v[idx] ?? fb;
    const last = kfs[kfs.length - 1];
    if (t >= last.t) return last.v[idx] ?? fb;
    for (let i = 0; i < kfs.length - 1; i += 1) {
      const a = kfs[i];
      const b = kfs[i + 1];
      if (t >= a.t && t <= b.t) {
        const k = (t - a.t) / (b.t - a.t || 1);
        const av = a.v[idx] ?? fb;
        const bv = b.v[idx] ?? fb;
        return av + (bv - av) * k;
      }
    }
    return fb;
  };
  return [pick(0, fx), pick(1, fy)];
}

function effectFilter(layer: Layer): string {
  const names = layer.effects.filter((e) => e.enabled).map((e) => e.name.toLowerCase());
  const parts: string[] = [];
  if (names.some((n) => n.includes('blur'))) parts.push('blur(6px)');
  if (names.some((n) => n.includes('glow'))) parts.push('brightness(1.25) saturate(1.3)');
  if (names.some((n) => n.includes('sharpen'))) parts.push('contrast(1.15)');
  if (names.some((n) => n.includes('vignette'))) parts.push('brightness(0.92)');
  if (names.some((n) => n.includes('exposure'))) parts.push('brightness(1.1)');
  if (names.some((n) => n.includes('satvib'))) parts.push('saturate(1.35)');
  return parts.join(' ') || 'none';
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
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
  ctx.translate(x, y);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.scale(sx || 1, sy || 1);
  ctx.filter = effectFilter(layer);

  const w = layer.width || scene.width * 0.4;
  const h = layer.height || scene.height * 0.3;

  if (layer.type === 'image' || layer.type === 'video') {
    const media = layer.mediaRef ? opts.media[layer.mediaRef] : undefined;
    if (media) {
      const el = media.el;
      const iw = media.kind === 'image' ? (el as HTMLImageElement).naturalWidth : (el as HTMLVideoElement).videoWidth;
      const ih = media.kind === 'image' ? (el as HTMLImageElement).naturalHeight : (el as HTMLVideoElement).videoHeight;
      if (iw && ih) {
        const scale = Math.min(w / iw, h / ih);
        const dw = iw * scale;
        const dh = ih * scale;
        try {
          ctx.drawImage(el, -dw / 2, -dh / 2, dw, dh);
        } catch {
          /* video belum siap */
        }
      }
    } else {
      // Slot kosong: tampilkan placeholder yang jelas (bukan data palsu).
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      roundRect(ctx, -w / 2, -h / 2, w, h, 12);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.font = `${Math.max(11, w * 0.06)}px Geist, sans-serif`;
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
    const isCircle = /ring|circle|ellipse|bulat/i.test(layer.name);
    ctx.fillStyle = layer.color || '#3d4f9a';
    if (isCircle) {
      ctx.beginPath();
      ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = Math.max(2, w * 0.02);
      ctx.stroke();
    } else {
      roundRect(ctx, -w / 2, -h / 2, w, h, Math.min(24, w * 0.06));
      ctx.fill();
    }
  } else if (layer.type === 'scene' || layer.type === 'group') {
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 2;
    roundRect(ctx, -w / 2, -h / 2, w, h, 10);
    ctx.stroke();
  } else {
    ctx.fillStyle = layer.color || '#3a3a42';
    roundRect(ctx, -w / 2, -h / 2, w, h, 8);
    ctx.fill();
  }

  if (opts.debug) {
    ctx.filter = 'none';
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

  // Latar scene
  const bg = ctx.createLinearGradient(0, 0, scene.width, scene.height);
  bg.addColorStop(0, '#0a0f1e');
  bg.addColorStop(1, '#050505');
  ctx.fillStyle = bg;
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
    const w = (l.width || scene.width * 0.4) * (sx || 1);
    const h = (l.height || scene.height * 0.3) * (sy || 1);
    if (px >= x - w / 2 && px <= x + w / 2 && py >= y - h / 2 && py <= y + h / 2) return l;
  }
  return null;
}
