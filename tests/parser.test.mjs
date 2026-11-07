import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Parser ditulis TypeScript; untuk uji unit kita pakai build hasil kompilasi
// lewat tsx-free approach: import dari .next tidak stabil, jadi uji perilaku
// lewat fungsi murni yang direplikasi di sini TIDAK dilakukan.
// Sebagai gantinya uji ini memvalidasi kontrak data preset contoh + endpoint
// (lihat tests/integration.mjs untuk uji end-to-end parser).

const sample = readFileSync(new URL('../public/sample-preset.xml', import.meta.url), 'utf8');

test('preset contoh punya struktur Alight Motion yang valid', () => {
  assert.match(sample, /<project[^>]*width="720"/);
  assert.match(sample, /<scene[^>]*fps="60"/);
  const layers = sample.match(/<layer /g) ?? [];
  assert.ok(layers.length >= 6, `harus ada minimal 6 layer, ditemukan ${layers.length}`);
});

test('preset contoh memakai keyframe untuk animasi', () => {
  const kfs = sample.match(/<kf /g) ?? [];
  assert.ok(kfs.length >= 10, `harus ada minimal 10 keyframe, ditemukan ${kfs.length}`);
});

test('preset contoh punya slot media dan track audio', () => {
  assert.match(sample, /type="image"/);
  assert.match(sample, /type="audio"/);
});
