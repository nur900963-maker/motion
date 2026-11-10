import type { Layer, MediaItem, Scene } from './types';

/**
 * Pencocokan otomatis media ↔ slot preset.
 *
 * Referensi media di XML Alight Motion:
 *   - "amproj:<namafile>"      → file dengan nama itu di paket share
 *   - "am:<sha1>.<ext>"        → nama hash perangkat pembuat (dari ekspor XML)
 *   - "content://..."          → media perangkat pengguna (tidak bisa dicocokkan)
 *
 * Pencocokan memakai nama file: referensi "am:75B85E94….mp4" cocok dengan media galeri
 * bernama "75B85E94….mp4" ATAU nama aslinya lewat peta manifest sha1→namafile dari paket.
 * Semua pembandingan tidak peka huruf besar/kecil.
 */

const refOf = (l: Layer): string | null => l.raw.fillImage ?? l.raw.fillVideo ?? l.raw.fillAudio ?? l.raw.src ?? null;

const basename = (p: string): string => decodeURIComponent(p.split('/').pop() ?? p).toLowerCase();

/** mediaRef berprefiks AM/content berarti slot BELUM terisi media galeri (hanya ref mentah parser). */
const isRawRef = (mediaRef: string | null | undefined): boolean =>
  !mediaRef || mediaRef.startsWith('am:') || mediaRef.startsWith('amproj:') || mediaRef.startsWith('content://');

export type BindResult = { scene: Scene; matched: number; missed: string[] };

/**
 * Pasang media galeri ke semua slot yang merujuknya. manifest opsional: Map sha1 → nama asli.
 * Slot yang sudah dipasangi media galeri lain (mediaRef bukan prefiks am/amproj) dibiarkan.
 */
export function autoBindMedia(scene: Scene, items: MediaItem[], manifest?: Map<string, string>): BindResult {
  const byName = new Map<string, MediaItem>();
  for (const m of items) {
    byName.set(m.name.toLowerCase(), m);
    byName.set(basename(m.name), m);
  }
  const resolve = (ref: string): MediaItem | null => {
    let wanted: string | null = null;
    if (ref.startsWith('amproj:')) wanted = ref.slice(7);
    else if (ref.startsWith('am:')) {
      const rest = ref.slice(3);
      wanted = rest;
      if (!byName.has(basename(rest))) {
        const sha = basename(rest).replace(/\.[a-z0-9]+$/i, '');
        const viaManifest = manifest?.get(sha.toLowerCase());
        if (viaManifest) wanted = viaManifest;
      }
    } else return null;
    if (!wanted) return null;
    return byName.get(basename(wanted)) ?? byName.get(wanted.toLowerCase()) ?? null;
  };

  let matched = 0;
  const missed: string[] = [];
  const walk = (layers: Layer[]): Layer[] =>
    layers.map((l) => {
      const children = l.children.length ? { ...l, children: walk(l.children) } : l;
      const ref = refOf(l);
      if (!ref || !isRawRef(l.mediaRef)) return children; // sudah dipasangi media galeri manual
      const item = resolve(ref);
      if (item) {
        matched += 1;
        return { ...children, mediaRef: String(item.id) };
      }
      if (ref.startsWith('am:') || ref.startsWith('amproj:')) missed.push(ref);
      return children;
    });

  const layers = walk(scene.layers);
  return { scene: { ...scene, layers }, matched, missed };
}
