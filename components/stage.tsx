'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { drawFrame, layerAt, type MediaMap } from '@/lib/renderer';
import { fmtTime, layerColor, type Layer, type MediaItem, type Scene } from '@/lib/types';
import {
  IconAudio,
  IconBookmark,
  IconChevronDown,
  IconEye,
  IconEyeOff,
  IconImage,
  IconLayers,
  IconLoop,
  IconMaximize,
  IconPause,
  IconPlay,
  IconRestart,
  IconSettings,
  IconShape,
  IconText,
  IconVideo,
  IconX,
  IconZoomIn,
  IconZoomOut,
} from './icons';

type Props = {
  scene: Scene;
  media: MediaItem[];
  onOpenSettings: () => void;
  onOpenExport: () => void;
  onSeekRef?: (fn: (ms: number) => void) => void;
};

const TYPE_ICON = {
  image: IconImage,
  video: IconVideo,
  audio: IconAudio,
  text: IconText,
  shape: IconShape,
  scene: IconLayers,
  group: IconLayers,
  other: IconShape,
} as const;

export default function Stage({
  scene,
  media,
  onOpenSettings,
  onOpenExport,
  onSeekRef,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const startRef = useRef<number>(0);
  const pausedAtRef = useRef<number>(0);
  const mediaRef = useRef<MediaMap>({});
  const videoEls = useRef<HTMLVideoElement[]>([]);

  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [loop, setLoop] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [debug, setDebug] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [showTree, setShowTree] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [bookmarks, setBookmarks] = useState<number[]>([]);
  const [muted, setMuted] = useState(false);
  const [ready, setReady] = useState(false);

  const duration = scene.duration;

  /* ── Media: muat gambar & video ke memori ── */
  useEffect(() => {
    const map: MediaMap = {};
    const vids: HTMLVideoElement[] = [];
    let cancelled = false;

    const load = async () => {
      for (const m of media) {
        if (m.kind === 'image') {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.src = m.url;
          await new Promise<void>((res) => {
            img.onload = () => res();
            img.onerror = () => res();
          });
          if (cancelled) return;
          map[String(m.id)] = { el: img, kind: 'image' };
          map[m.name] = { el: img, kind: 'image' };
        } else if (m.kind === 'video') {
          const v = document.createElement('video');
          v.src = m.url;
          v.crossOrigin = 'anonymous';
          v.muted = true;
          v.playsInline = true;
          v.loop = true;
          v.preload = 'auto';
          vids.push(v);
          await new Promise<void>((res) => {
            v.onloadeddata = () => res();
            v.onerror = () => res();
            setTimeout(res, 4000);
          });
          if (cancelled) return;
          map[String(m.id)] = { el: v, kind: 'video' };
          map[m.name] = { el: v, kind: 'video' };
        }
      }
      if (cancelled) return;
      mediaRef.current = map;
      videoEls.current = vids;
      setReady(true);
    };
    void load();
    return () => {
      cancelled = true;
      vids.forEach((v) => {
        v.pause();
        v.src = '';
      });
    };
  }, [media]);

  /* ── Render loop ── */
  const render = useCallback(
    (t: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      drawFrame(
        ctx,
        scene,
        { timeMs: t, media: mediaRef.current, selectedId: selected, debug },
        canvas.width,
        canvas.height,
      );
    },
    [scene, selected, debug],
  );

  useEffect(() => {
    render(time);
  }, [render, time, ready]);

  useEffect(() => {
    if (!playing) return;
    startRef.current = performance.now() - pausedAtRef.current;
    const tick = () => {
      const t = performance.now() - startRef.current;
      if (t >= duration) {
        if (loop) {
          startRef.current = performance.now();
          pausedAtRef.current = 0;
          setTime(0);
          videoEls.current.forEach((v) => {
            v.currentTime = 0;
            void v.play().catch(() => {});
          });
        } else {
          pausedAtRef.current = duration;
          setTime(duration);
          setPlaying(false);
          return;
        }
      } else {
        pausedAtRef.current = t;
        setTime(t);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    videoEls.current.forEach((v) => {
      v.muted = muted;
      void v.play().catch(() => {});
    });
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, duration, loop, muted]);

  const seek = useCallback(
    (ms: number) => {
      const clamped = Math.max(0, Math.min(duration, ms));
      pausedAtRef.current = clamped;
      startRef.current = performance.now() - clamped;
      setTime(clamped);
      videoEls.current.forEach((v) => {
        try {
          v.currentTime = (clamped / 1000) % (v.duration || 1);
        } catch {
          /* belum siap */
        }
      });
    },
    [duration],
  );

  useEffect(() => {
    onSeekRef?.(seek);
  }, [onSeekRef, seek]);

  /* ── Keyboard shortcuts ── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && /input|textarea|select/i.test(el.tagName)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === 'ArrowLeft') {
        seek(time - (e.shiftKey ? 1000 : 1000 / scene.fps));
      } else if (e.key === 'ArrowRight') {
        seek(time + (e.shiftKey ? 1000 : 1000 / scene.fps));
      } else if (e.key === 'Home') {
        seek(0);
      } else if (e.key === 'End') {
        seek(duration);
      } else if (e.key.toLowerCase() === 'l') {
        setLoop((v) => !v);
      } else if (e.key.toLowerCase() === 'r') {
        seek(0);
      } else if (e.key.toLowerCase() === 'm') {
        setMuted((v) => !v);
      } else if (e.key.toLowerCase() === 'b') {
        setBookmarks((b) => (b.some((x) => Math.abs(x - time) < 60) ? b.filter((x) => Math.abs(x - time) >= 60) : [...b, Math.round(time)].sort((a, c) => a - c)));
      } else if (e.key === '+' || e.key === '=') {
        setZoom((z) => Math.min(20, z * 1.25));
      } else if (e.key === '-') {
        setZoom((z) => Math.max(0.2, z / 1.25));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [time, duration, scene.fps, seek]);

  /* ── Klik pada canvas → pilih layer ── */
  const onCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const cy = ((e.clientY - rect.top) / rect.height) * canvas.height;
    const scale = Math.min(canvas.width / scene.width, canvas.height / scene.height);
    const ox = (canvas.width - scene.width * scale) / 2;
    const oy = (canvas.height - scene.height * scale) / 2;
    const px = (cx - ox) / scale;
    const py = (cy - oy) / scale;
    const hit = layerAt(scene, time, px, py);
    setSelected(hit?.id ?? null);
  };

  const visibleLayers = useMemo(
    () => scene.layers.filter((l) => l.visible && time >= l.start && time <= l.end),
    [scene.layers, time],
  );

  const [box, setBox] = useState({ w: 0, h: 0 });
  const [fluid, setFluid] = useState(false);

  /* Ukuran tampil canvas mengikuti wadah (responsif, tanpa overflow) */
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)');
    const sync = () => setFluid(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    const el = wrapRef.current;
    if (!el) return () => mq.removeEventListener('change', sync);
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setBox({ w: r.width - 16, h: r.height - 16 });
    });
    ro.observe(el);
    return () => {
      mq.removeEventListener('change', sync);
      ro.disconnect();
    };
  }, []);

  const fit = useMemo(() => {
    if (!box.w) return { w: 0, h: 0 };
    const ratio = scene.height / scene.width;
    if (fluid) {
      const w = Math.max(1, Math.floor(box.w));
      return { w, h: Math.max(1, Math.floor(w * ratio)) };
    }
    if (!box.h) return { w: 0, h: 0 };
    const s = Math.min(box.w / scene.width, box.h / scene.height);
    return { w: Math.max(1, Math.floor(scene.width * s)), h: Math.max(1, Math.floor(scene.height * s)) };
  }, [box, fluid, scene.width, scene.height]);

  const selectedLayer = scene.layers.find((l) => l.id === selected) ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Stage */}
      <div ref={wrapRef} className="relative flex shrink-0 items-center justify-center bg-black px-2 py-2 lg:min-h-0 lg:flex-1">
        <canvas
          ref={canvasRef}
          width={Math.min(1080, scene.width)}
          height={Math.round((Math.min(1080, scene.width) * scene.height) / scene.width)}
          onClick={onCanvasClick}
          className="rounded-lg border border-[var(--line)] shadow-[0_0_60px_rgba(31,200,238,0.08)]"
          style={{ width: fit.w || undefined, height: fit.h || undefined, touchAction: 'manipulation' }}
          aria-label="Preview preset"
        />
        <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-1.5">
          <span className="chip bg-black/60 backdrop-blur">
            {scene.width}×{scene.height}
          </span>
          <span className="chip bg-black/60 backdrop-blur">{scene.fps} fps</span>
          <span className="chip bg-black/60 backdrop-blur">{visibleLayers.length} aktif</span>
        </div>
        <div className="absolute right-3 top-3 flex gap-1.5">
          <button
            type="button"
            className="btn btn-sm btn-icon bg-black/60 backdrop-blur"
            onClick={() => setDebug((d) => !d)}
            title="Mode debug visual"
            aria-pressed={debug}
          >
            <IconMaximize size={14} />
          </button>
          <button
            type="button"
            className="btn btn-sm btn-icon bg-black/60 backdrop-blur"
            onClick={onOpenSettings}
            title="Setelan"
          >
            <IconSettings size={14} />
          </button>
        </div>
        {!ready && media.length > 0 && (
          <div className="absolute inset-0 grid place-items-center bg-black/50">
            <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
              <span className="spinner" /> Memuat media…
            </div>
          </div>
        )}
      </div>

      {/* Transport */}
      <div className="border-t border-[var(--line)] bg-[var(--panel)] px-3 py-2.5">
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={0}
            max={duration}
            step={1}
            value={Math.round(time)}
            onChange={(e) => seek(Number(e.target.value))}
            className="min-w-0 flex-1"
            style={{ ['--pct' as string]: `${(time / duration) * 100}%` }}
            aria-label="Posisi putar"
          />
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-[var(--muted)]">
            {fmtTime(time)} / {fmtTime(duration)}
          </span>
        </div>
        <div className="mt-1.5 flex items-center gap-1.5">
          <button type="button" className="btn btn-sm btn-icon" onClick={() => seek(0)} title="Ke awal">
            <IconRestart size={15} />
          </button>
          <button
            type="button"
            className="btn btn-primary h-10 flex-1 sm:flex-none sm:px-6"
            onClick={() => setPlaying((p) => !p)}
            aria-label={playing ? 'Jeda' : 'Putar'}
          >
            {playing ? <IconPause size={16} /> : <IconPlay size={16} />}
            <span className="text-xs font-semibold">{playing ? 'Jeda' : 'Putar'}</span>
          </button>
          <button
            type="button"
            className={`btn btn-sm btn-icon ${loop ? 'border-[var(--accent)] text-[var(--accent)]' : ''}`}
            onClick={() => setLoop((l) => !l)}
            aria-pressed={loop}
            title="Ulangi otomatis"
          >
            <IconLoop size={15} />
          </button>
          <button
            type="button"
            className={`btn btn-sm btn-icon ${muted ? 'border-[var(--accent)] text-[var(--accent)]' : ''}`}
            onClick={() => setMuted((m) => !m)}
            aria-pressed={muted}
            title="Bisukan audio"
          >
            <IconAudio size={15} />
          </button>
          <button
            type="button"
            className="btn btn-sm btn-icon"
            onClick={() => {
              setBookmarks((b) =>
                b.some((x) => Math.abs(x - time) < 60)
                  ? b.filter((x) => Math.abs(x - time) >= 60)
                  : [...b, Math.round(time)].sort((a, c) => a - c),
              );
            }}
            title="Pasang/buang penanda (B)"
          >
            <IconBookmark size={15} />
          </button>
          <button type="button" className="btn btn-sm ml-auto hidden sm:inline-flex" onClick={onOpenExport}>
            Ekspor
          </button>
        </div>
        {bookmarks.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {bookmarks.map((b) => (
              <button
                key={b}
                type="button"
                className="chip hover:border-[var(--accent)] hover:text-[var(--accent)]"
                onClick={() => seek(b)}
                title="Klik untuk lompat; klik kanan untuk hapus"
                onContextMenu={(e) => {
                  e.preventDefault();
                  setBookmarks((list) => list.filter((x) => x !== b));
                }}
              >
                {fmtTime(b)}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Timeline + tree */}
      <div className="border-t border-[var(--line)] bg-[var(--panel)]">
        <div className="flex items-center gap-1.5 border-b border-[var(--line)] px-3 py-2">
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setShowTimeline((s) => !s)}
            aria-pressed={showTimeline}
          >
            <IconLayers size={13} /> {showTimeline ? 'Tutup timeline' : 'Timeline'}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setShowTree((s) => !s)}
            aria-pressed={showTree}
          >
            {showTree ? 'Sembunyikan layer' : 'Daftar layer'}
          </button>
          <span className="chip hidden sm:inline-flex">{scene.layers.length} layer</span>
          <div className="ml-auto flex items-center gap-1">
            <button type="button" className="btn btn-sm btn-icon" onClick={() => setZoom((z) => Math.max(0.2, z / 1.25))} aria-label="Perkecil timeline">
              <IconZoomOut size={13} />
            </button>
            <span className="w-9 text-center font-mono text-[10px] text-[var(--muted)]">{zoom.toFixed(1)}x</span>
            <button type="button" className="btn btn-sm btn-icon" onClick={() => setZoom((z) => Math.min(20, z * 1.25))} aria-label="Perbesar timeline">
              <IconZoomIn size={13} />
            </button>
          </div>
        </div>

        <div
          className={`flex flex-col overflow-hidden ${showTimeline || showTree ? 'max-h-[34vh] min-h-[120px]' : 'max-h-0'}`}
        >
          {showTree && (
            <div className="max-h-[130px] shrink-0 overflow-y-auto border-b border-[var(--line)]">
              {scene.layers.map((l) => {
                const Icon = TYPE_ICON[l.type] ?? IconShape;
                const active = time >= l.start && time <= l.end;
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => {
                      setSelected(l.id);
                      seek(Math.max(l.start, Math.min(time, l.end)));
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition ${
                      selected === l.id ? 'bg-[rgba(31,200,238,0.1)]' : 'hover:bg-white/5'
                    } ${active ? '' : 'opacity-45'}`}
                  >
                    <span
                      className="grid h-5 w-5 shrink-0 place-items-center rounded"
                      style={{ background: layerColor(l.type) }}
                    >
                      <Icon size={11} />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{l.name}</span>
                    <span className="shrink-0 font-mono text-[10px] text-[var(--muted)]">
                      {(l.start / 1000).toFixed(1)}–{(l.end / 1000).toFixed(1)}s
                    </span>
                    {l.visible ? (
                      <IconEye size={12} className="shrink-0 text-[var(--muted)]" />
                    ) : (
                      <IconEyeOff size={12} className="shrink-0 text-[#4a4a52]" />
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Track bars */}
          {showTimeline && (
          <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
            <div style={{ width: `${Math.max(100, zoom * 100)}%` }} className="relative">
              <div className="mb-1 flex justify-between font-mono text-[9px] text-[#4a4a52]">
                {[0, 0.25, 0.5, 0.75, 1].map((f) => (
                  <span key={f}>{(duration * f / 1000).toFixed(1)}s</span>
                ))}
              </div>
              <div className="space-y-1">
                {scene.layers.slice(0, 40).map((l) => (
                  <div key={l.id} className="relative h-4 rounded bg-[#131317]">
                    <div
                      className="absolute top-0 h-full rounded"
                      style={{
                        left: `${(l.start / duration) * 100}%`,
                        width: `${Math.max(0.6, ((l.end - l.start) / duration) * 100)}%`,
                        background: layerColor(l.type),
                        opacity: selected === l.id ? 1 : 0.75,
                        outline: selected === l.id ? '1px solid var(--accent)' : 'none',
                      }}
                      title={`${l.name} · ${(l.start / 1000).toFixed(2)}s–${(l.end / 1000).toFixed(2)}s`}
                    />
                  </div>
                ))}
              </div>
              <div
                className="pointer-events-none absolute bottom-0 top-4 w-px bg-[var(--accent)]"
                style={{ left: `${(time / duration) * 100}%` }}
              />
            </div>
          </div>
          )}
        </div>
      </div>

      {/* Inspector */}
      {selectedLayer && (
        <div className="border-t border-[var(--line)] bg-[#0d0d10] px-3 py-2.5">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-xs font-semibold">{selectedLayer.name}</span>
            <span className="chip">{selectedLayer.type}</span>
            <button type="button" className="btn btn-sm btn-icon ml-auto" onClick={() => setSelected(null)} aria-label="Tutup inspector">
              <IconX size={12} />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[10px] text-[var(--muted)] sm:grid-cols-4">
            <span>pos {selectedLayer.x.toFixed(0)},{selectedLayer.y.toFixed(0)}</span>
            <span>scale {selectedLayer.scaleX.toFixed(2)}×{selectedLayer.scaleY.toFixed(2)}</span>
            <span>rot {selectedLayer.rotation.toFixed(0)}°</span>
            <span>op {selectedLayer.opacity.toFixed(2)}</span>
            <span>size {selectedLayer.width.toFixed(0)}×{selectedLayer.height.toFixed(0)}</span>
            <span>kf {Object.keys(selectedLayer.keyframes).length} properti</span>
            <span>fx {selectedLayer.effects.length}</span>
            <span>media {selectedLayer.mediaRef ?? '—'}</span>
          </div>
          {selectedLayer.effects.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {selectedLayer.effects.map((fx) => (
                <span key={fx.id} className="chip">
                  {fx.name}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
