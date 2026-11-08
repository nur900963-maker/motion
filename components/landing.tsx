'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError, isWellFormedXml, readFileAsText } from '@/lib/client';
import { parseAmXml, XmlError } from '@/lib/am-xml';
import { setPending } from '@/lib/local-db';
import { AUTHOR, ENGINE_NAME, FOOTER_TEXT, HERO_NAME, OWNER_NAME, SITE_NAME, TAGLINE } from '@/lib/site';
import type { PackageFile, Scene } from '@/lib/types';
import ContactMenu from './contact-menu';
import { LogoMark } from './icons';
import { IconAlert, IconChevron, IconCloud, IconFileUp, IconLink, IconUpload } from './icons';

const MAX_XML_BYTES = 12 * 1024 * 1024;
const CHUNK = 3 * 1024 * 1024;

type Kind = 'xml' | 'am' | 'drive';

type ImportResult = {
  text: string;
  name: string;
  sourceUrl: string;
  share?: { user: string; package: string };
  media?: { filename: string; size: number; mime: string; sha1?: string }[];
  zipSize?: number;
};

const STAGES = [
  'Menyiapkan preset…',
  'Mengambil data preset…',
  'Memvalidasi struktur XML…',
  'Membangun scene & layer…',
  'Membuka player…',
];

/** Parse di browser (tanpa batas body server). File ke-2 (grup/cc) digabung ke scene utama. */
function buildScene(files: { name: string; text: string }[], source: Scene['source']): Scene {
  let scene: Scene;
  try {
    scene = parseAmXml(files[0].text, source);
  } catch (err) {
    if (err instanceof XmlError) throw new Error(`${files[0].name}: ${err.message}`);
    throw err;
  }
  if (files[1]) {
    try {
      const extra = parseAmXml(files[1].text, source);
      scene.layers = [...scene.layers, ...extra.layers];
      scene.mediaRefs = Array.from(new Set([...scene.mediaRefs, ...extra.mediaRefs]));
      scene.effectCount += extra.effectCount;
      scene.warnings.push(`File grup "${files[1].name}" digabung (${extra.layers.length} layer).`);
    } catch (err) {
      scene.warnings.push(`File kedua "${files[1].name}" tidak bisa digabung: ${(err as Error).message}`);
    }
  }
  return scene;
}

