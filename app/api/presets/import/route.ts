import net from 'node:net';
import { lookup } from 'node:dns/promises';
import { fail, handleError, ok, rateLimit, clientIp } from '@/lib/http';
import {
  classifyDrive,
  DRIVE_MESSAGES,
  driveIdOf,
  extractUrl,
  interstitialUrl,
  isAlightHost,
  isHtml,
  looksLikeXml,
  type DriveProblem,
  type Fetched,
} from '@/lib/drive';
import {
  entryByName,
  findShareLinkInHtml,
  isJunkEntry,
  isMediaName,
  loadPackage,
  MAX_XML_BYTES,
  mimeOfName,
  parseManifest,
  parseShareLink,
  ShareError,
  zipExtract,
  type ShareRef,
} from '@/lib/am-share';

export const runtime = 'nodejs';
export const maxDuration = 60; // unduh paket share bisa puluhan MB

/**
 * Mengambil file XML preset dari link (server-side karena browser terblokir CORS), lalu
 * MENGEMBALIKAN TEKS XML-nya. Parsing dilakukan di browser.
 *
 * Batas 4 MB karena respons fungsi Vercel dibatasi ±4,5 MB. File lebih besar: unduh manual
 * lalu pakai "Upload Preset XML dari Perangkat" (diparse di browser, tanpa batas server).
 */

const MAX_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 6;
const BROWSER_UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

type HttpError = Error & { status?: number; code?: string };
function httpError(message: string, status: number, code: string): HttpError {
  const e = new Error(message) as HttpError;
  e.status = status;
  e.code = code;
  return e;
}
const blocked = () => httpError('Alamat tujuan tidak diizinkan.', 422, 'BLOCKED_HOST');

/* ───────── perlindungan SSRF ───────── */

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
    if (/^fe[89ab]/.test(l) || l.startsWith('fc') || l.startsWith('fd')) return true;
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

async function assertPublicHost(hostname: string): Promise<void> {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) throw blocked();
  if (net.isIP(h)) {
    if (isPrivateIp(h)) throw blocked();
    return;
  }
  let addrs: { address: string }[];
  try {
    addrs = await lookup(h, { all: true });
  } catch {
    throw httpError('Alamat tidak ditemukan. Periksa kembali link-nya.', 422, 'DNS_FAIL');
  }
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw blocked();
}

const isGoogleHost = (h: string) => h === 'google.com' || h.endsWith('.google.com') || h.endsWith('.googleusercontent.com');

/* ───────── fetch dengan redirect manual + cookie ───────── */

