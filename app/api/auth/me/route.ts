import { currentUser } from '@/lib/auth';
import { handleError, ok } from '@/lib/http';
import { MAX_EXPORT_BYTES, MAX_UPLOAD_BYTES, PERSISTENT } from '@/lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await currentUser();
    return ok({
      user,
      // Batas nyata di server ini (di Vercel dibatasi 4 MB per request), agar klien
      // tidak mengunggah file besar yang pasti ditolak.
      limits: { uploadBytes: MAX_UPLOAD_BYTES, exportBytes: MAX_EXPORT_BYTES },
      storage: { persistent: PERSISTENT },
    });
  } catch (err) {
    return handleError(err);
  }
}
