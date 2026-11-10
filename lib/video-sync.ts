import type { Layer, Scene } from './types';
import { flattenAll } from './am-xml';
import { videoTimeSec } from './scene-eval';

/**
 * Samakan elemen <video> dengan timeline: posisi = inTime + (t − start) × speed.
 * Dipakai preview (playing=true: biarkan diputar natif, koreksi bila melenceng) dan ekspor.
 */
export function syncVideos(
  scene: Scene,
  videos: Map<string, HTMLVideoElement>,
  t: number,
  playing: boolean,
): void {
  const layers = (flattenAll(scene.layers) as Layer[]).filter((l) => l.type === 'video' && l.mediaRef);
  const handled = new Set<HTMLVideoElement>();
  for (const l of layers) {
    const v = l.mediaRef ? videos.get(l.mediaRef) : undefined;
    if (!v || handled.has(v)) continue;
    const active = l.visible && t >= l.start && t <= l.end;
    if (!active) continue;
    handled.add(v);
    const want = videoTimeSec(l, t);
    const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : Infinity;
    const target = Math.min(want, Math.max(0, dur - 0.04));
    const speed = Math.min(16, Math.max(0.0625, l.speed && l.speed > 0 ? l.speed : 1));
    try {
      if (playing) {
        if (v.playbackRate !== speed) v.playbackRate = speed;
        if (v.paused) {
          v.currentTime = target;
          void v.play().catch(() => undefined);
        } else if (Math.abs(v.currentTime - target) > 0.25) {
          v.currentTime = target;
        }
      } else {
        if (!v.paused) v.pause();
        if (Math.abs(v.currentTime - target) > 0.02) v.currentTime = target;
      }
    } catch {
      /* belum siap */
    }
  }
  // Video yang tidak aktif dijeda agar tidak menghabiskan baterai.
  for (const v of videos.values()) if (!handled.has(v) && !v.paused) v.pause();
}

/** Tunggu sampai video selesai seek (untuk ekspor yang butuh frame tepat). */
export function waitSeeked(v: HTMLVideoElement, timeoutMs = 800): Promise<void> {
  return new Promise((resolve) => {
    if (!v.seeking) return resolve();
    const done = () => {
      v.removeEventListener('seeked', done);
      resolve();
    };
    v.addEventListener('seeked', done);
    setTimeout(done, timeoutMs);
  });
}
