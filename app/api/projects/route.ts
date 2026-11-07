import { z } from 'zod';
import { createProject, listProjects } from '@/lib/store';
import { requireUser } from '@/lib/auth';
import { handleError, ok } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LayerSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  start: z.number(),
  end: z.number(),
  visible: z.boolean(),
  x: z.number(),
  y: z.number(),
  scaleX: z.number(),
  scaleY: z.number(),
  rotation: z.number(),
  opacity: z.number(),
  width: z.number(),
  height: z.number(),
  color: z.string(),
  text: z.string(),
  mediaRef: z.string().nullable(),
  effects: z.array(z.object({ id: z.string(), name: z.string(), enabled: z.boolean() })),
  keyframes: z.record(z.array(z.object({ t: z.number(), v: z.array(z.number()) }))),
  children: z.array(z.any()),
  raw: z.record(z.string()),
});

const SceneSchema = z.object({
  name: z.string().min(1).max(200),
  width: z.number().int().min(16).max(8192),
  height: z.number().int().min(16).max(8192),
  fps: z.number().int().min(1).max(120),
  duration: z.number().int().min(100).max(3_600_000),
  layers: z.array(LayerSchema).max(2000),
  mediaRefs: z.array(z.string()).max(500),
  effectCount: z.number().int().min(0),
  warnings: z.array(z.string()).max(200),
  source: z.enum(['xml', 'am', 'drive', 'sample']),
});

const CreateBody = z.object({
  name: z.string().trim().min(1, 'Nama proyek wajib diisi.').max(120),
  scene: SceneSchema,
  xmlText: z.string().max(12 * 1024 * 1024).optional(),
  sourceKind: z.enum(['xml', 'am', 'drive', 'sample']).default('xml'),
  sourceUrl: z.string().max(2000).optional(),
});

export async function GET() {
  try {
    const user = await requireUser();
    const rows = await listProjects(user.id, 100);
    return ok({
      projects: rows.map((r) => ({
        id: r.id,
        name: r.name,
        sourceKind: r.sourceKind,
        updatedAt: r.updatedAt,
        layerCount: r.layerCount,
        duration: r.duration,
        width: r.width,
        height: r.height,
      })),
    });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = CreateBody.parse(await req.json());
    const id = await createProject({
      userId: user.id,
      name: body.name,
      sourceKind: body.sourceKind,
      sourceUrl: body.sourceUrl ?? null,
      scene: body.scene,
      xmlText: body.xmlText ?? null,
    });
    return ok({ id }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}
