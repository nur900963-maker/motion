'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/client';
import { IconAlert, IconUser } from './icons';

export default function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') || '/dashboard';
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    const fe: Record<string, string> = {};
    if (mode === 'register' && name.trim().length < 2) fe.name = 'Nama minimal 2 karakter.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) fe.email = 'Format email tidak valid.';
    if (password.length < (mode === 'register' ? 8 : 1)) {
      fe.password = mode === 'register' ? 'Kata sandi minimal 8 karakter.' : 'Kata sandi wajib diisi.';
    }
    setFieldErr(fe);
    if (Object.keys(fe).length) return;

    setBusy(true);
    try {
      await api(`/api/auth/${mode}`, {
        method: 'POST',
        body: JSON.stringify(mode === 'register' ? { name, email, password } : { email, password }),
      });
      router.push(next);
      router.refresh();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : 'Terjadi kesalahan.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-5 py-10">
      <Link href="/" className="mb-8 flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--paper)] text-black">
          <span className="text-base font-black">X</span>
        </span>
        <span className="text-sm font-bold">Xmotion</span>
      </Link>

      <h1 className="text-2xl font-bold tracking-tight">
        {mode === 'login' ? 'Masuk' : 'Buat akun'}
      </h1>
      <p className="mt-1 text-sm text-[var(--muted)]">
        {mode === 'login'
          ? 'Masuk untuk menyimpan proyek, media, dan hasil ekspor.'
          : 'Akun dipakai untuk menyimpan proyek dan media kamu di server.'}
      </p>

      <form onSubmit={submit} className="mt-6 space-y-3" noValidate>
        {mode === 'register' && (
          <div>
            <label className="label" htmlFor="name">
              Nama
            </label>
            <input
              id="name"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              placeholder="Nama kamu"
              aria-invalid={Boolean(fieldErr.name)}
            />
            {fieldErr.name && <p className="mt-1 text-[11px] text-[var(--err)]">{fieldErr.name}</p>}
          </div>
        )}
        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            inputMode="email"
            placeholder="kamu@email.com"
            aria-invalid={Boolean(fieldErr.email)}
          />
          {fieldErr.email && <p className="mt-1 text-[11px] text-[var(--err)]">{fieldErr.email}</p>}
        </div>
        <div>
          <label className="label" htmlFor="password">
            Kata sandi
          </label>
          <input
            id="password"
            type="password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            placeholder={mode === 'register' ? 'Minimal 8 karakter' : '••••••••'}
            aria-invalid={Boolean(fieldErr.password)}
          />
          {fieldErr.password && <p className="mt-1 text-[11px] text-[var(--err)]">{fieldErr.password}</p>}
        </div>

        {err && (
          <p className="err" role="alert">
            <IconAlert size={13} className="mt-0.5 shrink-0" /> {err}
          </p>
        )}

        <button type="submit" className="btn btn-primary w-full" disabled={busy}>
          {busy ? <span className="spinner" /> : <IconUser size={14} />}
          {mode === 'login' ? 'Masuk' : 'Buat akun'}
        </button>
      </form>

      <p className="mt-5 text-center text-xs text-[var(--muted)]">
        {mode === 'login' ? (
          <>
            Belum punya akun?{' '}
            <Link href="/register" className="text-[var(--accent)] hover:underline">
              Daftar
            </Link>
          </>
        ) : (
          <>
            Sudah punya akun?{' '}
            <Link href="/login" className="text-[var(--accent)] hover:underline">
              Masuk
            </Link>
          </>
        )}
      </p>
      <Link href="/" className="mt-2 text-center text-xs text-[var(--muted)] hover:text-[var(--paper)]">
        ← Kembali ke halaman awal
      </Link>
    </main>
  );
}
