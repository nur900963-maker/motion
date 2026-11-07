import { ok } from '@/lib/http';
import { storageHealth } from '@/lib/store';
import { AUTH_SECRET_OK } from '@/lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const storage = await storageHealth();
  const checks: Record<string, string> = {
    app: 'ok',
    storage: storage.ok ? `ok — ${storage.detail}` : `error: ${storage.detail}`,
    persistent: storage.persistent ? 'yes' : 'no (data sementara di Vercel)',
    auth: AUTH_SECRET_OK ? 'ok' : 'not-configured (isi AUTH_SECRET di config.js atau env Vercel)',
  };
  const healthy = checks.app === 'ok' && storage.ok && checks.auth === 'ok';
  return ok({ healthy, persistent: storage.persistent, checks, time: new Date().toISOString() }, { status: healthy ? 200 : 503 });
}
