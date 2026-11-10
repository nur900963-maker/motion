import { fail, handleError, rateLimit, clientIp } from '@/lib/http';
import { entryByName, loadPackage, mimeOfName, parseShareLink, ShareError, zipExtract } from '@/lib/am-share';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Mengirim SATU file media dari paket share Alight Motion (server-side, karena storage
 * Firebase tidak mengizinkan CORS browser). Paket ZIP di-cache server sehingga permintaan
 * berikutnya tidak mengunduh ulang.
 *
 * File di atas ~3 MB dikirim per-bagian (query start/end) supaya aman dari batas ukuran
 * respons serverless (±4,5 MB); klien menggabungkan bagian-bagiannya.
 */

const CHUNK = 3 * 1024 * 1024;

// File yang sedang dikirim per-bagian: simpan hasil ekstraknya agar bagian berikutnya tidak dekompresi ulang.
let lastExtract: { key: string; buf: Buffer } | null = null;

export async function POST(req: Request) {
  try {
    if (!rateLimit(`asset:${clientIp(req)}`, 120, 60_000)) {
      return fail('Terlalu banyak permintaan. Coba lagi sebentar.', 429, 'RATE_LIMIT');
    }
    const body = (await req.json()) as {
      user?: unknown;
      package?: unknown;
      filename?: unknown;
      start?: unknown;
      end?: unknown;
    };
    const user = typeof body.user === 'string' ? body.user : '';
    const pkgId = typeof body.package === 'string' ? body.package : '';
    const filename = typeof body.filename === 'string' ? body.filename : '';
    if (!user || !pkgId || !filename) return fail('Permintaan media tidak lengkap.', 422, 'BAD_REQUEST');

    if (user.length > 80 || pkgId.length > 120 || filename.length > 300) return fail('Permintaan media tidak valid.', 422, 'BAD_REQUEST');
    const ref = parseShareLink(`https://alightcreative.com/am/share/u/${encodeURIComponent(user)}/p/${encodeURIComponent(pkgId)}`);
    if (!ref || ref.user !== user || ref.package !== pkgId) return fail('Referensi paket tidak valid.', 422, 'BAD_REQUEST');

    const pkg = await loadPackage(ref);
    const entry = entryByName(pkg.entries, filename);
    if (!entry) return fail(`File "${filename}" tidak ada di paket.`, 404, 'NOT_FOUND');

    const key = `${pkgId}/${entry.name}`;
    let buf: Buffer;
    if (lastExtract?.key === key) {
      buf = lastExtract.buf;
    } else {
      buf = zipExtract(pkg.buf, entry);
      lastExtract = { key, buf };
    }
    const start = Math.max(0, Math.min(Number(body.start) || 0, buf.length));
    const end = Math.min(buf.length, Number(body.end) || start + CHUNK);
    const slice = buf.subarray(start, end);

    return new Response(new Uint8Array(slice), {
      status: 200,
      headers: {
        'content-type': mimeOfName(entry.name),
        'content-length': String(slice.byteLength),
        'x-total-size': String(buf.length),
        'x-chunk-start': String(start),
        'x-chunk-end': String(end),
        'cache-control': 'private, max-age=600',
      },
    });
  } catch (err) {
    if (err instanceof ShareError) return fail(err.message, err.status, err.code);
    return handleError(err);
  }
}
