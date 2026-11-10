import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyDrive, driveIdOf, extractUrl, interstitialUrl, isHtml, looksLikeXml } from '../lib/drive.ts';

test('ID file diambil dari berbagai bentuk link Drive (termasuk link dari pengguna)', () => {
  assert.equal(driveIdOf('https://drive.google.com/file/d/11p9jBMhFyV7xUd0EOcygHmbB4hWW8oeW/view?pli=1'), '11p9jBMhFyV7xUd0EOcygHmbB4hWW8oeW');
  assert.equal(driveIdOf('https://drive.google.com/open?id=ABCdef123_-xyz'), 'ABCdef123_-xyz');
  assert.equal(driveIdOf('https://drive.google.com/uc?export=download&id=ABCdef123_-xyz'), 'ABCdef123_-xyz');
  assert.equal(driveIdOf('https://drive.google.com/'), null);
  assert.equal(driveIdOf('halo'), null);
});

test('extractUrl mengambil URL dari teks yang ditempel bersama kata lain', () => {
  assert.equal(extractUrl('preset ku nih https://drive.google.com/file/d/abc/view?pli=1 pake ya'), 'https://drive.google.com/file/d/abc/view?pli=1');
});

test('deteksi XML vs HTML', () => {
  assert.equal(looksLikeXml("<?xml version='1.0'?>\n<scene title='a' width='1'>"), true);
  assert.equal(looksLikeXml('<!DOCTYPE html><html><body><scene></scene></body></html>'), false);
  assert.equal(isHtml('  <html lang="en">'), true);
});

const r = (over) => ({ status: 200, text: '', finalUrl: 'https://drive.usercontent.google.com/download?id=x', filename: null, ...over });

test('klasifikasi respons Drive: belum publik (redirect ke login)', () => {
  assert.equal(classifyDrive(r({ finalUrl: 'https://accounts.google.com/v3/signin/identifier?x=1', text: '<html>Sign in</html>' })), 'login');
  assert.equal(classifyDrive(r({ status: 403, text: '<html>forbidden</html>' })), 'login');
});

test('klasifikasi respons Drive: tidak ditemukan, kuota, lain-lain', () => {
  assert.equal(classifyDrive(r({ status: 404, text: '<html>not found</html>' })), 'notfound');
  assert.equal(classifyDrive(r({ text: '<html>Sorry, you can\'t view or download this file at this time. Too many users have viewed or downloaded this file recently.</html>' })), 'quota');
  assert.equal(classifyDrive(r({ text: '<html><body>halaman apa saja</body></html>' })), 'other');
});

test('halaman peringatan Drive (download-form) diubah jadi URL unduhan dengan semua field', () => {
  const html = `<html><body><form id="download-form" action="https://drive.usercontent.google.com/download" method="get">
    <input type="submit" id="uc-download-link" value="Download anyway">
    <input type="hidden" name="id" value="FILE123">
    <input type="hidden" name="export" value="download">
    <input type="hidden" name="confirm" value="t">
    <input type="hidden" name="uuid" value="u-u-i-d&amp;x">
  </form></body></html>`;
  assert.equal(classifyDrive(r({ text: html })), 'interstitial');
  const u = new URL(interstitialUrl(html));
  assert.equal(u.origin + u.pathname, 'https://drive.usercontent.google.com/download');
  assert.equal(u.searchParams.get('id'), 'FILE123');
  assert.equal(u.searchParams.get('confirm'), 't');
  assert.equal(u.searchParams.get('uuid'), 'u-u-i-d&x');
  assert.equal(interstitialUrl('<html>tidak ada form</html>'), null);
});

import { parseShareMeta, isAlightShareUrl, isAlightHost } from '../lib/drive.ts';

test('link share Alight Motion dikenali (termasuk link dari pengguna)', () => {
  assert.equal(isAlightShareUrl(new URL('https://alightcreative.com/am/share/u/Dk2xXsySGSURpwqmRkuhiZdR5cz1/p/IxLDKMNwkp-1a9dddbb292a5f59')), true);
  assert.equal(isAlightShareUrl(new URL('https://alight.link/abc123')), true);
  assert.equal(isAlightShareUrl(new URL('https://alightcreative.com/pricing')), false);
  assert.equal(isAlightShareUrl(new URL('https://evil.com/am/share/x')), false);
  assert.equal(isAlightShareUrl(new URL('https://alightcreative.com.evil.com/am/share/x')), false);
  assert.equal(isAlightHost('notalightcreative.com'), false);
});

test('metadata halaman share dibaca: judul, ukuran, thumbnail; entitas didecode', () => {
  const html = `<html><head><title>&#120293;x || 198 - Alight Motion Project</title>
    <meta property="og:title" content="Renprst &amp;&#x7C;| 198 - Alight Motion Project" />
    <meta content='This Alight Motion package contains 1 project, total 8.4 MB.' property='og:description'>
    <meta property="og:image" content="https://firebasestorage.googleapis.com/v0/b/alight-creative.appspot.com/o/share%2Fu%2FU%2Fp%2FP%2Fthumb-small.jpg?alt=media&amp;token=abc">
    </head><body></body></html>`;
  const m = parseShareMeta(html);
  assert.equal(m.title, 'Renprst &|| 198');
  assert.equal(m.sizeMb, 8.4);
  assert.match(m.description, /1 project/);
  assert.ok(m.image.startsWith('https://firebasestorage.googleapis.com/'));
  assert.ok(m.image.includes('alt=media&token=abc'));
});

test('metadata: fallback ke <title>, gambar non-https ditolak, halaman kosong → tanpa data', () => {
  assert.equal(parseShareMeta('<title>Judul Saja - Alight Motion Project</title>').title, 'Judul Saja');
  assert.equal(parseShareMeta('<meta property="og:image" content="http://x.com/a.jpg">').image, undefined);
  const empty = parseShareMeta('<html><body>hai</body></html>');
  assert.deepEqual([empty.title, empty.description, empty.image], [undefined, undefined, undefined]);
});

test('ukuran dalam KB/GB dikonversi ke MB', () => {
  assert.equal(parseShareMeta('<meta property="og:description" content="total 512 KB">').sizeMb, 0.5);
  assert.equal(parseShareMeta('<meta property="og:description" content="total 1.5 GB">').sizeMb, 1536);
});

import { readFileSync } from 'node:fs';
test('.vercelignore tidak membuang app/docs (pola harus dikunci ke root)', () => {
  const lines = readFileSync(new URL('../.vercelignore', import.meta.url), 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
  for (const bad of ['docs', 'tests', 'data']) {
    assert.ok(!lines.includes(bad), `pola "${bad}" tanpa garis miring depan akan ikut membuang folder bernama sama di mana pun (mis. app/docs)`);
  }
  assert.ok(lines.includes('/docs'));
});