export default function Landing() {
  const router = useRouter();
  const [open, setOpen] = useState<Kind | null>('xml');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState(STAGES[0]);
  const [detail, setDetail] = useState('');
  const [errors, setErrors] = useState<Record<Kind, string>>({ xml: '', am: '', drive: '' });
  const [amUrl, setAmUrl] = useState('');
  const [driveUrl, setDriveUrl] = useState('');
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const setErr = (kind: Kind, msg: string) => setErrors((e) => ({ ...e, [kind]: msg }));

  const goPlayer = useCallback(
    (scene: Scene, xmlText?: string, sourceUrl?: string, packageFiles?: PackageFile[], manifest?: [string, string][]) => {
      setPending({ scene, xmlText: xmlText ?? null, sourceUrl: sourceUrl ?? null, packageFiles, manifest });
      router.push('/player?from=import');
    },
    [router],
  );

  const run = useCallback(
    async (kind: Kind, task: (signal: AbortSignal) => Promise<void>) => {
      if (busy) return;
      setBusy(true);
      setNotice('');
      setErrors({ xml: '', am: '', drive: '' });
      const controller = new AbortController();
      abortRef.current = controller;
      setStage(STAGES[0]);
      setDetail('');
      try {
        await task(controller.signal);
      } catch (err) {
        if (controller.signal.aborted) {
          setNotice('Impor dibatalkan.');
        } else {
          const msg = err instanceof ApiError || err instanceof Error ? err.message : 'Terjadi kesalahan.';
          setErr(kind, msg);
        }
        setBusy(false);
      }
    },
    [busy],
  );

  const importFiles = useCallback(
    (list: FileList | File[]) =>
      run('xml', async (signal) => {
        const files = [...list];
        if (!files.length) throw new Error('Belum ada file yang dipilih.');
        if (files.length > 2) throw new Error('Maksimal 2 file: satu preset dan satu grup/cc.');
        const payload: { name: string; text: string }[] = [];
        for (const f of files) {
          if (!/\.xml$/i.test(f.name) && !/xml/i.test(f.type)) {
            throw new Error(`${f.name} bukan file XML. Pilih file preset berformat .xml.`);
          }
          if (f.size === 0) throw new Error(`${f.name} kosong.`);
          if (f.size > MAX_XML_BYTES) {
            throw new Error(`${f.name} terlalu besar (${(f.size / 1048576).toFixed(1)} MB). Maksimal 12 MB.`);
          }
          setStage(STAGES[1]);
          setDetail(f.name);
          const text = await readFileAsText(f);
          if (!isWellFormedXml(text)) throw new Error(`${f.name}: XML tidak valid atau file terpotong.`);
          payload.push({ name: f.name, text });
        }
        if (signal.aborted) return;
        setStage(STAGES[2]);
        await new Promise((r) => setTimeout(r, 60)); // beri browser kesempatan menampilkan status
        const scene = buildScene(payload, 'xml');
        setStage(STAGES[3]);
        setDetail(`${scene.layers.length} layer · ${scene.width}×${scene.height}`);
        await new Promise((r) => setTimeout(r, 220));
        setStage(STAGES[4]);
        goPlayer(scene, payload[0].text);
      }),
    [goPlayer, run],
  );

  /** Unduh satu file media dari paket share (per-bagian supaya aman dari batas respons server). */
  const fetchPackageFile = useCallback(
    async (share: { user: string; package: string }, media: { filename: string; size: number; mime: string }, signal: AbortSignal): Promise<File> => {
      const parts: Blob[] = [];
      for (let start = 0; start < media.size; start += CHUNK) {
        const end = Math.min(media.size, start + CHUNK);
        const res = await fetch('/api/presets/asset', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ user: share.user, package: share.package, filename: media.filename, start, end }),
          signal,
        });
        if (!res.ok) {
          let msg = `Gagal mengunduh ${media.filename}.`;
          try {
            const j = (await res.json()) as { error?: string };
            if (j.error) msg = j.error;
          } catch {
            /* bukan JSON */
          }
          throw new Error(msg);
        }
        parts.push(await res.blob());
      }
      return new File(parts, media.filename, { type: media.mime });
    },
    [],
  );

  const importLink = useCallback(
    (kind: 'am' | 'drive') =>
      run(kind, async (signal) => {
        const url = kind === 'am' ? amUrl : driveUrl;
        if (!url.trim()) throw new Error(kind === 'am' ? 'Tempel link share Alight Motion terlebih dahulu.' : 'Tempel link file XML Google Drive terlebih dahulu.');
        setStage(STAGES[1]);
        setDetail(kind === 'am' ? 'Link Alight Motion' : 'drive.google.com');
        const res = await api<ImportResult>('/api/presets/import', {
          method: 'POST',
          body: JSON.stringify({ kind, url }),
          signal,
        });

        // Link share AM: media asli preset ikut diunduh dari paket (tanpa upload manual).
        let packageFiles: PackageFile[] | undefined;
        let manifest: [string, string][] | undefined;
        if (res.share && res.media?.length) {
          packageFiles = [];
          manifest = [];
          for (let i = 0; i < res.media.length; i += 1) {
            if (signal.aborted) return;
            const m = res.media[i];
            setStage(`Mengunduh media preset ${i + 1}/${res.media.length}…`);
            setDetail(m.filename);
            const file = await fetchPackageFile(res.share, m, signal);
            packageFiles.push({ file, sha1: m.sha1 });
            if (m.sha1) manifest.push([m.sha1, m.filename]);
          }
        }

        setStage(STAGES[2]);
        const scene = buildScene([{ name: res.name, text: res.text }], kind === 'drive' ? 'drive' : 'am');
        setStage(STAGES[3]);
        setDetail(`${scene.layers.length} layer · ${scene.width}×${scene.height}`);
        await new Promise((r) => setTimeout(r, 220));
        setStage(STAGES[4]);
        goPlayer(scene, res.text, res.sourceUrl, packageFiles, manifest);
      }),
    [amUrl, driveUrl, fetchPackageFile, goPlayer, run],
  );

  const openSample = useCallback(
    () =>
      run('xml', async (signal) => {
        setStage(STAGES[1]);
        setDetail('sample-preset.xml');
        const text = await fetch('/sample-preset.xml').then((r) => r.text());
        if (signal.aborted) return;
        setStage(STAGES[2]);
        const scene = buildScene([{ name: 'sample-preset.xml', text }], 'sample');
        setStage(STAGES[4]);
        goPlayer(scene, text);
      }),
    [goPlayer, run],
  );

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[720px] flex-col px-5 pb-16 pt-6 sm:pt-10">
      <div className="mb-7 flex items-center justify-between">
        <span className="chip">
          <LogoMark size={16} />
          {SITE_NAME}, Preset AM Player
        </span>
        <ContactMenu />
      </div>

      {/* HERO: logo AM di atas + nama besar VINCENT X ZYE */}
      <div className="mb-7 select-none text-center">
        <div className="mb-4 flex justify-center">
          <div className="relative">
            <div
              className="absolute inset-0 -z-10 blur-2xl"
              style={{ background: 'radial-gradient(closest-side, rgba(31,200,238,0.35), transparent)' }}
              aria-hidden="true"
            />
            <LogoMark size={92} className="drop-shadow-[0_0_24px_rgba(31,200,238,0.35)]" />
          </div>
        </div>
        <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.35em] text-[var(--accent)]">{ENGINE_NAME}</p>
        <h1 className="bg-gradient-to-r from-[#7b5cff] via-[var(--accent)] to-[var(--accent-2)] bg-clip-text text-[clamp(2.7rem,11.5vw,5rem)] font-black leading-[0.95] tracking-[-0.03em] text-transparent">
          {HERO_NAME}
        </h1>
        <div className="mx-auto mt-3 h-px w-24 bg-gradient-to-r from-transparent via-[var(--line-2)] to-transparent" />
      </div>

      <p className="mx-auto mb-3 max-w-[46ch] text-center text-[15px] leading-relaxed text-[#b9bfcc] sm:text-base">
        {TAGLINE || (
          <>
            Xmotion Rendering Engine. Impor <span className="font-semibold text-[var(--paper)]">preset</span> kamu di
            sini, lalu upload media kamu di sini dan tinggal ekspor secara instan!
          </>
        )}
      </p>
      {AUTHOR && (
        <p className="mb-8 text-center">
          <span className="chip border-[rgba(31,200,238,0.4)] text-[var(--accent)]">✦ {AUTHOR}</span>
        </p>
      )}

      {notice && (
        <p className="mb-4 rounded-xl border border-[var(--line-2)] bg-[#101013] px-3 py-2 text-xs text-[var(--muted)]">
          {notice}
        </p>
      )}

      <div className="flex flex-col gap-3" role="group" aria-label="Pilih sumber preset">
        {/* XML */}
        <section className="card overflow-hidden">
          <button
            type="button"
            className="flex w-full items-center gap-3.5 px-4 py-4 text-left"
            aria-expanded={open === 'xml'}
            aria-controls="pane-xml"
            onClick={() => setOpen(open === 'xml' ? null : 'xml')}
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#15151a] text-[var(--accent)]">
              <IconFileUp size={19} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">Upload Preset XML dari Perangkat</span>
              <span className="mt-0.5 block text-xs text-[var(--muted)]">File .xml, maksimal 12 MB per file</span>
            </span>
            <IconChevron
              size={16}
              className={`shrink-0 text-[var(--muted)] transition-transform ${open === 'xml' ? 'rotate-90' : ''}`}
            />
          </button>
          {open === 'xml' && (
            <div id="pane-xml" className="fade-in border-t border-[var(--line)] px-4 pb-4 pt-4">
              <label
                htmlFor="lp-file"
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  if (e.dataTransfer.files?.length) void importFiles(e.dataTransfer.files);
                }}
                className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center transition ${
                  dragging ? 'border-[var(--accent)] bg-[rgba(31,200,238,0.06)]' : 'border-[#2f2f36] hover:border-[#45454f]'
                }`}
              >
                <IconUpload size={22} className="text-[var(--muted)]" />
                <span className="text-sm font-medium">Pilih file XML</span>
                <span className="max-w-[34ch] text-xs leading-relaxed text-[var(--muted)]">
                  atau seret file ke sini. Boleh 2 file sekaligus (preset dan grup).
                </span>
                <input
                  ref={fileRef}
                  type="file"
                  id="lp-file"
                  className="sr-only"
                  accept=".xml,text/xml,application/xml"
                  multiple
                  onChange={(e) => {
                    if (e.target.files?.length) void importFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
              </label>
              {errors.xml && (
                <p className="err" role="alert">
                  <IconAlert size={14} className="mt-0.5 shrink-0" />
                  <span>{errors.xml}</span>
                </p>
              )}
              <button type="button" className="btn btn-sm btn-ghost mt-3 px-0" onClick={openSample} disabled={busy}>
                Coba preset contoh bawaan →
              </button>
            </div>
          )}
        </section>

        {/* AM */}
        <section className="card overflow-hidden">
          <button
            type="button"
            className="flex w-full items-center gap-3.5 px-4 py-4 text-left"
            aria-expanded={open === 'am'}
            aria-controls="pane-am"
            onClick={() => setOpen(open === 'am' ? null : 'am')}
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#15151a] text-[var(--accent)]">
              <IconLink size={19} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">Import Preset Alight Motion</span>
              <span className="mt-0.5 block text-xs text-[var(--muted)]">Tempel link share Alight Motion</span>
            </span>
            <IconChevron
              size={16}
              className={`shrink-0 text-[var(--muted)] transition-transform ${open === 'am' ? 'rotate-90' : ''}`}
            />
          </button>
          {open === 'am' && (
            <div id="pane-am" className="fade-in border-t border-[var(--line)] px-4 pb-4 pt-4">
              <div className="flex gap-2">
                <input
                  type="url"
                  className="input"
                  placeholder="https://alightcreative.com/am/share/u/.../p/... atau https://alight.link/..."
                  inputMode="url"
                  autoCapitalize="off"
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="Link share Alight Motion"
                  value={amUrl}
                  onChange={(e) => setAmUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void importLink('am');
                  }}
                />
                <button type="button" className="btn btn-primary shrink-0" onClick={() => importLink('am')} disabled={busy}>
                  Ambil
                </button>
              </div>
              {errors.am && (
                <p className="err" role="alert">
                  <IconAlert size={14} className="mt-0.5 shrink-0" />
                  <span>{errors.am}</span>
                </p>
              )}
              <p className="hint">
                Didukung: link share lengkap <b>alightcreative.com/am/share/u/…/p/…</b> dan link pendek{" "}
                <b>alight.link/…</b>. Lewat link share, XML <b>dan seluruh media preset</b> (foto/video/audio asli)
                ikut terunduh otomatis — nggak perlu pasang media satu-satu.
              </p>
            </div>
          )}
        </section>

        {/* Drive */}
        <section className="card overflow-hidden">
          <button
            type="button"
            className="flex w-full items-center gap-3.5 px-4 py-4 text-left"
            aria-expanded={open === 'drive'}
            aria-controls="pane-drive"
            onClick={() => setOpen(open === 'drive' ? null : 'drive')}
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#15151a] text-[var(--accent)]">
              <IconCloud size={19} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">Import Preset XML dari Google Drive</span>
              <span className="mt-0.5 block text-xs text-[var(--muted)]">Link file XML dengan akses publik</span>
            </span>
            <IconChevron
              size={16}
              className={`shrink-0 text-[var(--muted)] transition-transform ${open === 'drive' ? 'rotate-90' : ''}`}
            />
          </button>
          {open === 'drive' && (
            <div id="pane-drive" className="fade-in border-t border-[var(--line)] px-4 pb-4 pt-4">
              <div className="flex gap-2">
                <input
                  type="url"
                  className="input"
                  placeholder="https://drive.google.com/file/d/ID/view"
                  inputMode="url"
                  autoCapitalize="off"
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="Link file XML Google Drive"
                  value={driveUrl}
                  onChange={(e) => setDriveUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void importLink('drive');
                  }}
                />
                <button
                  type="button"
                  className="btn btn-primary shrink-0"
                  onClick={() => importLink('drive')}
                  disabled={busy}
                >
                  Ambil
                </button>
              </div>
              {errors.drive && (
                <p className="err" role="alert">
                  <IconAlert size={14} className="mt-0.5 shrink-0" />
                  <span>{errors.drive}</span>
                </p>
              )}
              <p className="hint">
                Bagikan file dengan akses “Siapa saja yang memiliki link”. Media preset (foto, video, audio)
                ditambahkan sendiri di player.
              </p>
            </div>
          )}
        </section>
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-3 text-xs text-[var(--muted)]">
        <Link href="/dashboard" className="btn btn-sm">
          Proyek saya
        </Link>
        <Link href="/docs" className="btn btn-sm btn-ghost">
          Cara kerja
        </Link>
        <span className="ml-auto">Rendering engine v2 · canvas 2D</span>
      </div>

      {FOOTER_TEXT && (
        <footer className="mt-10 border-t border-[var(--line)] pt-5 text-center text-xs text-[var(--muted)]">
          {FOOTER_TEXT.replace('{owner}', OWNER_NAME)}
        </footer>
      )}

      {busy && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/80 px-5 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="lp-stage"
        >
          <div className="card w-full max-w-sm p-6 text-center">
            <div className="dot-pulse mb-4 flex justify-center">
              <i />
              <i />
              <i />
            </div>
            <p id="lp-stage" className="text-sm font-semibold" aria-live="polite">
              {stage}
            </p>
            <p className="mt-1 min-h-[1.25rem] truncate text-xs text-[var(--muted)]">{detail}</p>
            <button
              type="button"
              className="btn btn-sm mt-5"
              onClick={() => {
                abortRef.current?.abort();
                setBusy(false);
              }}
            >
              Batal
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
