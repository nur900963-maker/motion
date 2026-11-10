import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveQuality, TIERS, FIXED_LEVEL } from '../lib/settings.ts';

const feed = (q, delta, n, t0, budget = 1000 / 60) => {
  let now = t0, changed = null;
  for (let i = 0; i < n; i++) { now += delta; const r = q.record(delta, budget, now); if (r !== null) changed = r; }
  return { now, changed };
};

test('frame stabil sesuai anggaran → kualitas tidak berubah', () => {
  const q = new AdaptiveQuality(0);
  const { changed } = feed(q, 16.7, 200, 0);
  assert.equal(changed, null);
  assert.equal(q.level, 0);
});

test('frame lambat → kualitas turun', () => {
  const q = new AdaptiveQuality(0);
  const { changed } = feed(q, 40, 60, 10000);
  assert.ok(changed !== null && changed >= 1);
});

test('perangkat sangat lambat (1 fps) TETAP turun, dan melompat 2 tingkat', () => {
  const q = new AdaptiveQuality(0);
  const { changed } = feed(q, 1000, 20, 0);
  assert.equal(changed, 2);
});

test('lonjakan sesaat (seek) tidak menurunkan kualitas', () => {
  const q = new AdaptiveQuality(0);
  let now = 0;
  for (let i = 0; i < 40; i++) { now += 16.7; q.record(16.7, 16.7, now); }
  now += 900; const r = q.record(900, 16.7, now);
  for (let i = 0; i < 40; i++) { now += 16.7; q.record(16.7, 16.7, now); }
  assert.equal(r, null);
  assert.equal(q.level, 0);
});

test('tidak melewati level terendah', () => {
  const q = new AdaptiveQuality(0);
  feed(q, 1000, 400, 0);
  assert.equal(q.level, TIERS.length - 1);
});

test('stabil lama → naik pelan-pelan (dengan jeda), bukan langsung', () => {
  const q = new AdaptiveQuality(2);
  const first = feed(q, 16.7, 300, 100000); // ±5 dtk sejak frame pertama: belum boleh naik
  assert.equal(first.changed, null);
  const later = feed(q, 16.7, 2000, first.now); // ±38 dtk: boleh naik 1 tingkat
  assert.ok(later.changed !== null && q.level < 2, `level=${q.level}`);
  assert.ok(q.level >= 0);
});

test('level tetap: kualitas manual memetakan ke tier yang benar', () => {
  assert.deepEqual([FIXED_LEVEL.high, FIXED_LEVEL.medium, FIXED_LEVEL.low, FIXED_LEVEL.saver], [0, 1, 2, 3]);
  assert.equal(TIERS[0].width, 720);
});
