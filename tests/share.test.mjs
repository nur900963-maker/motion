import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import {
  entryByName,
  findShareLinkInHtml,
  isJunkEntry,
  isMediaName,
  matchRefToZipName,
  mimeOfName,
  parseManifest,
  parseShareLink,
  ShareError,
  storageUrl,
  zipDirectory,
  zipExtract,
} from '../lib/am-share.ts';
import { autoBindMedia } from '../lib/bind.ts';

/* ───────── pembuat ZIP kecil untuk fixture (store=0 / deflate=8) ───────── */

function crc32(buf) {
  let c;
  const table = (crc32.t ??= Array.from({ length: 256 }, (_, n) => {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  }));
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function makeZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data, method = 8 } of files) {
    const nameBuf = Buffer.from(name);
    const raw = Buffer.from(data);
    const comp = method === 8 ? deflateRawSync(raw) : raw;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc32(raw), 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    locals.push(lh, nameBuf, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(crc32(raw), 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

/* ───────── link ───────── */

const SHARE = 'https://alightcreative.com/am/share/u/Dk2xXsySGSURpwqmRkuhiZdR5cz1/p/IxLDKMNwkp-1a9dddbb292a5f59';

test('link share dikenali: user & package diambil', () => {
  assert.deepEqual(parseShareLink(SHARE), { user: 'Dk2xXsySGSURpwqmRkuhiZdR5cz1', package: 'IxLDKMNwkp-1a9dddbb292a5f59' });
  assert.deepEqual(parseShareLink(`${SHARE}/?utm=1`), { user: 'Dk2xXsySGSURpwqmRkuhiZdR5cz1', package: 'IxLDKMNwkp-1a9dddbb292a5f59' });
  assert.ok(parseShareLink('https://alight.link/am/share/u/abc/p/def'));
});

test('host dicek persis: domain tiruan & path menumpang ditolak', () => {
  assert.equal(parseShareLink('https://evil.com/alightcreative.com/am/share/u/abc/p/def'), null);
  assert.equal(parseShareLink('https://alightcreative.com.evil.com/am/share/u/abc/p/def'), null);
  assert.equal(parseShareLink('https://evil.com/?x=https://alightcreative.com/am/share/u/abc/p/def'), null);
  assert.equal(parseShareLink('https://alightcreative.com/pricing'), null);
  assert.equal(parseShareLink('ftp://alightcreative.com/am/share/u/abc/p/def'), null);
  assert.equal(parseShareLink('halo'), null);
});

test('id paket tidak boleh berupa titik-titik (path traversal)', () => {
  assert.equal(parseShareLink('https://alightcreative.com/am/share/u/abc/p/..'), null);
  assert.equal(parseShareLink('https://alightcreative.com/am/share/u/abc/p/.hidden'), null);
});

test('link share dicari di dalam HTML (hasil alihan alight.link)', () => {
  const html = `<meta property="og:url" content="${SHARE}"><a href="https://evil.com/am/share/u/x/p/y">`;
  assert.deepEqual(findShareLinkInHtml(html), { user: 'Dk2xXsySGSURpwqmRkuhiZdR5cz1', package: 'IxLDKMNwkp-1a9dddbb292a5f59' });
  assert.equal(findShareLinkInHtml('<p>tidak ada link</p>'), null);
});

test('URL storage dibentuk dari user/package (path di-encode)', () => {
  const u = storageUrl({ user: 'U1', package: 'P-2' }, 'projectfiles.zip');
  assert.equal(
    u,
    'https://firebasestorage.googleapis.com/v0/b/alight-creative.appspot.com/o/share%2Fu%2FU1%2Fp%2FP-2%2Fprojectfiles.zip?alt=media',
  );
});

/* ───────── ZIP ───────── */

const XML = "<?xml version='1.0'?><scene title='Demo' width='1080' height='1920'></scene>";
const SHA = 'a'.repeat(40);

test('ZIP: daftar isi & ekstrak (deflate dan store)', () => {
  const zip = makeZip([
    { name: 'abc.xml', data: XML },
    { name: 'manifest.txt', data: `${SHA}:Foto 1.png\n`, method: 0 },
    { name: 'Foto 1.png', data: Buffer.from([1, 2, 3, 4]), method: 0 },
  ]);
  const entries = zipDirectory(zip);
  assert.deepEqual(entries.map((e) => e.name), ['abc.xml', 'manifest.txt', 'Foto 1.png']);
  assert.equal(zipExtract(zip, entries[0]).toString(), XML);
  assert.equal(zipExtract(zip, entries[1]).toString(), `${SHA}:Foto 1.png\n`);
  assert.deepEqual([...zipExtract(zip, entries[2])], [1, 2, 3, 4]);
});

test('ZIP: bukan zip / terpotong → ShareError, bukan crash', () => {
  assert.throws(() => zipDirectory(Buffer.from('bukan zip sama sekali, hanya teks biasa panjang')), ShareError);
  const zip = makeZip([{ name: 'a.xml', data: XML }]);
  const cut = zip.subarray(0, zip.length - 30);
  assert.throws(() => zipDirectory(cut), ShareError);
});

test('ZIP: batas ukuran hasil ekstrak (perlindungan ZIP bomb)', () => {
  const big = Buffer.alloc(200_000, 0x41);
  const zip = makeZip([{ name: 'big.xml', data: big }]);
  const [e] = zipDirectory(zip);
  assert.throws(() => zipExtract(zip, e, 1000), (err) => err instanceof ShareError && err.code === 'TOO_LARGE');
  // Ukuran di header dipalsukan kecil, isi sebenarnya besar: inflate tetap dihentikan.
  const forged = { ...e, size: 10 };
  assert.throws(() => zipExtract(zip, forged, 1000), ShareError);
});

test('ZIP: entri ber-metode tak dikenal ditolak dengan pesan jelas', () => {
  const zip = makeZip([{ name: 'a.xml', data: XML }]);
  const [e] = zipDirectory(zip);
  assert.throws(() => zipExtract(zip, { ...e, method: 12 }), /tidak didukung/);
});

test('entri sampah (__MACOSX, ._file, folder) dikenali', () => {
  assert.equal(isJunkEntry('__MACOSX/x.xml'), true);
  assert.equal(isJunkEntry('dir/._x.png'), true);
  assert.equal(isJunkEntry('dir/'), true);
  assert.equal(isJunkEntry('foto.png'), false);
});

/* ───────── manifest & media ───────── */

test('manifest.txt: hanya baris "SHA1:nama" yang valid', () => {
  const m = parseManifest(`${SHA}:Elemen Baru 2 [60B2C69].png\r\nrusak\n${'b'.repeat(40)}: video.mp4 \nxyz:abc`);
  assert.equal(m.size, 2);
  assert.equal(m.get(SHA), 'Elemen Baru 2 [60B2C69].png');
  assert.equal(m.get('b'.repeat(40)), 'video.mp4');
});

test('tipe media dikenali dari ekstensi', () => {
  assert.equal(isMediaName('a.PNG'), true);
  assert.equal(isMediaName('a.xml'), false);
  assert.equal(mimeOfName('x.mp4'), 'video/mp4');
  assert.equal(mimeOfName('x.bin'), 'application/octet-stream');
});

test('entryByName: nama dicari tanpa peduli huruf besar/kecil & folder', () => {
  const zip = makeZip([{ name: 'sub/Foto Aku.png', data: 'x', method: 0 }]);
  const entries = zipDirectory(zip);
  assert.equal(entryByName(entries, 'foto aku.PNG')?.name, 'sub/Foto Aku.png');
  assert.equal(entryByName(entries, 'Foto%20Aku.png')?.name, 'sub/Foto Aku.png');
  assert.equal(entryByName(entries, 'tidak-ada.png'), null);
});

test('ref media XML dicocokkan ke nama entri ZIP (amproj: / am: / manifest)', () => {
  const names = ['abc.xml', 'Elemen Baru 2 [60B2C69].png', 'clip.mp4'];
  const manifest = new Map([[SHA, 'clip.mp4']]);
  assert.equal(matchRefToZipName('amproj:Elemen%20Baru%202%20%5B60B2C69%5D.png', manifest, names), 'Elemen Baru 2 [60B2C69].png');
  assert.equal(matchRefToZipName(`am:${SHA}.mp4`, manifest, names), 'clip.mp4');
  assert.equal(matchRefToZipName('am:clip.mp4', manifest, names), 'clip.mp4');
  assert.equal(matchRefToZipName('content://media/1', manifest, names), null);
});

/* ───────── auto-bind ───────── */

const layer = (id, over = {}) => ({ id, name: id, mediaRef: null, raw: {}, children: [], ...over });
const item = (id, name) => ({ id, name, mime: 'image/png', kind: 'image', size: 1, url: 'blob:x', projectId: null });

test('auto-bind: media dipasang ke slot yang merujuknya (termasuk di dalam grup)', () => {
  const scene = {
    layers: [
      layer('a', { raw: { fillImage: 'amproj:Foto 1.png' }, mediaRef: 'amproj:Foto 1.png' }),
      layer('g', { children: [layer('b', { raw: { fillVideo: `am:${SHA}.mp4` }, mediaRef: `am:${SHA}.mp4` })] }),
      layer('c', { raw: { fillImage: 'content://pribadi/1' }, mediaRef: 'content://pribadi/1' }),
    ],
  };
  const r = autoBindMedia(scene, [item(11, 'Foto 1.png'), item(12, 'clip.mp4')], new Map([[SHA, 'clip.mp4']]));
  assert.equal(r.matched, 2);
  assert.equal(r.scene.layers[0].mediaRef, '11');
  assert.equal(r.scene.layers[1].children[0].mediaRef, '12');
  assert.equal(r.scene.layers[2].mediaRef, 'content://pribadi/1'); // media pribadi tetap kosong
  assert.equal(scene.layers[0].mediaRef, 'amproj:Foto 1.png'); // scene asli tidak dimutasi
});

test('auto-bind: slot yang sudah dipasangi media manual tidak ditimpa; ref tak ketemu dilaporkan', () => {
  const scene = {
    layers: [
      layer('a', { raw: { fillImage: 'amproj:Foto 1.png' }, mediaRef: '99' }),
      layer('b', { raw: { fillImage: 'amproj:Hilang.png' }, mediaRef: 'amproj:Hilang.png' }),
    ],
  };
  const r = autoBindMedia(scene, [item(11, 'Foto 1.png')]);
  assert.equal(r.scene.layers[0].mediaRef, '99');
  assert.equal(r.matched, 0);
  assert.deepEqual(r.missed, ['amproj:Hilang.png']);
});
