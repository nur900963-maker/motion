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
