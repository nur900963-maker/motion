/**
 * AUDIT XMotion — tes menyeluruh dengan data NYATA:
 *  1. Parser XML: file preset asli user (𝙍𝙚𝙣𝙥𝙧𝙨𝙩 __ 198.xml) + XML dari paket share
 *  2. Semua 23 jenis efek terbaca & dikenali renderer (tanpa warning "belum didukung")
 *  3. Easing: cubic-bezier, elastic, reverse elastic, bounce, hold — semua terevaluasi
 *  4. Keyframe sampling: monotonic, endpoint benar
 *  5. ZIP reader: baca projectfiles.zip asli (amanifest + xml + media)
 *  6. Share link: regex parse + storage URL
 *  7. Auto-bind: media galeri → slot XML (amproj:/am: + manifest)
 *
 * Jalankan: node scripts/audit.mjs  (butuh `npm run build:type`? tidak — pakai tsx bila ada,
 * di sini kita pakai transpile via esbuild yang dibawa Next; fallback: bukan bagian CI)
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
let pass = 0;
let fail = 0;
const fails = [];
function check(name, cond, detail = '') {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    fails.push(name);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}
function section(title) {
  console.log(`\n━━ ${title} ${'━'.repeat(Math.max(2, 58 - title.length))}`);
}

/* ───────── 1. load modules ───────── */
/* Dijalankan dengan `bun scripts/audit.mjs` — Bun mengeksekusi TS langsung. */
const amXml = await import('../src/lib/am-xml.ts');
const bind = await import('../src/lib/bind.ts');
const amShare = await import('../src/lib/am-share.ts');

/* cari XML user di upload/ */
const uploadDir = `${ROOT}upload`;
const xmlFile = existsSync(uploadDir) ? readdirSync(uploadDir).find((f) => f.endsWith('.xml')) : null;

