/**
 * Dukungan link share Alight Motion (alightcreative.com/am/share/u/<user>/p/<package>,
 * termasuk bentuk pendek alight.link/...). Hanya dipakai di server (route API).
 *
 * Cara kerja:
 *  - Halaman share hanyalah HTML promosi. Data proyek ada di penyimpanan Alight Motion:
 *      https://firebasestorage.googleapis.com/v0/b/alight-creative.appspot.com/o/
 *        share%2Fu%2F<user>%2Fp%2F<package>%2Fprojectfiles.zip?alt=media
 *  - ZIP itu berisi: <uuid>.xml (scene), media asli (gambar/video/audio), dan manifest.txt
 *    berisi pemetaan "SHA1:namafile" per baris.
 *  - Referensi media di XML: "amproj:<namafile>" (XML dari paket) atau "am:<sha1>.<ext>"
 *    (XML hasil ekspor perangkat). Keduanya dicocokkan ke isi ZIP lewat nama file / manifest.
 *
 * Pembaca ZIP ditulis manual (EOCD + central directory + inflateRaw): tanpa dependensi, hanya
 * membaca, dan dibatasi ukurannya agar aman dari ZIP bomb.
 */

import { inflateRawSync } from 'node:zlib';

export type ShareRef = { user: string; package: string };

export class ShareError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 422, code = 'SHARE_ERROR') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/* ───────── batas ───────── */

export const MAX_PACKAGE_BYTES = 80 * 1024 * 1024; // paket (XML + media) yang diunduh server
export const MAX_XML_BYTES = 4 * 1024 * 1024; // XML yang dikirim ke browser (batas respons Vercel ±4,5 MB)
const MAX_ENTRY_BYTES = 96 * 1024 * 1024; // satu berkas setelah dekompresi
const DOWNLOAD_TIMEOUT_MS = 45_000;

/* ───────── link ───────── */

const SHARE_HOSTS = new Set(['alightcreative.com', 'www.alightcreative.com', 'alight.link', 'www.alight.link']);
const SHARE_PATH = /^\/am\/share\/u\/([A-Za-z0-9_-]+)\/p\/([A-Za-z0-9_-][A-Za-z0-9_.-]*)\/?$/;

/** Ambil (user, package) dari link share AM; null bila bukan link share. Host dicek persis. */
export function parseShareLink(url: string): ShareRef | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol) || !SHARE_HOSTS.has(u.hostname.toLowerCase())) return null;
  const m = SHARE_PATH.exec(u.pathname);
  return m ? { user: m[1], package: m[2] } : null;
}

/** Cari URL share AM di dalam teks HTML (meta og:url / link kanonik). */
export function findShareLinkInHtml(html: string): ShareRef | null {
  const m = /https?:\/\/(?:www\.)?(?:alightcreative\.com|alight\.link)\/am\/share\/u\/[A-Za-z0-9_-]+\/p\/[A-Za-z0-9_-][A-Za-z0-9_.-]*/i.exec(html);
  return m ? parseShareLink(m[0]) : null;
}

/** Nama kandidat berkas paket di storage (dari yang paling umum). */
export const PACKAGE_FILENAMES = ['projectfiles.zip', 'projectFiles.zip', 'package.zip', 'project.zip'] as const;

export function storageUrl(ref: ShareRef, filename: string): string {
  const path = `share/u/${ref.user}/p/${ref.package}/${filename}`;
  return `https://firebasestorage.googleapis.com/v0/b/alight-creative.appspot.com/o/${encodeURIComponent(path)}?alt=media`;
}

/* ───────── pembaca ZIP minimal (read-only) ───────── */

export type ZipEntry = {
  name: string;
  size: number;
  compressedSize: number;
  method: number;
  offset: number;
};

const badZip = (msg = 'Paket proyek bukan ZIP yang valid.') => new ShareError(msg, 422, 'BAD_ZIP');

function findEocd(buf: Buffer): number {
  // signature "PK\x05\x06"; komentar zip bisa sampai 64 KB
  const start = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= start; i -= 1) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) return i;
  }
  throw badZip();
}

export function zipDirectory(buf: Buffer): ZipEntry[] {
  if (buf.length < 22) throw badZip();
  const e = findEocd(buf);
  const count = buf.readUInt16LE(e + 10);
  let ptr = buf.readUInt32LE(e + 16);
  if (count === 0xffff || ptr === 0xffffffff) throw badZip('Paket terlalu besar (ZIP64) dan tidak didukung.');
  const out: ZipEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    if (ptr + 46 > buf.length || buf.readUInt32LE(ptr) !== 0x02014b50) throw badZip('Daftar isi paket rusak.');
    const method = buf.readUInt16LE(ptr + 10);
    const compressedSize = buf.readUInt32LE(ptr + 20);
    const size = buf.readUInt32LE(ptr + 24);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const offset = buf.readUInt32LE(ptr + 42);
    if (ptr + 46 + nameLen > buf.length) throw badZip('Daftar isi paket rusak.');
    out.push({ name: buf.toString('utf8', ptr + 46, ptr + 46 + nameLen), size, compressedSize, method, offset });
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** Ekstrak satu entri ZIP (store/deflate), dengan batas ukuran hasil. */
export function zipExtract(buf: Buffer, entry: ZipEntry, maxBytes = MAX_ENTRY_BYTES): Buffer {
  if (entry.method !== 0 && entry.method !== 8) {
    throw badZip(`Format kompresi tidak didukung (metode ${entry.method}) untuk ${entry.name}.`);
  }
  if (entry.size > maxBytes) throw new ShareError(`File ${entry.name} terlalu besar untuk diproses.`, 413, 'TOO_LARGE');
  const o = entry.offset;
  if (o + 30 > buf.length || buf.readUInt32LE(o) !== 0x04034b50) throw badZip('Struktur ZIP rusak.');
  const dataStart = o + 30 + buf.readUInt16LE(o + 26) + buf.readUInt16LE(o + 28);
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > buf.length) throw badZip('Paket terpotong (unduhan tidak lengkap).');
  const raw = buf.subarray(dataStart, dataEnd);
  if (entry.method === 0) return Buffer.from(raw);
  try {
    return inflateRawSync(raw, { maxOutputLength: maxBytes });
  } catch {
    throw badZip(`Isi file ${entry.name} tidak bisa didekompresi.`);
  }
}

