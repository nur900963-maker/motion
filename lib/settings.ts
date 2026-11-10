'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Setelan pengguna (disimpan di browser). Dibaca oleh Stage dan diubah dari modal Setelan.
 * Tidak ada server, tidak ada akun.
 */
export type QualityMode = 'auto' | 'high' | 'medium' | 'low' | 'saver';

export type Settings = {
  quality: QualityMode;
  /** batas fps preview; 'auto' mengikuti fps preset (maks 60) */
  fps: 'auto' | '60' | '30';
  effects: boolean;
  debug: boolean;
  safeArea: boolean;
};

export const DEFAULT_SETTINGS: Settings = { quality: 'auto', fps: 'auto', effects: true, debug: false, safeArea: false };

const KEY = 'xm:settings';
const EVENT = 'xm:settings-changed';

/** Tingkat kualitas preview: lebar render (px) dan jumlah sub-frame motion blur. */
export const TIERS = [
  { width: 720, motion: 4, label: 'Tinggi' },
  { width: 540, motion: 3, label: 'Sedang' },
  { width: 405, motion: 2, label: 'Rendah' },
  { width: 304, motion: 1, label: 'Hemat' },
  { width: 228, motion: 1, label: 'Sangat hemat' },
] as const;

export const FIXED_LEVEL: Record<Exclude<QualityMode, 'auto'>, number> = { high: 0, medium: 1, low: 2, saver: 3 };

let cache: Settings | null = null;

function read(): Settings {
  if (cache) return cache;
  let s = DEFAULT_SETTINGS;
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    if (raw) {
      const p = JSON.parse(raw) as Partial<Settings>;
      s = {
        quality: (['auto', 'high', 'medium', 'low', 'saver'] as const).includes(p.quality as QualityMode) ? (p.quality as QualityMode) : s.quality,
        fps: p.fps === '60' || p.fps === '30' ? p.fps : 'auto',
        effects: typeof p.effects === 'boolean' ? p.effects : s.effects,
        debug: typeof p.debug === 'boolean' ? p.debug : s.debug,
        safeArea: typeof p.safeArea === 'boolean' ? p.safeArea : s.safeArea,
      };
    }
  } catch {
    /* storage diblokir / JSON rusak: pakai bawaan */
  }
  cache = s;
  return s;
}

function write(next: Settings) {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* mode privat: setelan berlaku selama sesi saja */
  }
  window.dispatchEvent(new Event(EVENT));
}

const subscribe = (cb: () => void) => {
  window.addEventListener(EVENT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener('storage', cb);
  };
};

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const settings = useSyncExternalStore(subscribe, read, () => DEFAULT_SETTINGS);
  const update = useCallback((patch: Partial<Settings>) => write({ ...read(), ...patch }), []);
  return [settings, update];
}

/* ───────── kualitas adaptif ───────── */

/**
 * Mengatur level kualitas dari waktu antar-frame (selisih timestamp requestAnimationFrame).
 * Frame yang terus melewati anggaran → turunkan resolusi; stabil lama → naikkan perlahan.
 * Ada jeda antar perubahan agar tidak bolak-balik ("popping").
 */
export class AdaptiveQuality {
  level: number;
  private deltas: number[] = [];
  private lastChange = 0;
  private lastDegrade = 0;
  /** beberapa frame awal diabaikan: ada kompilasi shader & unggah tekstur */
  private warmup = 6;
  private started = false;

  constructor(start = 0) {
    this.level = start;
  }

  reset(level: number, now: number) {
    this.level = level;
    this.deltas = [];
    this.lastChange = now;
    this.warmup = 3;
  }

  /** Catat selisih waktu antar-frame; mengembalikan level baru bila berubah. */
  record(delta: number, budgetMs: number, now: number): number | null {
    if (delta <= 0) return null;
    if (!this.started) {
      // Jeda "naik kualitas" dihitung dari frame pertama, bukan dari waktu 0.
      this.started = true;
      this.lastChange = now;
      this.lastDegrade = now;
    }
    if (this.warmup > 0) {
      this.warmup -= 1;
      return null;
    }
    // Frame yang sangat lambat TETAP dihitung (perangkat lambat justru yang paling butuh turun kualitas),
    // hanya dibatasi agar satu lonjakan (seek, ganti tab) tidak mendominasi rata-rata.
    this.deltas.push(Math.min(delta, 600));
    if (this.deltas.length < 8) return null;
    if (this.deltas.length > 40) this.deltas.shift();
    // Median (bukan rata-rata): satu-dua lonjakan sesaat tidak menggeser hasilnya.
    const sorted = [...this.deltas].sort((a, b) => a - b);
    const avg = sorted[Math.floor(sorted.length / 2)];
    const maxLevel = TIERS.length - 1;

    if (avg > budgetMs * 1.35 && this.level < maxLevel && now - this.lastChange > 1200) {
      // Sangat lambat (>3× anggaran): lompat 2 tingkat supaya cepat pulih.
      this.level = Math.min(maxLevel, this.level + (avg > budgetMs * 3 ? 2 : 1));
      this.lastChange = now;
      this.lastDegrade = now;
      this.deltas = [];
      this.warmup = 2;
      return this.level;
    }
    if (avg < budgetMs * 1.08 && this.level > 0 && now - this.lastChange > 8000 && now - this.lastDegrade > 15000) {
      this.level -= 1;
      this.lastChange = now;
      this.deltas = [];
      this.warmup = 2;
      return this.level;
    }
    return null;
  }
}
