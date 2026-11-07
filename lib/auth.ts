import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import bcrypt from 'bcryptjs';
import { findUserById } from './store';
import { AUTH_SECRET, AUTH_SECRET_OK } from './config';

export const COOKIE = 'xm_session';
const MAX_AGE = 60 * 60 * 24 * 30;

export type SessionUser = { id: number; email: string; name: string };

function secret(): Uint8Array {
  if (!AUTH_SECRET_OK) {
    throw new Error('AUTH_SECRET belum diset (minimal 16 karakter). Isi di config.js atau Environment Variables Vercel.');
  }
  return new TextEncoder().encode(AUTH_SECRET);
}

/** Panggil di awal register/login: gagal cepat sebelum ada data yang ditulis. */
export function assertAuthConfigured(): void {
  secret();
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export async function createSession(user: SessionUser): Promise<void> {
  const token = await new SignJWT({ email: user.email, name: user.name })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(user.id))
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret());

  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE);
}

/** Baca sesi dari cookie; null bila tidak ada / kedaluwarsa / user sudah dihapus. */
export async function currentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    const id = Number(payload.sub);
    if (!Number.isFinite(id)) return null;
    const row = await findUserById(id);
    if (!row) return null;
    return { id: row.id, email: row.email, name: row.name };
  } catch (err) {
    // Token tidak valid / kedaluwarsa = bukan error. Kegagalan storage tetap dicatat.
    const code = (err as { code?: string })?.code;
    if (code === 'STORAGE') console.error('[auth] storage error:', (err as Error).message);
    return null;
  }
}

export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) {
    const err = new Error('UNAUTHORIZED') as Error & { status?: number };
    err.status = 401;
    throw err;
  }
  return user;
}
