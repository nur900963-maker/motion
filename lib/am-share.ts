/**
 * Dukungan link share Alight Motion (alightcreative.com/am/share/u/<user>/p/<package>,
 * termasuk bentuk lama alight.link/...). Dipakai server-side (route API).
 *
 * Cara kerja (dibuktikan dengan paket nyata):
 *  - Halaman share hanyalah HTML promosi. Data proyek disimpan di Firebase Storage:
 *      https://firebasestorage.googleapis.com/v0/b/alight-creative.appspot.com/o/
 *        share%2Fu%2F<user>%2Fp%2F<package>%2Fprojectfiles.zip?alt=media
 *  - ZIP itu berisi: <uuid>.xml (scene), file media asli (gambar/video/audio), dan
 *    manifest.txt berisi pemetaan "SHA1:namafile" per baris.
 *  - Referensi media di XML memakai prefiks "amproj:<namafile>" (XML dari paket) atau
 *    "am:<sha1>.<ext>" (XML hasil ekspor perangkat). Keduanya bisa dicocokkan ke isi ZIP
 *    lewat nama file / manifest.
 *
 * Pembaca ZIP ditulis manual (EOCD + central directory + inflateRaw) supaya tanpa
 * dependensi tambahan. Hanya membaca, tidak menulis.
 */

import { inflateRawSync } from 'node:zlib';

export type ShareRef = { user: string; package: string };

/** Ambil (user, package) dari link share AM; null bila bukan link share. */
export function parseShareLink(url: string): ShareRef | null {
  const m = /(?:alightcreative\.com|alight\.link)\/am\/share\/u\/([A-Za-z0-9_-]+)\/p\/([A-Za-z0-9_.-]+)/i.exec(url);
  return m ? { user: m[1], package: m[2] } : null;
}

/** Cari URL share AM di dalam teks HTML (meta og:url / link kanonik). */
export function findShareLinkInHtml(html: string): ShareRef | null {
  const m = html.match(/https?:\/\/(?:alightcreative\.com|alight\.link)\/am\/share\/u\/[A-Za-z0-9_-]+\/p\/[A-Za-z0-9_.-]+/i);
  return m ? parseShareLink(m[0]) : null;
}

/** Nama kandidat file paket di storage (dari yang paling umum). */
export const PACKAGE_FILENAMES = ['projectfiles.zip', 'projectFiles.zip', 'package.zip', 'project.zip'] as const;

export function storageUrl(ref: ShareRef, filename: string): string {
  const path = `share/u/${ref.user}/p/${ref.package}/${filename}`;
  return `https://firebasestorage.googleapis.com/v0/b/alight-creative.appspot.com/o/${encodeURIComponent(path)}?alt=media`;
}

export class ShareError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 422, code = 'SHARE_ERROR') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/* ───────── pembaca ZIP minimal (read-only) ───────── */

export type ZipEntry = {
  name: string;
  size: number;
  compressedSize: number;
  method: number;
  offset: number;
};

function eocd(buf: Buffer): number {
  // signature "PK\x05\x06"; komentar zip bisa sampai 64KB
  const start = Math.max(0, buf.length - 66 - 65536);
  for (let i = buf.length - 22; i >= start; i -= 1) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) return i;
  }
  throw new ShareError('Paket proyek bukan ZIP yang valid.', 422, 'BAD_ZIP');
}

export function zipDirectory(buf: Buffer): ZipEntry[] {
  const e = eocd(buf);
  const count = buf.readUInt16LE(e + 10);
  let ptr = buf.readUInt32LE(e + 16);
  const out: ZipEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    if (ptr + 46 > buf.length || buf.readUInt32LE(ptr) !== 0x02014b50) break;
    const method = buf.readUInt16LE(ptr + 10);
    const compressedSize = buf.readUInt32LE(ptr + 20);
    const size = buf.readUInt32LE(ptr + 24);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const offset = buf.readUInt32LE(ptr + 42);
    const name = buf.toString('utf8', ptr + 46, ptr + 46 + nameLen);
    out.push({ name, size, compressedSize, method, offset });
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** Ekstrak satu entri ZIP (method store/deflate). */
export function zipExtract(buf: Buffer, entry: ZipEntry): Buffer {
  if (entry.method !== 0 && entry.method !== 8) {
    throw new ShareError(`Format kompresi tidak didukung (metode ${entry.method}) untuk ${entry.name}.`, 422, 'BAD_ZIP');
  }
  const o = entry.offset;
  if (buf.readUInt32LE(o) !== 0x04034b50) throw new ShareError('Struktur ZIP rusak.', 422, 'BAD_ZIP');
  const nameLen = buf.readUInt16LE(o + 26);
  const extraLen = buf.readUInt16LE(o + 28);
  const dataStart = o + 30 + nameLen + extraLen;
  const raw = buf.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.method === 0) return Buffer.from(raw);
  try {
    return inflateRawSync(raw);
  } catch {
    throw new ShareError(`Isi file ${entry.name} tidak bisa didekompresi.`, 422, 'BAD_ZIP');
  }
}

const MEDIA_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
};

