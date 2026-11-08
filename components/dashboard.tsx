'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { deleteProject, listProjects } from '@/lib/local-db';
import { SITE_NAME } from '@/lib/site';
import { fmtTime, type LocalProject } from '@/lib/types';
import { LogoMark } from './icons';
import { IconAlert, IconFolder, IconPlus, IconRefresh, IconTrash } from './icons';

/** "Proyek saya": proyek yang disimpan di browser perangkat ini (tanpa akun). */
export default function Dashboard() {
  const [projects, setProjects] = useState<LocalProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [deleting, setDeleting] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      setProjects(await listProjects());
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Gagal memuat proyek.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (id: number) => {
    if (!window.confirm('Hapus proyek ini dari browser? Tindakan ini tidak bisa dibatalkan.')) return;
    setDeleting(id);
    try {
      await deleteProject(id);
      setProjects((p) => p.filter((x) => x.id !== id));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Gagal menghapus proyek.');
    } finally {
      setDeleting(null);
    }
  };

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-8">
      <div className="mb-6 flex items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-2">
          <LogoMark size={34} />
          <span className="text-sm font-black tracking-tight">{SITE_NAME}</span>
        </Link>
        <div className="flex items-center gap-1.5">
          <Link href="/" className="btn btn-sm">
            <IconPlus size={13} /> Preset baru
          </Link>
          <button type="button" className="btn btn-sm btn-icon" onClick={load} aria-label="Muat ulang">
            <IconRefresh size={14} />
          </button>
        </div>
      </div>

      <h1 className="mb-1 text-lg font-bold tracking-tight">Proyek saya</h1>
      <p className="mb-3 text-xs text-[var(--muted)]">
        Disimpan di browser perangkat ini. Tidak ikut pindah ke perangkat lain dan hilang jika data situs dihapus.
      </p>

      {err && (
        <p className="err mb-3" role="alert">
          <IconAlert size={13} className="mt-0.5 shrink-0" /> {err}
        </p>
      )}

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-16 w-full" />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <div className="card flex flex-col items-center px-6 py-12 text-center">
          <IconFolder size={26} className="mb-3 text-[#3f3f48]" />
          <p className="text-sm font-semibold">Belum ada proyek</p>
          <p className="mt-1 max-w-[32ch] text-xs text-[var(--muted)]">
            Impor preset XML, link Alight Motion, atau Google Drive dari halaman awal, lalu simpan proyeknya.
          </p>
          <Link href="/" className="btn btn-primary mt-4">
            Impor preset
          </Link>
        </div>
      ) : (
        <ul className="space-y-2">
          {projects.map((p) => (
            <li key={p.id} className="card flex items-center gap-3 px-3.5 py-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#1a1a20] text-[var(--accent)]">
                <IconFolder size={15} />
              </span>
              <Link href={`/player?project=${p.id}`} className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{p.name}</span>
                <span className="block text-[11px] text-[var(--muted)]">
                  {p.scene.layers.length} layer · {fmtTime(p.scene.duration)} · {p.scene.width}×{p.scene.height} ·{' '}
                  {new Date(p.updatedAt).toLocaleDateString('id-ID')}
                </span>
              </Link>
              <button
                type="button"
                className="btn btn-sm btn-icon text-[var(--err)]"
                onClick={() => remove(p.id)}
                disabled={deleting === p.id}
                aria-label={`Hapus ${p.name}`}
              >
                {deleting === p.id ? <span className="spinner" /> : <IconTrash size={13} />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
