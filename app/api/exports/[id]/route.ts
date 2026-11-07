import { deleteExport } from '@/lib/store';
import { requireUser } from '@/lib/auth';
import { fail, handleError, ok } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const numId = Number((await ctx.params).id);
    if (!Number.isInteger(numId) || numId <= 0) return fail('ID ekspor tidak valid.', 400);
    if (!(await deleteExport(numId, user.id))) return fail('Ekspor tidak ditemukan.', 404, 'NOT_FOUND');
    return ok({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
