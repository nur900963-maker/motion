'use client';

/** Batas nyata server (diisi dari /api/auth/me); Infinity = belum diketahui. */
export const serverLimits = { uploadBytes: Infinity, exportBytes: Infinity };

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;
  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: {
        ...(init?.body instanceof FormData ? {} : { 'content-type': 'application/json' }),
        ...(init?.headers || {}),
      },
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError('Tidak bisa menghubungi server. Periksa koneksi internet kamu.', 0, 'NETWORK');
  }

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* bukan JSON */
  }

  if (!res.ok) {
    const d = data as { error?: string; code?: string; details?: unknown } | null;
    if (res.status === 413 && !d?.error) {
      throw new ApiError('File terlalu besar untuk dikirim ke server (batas Vercel ±4,5 MB).', 413, 'TOO_LARGE');
    }
    throw new ApiError(d?.error || `Server membalas ${res.status}. Coba lagi nanti.`, res.status, d?.code, d?.details);
  }
  return data as T;
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error(`${file.name} tidak bisa dibaca. Coba pilih ulang file-nya.`));
    reader.readAsText(file);
  });
}

export function isWellFormedXml(text: string): boolean {
  if (typeof window === 'undefined') return true;
  const parse = (src: string) => {
    const doc = new DOMParser().parseFromString(src, 'application/xml');
    return !doc.querySelector('parsererror');
  };
  if (parse(text)) return true;
  const body = text
    .replace(/^\uFEFF/, '')
    .replace(/<\?xml[^>]*\?>/i, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  return parse(`<xm-fragment>${body}</xm-fragment>`);
}
