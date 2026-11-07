import net from 'node:net';
import { lookup } from 'node:dns/promises';
import { z } from 'zod';
import { parseAmXml, XmlError } from '@/lib/am-xml';
import { fail, handleError, ok, rateLimit, clientIp } from '@/lib/http';

export const runtime = 'nodejs';
export const maxDuration = 60;

const Body = z.object({
  kind: z.enum(['am', 'drive']),
  url: z.string().trim().min(1, 'Tempel link terlebih dahulu.').max(2000),
});

const MAX_BYTES = 12 * 1024 * 1024;
const TIMEOUT_MS = 20_000;

function blocked(): Error {
  const err = new Error('Alamat tujuan tidak diizinkan.') as Error & { status?: number; code?: string };
  err.status = 422;
  err.code = 'BLOCKED_HOST';
  return err;
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l === '::1' || l === '::') return true;
    if (l.startsWith('fe8') || l.startsWith('fe9') || l.startsWith('fea') || l.startsWith('feb')) return true;
    if (l.startsWith('fc') || l.startsWith('fd')) return true;
    const dotted = l.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (dotted) return isPrivateIp(dotted[1]);
    const hex = l.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) {
      const hi = parseInt(hex[1], 16);
      const lo = parseInt(hex[2], 16);
      return isPrivateIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    return false;
  }
  return true;
}

/** Tolak host internal: nama host, IP literal, dan hasil resolusi DNS-nya. */
async function assertPublicHost(hostname: string): Promise<void> {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) {
    throw blocked();
  }
  if (net.isIP(h)) {
    if (isPrivateIp(h)) throw blocked();
    return;
  }
  let addrs: { address: string }[];
  try {
    addrs = await lookup(h, { all: true });
  } catch {
    const e = new Error('Alamat tidak ditemukan. Periksa kembali link-nya.') as Error & { status?: number; code?: string };
    e.status = 422;
    e.code = 'DNS_FAIL';
    throw e;
  }
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw blocked();
}

function extractUrl(raw: string): string {
  const m = raw.match(/https?:\/\/[^\s<>"']+/i);
  return m ? m[0] : raw.trim();
}

function driveIdOf(value: string): string | null {
  const a = value.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (a) return a[1];
  const b = value.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (b) return b[1];
  if (/^[a-zA-Z0-9_-]{20,60}$/.test(value.trim())) return value.trim();
  return null;
}

function srcError(message: string, status: number, code: string): Error {
  const e = new Error(message) as Error & { status?: number; code?: string };
  e.status = status;
  e.code = code;
  return e;
}

const MAX_REDIRECTS = 5;

async function fetchText(url: string): Promise<{ text: string; finalUrl: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let current = url;
    let res: Response | null = null;
    // Redirect diikuti manual agar setiap hop divalidasi ulang (cegah SSRF lewat redirect).
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const u = new URL(current);
      if (!/^https?:$/.test(u.protocol)) throw blocked();
      await assertPublicHost(u.hostname);
      res = await fetch(u.href, {
        signal: controller.signal,
        redirect: 'manual',
        headers: {
          'user-agent': 'Xmotion/2.0 (+preset importer)',
          accept: 'application/xml,text/xml,text/plain,*/*',
        },
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        await res.body?.cancel().catch(() => undefined);
        if (!loc) throw srcError('Sumber mengalihkan tanpa tujuan yang jelas.', 422, 'SOURCE_ERROR');
        if (hop === MAX_REDIRECTS) throw srcError('Terlalu banyak pengalihan dari sumber.', 422, 'SOURCE_ERROR');
        current = new URL(loc, u.href).href;
        res = null;
        continue;
      }
      break;
    }
    if (!res) throw srcError('Terlalu banyak pengalihan dari sumber.', 422, 'SOURCE_ERROR');
    if (!res.ok) {
      throw srcError(`Sumber membalas ${res.status}. Pastikan link publik dan masih aktif.`, 422, 'SOURCE_ERROR');
    }
    if (Number(res.headers.get('content-length') || 0) > MAX_BYTES) {
      throw srcError('File terlalu besar (maksimal 12 MB).', 413, 'TOO_LARGE');
    }
    // Baca bertahap dan berhenti bila melewati batas (jangan buffer tak terbatas).
    const reader = res.body?.getReader();
    if (!reader) throw srcError('Sumber tidak mengembalikan isi.', 422, 'EMPTY');
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw srcError('File terlalu besar (maksimal 12 MB).', 413, 'TOO_LARGE');
      }
      chunks.push(value);
    }
    const text = new TextDecoder('utf-8').decode(Buffer.concat(chunks));
    return { text, finalUrl: current };
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw srcError('Sumber terlalu lama merespons. Coba lagi sebentar lagi.', 504, 'TIMEOUT');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(req: Request) {
  try {
    if (!rateLimit(`import:${clientIp(req)}`, 20, 60_000)) {
      return fail('Terlalu banyak permintaan. Coba lagi sebentar.', 429, 'RATE_LIMIT');
    }
    const body = Body.parse(await req.json());
    const raw = extractUrl(body.url);

    let target: URL;
    try {
      target = new URL(raw);
    } catch {
      return fail('Format link tidak valid. Contoh: https://alightcreative.com/am/share/...', 422, 'BAD_URL');
    }
    if (!/^https?:$/.test(target.protocol)) {
      return fail('Link harus diawali http:// atau https://.', 422, 'BAD_URL');
    }
    await assertPublicHost(target.hostname);

    if (body.kind === 'am') {
      if (/(^|\.)(drive|docs)\.google\.com$/i.test(target.hostname)) {
        return fail('Ini link Google Drive. Pakai opsi "Import Preset XML dari Google Drive".', 422, 'WRONG_SOURCE');
      }
      const { text, finalUrl } = await fetchText(target.href);
      if (!text.trim()) return fail('Link ini tidak berisi data preset.', 422, 'EMPTY');
      try {
        const scene = parseAmXml(text, 'am');
        return ok({ scene, sourceUrl: finalUrl });
      } catch (err) {
        if (err instanceof XmlError) {
          return fail(
            `Link ini tidak berisi preset XML Alight Motion yang valid (${err.message}). Pastikan link share masih aktif.`,
            422,
            'BAD_XML',
          );
        }
        throw err;
      }
    }

    // Google Drive
    if (/\/drive\/folders\//i.test(raw)) {
      return fail('Ini link folder. Bagikan link file XML-nya langsung.', 422, 'FOLDER');
    }
    const id = driveIdOf(raw);
    if (!id) {
      return fail('Bukan link Google Drive yang valid. Contoh: https://drive.google.com/file/d/ID/view', 422, 'BAD_URL');
    }
    const direct = `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`;
    const { text, finalUrl } = await fetchText(direct);
    if (/<html/i.test(text.slice(0, 400)) && !/<project|<scene/i.test(text)) {
      return fail(
        'Google Drive mengembalikan halaman HTML, bukan file XML. Pastikan akses file "Siapa saja yang memiliki link".',
        422,
        'NOT_PUBLIC',
      );
    }
    try {
      const scene = parseAmXml(text, 'drive');
      return ok({ scene, sourceUrl: finalUrl });
    } catch (err) {
      if (err instanceof XmlError) {
        return fail(`File dari Google Drive bukan XML preset yang valid: ${err.message}`, 422, 'BAD_XML');
      }
      throw err;
    }
  } catch (err) {
    return handleError(err);
  }
}
