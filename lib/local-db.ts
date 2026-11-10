import type { LocalProject, MediaItem, Scene } from './types';

/**
 * Penyimpanan di BROWSER (IndexedDB) — proyek dan media milik perangkat pengguna.
 * Tidak ada akun, tidak ada server, tidak ada env. Data tidak ikut pindah antar perangkat
 * dan hilang bila pengguna menghapus data situs di browser.
 */

const DB_NAME = 'xmotion';
const DB_VERSION = 1;

type StoredMedia = {
  id: number;
  projectId: number | null;
  name: string;
  mime: string;
  kind: MediaItem['kind'];
  size: number;
  blob: Blob;
};

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('Browser ini tidak mendukung penyimpanan lokal (IndexedDB).'));
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id', autoIncrement: true });
        if (!db.objectStoreNames.contains('media')) {
          const s = db.createObjectStore('media', { keyPath: 'id', autoIncrement: true });
          s.createIndex('projectId', 'projectId');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        dbPromise = null;
        reject(req.error ?? new Error('Gagal membuka penyimpanan lokal.'));
      };
      req.onblocked = () => reject(new Error('Penyimpanan lokal sedang dipakai tab lain. Tutup tab lain lalu coba lagi.'));
    });
  }
  return dbPromise;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Operasi penyimpanan gagal.'));
  });
}

async function tx(store: 'projects' | 'media', mode: IDBTransactionMode) {
  const db = await open();
  const t = db.transaction(store, mode);
  const done = new Promise<void>((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error ?? new Error('Transaksi penyimpanan gagal.'));
    t.onabort = () => reject(t.error ?? new Error('Penyimpanan penuh atau dibatalkan oleh browser.'));
  });
  return { store: t.objectStore(store), done };
}

/* ───────── proyek ───────── */

export async function listProjects(): Promise<LocalProject[]> {
  const { store } = await tx('projects', 'readonly');
  const all = (await wrap(store.getAll())) as LocalProject[];
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getProject(id: number): Promise<LocalProject | null> {
  const { store } = await tx('projects', 'readonly');
  return ((await wrap(store.get(id))) as LocalProject | undefined) ?? null;
}

/** Simpan proyek baru (id kosong) atau perbarui; mengembalikan id. */
export async function saveProject(p: {
  id?: number | null;
  name: string;
  scene: Scene;
  xmlText: string | null;
  sourceUrl: string | null;
}): Promise<number> {
  const { store, done } = await tx('projects', 'readwrite');
  const rec: Omit<LocalProject, 'id'> & { id?: number } = {
    name: p.name,
    scene: p.scene,
    xmlText: p.xmlText,
    sourceUrl: p.sourceUrl,
    updatedAt: Date.now(),
  };
  if (p.id) rec.id = p.id;
  const id = Number(await wrap(store.put(rec)));
  await done;
  return id;
}

export async function deleteProject(id: number): Promise<void> {
  const media = await listMedia(id);
  const { store, done } = await tx('projects', 'readwrite');
  store.delete(id);
  await done;
  for (const m of media) await deleteMedia(m.id);
}

/* ───────── media ───────── */

function kindOf(mime: string): MediaItem['kind'] {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'other';
}

function toItem(m: StoredMedia): MediaItem {
  return {
    id: m.id,
    name: m.name,
    mime: m.mime,
    kind: m.kind,
    size: m.size,
    url: URL.createObjectURL(m.blob),
    projectId: m.projectId,
  };
}

export async function addMedia(file: File, projectId: number | null): Promise<MediaItem> {
  const { store, done } = await tx('media', 'readwrite');
  const rec: Omit<StoredMedia, 'id'> = {
    projectId,
    name: file.name.slice(0, 200),
    mime: file.type || 'application/octet-stream',
    kind: kindOf(file.type || ''),
    size: file.size,
    blob: file,
  };
  const id = Number(await wrap(store.add(rec)));
  await done;
  return toItem({ ...rec, id });
}

export async function listMedia(projectId: number): Promise<MediaItem[]> {
  const { store } = await tx('media', 'readonly');
  const all = (await wrap(store.index('projectId').getAll(projectId))) as StoredMedia[];
  return all.sort((a, b) => a.id - b.id).map(toItem);
}

/** Hubungkan media yang diunggah sebelum proyek disimpan ke proyek yang baru dibuat. */
export async function attachMedia(ids: number[], projectId: number): Promise<void> {
  for (const id of ids) {
    const { store, done } = await tx('media', 'readwrite');
    const cur = (await wrap(store.get(id))) as StoredMedia | undefined;
    if (cur) store.put({ ...cur, projectId });
    await done;
  }
}

export async function deleteMedia(id: number): Promise<void> {
  const { store, done } = await tx('media', 'readwrite');
  store.delete(id);
  await done;
}

/* ───────── serah-terima landing → player (tanpa server, tanpa sessionStorage 5 MB) ───────── */

export type Pending = { scene: Scene; xmlText: string | null; sourceUrl: string | null };
let pending: Pending | null = null;
export const setPending = (p: Pending) => {
  pending = p;
};
export const takePending = (): Pending | null => {
  const p = pending;
  pending = null;
  return p;
};