/* ───────── media & manifest ───────── */

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

const extOf = (name: string): string => name.split('.').pop()?.toLowerCase() ?? '';
export const mimeOfName = (name: string): string => MEDIA_EXT[extOf(name)] ?? 'application/octet-stream';
export const isMediaName = (name: string): boolean => Object.prototype.hasOwnProperty.call(MEDIA_EXT, extOf(name));
export const isJunkEntry = (name: string): boolean => name.endsWith('/') || name.startsWith('__MACOSX') || name.split('/').pop()!.startsWith('._');

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

/** Cari entri berdasar nama file (basename, tidak peka huruf besar/kecil). */
export function entryByName(entries: ZipEntry[], filename: string): ZipEntry | null {
  let want: string;
  try {
    want = basename(decodeURIComponent(filename)).toLowerCase();
  } catch {
    want = basename(filename).toLowerCase();
  }
  return entries.find((e) => basename(e.name).toLowerCase() === want) ?? null;
}

/** Cocokkan referensi media XML ("amproj:nama", "am:sha.ext") ke nama entri ZIP. */
export function matchRefToZipName(ref: string, manifest: Map<string, string>, names: string[]): string | null {
  const lower = names.map((n) => n.toLowerCase());
  const find = (base: string): string | null => {
    const i = lower.indexOf(base.toLowerCase());
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

export type LoadedPackage = { buf: Buffer; zipName: string; entries: ZipEntry[] };

type CacheItem = LoadedPackage & { at: number };
const CACHE_TTL = 15 * 60_000;
const CACHE_MAX = 3;

// Cache & unduhan yang sedang berjalan hidup di globalThis supaya bertahan antar hot-reload / permintaan
// di instance yang sama. Instance serverless lain punya cache sendiri — itu wajar.
const g = globalThis as unknown as { __amPkgCache?: Map<string, CacheItem>; __amPkgInflight?: Map<string, Promise<LoadedPackage>> };
const store = (g.__amPkgCache ??= new Map<string, CacheItem>());
const inflight = (g.__amPkgInflight ??= new Map<string, Promise<LoadedPackage>>());

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
    if (res.status === 404 || res.status === 403) {
      throw new ShareError('Paket share tidak ditemukan atau sudah dihapus.', 404, 'SHARE_NOT_FOUND');
    }
    if (!res.ok) throw new ShareError(`Storage Alight Motion membalas ${res.status}.`, 502, 'SHARE_STORAGE');
    const tooLarge = () => new ShareError(`Paket proyek terlalu besar (maks ${Math.round(maxBytes / 1048576)} MB).`, 413, 'TOO_LARGE');
    if (Number(res.headers.get('content-length') || 0) > maxBytes) {
      await res.body?.cancel().catch(() => undefined);
      throw tooLarge();
    }
    const reader = res.body?.getReader();
    if (!reader) throw new ShareError('Storage tidak mengembalikan isi.', 502, 'SHARE_STORAGE');
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw tooLarge();
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, total);
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw new ShareError('Unduhan paket kehabisan waktu. Coba lagi.', 504, 'TIMEOUT');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPackage(ref: ShareRef, key: string, maxBytes: number): Promise<LoadedPackage> {
  let lastErr: unknown = null;
  for (const name of PACKAGE_FILENAMES) {
    try {
      const buf = await downloadToBuffer(storageUrl(ref, name), maxBytes, DOWNLOAD_TIMEOUT_MS);
      const entries = zipDirectory(buf); // validasi sebelum disimpan
      store.set(key, { buf, zipName: name, entries, at: Date.now() });
      while (store.size > CACHE_MAX) {
        const oldest = [...store.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!oldest) break;
        store.delete(oldest[0]);
      }
      return { buf, zipName: name, entries };
    } catch (err) {
      lastErr = err;
      // Hanya "tidak ada" yang layak dicoba dengan nama lain; masalah lain akan sama untuk semua nama.
      if (!(err instanceof ShareError && err.code === 'SHARE_NOT_FOUND')) throw err;
    }
  }
  if (lastErr instanceof ShareError) throw lastErr;
  throw new ShareError(
    'Paket proyek tidak bisa diambil dari Alight Motion. Pastikan link share masih aktif (buka di browser untuk cek).',
    404,
    'SHARE_NOT_FOUND',
  );
}

/**
 * Unduh paket share (cache in-memory 15 menit). Permintaan bersamaan untuk paket yang sama memakai
 * satu unduhan saja — penting karena browser meminta banyak media berurutan dari paket yang sama.
 */
export async function loadPackage(ref: ShareRef, maxBytes = MAX_PACKAGE_BYTES): Promise<LoadedPackage> {
  const key = `${ref.user}/${ref.package}`;
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return { buf: hit.buf, zipName: hit.zipName, entries: hit.entries };

  const running = inflight.get(key);
  if (running) return running;

  const job = fetchPackage(ref, key, maxBytes).finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}
