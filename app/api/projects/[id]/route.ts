import { z } from 'zod';
import { deleteProject, getProject, listMedia, updateProject } from '@/lib/store';
import { requireUser } from '@/lib/auth';
import { fail, handleError, ok } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PatchBody = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  scene: z.record(z.any()).optional(),
});

function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const numId = parseId((await ctx.params).id);
    if (numId === null) return fail('ID proyek tidak valid.', 400);
    const row = await getProject(numId, user.id);
    if (!row) return fail('Proyek tidak ditemukan.', 404, 'NOT_FOUND');
    const media = await listMedia(user.id, numId, 500);
    return ok({
      project: {
        id: row.id,
        name: row.name,
        scene: row.scene,
        xmlText: row.xmlText,
        sourceKind: row.sourceKind,
        sourceUrl: row.sourceUrl,
        updatedAt: row.updatedAt,
      },
      media: media
        .sort((a, b) => a.id - b.id)
        .map((m) => ({
          id: m.id,
          name: m.name,
          mime: m.mime,
          kind: m.kind,
          size: m.size,
          url: `/api/media/${m.id}/raw`,
        })),
    });
  } catch (err) {
    return handleError(err);
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const numId = parseId((await ctx.params).id);
    if (numId === null) return fail('ID proyek tidak valid.', 400);
    const body = PatchBody.parse(await req.json());
    const updated = await updateProject(numId, user.id, { name: body.name, scene: body.scene });
    if (!updated) return fail('Proyek tidak ditemukan.', 404, 'NOT_FOUND');
    return ok({ ok: true, updatedAt: updated.updatedAt });
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const numId = parseId((await ctx.params).id);
    if (numId === null) return fail('ID proyek tidak valid.', 400);
    const removed = await deleteProject(numId, user.id);
    if (!removed) return fail('Proyek tidak ditemukan.', 404, 'NOT_FOUND');
    return ok({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