section('1. PARSER — XML preset asli pengguna');
if (!xmlFile) {
  console.log('  (skip — tidak ada XML di upload/)');
} else {
  const text = readFileSync(`${uploadDir}/${xmlFile}`, 'utf8');
  const scene = amXml.parseAmXml(text, 'xml');
  check('scene terparse', scene.layers.length > 0, `${scene.layers.length} layer`);
  check('durasi > 0', scene.duration > 0, `${scene.duration} ms`);
  check('dimensi benar', scene.width === 1080 && scene.height === 1920, `${scene.width}×${scene.height}`);
  check('fps benar', scene.fps === 60, `${scene.fps}`);
  console.log(`    → ${scene.layers.length} layer, ${scene.effectCount} efek, ${scene.mediaRefs.length} ref media, durasi ${(scene.duration / 1000).toFixed(2)}s`);

  const warnJoined = scene.warnings.join(' | ');
  check('TIDAK ada warning efek belum didukung', !/belum didukung renderer/.test(warnJoined), warnJoined.slice(0, 200));
  check('TIDAK ada warning easing tak dikenal', !/easing tak dikenal/.test(warnJoined));
  check('TIDAK ada elemen dilewati', !/dilewati/.test(warnJoined));
  check('TIDAK ada transform belum didukung', !/transform belum didukung/.test(warnJoined));
  if (scene.warnings.length) console.log('    warnings:', scene.warnings.map((w) => `• ${w}`).join('\n             '));

  section('2. EFEK — semua jenis dikenali renderer');
  const kinds = new Map();
  for (const l of scene.layers) for (const fx of l.effects) kinds.set(fx.id, (kinds.get(fx.id) ?? 0) + 1);
  const approx = amXml.APPROXIMATED_EFFECTS;
  const unhandled = [...kinds.keys()].filter((id) => !approx.includes(id.split('.').pop().replace(/\d+$/, '')));
  check('semua jenis efek ada di daftar APPROXIMATED_EFFECTS', unhandled.length === 0, unhandled.join(','));
  check('jenis efek ≥ 20 (preset kompleks)', kinds.size >= 20, `${kinds.size}`);
  const total = [...kinds.values()].reduce((a, b) => a + b, 0);
  console.log(`    → ${kinds.size} jenis, ${total} instance:`);
  for (const [id, n] of [...kinds.entries()].sort((a, b) => b[1] - a[1])) console.log(`      ${id.split('.effects.').pop().padEnd(22)} ×${n}`);

  section('3. EASING & KEYFRAME');
  const easeSample = amXml.sampleKeyframes;
  const linear = [
    { t: 0, v: [0] },
    { t: 1000, v: [100] },
  ];
  check('linear awal', easeSample(linear, 0, 0, -1) === 0);
  check('linear tengah', Math.abs(easeSample(linear, 500, 0, -1) - 50) < 1e-9);
  check('linear akhir', easeSample(linear, 1000, 0, -1) === 100);
  check('sebelum awal = clamp', easeSample(linear, -50, 0, -1) === 0);
  check('sesudah akhir = clamp', easeSample(linear, 5000, 0, -1) === 100);
  const eased = [
    { t: 0, v: [0] },
    { t: 1000, v: [100], e: [0.42, 0, 1, 1] },
  ];
  const mid = easeSample(eased, 500, 0, -1);
  check('cubic-bezier (0.42,0,1,1) lambat di awal', mid < 50, `mid=${mid.toFixed(1)}`);
  check('nilai antara 0..100', mid > 0 && mid < 100);
  const hold = [
    { t: 0, v: [0] },
    { t: 1000, v: [100], easeName: 'hold' },
  ];
  check('hold = nilai awal sampai kf berikut', easeSample(hold, 999, 0, -1) === 0);
  const elastic = [
    { t: 0, v: [0] },
    { t: 1000, v: [100], easeName: 'elastic', easeParams: [0.4, 1] },
  ];
  const eVals = [];
  for (let i = 0; i <= 20; i += 1) eVals.push(easeSample(elastic, i * 50, 0, -1));
  check('elastic kontinu (tanpa NaN)', eVals.every((v) => Number.isFinite(v)));
  check('elastic berakhir di 100', Math.abs(eVals[eVals.length - 1] - 100) < 1e-6);
  const revElastic = [
    { t: 0, v: [0] },
    { t: 1000, v: [100], easeName: 'reverse elastic', easeParams: [0.4, 1] },
  ];
  const rVals = [];
  for (let i = 0; i <= 20; i += 1) rVals.push(easeSample(revElastic, i * 50, 0, -1));
  check('reverse elastic overshoot (lewat 100)', rVals.some((v) => v > 100.5), `max=${Math.max(...rVals).toFixed(1)}`);
  // hitung easing yang dipakai file nyata
  const usedEase = new Set();
  const collect = (l) => {
    for (const kfs of Object.values(l.keyframes)) for (const k of kfs) if (k.easeName) usedEase.add(k.easeName);
    l.children.forEach(collect);
  };
  scene.layers.forEach(collect);
  console.log(`    → easing khusus di file nyata: ${usedEase.size ? [...usedEase].join(', ') : '(semua cubic-bezier/linear)'}`);

  section('4. MEDIA REFS & MEDIA DECLS');
  check('mediaRefs terbaca', scene.mediaRefs.length > 0, String(scene.mediaRefs.length));
  check('mediaDecls terbaca', (scene.mediaDecls?.length ?? 0) > 0, String(scene.mediaDecls?.length));
  const contentRefs = scene.mediaRefs.filter((r) => r.startsWith('content://'));
  console.log(`    → refs: ${scene.mediaRefs.map((r) => r.slice(0, 42)).join(' | ')}`);
  console.log(`    → ${contentRefs.length} ref content:// (media perangkat pengguna — wajar di XML ekspor)`);
}

