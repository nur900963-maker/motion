import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { DATA_DIR_SETTING, MAX_UPLOAD_MB } from './config';

/**
 * Penyimpanan berbasis file JSON (tanpa database, tanpa layanan eksternal).
 *
 * Struktur folder data:
 *   meta.json              penghitung ID
 *   users.json             daftar akun
 *   media.json             metadata media            (byte: blobs/media-<id>)
 *   exports.json           metadata hasil ekspor     (byte: blobs/export-<id>)
 *   projects.json          indeks ringkas proyek
 *   projects/<id>.json     isi lengkap proyek (scene + xml)
 *
 * PENTING — Vercel:
 *   Filesystem fungsi Vercel hanya bisa ditulis di /tmp dan isinya HILANG saat
 *   cold start / antar-instance. Jadi di Vercel data ini bersifat SEMENTARA.
 *   Penyimpanan permanen hanya terjadi bila dijalankan di mesin dengan disk
 *   persisten (lokal / `next start`).
 */

export const ON_VERCEL = Boolean(process.env.VERCEL);
export const DATA_DIR = ON_VERCEL
  ? '/tmp/xmotion-data'
  : DATA_DIR_SETTING
    ? path.resolve(DATA_DIR_SETTING)
    : path.join(process.cwd(), 'data');
/** true bila data benar-benar bertahan setelah restart. */
export const PERSISTENT = !ON_VERCEL;

/** Vercel menolak body request > 4,5 MB sebelum sampai ke fungsi. */
const VERCEL_BODY_MB = 4;
const cfgUpload = MAX_UPLOAD_MB;
export const MAX_UPLOAD_BYTES =
  (ON_VERCEL ? Math.min(VERCEL_BODY_MB, cfgUpload) : cfgUpload) * 1024 * 1024;
export const MAX_EXPORT_BYTES = (ON_VERCEL ? VERCEL_BODY_MB : 200) * 1024 * 1024;

/* ───────────────────────── tipe ───────────────────────── */

export type UserRow = { id: number; email: string; name: string; passwordHash: string; createdAt: string };

export type ProjectSummary = {
  id: number;
  userId: number;
  name: string;
  sourceKind: string;
  updatedAt: string;
  layerCount: number;
  duration: number;
  width: number;
  height: number;
};

export type ProjectFull = {
  id: number;
  userId: number;
  name: string;
  sourceKind: string;
  sourceUrl: string | null;
  scene: unknown;
  xmlText: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MediaRow = {
  id: number;
  userId: number;
  projectId: number | null;
  name: string;
  mime: string;
  kind: string;
  size: number;
  createdAt: string;
};

export type ExportRow = {
  id: number;
  userId: number;
  projectId: number | null;
  status: string;
  preset: unknown;
  bytes: number | null;
  mime: string;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
};

type Meta = { users: number; projects: number; media: number; exports: number };

/* ───────────────────────── dasar file ───────────────────────── */

class StoreError extends Error {
  status = 503;
  code = 'STORAGE';
}

/** Antrian per-kunci: operasi baca-ubah-tulis pada file yang sama berjalan berurutan. */
const locks = new Map<string, Promise<unknown>>();
function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => undefined);
  locks.set(key, tail);
  void tail.then(() => {
    if (locks.get(key) === tail) locks.delete(key);
  });
  return run;
}

function abs(rel: string): string {
  const full = path.join(DATA_DIR, rel);
  if (!full.startsWith(DATA_DIR + path.sep) && full !== DATA_DIR) {
    throw new StoreError('Path penyimpanan tidak valid.');
  }
  return full;
}

function wrap(err: unknown): Error {
  const e = err as NodeJS.ErrnoException;
  if (e?.code === 'EROFS' || e?.code === 'EACCES' || e?.code === 'EPERM' || e?.code === 'ENOSPC') {
    const s = new StoreError(
      e.code === 'ENOSPC'
        ? 'Penyimpanan server penuh.'
        : 'Folder data server tidak bisa ditulis. Periksa izin folder DATA_DIR.',
    );
    console.error('[store]', e);
    return s;
  }
  return err as Error;
}

