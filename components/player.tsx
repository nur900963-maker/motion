'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  addMedia,
  attachMedia,
  deleteMedia,
  getProject,
  listMedia,
  saveProject as saveLocalProject,
  takePending,
} from '@/lib/local-db';
import { drawFrame, type MediaMap } from '@/lib/renderer';
import { GlRenderer } from '@/lib/gl-renderer';
import { flattenAll } from '@/lib/am-xml';
import { syncVideos, waitSeeked } from '@/lib/video-sync';
import { collectAudioSources, prepareExportAudio } from '@/lib/audio-engine';
import {
  fmtBytes,
  fmtTime,
  RESOLUTIONS,
  type ExportSettings,
  type Layer,
  type MediaItem,
  type Scene,
} from '@/lib/types';
import { SITE_NAME } from '@/lib/site';
import Stage from './stage';
import {
  IconAlert,
  IconAudio,
  IconCheck,
  IconChevronDown,
  IconDownload,
  IconFolder,
  IconImage,
  IconInfo,
  IconLayers,
  IconPlus,
  IconRefresh,
  IconSettings,
  IconShare,
  IconTrash,
  IconUpload,
  IconVideo,
  IconX,
} from './icons';

type Tab = 'proyek' | 'media' | 'audio' | 'layer' | 'ekspor';

const TABS: { id: Tab; label: string; icon: typeof IconFolder }[] = [
  { id: 'proyek', label: 'Proyek', icon: IconFolder },
  { id: 'media', label: 'Media', icon: IconImage },
  { id: 'audio', label: 'Audio', icon: IconAudio },
  { id: 'layer', label: 'Layer', icon: IconLayers },
  { id: 'ekspor', label: 'Ekspor', icon: IconDownload },
];