async function fetchFollow(
  startUrl: string,
  opts: { hostOk?: (host: string) => boolean; jar?: Map<string, string> } = {},
): Promise<Fetched> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const jar = opts.jar ?? new Map<string, string>();
  try {
    let current = startUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const u = new URL(current);
      if (!/^https?:$/.test(u.protocol)) throw blocked();
      if (opts.hostOk && !opts.hostOk(u.hostname.toLowerCase())) throw blocked();
      await assertPublicHost(u.hostname);

      const headers: Record<string, string> = {
        'user-agent': BROWSER_UA,
        accept: 'application/xml,text/xml,text/html;q=0.8,*/*;q=0.5',
        'accept-language': 'en-US,en;q=0.8',
      };
      if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

      const res = await fetch(u.href, { signal: controller.signal, redirect: 'manual', headers });
      for (const c of res.headers.getSetCookie?.() ?? []) {
        const [pair] = c.split(';');
        const i = pair.indexOf('=');
        if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
      }

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        await res.body?.cancel().catch(() => undefined);
        if (!loc) throw httpError('Sumber mengalihkan tanpa tujuan yang jelas.', 422, 'SOURCE_ERROR');
        current = new URL(loc, u.href).href;
        continue;
      }

      if (Number(res.headers.get('content-length') || 0) > MAX_BYTES) {
        await res.body?.cancel().catch(() => undefined);
        throw httpError('File terlalu besar untuk diimpor lewat link (maks 4 MB). Unduh file-nya lalu pakai Upload.', 413, 'TOO_LARGE');
      }
      const reader = res.body?.getReader();
      if (!reader) throw httpError('Sumber tidak mengembalikan isi.', 422, 'EMPTY');
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_BYTES) {
          await reader.cancel().catch(() => undefined);
          throw httpError('File terlalu besar untuk diimpor lewat link (maks 4 MB). Unduh file-nya lalu pakai Upload.', 413, 'TOO_LARGE');
        }
        chunks.push(value);
      }
      const cd = res.headers.get('content-disposition') ?? '';
      const fn = /filename\*=UTF-8''([^;]+)/i.exec(cd)?.[1] ?? /filename="?([^";]+)"?/i.exec(cd)?.[1] ?? null;
      let filename: string | null = null;
      if (fn) {
        try {
          filename = decodeURIComponent(fn);
        } catch {
          filename = fn;
        }
      }
      return {
        status: res.status,
        text: new TextDecoder('utf-8').decode(Buffer.concat(chunks)),
        finalUrl: current,
        filename,
      };
    }
    throw httpError('Terlalu banyak pengalihan dari sumber.', 422, 'SOURCE_ERROR');
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw httpError('Sumber terlalu lama merespons. Coba lagi sebentar lagi.', 504, 'TIMEOUT');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchDrive(id: string): Promise<Fetched> {
  const jar = new Map<string, string>();
  const candidates = [
    `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`,
    `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`,
  ];
  let problem: DriveProblem = 'other';
  for (const url of candidates) {
    let r = await fetchFollow(url, { hostOk: isGoogleHost, jar });
    if (looksLikeXml(r.text)) return r;
    problem = classifyDrive(r);
    if (problem === 'interstitial') {
      const next = interstitialUrl(r.text);
      if (next) {
        r = await fetchFollow(next, { hostOk: isGoogleHost, jar });
        if (looksLikeXml(r.text)) return r;
        problem = classifyDrive(r);
      }
    }
    // Belum publik / tidak ada: kandidat lain akan memberi hasil sama, jangan buang waktu.
    if (problem === 'login' || problem === 'notfound' || problem === 'quota') break;
  }
  if (problem === 'interstitial') problem = 'other';
  throw httpError(DRIVE_MESSAGES[problem], 422, `DRIVE_${problem.toUpperCase()}`);
}

/* ───────── paket share Alight Motion ───────── */

/**
 * Tentukan paket share dari link apa pun di domain Alight Motion: link lengkap langsung dikenali;
 * link pendek (alight.link/…) diikuti alihannya, lalu URL share dicari di URL akhir / isi HTML.
 */
async function shareRefOf(target: URL): Promise<ShareRef | null> {
  const direct = parseShareLink(target.href);
  if (direct) return direct;
  if (!isAlightHost(target.hostname.toLowerCase())) return null;
  try {
    const r = await fetchFollow(target.href, { hostOk: isAlightHost });
    return parseShareLink(r.finalUrl) ?? (isHtml(r.text) ? findShareLinkInHtml(r.text) : null);
  } catch {
    return null;
  }
}

/** Unduh paket, pilih XML utama, dan susun daftar media + manifest (isi media diambil terpisah lewat /api/presets/asset). */
async function resolveSharePackage(ref: ShareRef, sourceUrl: string) {
  const pkg = await loadPackage(ref);
  const xmlEntries = pkg.entries
    .filter((e) => e.name.toLowerCase().endsWith('.xml') && !isJunkEntry(e.name))
    .sort((a, b) => b.size - a.size);
  if (!xmlEntries.length) {
    throw new ShareError('Paket share ini tidak berisi XML proyek.', 422, 'SHARE_NO_XML');
  }

  // XML terbesar yang benar-benar scene Alight Motion (paket bisa berisi XML lain).
  let main: (typeof xmlEntries)[number] | null = null;
  let text = '';
  let tooBig = false;
  for (const e of xmlEntries) {
    if (e.size > MAX_XML_BYTES) {
      tooBig = true;
      continue;
    }
    const t = zipExtract(pkg.buf, e, MAX_XML_BYTES).toString('utf8').replace(/^\uFEFF/, '');
    if (looksLikeXml(t)) {
      main = e;
      text = t;
      break;
    }
  }
  if (!main) {
    throw tooBig
      ? new ShareError('XML di dalam paket terlalu besar untuk dikirim lewat link (maks 4 MB). Ekspor XML-nya lalu pakai Upload dari perangkat.', 413, 'TOO_LARGE')
      : new ShareError('Paket dibuka, tapi tidak ada XML preset Alight Motion di dalamnya.', 422, 'SHARE_NO_XML');
  }

  let manifest = new Map<string, string>();
  const manifestEntry = entryByName(pkg.entries, 'manifest.txt');
  if (manifestEntry) manifest = parseManifest(zipExtract(pkg.buf, manifestEntry, 1024 * 1024).toString('utf8'));
  const shaByName = new Map<string, string>();
  for (const [sha, name] of manifest) shaByName.set(name.toLowerCase(), sha);

  const media = pkg.entries
    .filter((e) => !isJunkEntry(e.name) && isMediaName(e.name) && e.name !== main!.name)
    .map((e) => ({ filename: e.name, size: e.size, mime: mimeOfName(e.name), sha1: shaByName.get(e.name.toLowerCase()) }));

  return { text, name: main.name, sourceUrl, share: ref, media, zipSize: pkg.buf.length };
}