section('5. SHARE LINK — parse URL & storage');
const userUrl = 'https://alightcreative.com/am/share/u/Dk2xXsySGSURpwqmRkuhiZdR5cz1/p/IxLDKMNwkp-1a9dddbb292a5f59';
const ref = amShare.parseShareLink(userUrl);
check('parse link lengkap', !!ref && ref.user === 'Dk2xXsySGSURpwqmRkuhiZdR5cz1' && ref.package === 'IxLDKMNwkp-1a9dddbb292a5f59');
check('parse link alight.link', !!amShare.parseShareLink('https://alight.link/am/share/u/ABCdef123/p/pkg-id_9'));
check('bukan share → null', amShare.parseShareLink('https://drive.google.com/file/d/xyz/view') === null);
check('share di tengah teks ditemukan', !!amShare.parseShareLink('coba ini: ' + userUrl + ' ok'));
const su = amShare.storageUrl(ref, 'projectfiles.zip');
check('storage URL benar', su.includes('alight-creative.appspot.com') && su.includes('share%2Fu%2FDk2xXsySGSURpwqmRkuhiZdR5cz1%2Fp%2FIxLDKMNwkp-1a9dddbb292a5f59%2Fprojectfiles.zip'));

section('6. ZIP READER — paket asli dari link user');
const zipPath = '/tmp/am_package.zip';
if (!existsSync(zipPath)) {
  console.log('  (skip — /tmp/am_package.zip belum ada; jalankan unduhan paket dulu)');
} else {
  const buf = readFileSync(zipPath);
  const entries = amShare.zipDirectory(buf);
  check('entri terbaca', entries.length >= 7, `${entries.length} entri`);
  const xml = entries.find((e) => e.name.endsWith('.xml'));
  check('ada XML', !!xml, xml?.name);
  const manifestEntry = entries.find((e) => e.name.toLowerCase() === 'manifest.txt');
  check('ada manifest.txt', !!manifestEntry);
  const manifest = amShare.parseManifest(manifestEntry ? amShare.zipExtract(buf, manifestEntry).toString('utf8') : '');
  check('manifest ≥ 5 baris', manifest.size >= 5, String(manifest.size));
  const xmlText = amShare.zipExtract(buf, xml).toString('utf8');
  check('XML utuh (mulai dengan <)', xmlText.trimStart().startsWith('<'), xmlText.slice(0, 40));
  const pkgScene = amXml.parseAmXml(xmlText, 'am');
  check('XML paket terparse', pkgScene.layers.length > 0, `${pkgScene.layers.length} layer`);
  const mediaEntries = entries.filter((e) => amShare.isMediaName(e.name));
  check('media di paket ≥ 5', mediaEntries.length >= 5, String(mediaEntries.length));
  console.log(`    → ${entries.length} entri, ${mediaEntries.length} media, manifest ${manifest.size}, XML ${pkgScene.layers.length} layer`);

  // round-trip ukuran: hasil ekstrak = ukuran tercatat
  const png = entries.find((e) => e.name.toLowerCase().endsWith('.png'));
  const pngBuf = amShare.zipExtract(buf, png);
  check('ukuran ekstrak = ukuran central directory', pngBuf.length === png.size, `${pngBuf.length} vs ${png.size}`);

  section('7. MATCHING REF → FILE PAKET');
  const names = entries.map((e) => e.name);
  const m1 = amShare.matchRefToZipName('amproj:VID-20260807-WA0046.mp4', manifest, names);
  check('amproj: nama persis', m1 === 'VID-20260807-WA0046.mp4', m1);
  const m2 = amShare.matchRefToZipName('am:75B85E94B658F072C61C65C2B07E5F5A28B2F2B0.mp4', manifest, names);
  check('am: hash mp4 (nama file = hash)', m2 === '75B85E94B658F072C61C65C2B07E5F5A28B2F2B0.mp4', m2);
  const m3 = amShare.matchRefToZipName('am:720AD87FFCCAB97278F6501EB8054CDDEFFB9B36.mp4', manifest, names);
  check('am: hash → manifest → nama asli', m3 === 'VID-20260807-WA0046.mp4', m3);
  const m4 = amShare.matchRefToZipName('content://media/external/images/media/1000071321', manifest, names);
  check('content:// tidak dipaksa cocok', m4 === null);

  section('8. AUTO-BIND — media galeri → slot scene');
  const fakeItems = mediaEntries.map((e, i) => ({
    id: 100 + i,
    name: e.name,
    mime: amShare.mimeOfName(e.name),
    kind: amShare.mimeOfName(e.name).startsWith('video/') ? 'video' : 'image',
    size: e.size,
    url: `blob:fake-${i}`,
    projectId: null,
  }));
  const bindRes = bind.autoBindMedia(pkgScene, fakeItems, manifest);
  console.log(`    → matched=${bindRes.matched}, missed=${bindRes.missed.length}${bindRes.missed.length ? ` (${bindRes.missed.join(', ')})` : ''}`);
  check('ada slot yang terikat otomatis', bindRes.matched > 0, String(bindRes.matched));
  const boundLayers = [];
  const collectBound = (ls) => {
    for (const l of ls) {
      if (l.mediaRef) boundLayers.push(l.mediaRef);
      collectBound(l.children);
    }
  };
  collectBound(bindRes.scene.layers);
  // mediaRef harus berupa id galeri yang terikat, ATAU ref mentah (am:/amproj:/content://) untuk slot yang memang belum terisi
  check(
    'mediaRef = id galeri atau ref mentah yang belum terisi',
    boundLayers.every((r) => fakeItems.some((f) => String(f.id) === r) || /^(am:|amproj:|content:\/\/)/.test(r)),
    boundLayers.filter((r) => !fakeItems.some((f) => String(f.id) === r) && !/^(am:|amproj:|content:\/\/)/.test(r)).join(','),
  );
  const galleryBound = boundLayers.filter((r) => fakeItems.some((f) => String(f.id) === r));
  const ids = new Set(boundLayers);
  check('satu media bisa dipakai banyak layer', ids.size < boundLayers.length, `${ids.size} unik / ${boundLayers.length} layer`);
}

