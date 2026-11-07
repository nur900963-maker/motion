'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/client';
import { fmtTime, type ProjectSummary, type User } from '@/lib/types';
import { IconAlert, IconFolder, IconLogout, IconPlus, IconRefresh, IconTrash, IconUser } from './icons';

export default function Dashboard() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [deleting, setDeleting] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const me = await api<{ user: User | null }>('/api/auth/me');
      setUser(me.user);
      if (!me.user) {
        router.replace('/login?next=/dashboard');
        return;
      }
      const d = await api<{ projects: ProjectSummary[] }>('/api/projects');
      setProjects(d.projects);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Gagal memuat proyek.');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (id: number) => {
    if (!window.confirm('Hapus proyek ini? Tindakan ini tidak bisa dibatalkan.')) return;
    setDeleting(id);
    try {
      await api(`/api/projects/${id}`, { method: 'DELETE' });
      setProjects((p) => p.filter((x) => x.id !== id));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Gagal menghapus proyek.');
    } finally {
      setDeleting(null);
    }
  };

  const logout = async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    router.push('/');
    router.refresh();
  };

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-8">
      <div className="mb-6 flex items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--paper)] text-black">
            <span className="text-sm font-black">X</span>
          </span>
          <span className="text-sm font-bold">Xmotion</span>
        </Link>
        <div className="flex items-center gap-1.5">
          <Link href="/" className="btn btn-sm">
            <IconPlus size={13} /> Preset baru
          </Link>
          <button type="button" className="btn btn-sm btn-icon" onClick={logout} aria-label="Keluar">
            <IconLogout size={14} />
          </button>
        </div>
      </div>

      <div className="mb-6 flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-full bg-[#1a1a20] text-[var(--muted)]">
          <IconUser size={18} />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{user?.name ?? '…'}</p>
          <p className="truncate text-xs text-[var(--muted)]">{user?.email ?? ''}</p>
        </div>
        <button type="button" className="btn btn-sm btn-icon ml-auto" onClick={load} aria-label="Muat ulang">
          <IconRefresh size={14} />
        </button>
      </div>

      <h1 className="mb-3 text-lg font-bold tracking-tight">Proyek saya</h1>

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
                  {p.layerCount} layer · {fmtTime(p.duration)} · {p.width}×{p.height} ·{' '}
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