/* ───────── handler ───────── */

export async function POST(req: Request) {
  try {
    if (!rateLimit(`import:${clientIp(req)}`, 20, 60_000)) {
      return fail('Terlalu banyak permintaan. Coba lagi sebentar.', 429, 'RATE_LIMIT');
    }

    const body = (await req.json()) as { kind?: unknown; url?: unknown };
    const kind = body.kind;
    const url = typeof body.url === 'string' ? body.url.trim() : '';
    if (kind !== 'am' && kind !== 'drive') return fail('Jenis impor tidak valid.', 422, 'BAD_KIND');
    if (!url) return fail('Tempel link terlebih dahulu.', 422, 'EMPTY_URL');
    if (url.length > 2000) return fail('Link terlalu panjang.', 422, 'BAD_URL');

    const raw = extractUrl(url);
    let target: URL;
    try {
      target = new URL(raw);
    } catch {
      return fail('Format link tidak valid. Tempel link lengkap yang diawali https://', 422, 'BAD_URL');
    }
    if (!/^https?:$/.test(target.protocol)) return fail('Link harus diawali http:// atau https://.', 422, 'BAD_URL');

    if (kind === 'am') {
      if (/(^|\.)(drive|docs)\.google\.com$/i.test(target.hostname)) {
        return fail('Ini link Google Drive. Pakai opsi "Import Preset XML dari Google Drive".', 422, 'WRONG_SOURCE');
      }
      // Link share Alight Motion (alightcreative.com/am/share/u/…/p/… atau alight.link/…):
      // XML + daftar media diambil dari paket share-nya.
      const share = await shareRefOf(target);
      if (share) return ok(await resolveSharePackage(share, url));
      if (isAlightHost(target.hostname.toLowerCase())) {
        return fail(
          'Link Alight Motion ini bukan link share project yang dikenali. Pakai link dari Share → Copy Link di aplikasi (alightcreative.com/am/share/u/…/p/…).',
          422,
          'SHARE_UNREADABLE',
        );
      }
      const r = await fetchFollow(target.href);
      if (!r.text.trim()) return fail('Link ini tidak berisi data.', 422, 'EMPTY');
      if (!looksLikeXml(r.text)) {
        return fail(
          isHtml(r.text)
            ? 'Link ini membuka halaman web (kemungkinan hanya membuka aplikasi Alight Motion), bukan file XML. Ekspor preset sebagai XML lalu pakai Upload atau Google Drive.'
            : 'Isi link ini bukan XML preset Alight Motion.',
          422,
          'NOT_XML',
        );
      }
      return ok({ text: r.text, name: r.filename ?? 'preset.xml', sourceUrl: r.finalUrl });
    }

    // Google Drive
    if (/\/drive\/folders\//i.test(raw)) {
      return fail('Ini link folder. Bagikan link file XML-nya langsung.', 422, 'FOLDER');
    }
    const id = driveIdOf(raw);
    if (!id) {
      return fail('Bukan link Google Drive yang valid. Contoh: https://drive.google.com/file/d/ID/view', 422, 'BAD_URL');
    }
    const r = await fetchDrive(id);
    return ok({ text: r.text, name: r.filename ?? 'preset.xml', sourceUrl: `https://drive.google.com/file/d/${id}/view` });
  } catch (err) {
    return handleError(err);
  }
}