section('9. REGRESI FILE USER — XML ekspor perangkat + auto-bind via manifest');
if (xmlFile) {
  const text = readFileSync(`${uploadDir}/${xmlFile}`, 'utf8');
  const scene = amXml.parseAmXml(text, 'xml');
  const manifest = new Map([
    ['720ad87ffccab97278f6501eb8054cddeffb9b36', 'VID-20260807-WA0046.mp4'],
    ['75b85e94b658f072c61c65c2b07e5f5a28b2f2b0', '75B85E94B658F072C61C65C2B07E5F5A28B2F2B0.mp4'],
    ['d550b1a96639557d843d86cf69a8266692660fea', 'D550B1A96639557D843D86CF69A8266692660FEA.png'],
  ]);
  const items = [
    { id: 1, name: 'VID-20260807-WA0046.mp4', mime: 'video/mp4', kind: 'video', size: 1, url: 'blob:x', projectId: null },
    { id: 2, name: '75B85E94B658F072C61C65C2B07E5F5A28B2F2B0.mp4', mime: 'video/mp4', kind: 'video', size: 1, url: 'blob:y', projectId: null },
    { id: 3, name: 'D550B1A96639557D843D86CF69A8266692660FEA.png', mime: 'image/png', kind: 'image', size: 1, url: 'blob:z', projectId: null },
  ];
  const res = bind.autoBindMedia(scene, items, manifest);
  console.log(`    → matched=${res.matched}, missed=${res.missed.length}`);
  check('XML user: ref am: terikat via nama/manifest', res.matched >= 1, String(res.matched));
}

section('RINGKASAN');
console.log(`  PASS: ${pass}   FAIL: ${fail}`);
if (fail) {
  console.log('  GAGAL:', fails.join(' | '));
  process.exit(1);
}
console.log('  SEMUA TES LULUS ✅');