export default function Player() {
  const [scene, setScene] = useState<Scene | null>(null);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [tab, setTab] = useState<Tab>('proyek');
  const [projectId, setProjectId] = useState<number | null>(null);
  const [projectName, setProjectName] = useState('');
  const [xmlText, setXmlText] = useState<string | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState('');
  const [slotTarget, setSlotTarget] = useState<Layer | null>(null);
  const seekRef = useRef<((ms: number) => void) | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const slotInputRef = useRef<HTMLInputElement>(null);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 3200);
  }, []);

  /* ── Boot: ambil preset dari halaman utama (memori) atau proyek tersimpan di browser ── */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pending = takePending();
        if (pending?.scene?.layers) {
          setScene(pending.scene);
          setProjectName(pending.scene.name);
          setXmlText(pending.xmlText);
          setSourceUrl(pending.sourceUrl);
          setLoading(false);
          return;
        }

        const pid = Number(new URLSearchParams(window.location.search).get('project'));
        if (Number.isInteger(pid) && pid > 0) {
          const proj = await getProject(pid);
          if (cancelled) return;
          if (!proj) throw new Error('Proyek tidak ditemukan di browser ini. Mungkin sudah dihapus.');
          setScene(proj.scene);
          setProjectName(proj.name);
          setProjectId(proj.id);
          setXmlText(proj.xmlText);
          setSourceUrl(proj.sourceUrl);
          setMedia(await listMedia(proj.id));
          setLoading(false);
          return;
        }

        // Tanpa preset & tanpa proyek: kembali ke halaman utama untuk memilih preset.
        window.location.replace('/');
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Gagal memuat player.');
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const saveProject = useCallback(async () => {
    if (!scene) return;
    setSaving(true);
    try {
      const id = await saveLocalProject({
        id: projectId,
        name: projectName || scene.name,
        scene,
        xmlText,
        sourceUrl,
      });
      if (!projectId) {
        // Media yang ditambahkan sebelum proyek disimpan ikut dihubungkan ke proyek ini.
        await attachMedia(
          media.filter((m) => m.projectId === null).map((m) => m.id),
          id,
        );
        setMedia((list) => list.map((m) => (m.projectId === null ? { ...m, projectId: id } : m)));
        setProjectId(id);
        notify('Proyek disimpan di browser ini.');
      } else {
        notify('Proyek diperbarui.');
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Gagal menyimpan proyek.');
    } finally {
      setSaving(false);
    }
  }, [scene, projectId, projectName, xmlText, sourceUrl, media, notify]);

  const uploadMedia = useCallback(
    async (file: File, target?: Layer | null): Promise<MediaItem | null> => {
      if (!/^(image|video|audio)\//.test(file.type)) {
        setUploadErr(`Tipe file "${file.type || 'tidak dikenal'}" tidak didukung. Pilih gambar, video, atau audio.`);
        return null;
      }
      setUploading(true);
      setUploadErr('');
      try {
        // Media disimpan di browser (IndexedDB), tidak diunggah ke server.
        const item = await addMedia(file, projectId);
        setMedia((m) => [item, ...m]);

        if (target && scene) {
          // Pasang ke semua slot yang merujuk media asal yang sama (mis. 22 layer memakai 1 foto).
          const original = target.raw.fillVideo ?? target.raw.fillImage ?? target.raw.src ?? null;
          const same = (l: Layer) => l.id === target.id || (original !== null && (l.raw.fillVideo ?? l.raw.fillImage ?? l.raw.src) === original);
          const next: Scene = {
            ...scene,
            layers: scene.layers.map((l) => (same(l) ? { ...l, mediaRef: String(item.id) } : l)),
          };
          const count = next.layers.filter(same).length;
          setScene(next);
          notify(count > 1 ? `Media dipasang ke ${count} layer yang memakai foto yang sama.` : `Media dipasang ke "${target.name}".`);
        } else {
          notify('Media ditambahkan ke galeri.');
        }
        return item;
      } catch (err) {
        setUploadErr(err instanceof Error ? err.message : 'Gagal menambahkan media.');
        return null;
      } finally {
        setUploading(false);
      }
    },
    [projectId, scene, notify],
  );

  const removeMedia = useCallback(
    async (id: number) => {
      try {
        await deleteMedia(id);
        setMedia((m) => {
          const gone = m.find((x) => x.id === id);
          if (gone) URL.revokeObjectURL(gone.url);
          return m.filter((x) => x.id !== id);
        });
        setScene((sc) =>
          sc ? { ...sc, layers: sc.layers.map((l) => (l.mediaRef === String(id) ? { ...l, mediaRef: l.raw.fillVideo ?? l.raw.fillImage ?? l.raw.src ?? null } : l)) } : sc,
        );
        setScene((sc) => (sc ? { ...sc, userAudio: (sc.userAudio ?? []).filter((u) => u.mediaId !== id) } : sc));
        notify('Media dihapus.');
      } catch (err) {
        notify(err instanceof Error ? err.message : 'Gagal menghapus media.');
      }
    },
    [notify],
  );

  const toggleLayer = useCallback(
    (id: string) => {
      setScene((s) =>
        s ? { ...s, layers: s.layers.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)) } : s,
      );
    },
    [],
  );

  const audioInputRef = useRef<HTMLInputElement>(null);

  const addUserAudio = useCallback(
    async (file: File) => {
      const item = await uploadMedia(file, null);
      if (!item) return;
      setScene((sc) =>
        sc
          ? {
              ...sc,
              userAudio: [
                ...(sc.userAudio ?? []),
                { id: `ua-${Date.now()}`, mediaId: item.id, offset: 0, trim: 0, volume: 1 },
              ],
            }
          : sc,
      );
      notify('Audio ditambahkan. Tekan Putar untuk mendengarnya.');
    },
    [uploadMedia, notify],
  );

  const updateUserAudio = useCallback((id: string, patch: Partial<{ offset: number; trim: number; volume: number }>) => {
    setScene((sc) => (sc ? { ...sc, userAudio: (sc.userAudio ?? []).map((u) => (u.id === id ? { ...u, ...patch } : u)) } : sc));
  }, []);

  const removeUserAudio = useCallback((id: string) => {
    setScene((sc) => (sc ? { ...sc, userAudio: (sc.userAudio ?? []).filter((u) => u.id !== id) } : sc));
  }, []);

  /** Slot media digabung per media asal: satu foto yang dipakai 22 layer = satu baris. */
  const slotGroups = useMemo(() => {
    if (!scene) return [];
    const map = new Map<string, Layer[]>();
    for (const l of flattenAll(scene.layers) as Layer[]) {
      if (l.type !== 'image' && l.type !== 'video') continue;
      const key = l.raw.fillVideo ?? l.raw.fillImage ?? l.raw.src ?? `layer:${l.id}`;
      const list = map.get(key);
      if (list) list.push(l);
      else map.set(key, [l]);
    }
    return [...map.entries()].map(([key, layers]) => ({ key, layers, first: layers[0] }));
  }, [scene]);
  const audioLayers = useMemo(
    () => (scene ? (flattenAll(scene.layers) as Layer[]).filter((l) => l.type === 'audio') : []),
    [scene],
  );

  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center px-6">
        <div className="text-center">
          <div className="dot-pulse mb-4 flex justify-center">
            <i />
            <i />
            <i />
          </div>
          <p className="text-sm text-[var(--muted)]">Menyiapkan player…</p>
        </div>
      </div>
    );
  }

  if (error || !scene) {
    return (
      <div className="grid min-h-dvh place-items-center px-6">
        <div className="card max-w-sm p-6 text-center">
          <IconAlert size={26} className="mx-auto mb-3 text-[var(--err)]" />
          <p className="text-sm font-semibold">Player tidak bisa dibuka</p>
          <p className="mt-1 text-xs text-[var(--muted)]">{error || 'Preset tidak tersedia.'}</p>
          <Link href="/" className="btn btn-primary mt-4 w-full">
            Kembali ke halaman awal
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-[var(--ink)] lg:h-dvh lg:overflow-hidden">
      {/* Header */}
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-[var(--line)] bg-[rgba(5,5,5,0.92)] px-3 py-2.5 backdrop-blur">
        <Link href="/" className="flex items-center gap-2" aria-label="Kembali ke halaman awal">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--paper)] text-black">
            <span className="text-sm font-black">X</span>
          </span>
          <span className="hidden sm:block">
            <span className="block text-xs font-bold leading-tight">{SITE_NAME}</span>
            <span className="block text-[10px] leading-tight text-[var(--muted)]">Preset Player</span>
          </span>
        </Link>
        <div className="min-w-0 flex-1 px-1">
          <p className="truncate text-xs font-semibold">{projectName || scene.name}</p>
          <p className="truncate text-[10px] text-[var(--muted)]">
            {scene.layers.length} layer · {fmtTime(scene.duration)} · {scene.width}×{scene.height}
          </p>
        </div>
        <button type="button" className="btn btn-sm" onClick={saveProject} disabled={saving}>
          {saving ? <span className="spinner" /> : <IconCheck size={13} />}
          <span className="hidden sm:inline">{projectId ? 'Simpan' : 'Simpan proyek'}</span>
        </button>
        <button type="button" className="btn btn-sm btn-icon" onClick={() => setSettingsOpen(true)} aria-label="Setelan">
          <IconSettings size={15} />
        </button>
        <button type="button" className="btn btn-sm btn-accent" onClick={() => setExportOpen(true)}>
          <IconDownload size={13} />
          <span className="hidden sm:inline">Ekspor</span>
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Stage */}
        <div className="flex flex-col lg:min-h-0 lg:flex-1">
          <Stage
            scene={scene}
            media={media}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenExport={() => setExportOpen(true)}
            onSeekRef={(fn) => {
              seekRef.current = fn;
            }}
          />
        </div>

        {/* Panel */}
        <aside className="flex min-h-0 w-full shrink-0 flex-col border-t border-[var(--line)] bg-[var(--panel)] lg:max-h-none lg:w-[380px] lg:border-l lg:border-t-0">
          <div className="flex gap-1 border-b border-[var(--line)] p-2">
            {TABS.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  type="button"
                  className="tab"
                  data-active={tab === t.id}
                  aria-label={t.label}
                  onClick={() => setTab(t.id)}
                >
                  <Icon size={13} />
                  <span className="text-[11px]">{t.label}</span>
                </button>
              );
            })}
          </div>

          <div className="p-3 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
            {tab === 'proyek' && (
              <div className="space-y-3">
                <div>
                  <label className="label" htmlFor="proj-name">
                    Nama proyek
                  </label>
                  <input
                    id="proj-name"
                    className="input"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    maxLength={120}
                    placeholder="Nama proyek"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Stat label="Durasi" value={fmtTime(scene.duration)} />
                  <Stat label="Dimensi" value={`${scene.width}×${scene.height}`} />
                  <Stat label="FPS" value={String(scene.fps)} />
                  <Stat label="Layer" value={String(scene.layers.length)} />
                  <Stat label="Efek" value={String(scene.effectCount)} />
                  <Stat label="Sumber" value={scene.source.toUpperCase()} />
                </div>

                {scene.warnings.length > 0 && (
                  <div className="rounded-xl border border-[rgba(245,181,68,0.3)] bg-[rgba(245,181,68,0.07)] p-3">
                    <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-[var(--warn)]">
                      <IconAlert size={13} /> Catatan parser ({scene.warnings.length})
                    </p>
                    <ul className="space-y-1 text-[11px] leading-relaxed text-[#c9b48a]">
                      {scene.warnings.slice(0, 6).map((w, i) => (
                        <li key={i}>• {w}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="space-y-2">
                  <button type="button" className="btn w-full" onClick={saveProject} disabled={saving}>
                    {saving ? <span className="spinner" /> : <IconCheck size={14} />}
                    {projectId ? 'Perbarui proyek tersimpan' : 'Simpan di browser ini'}
                  </button>
                  <Link href="/" className="btn w-full">
                    <IconRefresh size={14} /> Ganti preset
                  </Link>
                  <Link href="/dashboard" className="btn w-full">
                    <IconFolder size={14} /> Proyek saya
                  </Link>
                </div>

                {xmlText && (
                  <details className="rounded-xl border border-[var(--line)] bg-[#0e0e11] p-3">
                    <summary className="cursor-pointer text-xs font-medium text-[var(--muted)]">
                      Lihat XML sumber ({fmtBytes(new Blob([xmlText]).size)})
                    </summary>
                    <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] leading-relaxed text-[#7d8496]">
                      {xmlText.slice(0, 4000)}
                      {xmlText.length > 4000 ? '\n…' : ''}
                    </pre>
                  </details>
                )}
              </div>
            )}

            {tab === 'media' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold">Galeri media ({media.length})</p>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                  >
                    {uploading ? <span className="spinner" /> : <IconPlus size={12} />} Tambah
                  </button>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="sr-only"
                  accept="image/*,video/*,audio/*"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void uploadMedia(f);
                    e.target.value = '';
                  }}
                />
                {uploadErr && (
                  <p className="err" role="alert">
                    <IconAlert size={13} className="mt-0.5 shrink-0" /> {uploadErr}
                  </p>
                )}

                <div>
                  <p className="label">Slot media preset ({slotGroups.length})</p>
                  {slotGroups.length === 0 ? (
                    <p className="hint">Preset ini tidak punya slot gambar/video.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {slotGroups.map((g) => {
                        const l = g.first;
                        const bound = l.mediaRef ? media.find((m) => String(m.id) === l.mediaRef) : null;
                        const info = scene.mediaInfo?.[g.key];
                        const embedded = /^(am|amproj):/.test(g.key);
                        const hidden = g.layers.every((x) => x.hiddenInSource);
                        const title = info?.title || l.name;
                        const detail = [
                          g.layers.length > 1 ? `dipakai ${g.layers.length} layer` : null,
                          info?.type && info.width ? `${info.type.split('/')[0]} ${info.width}×${info.height}` : null,
                          info?.durationMs ? `${Math.round(info.durationMs / 1000)} dtk` : null,
                          embedded ? 'tertanam di preset, tidak ada di XML' : null,
                          hidden ? 'disembunyikan di preset' : null,
                        ]
                          .filter(Boolean)
                          .join(' · ');
                        return (
                          <div
                            key={g.key}
                            className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[#0e0e11] px-2.5 py-2"
                          >
                            <span className="grid h-7 w-7 shrink-0 place-items-center rounded bg-[#1a1a20] text-[var(--muted)]">
                              {l.type === 'video' ? <IconVideo size={13} /> : <IconImage size={13} />}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[11px] font-medium">{title}</span>
                              <span className="block truncate text-[10px] text-[var(--muted)]">
                                {bound ? `✓ ${bound.name}` : 'belum ada media'}
                                {detail ? ` · ${detail}` : ''}
                              </span>
                            </span>
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={() => {
                                setSlotTarget(l);
                                slotInputRef.current?.click();
                              }}
                            >
                              {bound ? 'Ganti' : 'Pilih'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <input
                    ref={slotInputRef}
                    type="file"
                    className="sr-only"
                    accept={slotTarget?.type === 'audio' ? 'audio/*' : 'image/*,video/*'}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void uploadMedia(f, slotTarget);
                      e.target.value = '';
                      setSlotTarget(null);
                    }}
                  />
                </div>

                <div>
                  <p className="label">Semua media</p>
                  {media.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-[#2a2a30] px-3 py-6 text-center">
                      <IconImage size={20} className="mx-auto mb-2 text-[#3f3f48]" />
                      <p className="text-[11px] text-[var(--muted)]">
                        Belum ada media. Tambahkan foto, video, atau audio.
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-1.5">
                      {media.map((m) => (
                        <div key={m.id} className="group relative overflow-hidden rounded-lg border border-[var(--line)] bg-[#0e0e11]">
                          {m.kind === 'image' ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={m.url} alt={m.name} className="aspect-square w-full object-cover" />
                          ) : (
                            <div className="grid aspect-square w-full place-items-center text-[var(--muted)]">
                              {m.kind === 'video' ? <IconVideo size={18} /> : <IconAudio size={18} />}
                            </div>
                          )}
                          <div className="absolute inset-x-0 bottom-0 bg-black/70 px-1 py-0.5">
                            <p className="truncate text-[9px]">{m.name}</p>
                          </div>
                          <button
                            type="button"
                            className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded bg-black/70 text-[var(--err)] opacity-0 transition group-hover:opacity-100"
                            onClick={() => removeMedia(m.id)}
                            aria-label={`Hapus ${m.name}`}
                          >
                            <IconTrash size={10} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {tab === 'audio' && (
              <div className="space-y-3">
                <p className="text-xs font-semibold">Track audio scene ({audioLayers.length})</p>
                {audioLayers.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[#2a2a30] px-3 py-6 text-center">
                    <IconAudio size={20} className="mx-auto mb-2 text-[#3f3f48]" />
                    <p className="text-[11px] text-[var(--muted)]">Preset ini tidak punya track audio.</p>
                  </div>
                ) : (
                  audioLayers.map((l) => {
                    const bound = l.mediaRef ? media.find((m) => String(m.id) === l.mediaRef) : null;
                    return (
                      <div key={l.id} className="rounded-xl border border-[var(--line)] bg-[#0e0e11] p-3">
                        <div className="flex items-center gap-2">
                          <IconAudio size={14} className="text-[var(--warn)]" />
                          <span className="min-w-0 flex-1 truncate text-xs font-medium">{l.name}</span>
                          <span className="font-mono text-[10px] text-[var(--muted)]">
                            {(l.start / 1000).toFixed(1)}–{(l.end / 1000).toFixed(1)}s
                          </span>
                        </div>
                        <p className="mt-1 truncate text-[10px] text-[var(--muted)]">
                          {bound ? bound.name : 'belum ada file audio'}
                        </p>
                        <button
                          type="button"
                          className="btn btn-sm mt-2 w-full"
                          onClick={() => {
                            setSlotTarget(l);
                            slotInputRef.current?.click();
                          }}
                        >
                          <IconUpload size={12} /> {bound ? 'Ganti audio' : 'Unggah audio'}
                        </button>
                      </div>
                    );
                  })
                )}
                <div className="space-y-2 rounded-xl border border-[var(--line)] bg-[#0e0e11] p-3">
                  <p className="text-xs font-semibold">Tambah audio sendiri ({(scene.userAudio ?? []).length})</p>
                  <p className="hint">
                    Audio ikut terdengar di preview dan ikut masuk ke hasil ekspor. Cocok untuk musik atau voice over di
                    preset yang tidak punya track audio.
                  </p>
                  <button type="button" className="btn btn-sm w-full" onClick={() => audioInputRef.current?.click()} disabled={uploading}>
                    {uploading ? <span className="spinner" /> : <IconPlus size={12} />} Pilih file audio
                  </button>
                  <input
                    ref={audioInputRef}
                    type="file"
                    className="sr-only"
                    accept="audio/*"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (f) void addUserAudio(f);
                    }}
                  />
                  {(scene.userAudio ?? []).map((u) => {
                    const m = media.find((x) => x.id === u.mediaId);
                    return (
                      <div key={u.id} className="space-y-2 rounded-lg border border-[var(--line)] p-2.5">
                        <div className="flex items-center gap-2">
                          <IconAudio size={13} className="text-[var(--warn)]" />
                          <span className="min-w-0 flex-1 truncate text-[11px] font-medium">{m?.name ?? 'audio hilang'}</span>
                          <button type="button" className="btn btn-sm btn-icon" onClick={() => removeUserAudio(u.id)} aria-label="Hapus track audio">
                            <IconTrash size={13} />
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <label className="block text-[10px] text-[var(--muted)]">
                            Mulai di (detik)
                            <input
                              type="number"
                              min={0}
                              step={0.1}
                              className="input mt-1"
                              value={u.offset / 1000}
                              onChange={(e) => updateUserAudio(u.id, { offset: Math.max(0, Number(e.target.value) || 0) * 1000 })}
                            />
                          </label>
                          <label className="block text-[10px] text-[var(--muted)]">
                            Potong awal (detik)
                            <input
                              type="number"
                              min={0}
                              step={0.1}
                              className="input mt-1"
                              value={u.trim / 1000}
                              onChange={(e) => updateUserAudio(u.id, { trim: Math.max(0, Number(e.target.value) || 0) * 1000 })}
                            />
                          </label>
                        </div>
                        <label className="block text-[10px] text-[var(--muted)]">
                          Volume {Math.round(u.volume * 100)}%
                          <input
                            type="range"
                            min={0}
                            max={100}
                            value={Math.round(u.volume * 100)}
                            className="mt-1 w-full"
                            onChange={(e) => updateUserAudio(u.id, { volume: Number(e.target.value) / 100 })}
                          />
                        </label>
                      </div>
                    );
                  })}
                </div>

                <div>
                  <p className="label">Audio di galeri</p>
                  {media.filter((m) => m.kind === 'audio').length === 0 ? (
                    <p className="hint">Belum ada audio di galeri.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {media
                        .filter((m) => m.kind === 'audio')
                        .map((m) => (
                          <div key={m.id} className="flex items-center gap-2 rounded-lg border border-[var(--line)] px-2.5 py-2">
                            <IconAudio size={13} className="text-[var(--muted)]" />
                            <span className="min-w-0 flex-1 truncate text-[11px]">{m.name}</span>
                            <span className="text-[10px] text-[var(--muted)]">{fmtBytes(m.size)}</span>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {tab === 'layer' && (
              <div className="space-y-2">
                <p className="text-xs font-semibold">Semua layer ({scene.layers.length})</p>
                {scene.layers.map((l) => (
                  <div
                    key={l.id}
                    className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[#0e0e11] px-2.5 py-2"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11px] font-medium">{l.name}</span>
                      <span className="block text-[10px] text-[var(--muted)]">
                        {l.type} · {(l.start / 1000).toFixed(2)}–{(l.end / 1000).toFixed(2)}s ·{' '}
                        {Object.keys(l.keyframes).length} kf
                      </span>
                    </span>
                    <button
                      type="button"
                      className="btn btn-sm btn-icon"
                      onClick={() => toggleLayer(l.id)}
                      aria-label={l.visible ? 'Sembunyikan layer' : 'Tampilkan layer'}
                    >
                      {l.visible ? <IconCheck size={12} /> : <IconX size={12} />}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {tab === 'ekspor' && (
              <div className="space-y-3">
                <p className="text-xs font-semibold">Ekspor & bagikan</p>
                <p className="hint">
                  Render dilakukan di browser kamu dari canvas yang sama dengan preview, lalu hasilnya langsung bisa
                  kamu simpan ke perangkat. Tidak ada yang diunggah ke server.
                </p>
                <button type="button" className="btn btn-accent w-full" onClick={() => setExportOpen(true)}>
                  <IconDownload size={14} /> Buka pengaturan ekspor
                </button>
              </div>
            )}
          </div>
        </aside>
      </div>

      {toast && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-[var(--line-2)] bg-[#17171b] px-4 py-2.5 text-xs shadow-xl fade-in">
          {toast}
        </div>
      )}

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} scene={scene} />}
      {exportOpen && (
        <ExportModal
          scene={scene}
          media={media}
          onClose={() => setExportOpen(false)}
          onDone={(msg) => {
            notify(msg);
            setTab('ekspor');
          }}
        />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--line)] bg-[#0e0e11] px-2.5 py-2">
      <p className="text-[9px] uppercase tracking-wider text-[var(--muted)]">{label}</p>
      <p className="mt-0.5 truncate text-[11px] font-semibold">{value}</p>
    </div>
  );
}

function SettingsModal({ onClose, scene }: { onClose: () => void; scene: Scene }) {
  const [quality, setQuality] = useState(360);
  const [targetFps, setTargetFps] = useState(60);
  const [autoQuality, setAutoQuality] = useState(true);
  const [effects, setEffects] = useState(true);
  const [debug, setDebug] = useState(false);
  const [safeArea, setSafeArea] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:p-5" role="dialog" aria-modal="true">
      <div className="card max-h-[88dvh] w-full max-w-md overflow-y-auto rounded-b-none p-4 sm:rounded-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Setelan</h2>
          <button type="button" className="btn btn-sm btn-icon" onClick={onClose} aria-label="Tutup">
            <IconX size={14} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="label" htmlFor="q">
              Kualitas render preview
            </label>
            <select id="q" className="input" value={quality} onChange={(e) => setQuality(Number(e.target.value))}>
              <option value={270}>270p (paling cepat)</option>
              <option value={360}>360p (bawaan)</option>
              <option value={480}>480p</option>
              <option value={640}>640p</option>
              <option value={960}>960p (berat)</option>
            </select>
            <p className="hint">
              Canvas {Math.round((scene.width / scene.height) * quality)}×{quality}
            </p>
          </div>

          <div>
            <label className="label" htmlFor="fps">
              Target FPS
            </label>
            <select id="fps" className="input" value={targetFps} onChange={(e) => setTargetFps(Number(e.target.value))}>
              <option value={60}>60 (mulus)</option>
              <option value={30}>30 (hemat)</option>
              <option value={24}>24</option>
              <option value={15}>15 (paling ringan)</option>
            </select>
          </div>

          <Toggle label="Turunkan kualitas otomatis saat ngelag" checked={autoQuality} onChange={setAutoQuality} />
          <Toggle label="Jalankan efek" checked={effects} onChange={setEffects} />
          <Toggle label="Mode debug rendering (border layer)" checked={debug} onChange={setDebug} />
          <Toggle label="Tampilkan safe area" checked={safeArea} onChange={setSafeArea} />

          <div className="rounded-xl border border-[var(--line)] bg-[#0e0e11] p-3">
            <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold">
              <IconInfo size={12} /> Pintasan papan tik
            </p>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] text-[var(--muted)]">
              <dt>Spasi</dt>
              <dd>putar / jeda</dd>
              <dt>← / →</dt>
              <dd>mundur / maju 1 frame</dd>
              <dt>Home / End</dt>
              <dd>ke awal / akhir</dd>
              <dt>+ / −</dt>
              <dd>zoom timeline</dd>
              <dt>L</dt>
              <dd>loop</dd>
              <dt>R</dt>
              <dd>reset posisi</dd>
              <dt>M</dt>
              <dd>bisukan audio</dd>
              <dt>B</dt>
              <dd>pasang penanda</dd>
            </dl>
          </div>

          <button type="button" className="btn btn-primary w-full" onClick={onClose}>
            Selesai
          </button>
        </div>
      </div>
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3">
      <span className="text-xs text-[#c3c8d4]">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? 'bg-[var(--accent)]' : 'bg-[#2a2a30]'}`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`}
        />
      </button>
    </label>
  );
}

/* ───────────────────────── Ekspor ───────────────────────── */

function ExportModal({
  scene,
  media,
  onClose,
  onDone,
}: {
  scene: Scene;
  media: MediaItem[];
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [resIdx, setResIdx] = useState(3);
  const [fps, setFps] = useState(scene.fps > 60 ? 60 : scene.fps);
  const [bitrate, setBitrate] = useState(8);
  const [startMs, setStartMs] = useState(0);
  const [endMs, setEndMs] = useState(scene.duration);
  const [phase, setPhase] = useState<'idle' | 'rendering' | 'done' | 'error'>('idle');
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState('');
  const [result, setResult] = useState<{ url: string; blobUrl: string; bytes: number; mime: string } | null>(null);
  const cancelRef = useRef(false);

  const res = RESOLUTIONS[resIdx];
  const outW = res.w;
  const outH = Math.round((res.w * scene.height) / scene.width);

  const start = useCallback(async () => {
    if (endMs <= startMs) {
      setErr('Waktu selesai harus lebih besar dari waktu mulai.');
      return;
    }
    if (typeof MediaRecorder === 'undefined') {
      setErr('Browser ini tidak mendukung perekaman video (MediaRecorder). Coba Chrome, Edge, Firefox, atau Safari terbaru.');
      return;
    }
    setErr('');
    setPhase('rendering');
    setProgress(0);
    cancelRef.current = false;

    const even = (n: number) => Math.max(2, Math.round(n / 2) * 2); // encoder H.264 butuh ukuran genap
    const canvas = document.createElement('canvas');
    canvas.width = even(outW);
    canvas.height = even(outH);

    // Renderer: WebGL2 bila ada (efek penuh), kalau tidak canvas 2D (tanpa efek shader).
    let gl: GlRenderer | null = null;
    let ctx2d: CanvasRenderingContext2D | null = null;
    if (GlRenderer.isSupported()) {
      try {
        gl = new GlRenderer(canvas);
      } catch {
        gl = null;
      }
    }
    if (!gl) {
      ctx2d = canvas.getContext('2d');
      if (!ctx2d) {
        setErr('Browser ini tidak bisa membuat kanvas render.');
        setPhase('error');
        return;
      }
    }

    // Muat media ke memori
    const map: MediaMap = {};
    const vmap = new Map<string, HTMLVideoElement>();
    for (const m of media) {
      if (m.kind === 'image') {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = m.url;
        await new Promise<void>((r) => {
          img.onload = () => r();
          img.onerror = () => r();
        });
        map[String(m.id)] = { el: img, kind: 'image' };
        map[m.name] = { el: img, kind: 'image' };
      } else if (m.kind === 'video') {
        const v = document.createElement('video');
        v.src = m.url;
        v.crossOrigin = 'anonymous';
        v.muted = true;
        v.playsInline = true;
        v.setAttribute('playsinline', '');
        v.preload = 'auto';
        await new Promise<void>((r) => {
          v.onloadeddata = () => r();
          v.onerror = () => r();
          setTimeout(r, 4000);
        });
        map[String(m.id)] = { el: v, kind: 'video' };
        map[m.name] = { el: v, kind: 'video' };
        vmap.set(String(m.id), v);
        vmap.set(m.name, v);
      }
    }

    // Audio: preset + track tambahan, dicampur lewat Web Audio.
    const audio = await prepareExportAudio(collectAudioSources(scene, media), startMs, endMs);

    const stream = canvas.captureStream(fps);
    if (audio.track) stream.addTrack(audio.track);

    // Urutan format: MP4 dulu (Safari, Chrome 130+; bisa diunggah ke TikTok/IG), lalu WebM.
    // MP4 hanya dipakai bila codec H.264 disebut eksplisit: `video/mp4` polos membuat Chrome
    // memasukkan VP9/Opus ke wadah MP4 yang tidak bisa dibuka banyak aplikasi.
    const mimeCandidates = audio.track
      ? [
          'video/mp4;codecs=avc1.640028,mp4a.40.2',
          'video/mp4;codecs=avc1.4d0028,mp4a.40.2',
          'video/mp4;codecs=avc1,mp4a.40.2',
          'video/webm;codecs=vp9,opus',
          'video/webm;codecs=vp8,opus',
          'video/webm',
        ]
      : [
          'video/mp4;codecs=avc1.640028',
          'video/mp4;codecs=avc1.4d0028',
          'video/mp4;codecs=avc1',
          'video/webm;codecs=vp9',
          'video/webm;codecs=vp8',
          'video/webm',
        ];
    let rec: MediaRecorder | null = null;
    let mime = '';
    for (const cand of mimeCandidates) {
      if (!MediaRecorder.isTypeSupported(cand)) continue;
      try {
        rec = new MediaRecorder(stream, { mimeType: cand, videoBitsPerSecond: bitrate * 1_000_000 });
        mime = cand.split(';')[0];
        break;
      } catch {
        rec = null;
      }
    }
    if (!rec) {
      audio.stop();
      setErr('Tidak ada format video yang didukung browser ini.');
      setPhase('error');
      return;
    }

    const chunks: BlobPart[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    const recorder = rec;
    const done = new Promise<Blob>((resolve) => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: mime }));
    });

    // Posisikan video ke titik mulai sebelum merekam.
    syncVideos(scene, vmap, startMs, false);
    for (const v of vmap.values()) await waitSeeked(v);

    const draw = (t: number) => {
      syncVideos(scene, vmap, t, true);
      if (gl) gl.render(scene, { timeMs: t, media: map, motionSamples: 7 });
      else if (ctx2d) drawFrame(ctx2d, scene, { timeMs: t, media: map }, canvas.width, canvas.height);
    };
    draw(startMs);

    recorder.start(200);
    audio.start();
    const span = endMs - startMs;
    const t0 = performance.now();

    await new Promise<void>((resolve) => {
      const step = () => {
        if (cancelRef.current) {
          resolve();
          return;
        }
        const elapsed = performance.now() - t0;
        const t = startMs + Math.min(span, elapsed);
        draw(t);
        setProgress(Math.min(1, (t - startMs) / span));
        if (t - startMs >= span) {
          resolve();
          return;
        }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });

    recorder.stop();
    audio.stop();
    stream.getTracks().forEach((tr) => tr.stop());
    for (const v of vmap.values()) v.pause();
    const blob = await done;
    gl?.dispose();

    if (cancelRef.current) {
      setPhase('idle');
      setProgress(0);
      return;
    }
    if (!blob.size) {
      setErr('Render menghasilkan file kosong. Coba turunkan resolusi.');
      setPhase('error');
      return;
    }

    const blobUrl = URL.createObjectURL(blob);
    setResult({ url: blobUrl, blobUrl, bytes: blob.size, mime });
    setPhase('done');
    const notes: string[] = [];
    if (audio.failed.length) notes.push(`Audio gagal dimuat: ${audio.failed.join(', ')}.`);
    if (!gl) notes.push('Efek shader tidak ikut dirender (browser tanpa WebGL2).');
    onDone(notes.length ? `Ekspor selesai. ${notes.join(' ')}` : 'Ekspor selesai. Simpan videonya ke perangkat.');
  }, [endMs, startMs, outW, outH, media, scene, fps, bitrate, onDone]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 backdrop-blur-sm sm:items-center sm:p-5" role="dialog" aria-modal="true">
      <div className="card max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-b-none p-4 sm:rounded-2xl">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">Ekspor & bagikan</h2>
            <p className="text-[10px] text-[var(--muted)]">Render nyata dari canvas scene</p>
          </div>
          <button type="button" className="btn btn-sm btn-icon" onClick={onClose} aria-label="Tutup">
            <IconX size={14} />
          </button>
        </div>

        {phase === 'idle' || phase === 'error' ? (
          <div className="space-y-3">
            <div>
              <label className="label" htmlFor="res">
                Resolusi
              </label>
              <select id="res" className="input" value={resIdx} onChange={(e) => setResIdx(Number(e.target.value))}>
                {RESOLUTIONS.map((r, i) => (
                  <option key={r.label} value={i}>
                    {r.label}
                  </option>
                ))}
              </select>
              <p className="hint">
                Output {outW}×{outH} · {((outW * outH) / 1_000_000).toFixed(2)} MP
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label" htmlFor="efps">
                  FPS
                </label>
                <select id="efps" className="input" value={fps} onChange={(e) => setFps(Number(e.target.value))}>
                  {[24, 30, 60].map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="br">
                  Bitrate (Mbps)
                </label>
                <input
                  id="br"
                  type="number"
                  min={1}
                  max={40}
                  className="input"
                  value={bitrate}
                  onChange={(e) => setBitrate(Math.max(1, Math.min(40, Number(e.target.value) || 1)))}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label" htmlFor="st">
                  Mulai (detik)
                </label>
                <input
                  id="st"
                  type="number"
                  min={0}
                  max={scene.duration / 1000}
                  step={0.1}
                  className="input"
                  value={(startMs / 1000).toFixed(1)}
                  onChange={(e) => setStartMs(Math.max(0, Math.min(scene.duration, Number(e.target.value) * 1000)))}
                />
              </div>
              <div>
                <label className="label" htmlFor="en">
                  Selesai (detik)
                </label>
                <input
                  id="en"
                  type="number"
                  min={0}
                  max={scene.duration / 1000}
                  step={0.1}
                  className="input"
                  value={(endMs / 1000).toFixed(1)}
                  onChange={(e) => setEndMs(Math.max(0, Math.min(scene.duration, Number(e.target.value) * 1000)))}
                />
              </div>
            </div>

            {err && (
              <p className="err" role="alert">
                <IconAlert size={13} className="mt-0.5 shrink-0" /> {err}
              </p>
            )}

            <button type="button" className="btn btn-accent w-full" onClick={start}>
              <IconDownload size={14} /> Mulai ekspor
            </button>
            <p className="hint">
              Durasi render ≈ {((endMs - startMs) / 1000).toFixed(1)} detik. Jangan tutup tab selama proses
              berjalan.
            </p>
          </div>
        ) : phase === 'rendering' ? (
          <div className="py-6 text-center">
            <div className="mx-auto mb-4 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-[#1c1c22]">
              <div
                className="h-full rounded-full bg-[var(--accent)] transition-all"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
            <p className="text-sm font-semibold">
              {phase === 'rendering' ? 'Sedang merender…' : 'Mengunggah hasil…'}
            </p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {phase === 'rendering' ? `${Math.round(progress * 100)}%` : 'Menyimpan ke server'}
            </p>
            {phase === 'rendering' && (
              <button
                type="button"
                className="btn btn-sm mt-5"
                onClick={() => {
                  cancelRef.current = true;
                }}
              >
                Batal
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-xl border border-[rgba(53,208,127,0.3)] bg-[rgba(53,208,127,0.08)] px-3 py-2.5">
              <IconCheck size={15} className="text-[var(--ok)]" />
              <span className="text-xs font-medium text-[#9be8bf]">Video berhasil dirender</span>
            </div>
            {result && (
              <>
                <video src={result.blobUrl} controls className="w-full rounded-xl border border-[var(--line)]" />
                <p className="text-[11px] text-[var(--muted)]">
                  {fmtBytes(result.bytes)} · {result.mime}
                </p>
                {err && <p className="err">{err}</p>}
                <div className="grid grid-cols-2 gap-2">
                  <a href={result.blobUrl} download={`xmotion-${Date.now()}.${result.mime.includes('mp4') ? 'mp4' : 'webm'}`} className="btn btn-primary">
                    <IconDownload size={14} /> Simpan
                  </a>
                  <button
                    type="button"
                    className="btn"
                    onClick={async () => {
                      const file = await fetch(result.blobUrl).then((r) => r.blob());
                      const f = new File([file], `xmotion.${result.mime.includes('mp4') ? 'mp4' : 'webm'}`, { type: result.mime });
                      if (navigator.canShare?.({ files: [f] })) {
                        await navigator.share({ files: [f], title: 'Xmotion export' }).catch(() => {});
                      } else {
                        onDone('Browser ini tidak mendukung Bagikan file. Pakai tombol Simpan.');
                      }
                    }}
                  >
                    <IconShare size={14} /> Bagikan
                  </button>
                </div>
              </>
            )}
            <button
              type="button"
              className="btn w-full"
              onClick={() => {
                setPhase('idle');
                setProgress(0);
                setResult(null);
              }}
            >
              Ekspor lagi
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
