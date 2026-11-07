import { getMedia, readMediaBytes } from '@/lib/store';
import { requireUser } from '@/lib/auth';
import { fail, handleError } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Sajikan byte media dari folder data milik pengguna yang sedang masuk. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const numId = Number((await ctx.params).id);
    if (!Number.isInteger(numId) || numId <= 0) return fail('ID media tidak valid.', 400);
    const row = await getMedia(numId, user.id);
    if (!row) return fail('Media tidak ditemukan.', 404, 'NOT_FOUND');
    const data = await readMediaBytes(numId);
    if (!data) {
      return fail('Isi media tidak tersedia di server (kemungkinan data sementara sudah terhapus).', 410, 'GONE');
    }
    return new Response(new Uint8Array(data), {
      headers: {
        'content-type': row.mime,
        'content-length': String(data.length),
        'cache-control': 'private, max-age=3600',
        'x-content-type-options': 'nosniff',
        'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(row.name)}`,
      },
    });
  } catch (err) {
    return handleError(err);
  }
}