export const mimeOfName = (name: string): string => MEDIA_EXT[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
export const isMediaName = (name: string): boolean => Object.prototype.hasOwnProperty.call(MEDIA_EXT, name.split('.').pop()?.toLowerCase() ?? '');

/** Parse manifest.txt → Map<sha1, filename>. */
export function parseManifest(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i !== 40) continue;
    const sha = line.slice(0, i).trim();
    const name = line.slice(i + 1).trim();
    if (/^[0-9a-f]{40}$/i.test(sha) && name) map.set(sha.toLowerCase(), name);
  }
  return map;
}

const basename = (p: string): string => p.split('/').pop() ?? p;

/** Cocokkan referensi media XML ("amproj:nama", "am:sha.ext") ke nama entri ZIP. */
export function matchRefToZipName(ref: string, manifest: Map<string, string>, names: string[]): string | null {
  const lower = names.map((n) => n.toLowerCase());
  const find = (base: string): string | null => {
    const b = base.toLowerCase();
    const i = lower.indexOf(b);
    return i >= 0 ? names[i] : null;
  };
  if (ref.startsWith('amproj:')) {
    const wanted = decodeURIComponent(ref.slice(7));
    return find(wanted) ?? find(basename(wanted));
  }
  if (ref.startsWith('am:')) {
    const rest = ref.slice(3);
    const direct = find(rest);
    if (direct) return direct;
    const sha = basename(rest).replace(/\.[a-z0-9]+$/i, '').toLowerCase();
    const viaManifest = manifest.get(sha);
    if (viaManifest) return find(viaManifest) ?? find(basename(viaManifest));
  }
  return null;
}

/* ───────── unduhan & cache paket (server) ───────── */

type CacheItem = { buf: Buffer; at: number };
const CACHE_TTL = 15 * 60_000;
const CACHE_MAX = 3;
 
const store: Map<string, CacheItem> = ((globalThis as any).__amPackageCache ??= new Map<string, CacheItem>());

const UA = 'AlightMotion/6.2.53 (iOS; gzip)';

async function downloadToBuffer(url: string, maxBytes: number, timeoutMs: number): Promise<Buffer> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'user-agent': UA, accept: '*/*', 'accept-encoding': 'identity' },
      redirect: 'follow',
    });
    if (res.status === 404 || res.status === 403) throw new ShareError('Paket share tidak ditemukan atau sudah dihapus.', 404, 'SHARE_NOT_FOUND');
    if (!res.ok) throw new ShareError(`Storage Alight Motion membalas ${res.status}.`, 502, 'SHARE_STORAGE');
    const len = Number(res.headers.get('content-length') || 0);
    if (len > maxBytes) throw new ShareError('Paket proyek terlalu besar (maks 80 MB).', 413, 'TOO_LARGE');
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = res.body?.getReader();
    if (!reader) throw new ShareError('Storage tidak mengembalikan isi.', 502, 'SHARE_STORAGE');
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ShareError('Paket proyek terlalu besar (maks 80 MB).', 413, 'TOO_LARGE');
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks.map((c) => Buffer.from(c)));
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw new ShareError('Unduhan paket kehabisan waktu. Coba lagi.', 504, 'TIMEOUT');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export type LoadedPackage = { buf: Buffer; zipName: string; entries: ZipEntry[] };

/** Unduh projectfiles.zip (dengan nama cadangan); hasilnya di-cache in-memory. */
export async function loadPackage(ref: ShareRef, maxBytes = 80 * 1024 * 1024): Promise<LoadedPackage> {
  const key = `${ref.user}/${ref.package}`;
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return { buf: hit.buf, zipName: 'projectfiles.zip', entries: zipDirectory(hit.buf) };

  let lastErr: unknown = null;
  for (const name of PACKAGE_FILENAMES) {
    try {
      const buf = await downloadToBuffer(storageUrl(ref, name), maxBytes, 45_000);
      const entries = zipDirectory(buf); // validasi sebelum disimpan
      store.set(key, { buf, at: Date.now() });
      while (store.size > CACHE_MAX) {
        const oldest = [...store.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!oldest) break;
        store.delete(oldest[0]);
      }
      return { buf, zipName: name, entries };
    } catch (err) {
      lastErr = err;
      if (err instanceof ShareError && err.code === 'TOO_LARGE') throw err;
    }
  }
  if (lastErr instanceof ShareError) throw lastErr;
  throw new ShareError(
    'Paket proyek tidak bisa diambil dari Alight Motion. Pastikan link share masih aktif (buka di browser untuk cek).',
    404,
    'SHARE_NOT_FOUND',
  );
}

export function packageCachePeek(ref: ShareRef): boolean {
  const hit = store.get(`${ref.user}/${ref.package}`);
  return Boolean(hit && Date.now() - hit.at < CACHE_TTL);
}

/** Cari entri berdasar nama file (basename, tidak peka huruf besar/kecil). */
export function entryByName(entries: ZipEntry[], filename: string): ZipEntry | null {
  const want = basename(decodeURIComponent(filename)).toLowerCase();
  return entries.find((e) => basename(e.name).toLowerCase() === want) ?? null;
}
