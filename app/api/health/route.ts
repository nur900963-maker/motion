import { ok } from '@/lib/http';
import { storageHealth } from '@/lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const storage = await storageHealth();
  const checks: Record<string, string> = {
    app: 'ok',
    storage: storage.ok ? `ok — ${storage.detail}` : `error: ${storage.detail}`,
    persistent: storage.persistent ? 'yes' : 'no (data sementara di Vercel)',
    auth: process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 16 ? 'ok' : 'not-configured',
  };
  const healthy = checks.app === 'ok' && storage.ok && checks.auth === 'ok';
  return ok({ healthy, persistent: storage.persistent, checks, time: new Date().toISOString() }, { status: healthy ? 200 : 503 });
}
