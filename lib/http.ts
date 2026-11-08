import { NextResponse } from 'next/server';

export type ApiError = { error: string; code?: string };

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function fail(message: string, status = 400, code?: string) {
  return NextResponse.json<ApiError>({ error: message, code }, { status });
}

/** Ubah error apa pun menjadi respons JSON yang konsisten (tanpa membocorkan detail internal). */
export function handleError(err: unknown) {
  if (err instanceof SyntaxError) return fail('Body request bukan JSON yang valid.', 400, 'BAD_JSON');
  const e = err as Error & { status?: number; code?: string };
  const status = e?.status ?? 500;
  if (status >= 500) console.error('[api]', e);
  const message = e?.status ? e.message : 'Terjadi kesalahan di server.';
  return fail(message || 'Terjadi kesalahan di server.', status, e?.code ?? 'INTERNAL');
}

export function clientIp(req: Request): string {
  const h = req.headers;
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || 'unknown';
}

/** Rate limit sederhana in-memory (per instance serverless). */
const buckets = new Map<string, { count: number; reset: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  b.count += 1;
  return b.count <= limit;
}
