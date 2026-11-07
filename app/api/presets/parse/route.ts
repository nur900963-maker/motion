import { z } from 'zod';
import { parseAmXml, XmlError } from '@/lib/am-xml';
import { fail, handleError, ok, rateLimit, clientIp } from '@/lib/http';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_MB = Number(process.env.MAX_UPLOAD_MB || 12);

const Body = z.object({
  files: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        text: z.string().min(1, 'File kosong.'),
      }),
    )
    .min(1, 'Belum ada file yang dipilih.')
    .max(2, 'Maksimal 2 file (preset dan grup).'),
});

export async function POST(req: Request) {
  try {
    if (!rateLimit(`parse:${clientIp(req)}`, 30, 60_000)) {
      return fail('Terlalu banyak permintaan. Coba lagi sebentar.', 429, 'RATE_LIMIT');
    }
    const body = Body.parse(await req.json());

    for (const f of body.files) {
      if (!/\.xml$/i.test(f.name)) {
        return fail(`${f.name} bukan file XML. Pilih file preset berformat .xml.`, 415, 'NOT_XML');
      }
      const bytes = Buffer.byteLength(f.text, 'utf8');
      if (bytes > MAX_MB * 1024 * 1024) {
        return fail(`${f.name} terlalu besar (${(bytes / 1048576).toFixed(1)} MB). Maksimal ${MAX_MB} MB.`, 413, 'TOO_LARGE');
      }
    }

    // File pertama = preset utama; file kedua (opsional) = grup/cc yang digabung.
    const primary = body.files[0];
    let scene;
    try {
      scene = parseAmXml(primary.text, 'xml');
    } catch (err) {
      if (err instanceof XmlError) return fail(`${primary.name}: ${err.message}`, 422, 'BAD_XML');
      throw err;
    }

    if (body.files[1]) {
      try {
        const extra = parseAmXml(body.files[1].text, 'xml');
        scene.layers = [...scene.layers, ...extra.layers];
        scene.mediaRefs = Array.from(new Set([...scene.mediaRefs, ...extra.mediaRefs]));
        scene.effectCount += extra.effectCount;
        scene.warnings.push(`File grup "${body.files[1].name}" digabung (${extra.layers.length} layer).`);
      } catch (err) {
        scene.warnings.push(
          `File kedua "${body.files[1].name}" tidak bisa digabung: ${(err as Error).message}`,
        );
      }
    }

    return ok({ scene, files: body.files.map((f) => ({ name: f.name, bytes: Buffer.byteLength(f.text) })) });
  } catch (err) {
    return handleError(err);
  }
}
