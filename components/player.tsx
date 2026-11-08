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
import { autoBindMedia } from '@/lib/bind';
import { drawFrame, type MediaMap } from '@/lib/renderer';
import {
  fmtBytes,
  fmtTime,
  RESOLUTIONS,
  type AudioTrack,
  type ExportSettings,
  type Layer,
  type MediaItem,
  type Scene,
} from '@/lib/types';
import { SITE_NAME } from '@/lib/site';
import Stage from './stage';
import { LogoMark } from './icons';
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
  const [slotChooser, setSlotChooser] = useState<string | null>(null);
  const [audioTarget, setAudioTarget] = useState<Layer | null>(null);
  const seekRef = useRef<((ms: number) => void) | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const slotInputRef = useRef<HTMLInputElement>(null);
  const audioFileRef = useRef<HTMLInputElement>(null);
  const slotAudioInputRef = useRef<HTMLInputElement>(null);

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

          // Media dari paket share AM: masuk galeri lalu diikat otomatis ke slot-nya.
          if (pending.packageFiles?.length) {
            const items: MediaItem[] = [];
            for (const pf of pending.packageFiles) {
              try {
                items.push(await addMedia(pf.file, null));
              } catch {
                /* galeri penuh / file tunggal gagal — lanjut yang lain */
              }
            }
            if (items.length) {
              setMedia((prev) => [...items, ...prev]);
              const manifest = new Map(pending.manifest ?? []);
              const bound = autoBindMedia(pending.scene, items, manifest);
              setScene(bound.scene);
              notify(
                bound.missed.length
                  ? `${items.length} media preset dimuat & ${bound.matched} slot terpasang otomatis (${bound.missed.length} slot butuh media kamu).`
                  : `${items.length} media preset dimuat & semua slot terpasang otomatis.`,
              );
            }
          }

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

  /** Referensi asal media pada satu layer, dikembalikan juga basenamanya. */
  const refOf = useCallback((l: Layer): string | null => (l.raw.fillImage ?? l.raw.fillVideo ?? l.raw.fillAudio ?? l.raw.src ?? null), []);

  const isAmRef = (ref: string | null): boolean => Boolean(ref && (ref.startsWith('am:') || ref.startsWith('amproj:')));

  /** Nama yang mewakili sebuah ref: "amproj:a.png"→"a.png", "am:sha.mp4"→ nama deklarasi/basename. */
  const refNames = useCallback(
    (ref: string): string[] => {
      const out = new Set<string>([ref]);
      if (ref.startsWith('amproj:')) out.add(ref.slice(7));
      if (ref.startsWith('am:')) {
        const rest = ref.slice(3);
        out.add(rest);
        const decl = scene?.mediaDecls?.find((d) => d.uri === ref);
        if (decl) {
          out.add(decl.filename);
          out.add(decl.title);
        }
      }
      return [...out].filter(Boolean).map((v) => v.toLowerCase());
    },
    [scene],
  );

  /** Pasang media galeri ke slot (tanpa unggah ulang): semua layer dengan rujukan asal sama ikut. */
  const bindMediaToSlot = useCallback(
    (item: MediaItem, target: Layer) => {
      if (!scene) return;
      const original = refOf(target);
      const kindOk =
        (item.kind === 'video' && target.type === 'video') ||
        (item.kind === 'image' && target.type === 'image') ||
        (item.kind === 'audio' && target.type === 'audio');
      if (!kindOk) {
        notify(`Tipe media tidak cocok: slot ini butuh ${target.type === 'video' ? 'video' : target.type === 'audio' ? 'audio' : 'gambar'}.`);
        return;
      }
      const same = (l: Layer) => l.id === target.id || (original !== null && refOf(l) === original);
      const next: Scene = {
        ...scene,
        layers: scene.layers.map((l) => (same(l) ? { ...l, mediaRef: String(item.id) } : l)),
      };
      const count = next.layers.filter(same).length;
      setScene(next);
      notify(count > 1 ? `Media dipasang ke ${count} layer yang memakai media asal yang sama.` : `Media dipasang ke "${target.name}".`);
    },
    [scene, refOf, notify],
  );

  const uploadMedia = useCallback(
    async (file: File, target?: Layer | null) => {
      if (!/^(image|video|audio)\//.test(file.type)) {
        setUploadErr(`Tipe file "${file.type || 'tidak dikenal'}" tidak didukung. Pilih gambar, video, atau audio.`);
        return;
      }
      setUploading(true);
      setUploadErr('');
      try {
        // Media disimpan di browser (IndexedDB), tidak diunggah ke server.
        const item = await addMedia(file, projectId);
        setMedia((m) => [item, ...m]);

        if (target && scene) {
          // Pasang ke semua slot yang merujuk media asal yang sama (mis. 22 layer memakai 1 foto).
          bindMediaToSlot(item, target);
        } else if (scene) {
          // Auto-bind: isi slot yang merujuk media preset (am:/amproj:) — cocokkan dulu lewat
          // NAMA FILE (mis. upload "Elemen Baru 2 [60B2C69].png" langsung nempel), lalu kalau
          // hanya ada satu slot kosong tipe itu, pasang di sana.
          const wantType = item.kind === 'video' ? 'video' : item.kind === 'image' ? 'image' : item.kind === 'audio' ? 'audio' : null;
          const lowerName = item.name.toLowerCase();
          const nameGroups = new Map<string, Layer[]>();
          const typeGroups = new Map<string, Layer[]>();
          if (wantType) {
            for (const l of scene.layers) {
              const ref = l.raw.fillVideo ?? l.raw.fillImage ?? l.raw.fillAudio ?? null;
              if (!ref || !isAmRef(ref)) continue;
              if (l.type !== wantType) continue;
              if (l.mediaRef && !isAmRef(l.mediaRef)) continue; // sudah dipasangi media lain
              const arr = typeGroups.get(ref) ?? [];
              arr.push(l);
              typeGroups.set(ref, arr);
              if (refNames(ref).includes(lowerName)) {
                const g = nameGroups.get(ref) ?? [];
                g.push(l);
                nameGroups.set(ref, g);
              }
            }
          }
          const applyBind = (groups: Map<string, Layer[]>, count: number): boolean => {
            if (!count) return false;
            let next = scene;
            for (const [ref, list] of groups) {
              const ids = new Set(list.map((s) => s.id));
              next = { ...next, layers: next.layers.map((l) => (ids.has(l.id) ? { ...l, mediaRef: String(item.id) } : l)) };
            }
            setScene(next);
            return true;
          };

          let done = applyBind(nameGroups, [...nameGroups.values()].reduce((n, g) => n + g.length, 0));
          if (done) {
            notify(`"${item.name}" otomatis dipasang ke slot yang cocok namanya.`);
          }
          if (!done && typeGroups.size === 1) {
            const [ref, list] = [...typeGroups.entries()][0];
            const title = scene.mediaDecls?.find((d) => d.uri === ref)?.title ?? ref.replace(/^am(proj)?:/, '').slice(0, 20);
            const next: Scene = {
              ...scene,
              layers: scene.layers.map((l) => (list.some((s) => s.id === l.id) ? { ...l, mediaRef: String(item.id) } : l)),
            };
            setScene(next);
            notify(`Media otomatis dipasang ke ${list.length} layer slot "${title}".`);
            done = true;
          }
          if (!done && typeGroups.size > 1) {
            notify('Media masuk galeri. Ada beberapa slot preset — pasang lewat tombol Pilih di tab Media.');
          } else if (!done) {
            notify('Media ditambahkan ke galeri.');
          }
        } else {
          notify('Media ditambahkan ke galeri.');
        }
      } catch (err) {
        setUploadErr(err instanceof Error ? err.message : 'Gagal menambahkan media.');
      } finally {
        setUploading(false);
      }
    },
    [projectId, scene, notify, bindMediaToSlot],
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
          sc
            ? {
                ...sc,
                layers: sc.layers.map((l) => (l.mediaRef === String(id) ? { ...l, mediaRef: l.raw.fillImage ?? l.raw.fillVideo ?? l.raw.src ?? null } : l)),
                audioTracks: (sc.audioTracks ?? []).filter((tr) => tr.mediaId !== String(id)),
              }
            : sc,
        );
        notify('Media dihapus.');
      } catch (err) {
        notify(err instanceof Error ? err.message : 'Gagal menghapus media.');
      }
    },
    [notify],
  );

  /* ── Track audio tambahan (tab Audio) ── */
  const addAudioTrack = useCallback(
    (item: MediaItem, startMs = 0) => {
      setScene((sc) => {
        if (!sc) return sc;
        const track: AudioTrack = {
          id: `tr-${Date.now()}-${Math.round(Math.random() * 1e4)}`,
          mediaId: String(item.id),
          startMs,
          volume: 1,
          muted: false,
        };
        return { ...sc, audioTracks: [...(sc.audioTracks ?? []), track] };
      });
      notify(`Audio "${item.name}" ditambahkan ke scene.`);
    },
    [notify],
  );

  const uploadAudioTrack = useCallback(
    async (file: File) => {
      if (!/^audio\//.test(file.type)) {
        notify(`"${file.name}" bukan file audio (mp3/m4a/wav/ogg).`);
        return;
      }
      setUploading(true);
      try {
        const item = await addMedia(file, projectId);
        setMedia((m) => [item, ...m]);
        addAudioTrack(item, 0);
      } catch (err) {
        notify(err instanceof Error ? err.message : 'Gagal menambahkan audio.');
      } finally {
        setUploading(false);
      }
    },
    [projectId, addAudioTrack, notify],
  );

  const updateAudioTrack = useCallback((id: string, patch: Partial<AudioTrack>) => {
    setScene((sc) =>
      sc ? { ...sc, audioTracks: (sc.audioTracks ?? []).map((tr) => (tr.id === id ? { ...tr, ...patch } : tr)) } : sc,
    );
  }, []);

  const removeAudioTrack = useCallback((id: string) => {
    setScene((sc) => (sc ? { ...sc, audioTracks: (sc.audioTracks ?? []).filter((tr) => tr.id !== id) } : sc));
  }, []);

  const toggleLayer = useCallback(
    (id: string) => {
      setScene((s) =>
        s ? { ...s, layers: s.layers.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)) } : s,
      );
    },
    [],
  );

  const mediaSlots = useMemo(
    () => (scene ? scene.layers.filter((l) => l.type === 'image' || l.type === 'video') : []),
    [scene],
  );
  const audioLayers = useMemo(
    () => (scene ? scene.layers.filter((l) => l.type === 'audio') : []),
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
          <LogoMark size={34} />
          <span className="hidden sm:block">
            <span className="block text-xs font-black leading-tight tracking-tight">{SITE_NAME}</span>
            <span className="block text-[10px] leading-tight text-[var(--muted)]">Xmotion Rendering Engine</span>
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
                  accept="image/*,video/mp4,video/webm,video/*,audio/*,.mp4,.xml"
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
                  <p className="label">Slot media preset ({mediaSlots.length})</p>
                  {mediaSlots.length === 0 ? (
                    <p className="hint">Preset ini tidak punya slot gambar/video.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {mediaSlots.map((l) => {
                        const bound = l.mediaRef ? media.find((m) => String(m.id) === l.mediaRef) : null;
                        const original = l.raw.fillImage ?? l.raw.fillVideo ?? null;
                        const declTitle = original?.startsWith('am:') ? scene.mediaDecls?.find((d) => d.uri === original)?.title : null;
                        const chooserOpen = slotChooser === l.id;
                        const compatible = media.filter(
                          (m) => (l.type === 'video' && m.kind === 'video') || (l.type === 'image' && m.kind === 'image'),
                        );
                        return (
                          <div key={l.id} className="overflow-hidden rounded-lg border border-[var(--line)] bg-[#0e0e11]">
                            <div className="flex items-center gap-2 px-2.5 py-2">
                              <span className="grid h-7 w-7 shrink-0 place-items-center rounded bg-[#1a1a20] text-[var(--muted)]">
                                {l.type === 'video' ? <IconVideo size={13} /> : <IconImage size={13} />}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[11px] font-medium">{declTitle ?? l.name}</span>
                                <span className="block truncate text-[10px] text-[var(--muted)]">
                                  {bound ? bound.name : `belum ada ${l.type === 'video' ? 'video' : 'gambar'}`}
                                  {declTitle ? ` · slot preset: ${declTitle}` : ''}
                                </span>
                              </span>
                              <button
                                type="button"
                                className="btn btn-sm shrink-0"
                                aria-expanded={chooserOpen}
                                onClick={() => setSlotChooser(chooserOpen ? null : l.id)}
                              >
                                {bound ? 'Ganti' : 'Pilih'}
                                <IconChevronDown size={11} className={`transition-transform ${chooserOpen ? 'rotate-180' : ''}`} />
                              </button>
                            </div>
                            {chooserOpen && (
                              <div className="fade-in space-y-1.5 border-t border-[var(--line)] px-2.5 py-2">
                                <button
                                  type="button"
                                  className="btn btn-sm w-full"
                                  onClick={() => {
                                    setSlotTarget(l);
                                    slotInputRef.current?.click();
                                  }}
                                >
                                  <IconUpload size={12} /> Unggah {l.type === 'video' ? 'video baru (MP4 dll.)' : 'gambar baru'}
                                </button>
                                {compatible.length === 0 ? (
                                  <p className="hint">Belum ada {l.type === 'video' ? 'video' : 'gambar'} di galeri. Unggah dulu di atas.</p>
                                ) : (
                                  <div className="max-h-44 space-y-1 overflow-y-auto">
                                    {compatible.map((m) => (
                                      <button
                                        key={m.id}
                                        type="button"
                                        className={`flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition ${
                                          bound?.id === m.id ? 'border-[var(--accent)] bg-[rgba(31,200,238,0.08)]' : 'border-[var(--line)] hover:bg-white/5'
                                        }`}
                                        onClick={() => {
                                          bindMediaToSlot(m, l);
                                          setSlotChooser(null);
                                        }}
                                      >
                                        {m.kind === 'image' ? (
                                          <img src={m.url} alt="" className="h-8 w-8 shrink-0 rounded object-cover" />
                                        ) : (
                                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded bg-[#1a1a20] text-[var(--muted)]">
                                            <IconVideo size={13} />
                                          </span>
                                        )}
                                        <span className="min-w-0 flex-1 truncate text-[11px]">{m.name}</span>
                                        <span className="shrink-0 text-[9px] text-[var(--muted)]">{fmtBytes(m.size)}</span>
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <input
                    ref={slotInputRef}
                    type="file"
                    className="sr-only"
                    accept="image/*,video/mp4,video/webm,video/*,.mp4"
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
                <input
                  ref={audioFileRef}
                  type="file"
                  className="sr-only"
                  accept="audio/*,.mp3,.m4a,.wav,.ogg"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void uploadAudioTrack(f);
                    e.target.value = '';
                  }}
                />
                <input
                  ref={slotAudioInputRef}
                  type="file"
                  className="sr-only"
                  accept="audio/*,.mp3,.m4a,.wav,.ogg"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f && audioTarget && scene) void uploadMedia(f, audioTarget);
                    e.target.value = '';
                    setAudioTarget(null);
                  }}
                />

                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold">Audio scene</p>
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={() => audioFileRef.current?.click()}
                    disabled={uploading}
                  >
                    {uploading ? <span className="spinner" /> : <IconPlus size={12} />} Tambah Audio
                  </button>
                </div>
                <p className="hint -mt-1">
                  Tambahkan lagu/suara (MP3, M4A, WAV) langsung dari perangkat. Audio ikut diputar di preview dan
                  dirender saat ekspor.
                </p>

                {(scene.audioTracks ?? []).length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[#2a2a30] px-3 py-6 text-center">
                    <IconAudio size={20} className="mx-auto mb-2 text-[#3f3f48]" />
                    <p className="text-[11px] text-[var(--muted)]">
                      Belum ada track audio. Tekan “Tambah Audio” buat masang lagu.
                    </p>
                  </div>
                ) : (
                  (scene.audioTracks ?? []).map((tr) => {
                    const item = media.find((m) => String(m.id) === tr.mediaId);
                    return (
                      <div key={tr.id} className="rounded-xl border border-[var(--line)] bg-[#0e0e11] p-3">
                        <div className="flex items-center gap-2">
                          <IconAudio size={14} className="shrink-0 text-[var(--accent)]" />
                          <span className="min-w-0 flex-1 truncate text-xs font-medium">{item?.name ?? '(media hilang)'}</span>
                          <button
                            type="button"
                            className={`btn btn-sm btn-icon ${tr.muted ? 'opacity-50' : 'text-[var(--accent)]'}`}
                            aria-label={tr.muted ? 'Bunyikan track' : 'Bisukan track'}
                            onClick={() => updateAudioTrack(tr.id, { muted: !tr.muted })}
                          >
                            <IconAudio size={12} />
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-icon text-[var(--err)]"
                            aria-label="Hapus track"
                            onClick={() => removeAudioTrack(tr.id)}
                          >
                            <IconTrash size={12} />
                          </button>
                        </div>
                        <div className="mt-2 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5">
                          <span className="text-[10px] uppercase tracking-wider text-[var(--muted)]">Mulai</span>
                          <input
                            type="number"
                            className="input h-8 py-1 text-xs"
                            min={0}
                            max={Math.max(0, scene.duration / 1000)}
                            step={0.1}
                            value={(tr.startMs / 1000).toFixed(1)}
                            onChange={(e) =>
                              updateAudioTrack(tr.id, {
                                startMs: Math.max(0, Math.min(scene.duration, Number(e.target.value) * 1000 || 0)),
                              })
                            }
                            aria-label="Waktu mulai audio (detik)"
                          />
                          <span className="text-[10px] uppercase tracking-wider text-[var(--muted)]">Volume</span>
                          <input
                            type="range"
                            min={0}
                            max={100}
                            value={Math.round(tr.volume * 100)}
                            onChange={(e) => updateAudioTrack(tr.id, { volume: Number(e.target.value) / 100 })}
                            aria-label="Volume audio"
                          />
                        </div>
                        <p className="mt-1 text-[10px] text-[var(--muted)]">
                          {item ? `${fmtBytes(item.size)} · diputar mulai ${(tr.startMs / 1000).toFixed(1)}s` : 'Pilih ulang audio di galeri.'}
                        </p>
                      </div>
                    );
                  })
                )}

                {audioLayers.length > 0 && (
                  <div>
                    <p className="label">Track audio bawaan preset ({audioLayers.length})</p>
                    <div className="space-y-1.5">
                      {audioLayers.map((l) => {
                        const bound = l.mediaRef ? media.find((m) => String(m.id) === l.mediaRef) : null;
                        return (
                          <div key={l.id} className="rounded-xl border border-[var(--line)] bg-[#0e0e11] p-3">
                            <div className="flex items-center gap-2">
                              <IconAudio size={14} className="shrink-0 text-[var(--warn)]" />
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
                                setAudioTarget(l);
                                slotAudioInputRef.current?.click();
                              }}
                            >
                              <IconUpload size={12} /> {bound ? 'Ganti audio' : 'Unggah audio'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div>
                  <p className="label">Audio di galeri</p>
                  {media.filter((m) => m.kind === 'audio').length === 0 ? (
                    <p className="hint">Belum ada audio di galeri.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {media
                        .filter((m) => m.kind === 'audio')
                        .map((m) => {
                          const used = (scene.audioTracks ?? []).some((tr) => tr.mediaId === String(m.id));
                          return (
                            <div key={m.id} className="flex items-center gap-2 rounded-lg border border-[var(--line)] px-2.5 py-2">
                              <IconAudio size={13} className="shrink-0 text-[var(--muted)]" />
                              <span className="min-w-0 flex-1 truncate text-[11px]">{m.name}</span>
                              <span className="shrink-0 text-[10px] text-[var(--muted)]">{fmtBytes(m.size)}</span>
                              <button
                                type="button"
                                className="btn btn-sm shrink-0"
                                onClick={() => addAudioTrack(m, 0)}
                                disabled={used}
                              >
                                {used ? 'Terpasang' : '+ Track'}
                              </button>
                            </div>
                          );
                        })}
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
  const mp4Supported = typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/mp4');
  const [format, setFormat] = useState<'mp4' | 'webm'>(mp4Supported ? 'mp4' : 'webm');
  const [resIdx, setResIdx] = useState(3);
  const [fps, setFps] = useState(scene.fps > 60 ? 60 : scene.fps);
  const [bitrate, setBitrate] = useState(8);
  const [startMs, setStartMs] = useState(0);
  const [endMs, setEndMs] = useState(scene.duration);
  const hasAudioSource =
    (scene.audioTracks ?? []).length > 0 ||
    scene.layers.some((l) => l.type === 'audio' && l.mediaRef && media.some((m) => String(m.id) === l.mediaRef));
  const [includeAudio, setIncludeAudio] = useState(hasAudioSource);
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
      setErr('Browser ini tidak mendukung MediaRecorder. Coba Chrome/Edge terbaru.');
      return;
    }
    setErr('');
    setPhase('rendering');
    setProgress(0);
    cancelRef.current = false;

    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setErr('Canvas 2D tidak tersedia.');
      setPhase('error');
      return;
    }

    // Muat media ke memori untuk render offline
    const map: MediaMap = {};
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
        await new Promise<void>((r) => {
          v.onloadeddata = () => r();
          v.onerror = () => r();
          setTimeout(r, 3000);
        });
        map[String(m.id)] = { el: v, kind: 'video' };
        map[m.name] = { el: v, kind: 'video' };
      }
    }

    // ── Audio: track tambahan + track audio bawaan preset ──
    const trackDefs: { mediaId: string; startMs: number; volume: number; muted: boolean }[] = [];
    for (const tr of scene.audioTracks ?? []) {
      trackDefs.push({ mediaId: tr.mediaId, startMs: tr.startMs, volume: tr.volume, muted: tr.muted });
    }
    for (const l of scene.layers) {
      if (l.type !== 'audio' || !l.mediaRef) continue;
      trackDefs.push({ mediaId: l.mediaRef, startMs: l.start, volume: 1, muted: false });
    }

    type Voice = { el: HTMLAudioElement; def: { mediaId: string; startMs: number; volume: number; muted: boolean } };
    let audioCtx: AudioContext | null = null;
    let audioDest: MediaStreamAudioDestinationNode | null = null;
    const voices: Voice[] = [];
    if (includeAudio && trackDefs.length) {
      try {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AC) {
          audioCtx = new AC();
          audioDest = audioCtx.createMediaStreamDestination();
          for (const def of trackDefs) {
            const item = media.find((m) => String(m.id) === def.mediaId);
            if (!item) continue;
            const el = document.createElement('audio');
            el.src = item.url;
            el.preload = 'auto';
            el.crossOrigin = 'anonymous';
            const srcNode = audioCtx.createMediaElementSource(el);
            const gain = audioCtx.createGain();
            gain.gain.value = def.muted ? 0 : Math.min(1, Math.max(0, def.volume));
            srcNode.connect(gain);
            gain.connect(audioDest);
            voices.push({ el, def });
          }
          await audioCtx.resume().catch(() => {});
        }
      } catch {
        audioCtx = null;
        audioDest = null;
      }
    }

    const withAudio = Boolean(audioDest && voices.length);
    const mimeCandidates =
      format === 'mp4'
        ? [
            'video/mp4;codecs=avc1.640028,mp4a.40.2',
            'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
            'video/mp4;codecs=avc1',
            'video/mp4;codecs=vp09.00.10.08,mp4a.40.2',
            'video/mp4',
          ]
        : ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9', 'video/webm'];
    let mime = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
    if (!mime) {
      // fallback lintas format bila pilihan utama tak didukung
      mime = ['video/webm;codecs=vp9,opus', 'video/webm', 'video/mp4'].find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
    }
    if (!mime) {
      setErr('Tidak ada format video yang didukung browser ini.');
      setPhase('error');
      return;
    }

    const canvasStream = canvas.captureStream(fps);
    const mixed = new MediaStream([...canvasStream.getVideoTracks(), ...(withAudio && audioDest ? audioDest.stream.getAudioTracks() : [])]);
    const chunks: BlobPart[] = [];
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(mixed, { mimeType: mime, videoBitsPerSecond: bitrate * 1_000_000 });
    } catch {
      setErr('Gagal memulai encoder video.');
      setPhase('error');
      return;
    }
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };

    const done = new Promise<Blob>((resolve) => {
      rec.onstop = () => resolve(new Blob(chunks, { type: mime }));
    });

    rec.start(200);
    const span = endMs - startMs;
    const t0 = performance.now();

    const syncExportAudio = (t: number) => {
      if (!withAudio) return;
      for (const v of voices) {
        const want = (t - v.def.startMs) / 1000;
        const dur = Number.isFinite(v.el.duration) && v.el.duration > 0 ? v.el.duration * 1000 : Number.POSITIVE_INFINITY;
        const inWindow = t >= v.def.startMs && t < v.def.startMs + dur && want >= 0;
        if (inWindow) {
          if (v.el.paused) {
            try {
              v.el.currentTime = want;
            } catch {
              /* belum siap */
            }
            void v.el.play().catch(() => {});
          } else if (Math.abs(v.el.currentTime - want) > 0.3) {
            try {
              v.el.currentTime = want;
            } catch {
              /* belum siap */
            }
          }
        } else if (!v.el.paused) {
          v.el.pause();
        }
      }
    };

    await new Promise<void>((resolve) => {
      const step = () => {
        if (cancelRef.current) {
          resolve();
          return;
        }
        const elapsed = performance.now() - t0;
        const t = startMs + Math.min(span, elapsed);
        drawFrame(ctx, scene, { timeMs: t, media: map }, outW, outH);
        syncExportAudio(t);
        setProgress(Math.min(1, (t - startMs) / span));
        if (t - startMs >= span) {
          resolve();
          return;
        }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });

    rec.stop();
    canvasStream.getTracks().forEach((tr) => tr.stop());
    voices.forEach((v) => {
      v.el.pause();
      v.el.src = '';
    });
    if (audioCtx) await audioCtx.close().catch(() => {});
    const blob = await done;

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
    onDone('Ekspor selesai. Simpan videonya ke perangkat.');
  }, [endMs, startMs, outW, outH, media, scene, fps, bitrate, format, includeAudio, onDone]);

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
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label" htmlFor="fmt">
                  Format
                </label>
                <select id="fmt" className="input" value={format} onChange={(e) => setFormat(e.target.value as 'mp4' | 'webm')}>
                  <option value="mp4">MP4 {mp4Supported ? '' : '(tak didukung)'}</option>
                  <option value="webm">WebM</option>
                </select>
              </div>
              <div>
                <label className="label" htmlFor="efps2">
                  FPS
                </label>
                <select id="efps2" className="input" value={fps} onChange={(e) => setFps(Number(e.target.value))}>
                  {[24, 30, 60].map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {hasAudioSource && (
              <Toggle label="Sertakan audio (track + lagu)" checked={includeAudio} onChange={setIncludeAudio} />
            )}

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

            <div className="grid grid-cols-1 gap-2">
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
