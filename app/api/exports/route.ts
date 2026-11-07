import { addExport, getProject, listExports, MAX_EXPORT_BYTES } from '@/lib/store';
import { requireUser } from '@/lib/auth';
import { fail, handleError, ok } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  try {
    const user = await requireUser();
    const rows = await listExports(user.id, 50);
    return ok({
      exports: rows.map((r) => ({
        id: r.id,
        projectId: r.projectId,
        status: r.status,
        preset: r.preset,
        bytes: r.bytes,
        url: `/api/exports/${r.id}/file`,
        error: r.error,
        createdAt: r.createdAt,
      })),
    });
  } catch (err) {
    return handleError(err);
  }
}

/**
 * Menerima hasil render dari klien (MediaRecorder atas canvas yang benar-benar
 * merender scene) lalu menyimpannya di folder data. Status langsung 'done'
 * karena encoding terjadi di klien dan file yang masuk sudah final.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const form = await req.formData();
    const file = form.get('file');
    const projectIdRaw = form.get('projectId');
    const presetRaw = form.get('preset');

    if (!(file instanceof File)) return fail('File hasil ekspor tidak ditemukan.', 400, 'NO_FILE');
    if (file.size === 0) return fail('Hasil ekspor kosong. Coba render ulang.', 400, 'EMPTY');
    if (file.size > MAX_EXPORT_BYTES) {
      return fail(
        `Hasil ekspor terlalu besar untuk disimpan di server (${(file.size / 1048576).toFixed(1)} MB, maksimal ${(MAX_EXPORT_BYTES / 1048576).toFixed(0)} MB).`,
        413,
        'TOO_LARGE',
      );
    }

    let preset: unknown = {};
    if (typeof presetRaw === 'string') {
      try {
        preset = JSON.parse(presetRaw);
      } catch {
        return fail('Metadata preset tidak valid.', 422, 'BAD_PRESET');
      }
    }

    const projectId = projectIdRaw ? Number(projectIdRaw) : null;
    if (projectId !== null) {
      if (!Number.isInteger(projectId) || projectId <= 0) return fail('ID proyek tidak valid.', 400);
      if (!(await getProject(projectId, user.id))) return fail('Proyek tidak ditemukan.', 404, 'NOT_FOUND');
    }

    const mime = file.type || 'video/webm';
    const row = await addExport(
      { userId: user.id, projectId, preset, bytes: file.size, mime },
      Buffer.from(await file.arrayBuffer()),
    );

    return ok(
      { export: { id: row.id, status: 'done', bytes: file.size, url: `/api/exports/${row.id}/file`, mime } },
      { status: 201 },
    );
  } catch (err) {
    return handleError(err);
  }
}
