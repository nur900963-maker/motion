import { getExport, readExportBytes } from '@/lib/store';
import { requireUser } from '@/lib/auth';
import { fail, handleError } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const numId = Number((await ctx.params).id);
    if (!Number.isInteger(numId) || numId <= 0) return fail('ID ekspor tidak valid.', 400);
    const row = await getExport(numId, user.id);
    if (!row) return fail('Ekspor tidak ditemukan.', 404, 'NOT_FOUND');
    const data = await readExportBytes(numId);
    if (!data) {
      return fail('File ekspor tidak lagi tersedia di server (data sementara sudah terhapus).', 410, 'GONE');
    }
    const ext = row.mime.includes('mp4') ? 'mp4' : 'webm';
    return new Response(new Uint8Array(data), {
      headers: {
        'content-type': row.mime,
        'content-length': String(data.length),
        'cache-control': 'private, max-age=3600',
        'x-content-type-options': 'nosniff',
        'content-disposition': `attachment; filename="xmotion-${numId}.${ext}"`,
      },
    });
  } catch (err) {
    return handleError(err);
  }
}
