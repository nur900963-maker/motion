import type { Layer, MediaItem, Scene } from './types';
import { flattenAll } from './am-xml';

/**
 * Sistem audio.
 *  - Sumber: layer audio bawaan preset (yang sudah dipasangi file) + track tambahan pengguna (scene.userAudio).
 *  - Preview: satu <audio> per sumber, disinkronkan ke timeline (play/jeda/seek).
 *  - Ekspor: Web Audio (decode → jadwalkan → MediaStreamDestination) lalu trek-nya ditempel ke stream video.
 */

export type AudioSource = {
  key: string;
  label: string;
  url: string;
  /** ms pada timeline saat sumber mulai berbunyi */
  startMs: number;
  /** ms pada timeline saat sumber berhenti */
  endMs: number;
  /** ms di dalam file untuk mulai (potong awal) */
  trimMs: number;
  volume: number;
};

const findMedia = (media: MediaItem[], ref: string | null | undefined) =>
  ref ? media.find((m) => String(m.id) === ref || m.name === ref) : undefined;

/** Kumpulkan semua sumber audio yang benar-benar punya file. */
export function collectAudioSources(scene: Scene, media: MediaItem[]): AudioSource[] {
  const out: AudioSource[] = [];
  for (const l of flattenAll(scene.layers) as Layer[]) {
    if (l.type !== 'audio' || !l.visible) continue;
    const m = findMedia(media, l.mediaRef);
    if (!m || m.kind !== 'audio') continue;
    out.push({
      key: `layer:${l.id}`,
      label: l.name,
      url: m.url,
      startMs: l.start,
      endMs: l.end,
      trimMs: l.inTime ?? 0,
      volume: 1,
    });
  }
  for (const u of scene.userAudio ?? []) {
    const m = media.find((x) => x.id === u.mediaId);
    if (!m || m.kind !== 'audio') continue;
    out.push({
      key: `user:${u.id}`,
      label: m.name,
      url: m.url,
      startMs: u.offset,
      endMs: scene.duration,
      trimMs: u.trim,
      volume: u.volume,
    });
  }
  return out;
}

/* ───────────── preview ───────────── */

export class AudioPreview {
  private els = new Map<string, { el: HTMLAudioElement; src: AudioSource }>();

  setSources(sources: AudioSource[]) {
    const keep = new Set(sources.map((s) => s.key));
    for (const [key, rec] of this.els) {
      if (!keep.has(key)) {
        rec.el.pause();
        rec.el.src = '';
        this.els.delete(key);
      }
    }
    for (const s of sources) {
      const cur = this.els.get(s.key);
      if (cur && cur.src.url === s.url) {
        cur.src = s;
        continue;
      }
      if (cur) {
        cur.el.pause();
        cur.el.src = '';
      }
      const el = new Audio();
      el.preload = 'auto';
      el.src = s.url;
      this.els.set(s.key, { el, src: s });
    }
  }

  /** Samakan semua audio dengan posisi timeline `t`. Dipanggil tiap frame saat main, dan saat seek/jeda. */
  sync(t: number, playing: boolean, muted: boolean) {
    for (const { el, src } of this.els.values()) {
      el.volume = muted ? 0 : Math.max(0, Math.min(1, src.volume));
      const active = t >= src.startMs && t < src.endMs;
      if (!active || !playing) {
        if (!el.paused) el.pause();
        if (active) this.seekEl(el, (t - src.startMs + src.trimMs) / 1000);
        continue;
      }
      const want = (t - src.startMs + src.trimMs) / 1000;
      if (el.paused) {
        this.seekEl(el, want);
        void el.play().catch(() => {
          /* diblokir autoplay sampai ada interaksi; akan dicoba lagi di frame berikutnya */
        });
      } else if (Math.abs(el.currentTime - want) > 0.3) {
        this.seekEl(el, want);
      }
    }
  }

  private seekEl(el: HTMLAudioElement, sec: number) {
    try {
      if (Math.abs(el.currentTime - sec) > 0.03) el.currentTime = Math.max(0, sec);
    } catch {
      /* metadata belum siap */
    }
  }

  pauseAll() {
    for (const { el } of this.els.values()) el.pause();
  }

  dispose() {
    for (const { el } of this.els.values()) {
      el.pause();
      el.src = '';
    }
    this.els.clear();
  }
}

/* ───────────── ekspor ───────────── */

export type ExportAudio = {
  track: MediaStreamTrack | null;
  /** Mulai semua sumber (panggil tepat saat recorder.start). */
  start: () => void;
  stop: () => void;
  /** Sumber yang gagal didecode (untuk ditampilkan ke pengguna). */
  failed: string[];
};

/**
 * Siapkan trek audio gabungan untuk rentang [startMs, endMs] timeline.
 * Mengembalikan track=null bila tidak ada audio atau Web Audio tidak tersedia.
 */
export async function prepareExportAudio(sources: AudioSource[], startMs: number, endMs: number): Promise<ExportAudio> {
  const empty: ExportAudio = { track: null, start: () => {}, stop: () => {}, failed: [] };
  const relevant = sources.filter((s) => s.endMs > startMs && s.startMs < endMs);
  if (!relevant.length) return empty;
  const AC: typeof AudioContext | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return { ...empty, failed: relevant.map((s) => `${s.label} (browser tanpa Web Audio)`) };

  const ctx = new AC();
  const dest = ctx.createMediaStreamDestination();
  const failed: string[] = [];
  const decoded: { s: AudioSource; buf: AudioBuffer }[] = [];
  for (const s of relevant) {
    try {
      const data = await (await fetch(s.url)).arrayBuffer();
      decoded.push({ s, buf: await ctx.decodeAudioData(data) });
    } catch {
      failed.push(s.label);
    }
  }
  if (!decoded.length) {
    void ctx.close();
    return { ...empty, failed };
  }

  const nodes: AudioBufferSourceNode[] = [];
  return {
    track: dest.stream.getAudioTracks()[0] ?? null,
    failed,
    start: () => {
      void ctx.resume();
      const t0 = ctx.currentTime + 0.05;
      for (const { s, buf } of decoded) {
        const winStart = Math.max(startMs, s.startMs);
        const winEnd = Math.min(endMs, s.endMs);
        if (winEnd <= winStart) continue;
        const offset = (winStart - s.startMs + s.trimMs) / 1000;
        if (offset >= buf.duration) continue;
        const dur = Math.min((winEnd - winStart) / 1000, buf.duration - offset);
        const node = ctx.createBufferSource();
        node.buffer = buf;
        const gain = ctx.createGain();
        gain.gain.value = Math.max(0, Math.min(1, s.volume));
        node.connect(gain).connect(dest);
        node.start(t0 + (winStart - startMs) / 1000, offset, dur);
        nodes.push(node);
      }
    },
    stop: () => {
      for (const n of nodes) {
        try {
          n.stop();
        } catch {
          /* sudah berhenti */
        }
      }
      void ctx.close();
    },
  };
}
