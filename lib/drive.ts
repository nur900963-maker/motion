/** Fungsi murni untuk impor link (Google Drive / link XML). Dipisah agar bisa diuji tanpa jaringan. */

export type Fetched = { status: number; text: string; finalUrl: string; filename: string | null };


export const isHtml = (t: string) => /^\s*(<!doctype html|<html)/i.test(t.slice(0, 300));
export const looksLikeXml = (t: string) => !isHtml(t) && /<scene[\s>]/i.test(t.slice(0, 4000));

export function extractUrl(raw: string): string {
  const m = raw.match(/https?:\/\/[^\s<>"']+/i);
  return m ? m[0] : raw.trim();
}

export function driveIdOf(value: string): string | null {
  const a = value.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (a) return a[1];
  const b = value.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (b) return b[1];
  return /^[a-zA-Z0-9_-]{20,60}$/.test(value.trim()) ? value.trim() : null;
}

/* ───────── Google Drive ───────── */

export type DriveProblem = 'login' | 'quota' | 'notfound' | 'interstitial' | 'other';

export function classifyDrive(r: Fetched): DriveProblem {
  const host = (() => {
    try {
      return new URL(r.finalUrl).hostname;
    } catch {
      return '';
    }
  })();
  if (r.status === 404) return 'notfound';
  if (host === 'accounts.google.com' || /accounts\.google\.com\/(v3\/)?(signin|ServiceLogin|AccountChooser)/i.test(r.text)) {
    return 'login';
  }
  if (/id="download-form"/i.test(r.text)) return 'interstitial';
  if (/too many users|download quota|quota exceeded/i.test(r.text)) return 'quota';
  if (r.status === 401 || r.status === 403) return 'login';
  return 'other';
}

export const DRIVE_MESSAGES: Record<Exclude<DriveProblem, 'interstitial'>, string> = {
  login:
    'File Drive ini belum publik. Buka file di Drive → Bagikan → Akses umum → pilih "Siapa saja yang memiliki link", lalu coba lagi.',
  quota:
    'Google sedang membatasi unduhan file ini (terlalu banyak unduhan). Coba lagi nanti, atau unduh manual lalu pakai Upload Preset XML.',
  notfound: 'File tidak ditemukan di Google Drive. Periksa kembali link-nya.',
  other:
    'Google Drive membalas dengan halaman web, bukan file XML. Kalau file sudah publik dan masih gagal, unduh dari Drive lalu pakai Upload Preset XML.',
};

/** Ambil bentuk form "download-form" (halaman peringatan Drive) menjadi URL GET. */
export function interstitialUrl(html: string): string | null {
  const form = /<form[^>]*id="download-form"[^>]*>([\s\S]*?)<\/form>/i.exec(html);
  if (!form) return null;
  const action = /action="([^"]+)"/i.exec(form[0])?.[1];
  if (!action) return null;
  const url = new URL(action.replace(/&amp;/g, '&'));
  for (const m of form[1].matchAll(/<input[^>]*type="hidden"[^>]*>/gi)) {
    const name = /name="([^"]*)"/i.exec(m[0])?.[1];
    const value = /value="([^"]*)"/i.exec(m[0])?.[1] ?? '';
    if (name) url.searchParams.set(name, value.replace(/&amp;/g, '&'));
  }
  return url.href;
}


/* ───────── link share Alight Motion ───────── */

export type ShareMeta = {
  title?: string;
  description?: string;
  image?: string;
  /** ukuran package dalam MB, bila tercantum di deskripsi ("total 8.4 MB") */
  sizeMb?: number;
};

/** Host halaman share resmi Alight Motion (alightcreative.com/am/share/..., alight.link/...). */
export const isAlightHost = (host: string) =>
  host === 'alightcreative.com' || host.endsWith('.alightcreative.com') || host === 'alight.link' || host.endsWith('.alight.link');

export const isAlightShareUrl = (u: URL) =>
  isAlightHost(u.hostname.toLowerCase()) && (u.hostname.toLowerCase().includes('alight.link') || /^\/am\/share\//i.test(u.pathname));

function decodeEntities(v: string): string {
  return v
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function metaContent(html: string, keys: string[]): string | undefined {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const key = /(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    if (!key || !keys.includes(key)) continue;
    const content = /content\s*=\s*"([^"]*)"|content\s*=\s*'([^']*)'/i.exec(tag);
    const v = content?.[1] ?? content?.[2];
    if (v && v.trim()) return decodeEntities(v.trim());
  }
  return undefined;
}

/** Baca metadata publik (Open Graph) dari halaman share. Tidak mengambil isi package. */
export function parseShareMeta(html: string): ShareMeta {
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const rawTitle = metaContent(html, ['og:title', 'twitter:title']) ?? (titleTag ? decodeEntities(titleTag.trim()) : undefined);
  const title = rawTitle?.replace(/\s*[-–|]\s*Alight Motion Project\s*$/i, '').trim() || undefined;
  const description = metaContent(html, ['og:description', 'twitter:description', 'description']);
  const image = metaContent(html, ['og:image', 'twitter:image']);
  const size = description ? /total\s+([\d.,]+)\s*(KB|MB|GB)/i.exec(description) : null;
  let sizeMb: number | undefined;
  if (size) {
    const n = Number(size[1].replace(',', '.'));
    if (Number.isFinite(n)) sizeMb = size[2].toUpperCase() === 'GB' ? n * 1024 : size[2].toUpperCase() === 'KB' ? n / 1024 : n;
  }
  return {
    title,
    description,
    image: image && /^https:\/\//i.test(image) ? image : undefined,
    sizeMb,
  };
}
