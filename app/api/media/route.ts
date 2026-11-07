import { addMedia, getProject, listMedia, MAX_UPLOAD_BYTES } from '@/lib/store';
import { requireUser } from '@/lib/auth';
import { fail, handleError, ok } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ALLOWED = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/ogg',
  'audio/aac',
];

function kindOf(mime: string): 'image' | 'video' | 'audio' | 'other' {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'other';
}

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const raw = new URL(req.url).searchParams.get('projectId');
    let projectId: number | null = null;
    if (raw !== null) {
      projectId = Number(raw);
      if (!Number.isInteger(projectId) || projectId <= 0) return fail('ID proyek tidak valid.', 400);
    }
    const rows = await listMedia(user.id, projectId, 200);
    return ok({
      media: rows.map((m) => ({
        id: m.id,
        name: m.name,
        mime: m.mime,
        kind: m.kind,
        size: m.size,
        url: `/api/media/${m.id}/raw`,
        projectId: m.projectId,
      })),
    });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const form = await req.formData();
    const file = form.get('file');
    const projectIdRaw = form.get('projectId');
    const projectId = projectIdRaw ? Number(projectIdRaw) : null;

    if (!(file instanceof File)) return fail('Tidak ada file yang diunggah.', 400, 'NO_FILE');
    if (file.size === 0) return fail('File kosong.', 400, 'EMPTY');
    if (file.size > MAX_UPLOAD_BYTES) {
      return fail(
        `File terlalu besar (${(file.size / 1048576).toFixed(1)} MB). Maksimal ${(MAX_UPLOAD_BYTES / 1048576).toFixed(0)} MB.`,
        413,
        'TOO_LARGE',
      );
    }
    const mime = file.type || 'application/octet-stream';
    if (!ALLOWED.includes(mime)) {
      return fail(`Tipe file ${mime} tidak didukung. Gunakan gambar, video, atau audio.`, 415, 'BAD_TYPE');
    }
    if (projectId !== null) {
      if (!Number.isInteger(projectId) || projectId <= 0) return fail('ID proyek tidak valid.', 400);
      if (!(await getProject(projectId, user.id))) return fail('Proyek tidak ditemukan.', 404, 'NOT_FOUND');
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const row = await addMedia(
      {
        userId: user.id,
        projectId,
        name: file.name.slice(0, 200),
        mime,
        kind: kindOf(mime),
        size: file.size,
      },
      buf,
    );

    return ok(
      {
        media: {
          id: row.id,
          name: row.name,
          mime,
          kind: row.kind,
          size: row.size,
          url: `/api/media/${row.id}/raw`,
          projectId,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    return handleError(err);
  }
}