async function atomicWrite(rel: string, data: string | Buffer): Promise<void> {
  const target = abs(rel);
  const tmp = `${target}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, target);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw wrap(err);
  }
}

async function readJson<T>(rel: string, fallback: T): Promise<T> {
  let text: string;
  try {
    text = await fs.readFile(abs(rel), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw wrap(err);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    // Jangan di-reset diam-diam: itu akan menghapus semua data pengguna.
    console.error(`[store] ${rel} berisi JSON rusak.`);
    throw new StoreError(`File data ${rel} rusak. Perbaiki atau hapus manual, lalu coba lagi.`);
  }
}

async function writeJson(rel: string, value: unknown): Promise<void> {
  await atomicWrite(rel, JSON.stringify(value));
}

async function nextId(name: keyof Meta): Promise<number> {
  return withLock('meta', async () => {
    const meta = await readJson<Meta>('meta.json', { users: 0, projects: 0, media: 0, exports: 0 });
    meta[name] = (meta[name] ?? 0) + 1;
    await writeJson('meta.json', meta);
    return meta[name];
  });
}

const nowIso = () => new Date().toISOString();

/* ───────────────────────── users ───────────────────────── */

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const users = await readJson<UserRow[]>('users.json', []);
  return users.find((u) => u.email === email) ?? null;
}

export async function findUserById(id: number): Promise<UserRow | null> {
  const users = await readJson<UserRow[]>('users.json', []);
  return users.find((u) => u.id === id) ?? null;
}

/** Mengembalikan null bila email sudah terdaftar. */
export async function createUser(input: { email: string; name: string; passwordHash: string }): Promise<UserRow | null> {
  return withLock('users', async () => {
    const users = await readJson<UserRow[]>('users.json', []);
    if (users.some((u) => u.email === input.email)) return null;
    const row: UserRow = { id: await nextId('users'), ...input, createdAt: nowIso() };
    users.push(row);
    await writeJson('users.json', users);
    return row;
  });
}

/* ───────────────────────── projects ───────────────────────── */

type SceneLike = { layers?: unknown[]; duration?: number; width?: number; height?: number };

function summarize(p: Omit<ProjectFull, 'xmlText' | 'sourceUrl' | 'createdAt'>): ProjectSummary {
  const s = (p.scene ?? {}) as SceneLike;
  return {
    id: p.id,
    userId: p.userId,
    name: p.name,
    sourceKind: p.sourceKind,
    updatedAt: p.updatedAt,
    layerCount: Array.isArray(s.layers) ? s.layers.length : 0,
    duration: Number(s.duration) || 0,
    width: Number(s.width) || 0,
    height: Number(s.height) || 0,
  };
}

export async function listProjects(userId: number, limit = 100): Promise<ProjectSummary[]> {
  const all = await readJson<ProjectSummary[]>('projects.json', []);
  return all
    .filter((p) => p.userId === userId)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .slice(0, limit);
}

export async function getProject(id: number, userId: number): Promise<ProjectFull | null> {
  const p = await readJson<ProjectFull | null>(`projects/${id}.json`, null);
  return p && p.userId === userId ? p : null;
}

export async function createProject(input: {
  userId: number;
  name: string;
  sourceKind: string;
  sourceUrl: string | null;
  scene: unknown;
  xmlText: string | null;
}): Promise<number> {
  const id = await nextId('projects');
  const ts = nowIso();
  const full: ProjectFull = { id, createdAt: ts, updatedAt: ts, ...input };
  await writeJson(`projects/${id}.json`, full);
  await withLock('projects', async () => {
    const idx = await readJson<ProjectSummary[]>('projects.json', []);
    idx.push(summarize(full));
    await writeJson('projects.json', idx);
  });
  return id;
}

export async function updateProject(
  id: number,
  userId: number,
  patch: { name?: string; scene?: unknown },
): Promise<ProjectFull | null> {
  return withLock(`project:${id}`, async () => {
    const cur = await getProject(id, userId);
    if (!cur) return null;
    const next: ProjectFull = {
      ...cur,
      name: patch.name ?? cur.name,
      scene: patch.scene ?? cur.scene,
      updatedAt: nowIso(),
    };
    await writeJson(`projects/${id}.json`, next);
    await withLock('projects', async () => {
      const idx = await readJson<ProjectSummary[]>('projects.json', []);
      const i = idx.findIndex((p) => p.id === id);
      if (i >= 0) idx[i] = summarize(next);
      else idx.push(summarize(next));
      await writeJson('projects.json', idx);
    });
    return next;
  });
}

/** Hapus proyek; media & ekspor yang terkait dilepas (project_id → null), bukan ikut terhapus. */
export async function deleteProject(id: number, userId: number): Promise<boolean> {
  return withLock(`project:${id}`, async () => {
    const cur = await getProject(id, userId);
    if (!cur) return false;
    await fs.rm(abs(`projects/${id}.json`), { force: true });
    await withLock('projects', async () => {
      const idx = await readJson<ProjectSummary[]>('projects.json', []);
      await writeJson('projects.json', idx.filter((p) => p.id !== id));
    });
    await withLock('media', async () => {
      const rows = await readJson<MediaRow[]>('media.json', []);
      if (rows.some((m) => m.projectId === id)) {
        await writeJson('media.json', rows.map((m) => (m.projectId === id ? { ...m, projectId: null } : m)));
      }
    });
    await withLock('exports', async () => {
      const rows = await readJson<ExportRow[]>('exports.json', []);
      if (rows.some((x) => x.projectId === id)) {
        await writeJson('exports.json', rows.map((x) => (x.projectId === id ? { ...x, projectId: null } : x)));
      }
    });
    return true;
  });
}

/* ───────────────────────── media ───────────────────────── */

export async function listMedia(userId: number, projectId?: number | null, limit = 200): Promise<MediaRow[]> {
  const rows = await readJson<MediaRow[]>('media.json', []);
  return rows
    .filter((m) => m.userId === userId && (projectId == null || m.projectId === projectId))
    .sort((a, b) => b.id - a.id)
    .slice(0, limit);
}

export async function addMedia(
  meta: Omit<MediaRow, 'id' | 'createdAt'>,
  data: Buffer,
): Promise<MediaRow> {
  const id = await nextId('media');
  await atomicWrite(`blobs/media-${id}`, data);
  const row: MediaRow = { id, createdAt: nowIso(), ...meta };
  try {
    await withLock('media', async () => {
      const rows = await readJson<MediaRow[]>('media.json', []);
      rows.push(row);
      await writeJson('media.json', rows);
    });
  } catch (err) {
    await fs.rm(abs(`blobs/media-${id}`), { force: true }).catch(() => undefined);
    throw err;
  }
  return row;
}

export async function getMedia(id: number, userId: number): Promise<MediaRow | null> {
  const rows = await readJson<MediaRow[]>('media.json', []);
  return rows.find((m) => m.id === id && m.userId === userId) ?? null;
}

export async function readMediaBytes(id: number): Promise<Buffer | null> {
  try {
    return await fs.readFile(abs(`blobs/media-${id}`));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw wrap(err);
  }
}

export async function deleteMedia(id: number, userId: number): Promise<boolean> {
  const removed = await withLock('media', async () => {
    const rows = await readJson<MediaRow[]>('media.json', []);
    if (!rows.some((m) => m.id === id && m.userId === userId)) return false;
    await writeJson('media.json', rows.filter((m) => !(m.id === id && m.userId === userId)));
    return true;
  });
  if (removed) await fs.rm(abs(`blobs/media-${id}`), { force: true }).catch(() => undefined);
  return removed;
}

/* ───────────────────────── exports ───────────────────────── */

export async function listExports(userId: number, limit = 50): Promise<ExportRow[]> {
  const rows = await readJson<ExportRow[]>('exports.json', []);
  return rows
    .filter((x) => x.userId === userId)
    .sort((a, b) => b.id - a.id)
    .slice(0, limit);
}

export async function addExport(
  meta: Pick<ExportRow, 'userId' | 'projectId' | 'preset' | 'bytes' | 'mime'>,
  data: Buffer,
): Promise<ExportRow> {
  const id = await nextId('exports');
  await atomicWrite(`blobs/export-${id}`, data);
  const ts = nowIso();
  const row: ExportRow = { id, status: 'done', error: null, createdAt: ts, finishedAt: ts, ...meta };
  try {
    await withLock('exports', async () => {
      const rows = await readJson<ExportRow[]>('exports.json', []);
      rows.push(row);
      await writeJson('exports.json', rows);
    });
  } catch (err) {
    await fs.rm(abs(`blobs/export-${id}`), { force: true }).catch(() => undefined);
    throw err;
  }
  return row;
}

export async function getExport(id: number, userId: number): Promise<ExportRow | null> {
  const rows = await readJson<ExportRow[]>('exports.json', []);
  return rows.find((x) => x.id === id && x.userId === userId) ?? null;
}

export async function readExportBytes(id: number): Promise<Buffer | null> {
  try {
    return await fs.readFile(abs(`blobs/export-${id}`));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw wrap(err);
  }
}

export async function deleteExport(id: number, userId: number): Promise<boolean> {
  const removed = await withLock('exports', async () => {
    const rows = await readJson<ExportRow[]>('exports.json', []);
    if (!rows.some((x) => x.id === id && x.userId === userId)) return false;
    await writeJson('exports.json', rows.filter((x) => !(x.id === id && x.userId === userId)));
    return true;
  });
  if (removed) await fs.rm(abs(`blobs/export-${id}`), { force: true }).catch(() => undefined);
  return removed;
}

/* ───────────────────────── health ───────────────────────── */

export async function storageHealth(): Promise<{ ok: boolean; persistent: boolean; detail: string }> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const probe = `.probe-${randomBytes(4).toString('hex')}`;
    await fs.writeFile(path.join(DATA_DIR, probe), 'ok');
    await fs.rm(path.join(DATA_DIR, probe), { force: true });
    return {
      ok: true,
      persistent: PERSISTENT,
      detail: PERSISTENT ? `JSON di ${DATA_DIR}` : `JSON di ${DATA_DIR} (SEMENTARA: hilang saat cold start Vercel)`,
    };
  } catch (err) {
    return { ok: false, persistent: false, detail: `tidak bisa menulis: ${(err as Error).message.slice(0, 100)}` };
  }
}
