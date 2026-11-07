import { destroySession } from '@/lib/auth';
import { handleError, ok } from '@/lib/http';

export const runtime = 'nodejs';

export async function POST() {
  try {
    await destroySession();
    return ok({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
