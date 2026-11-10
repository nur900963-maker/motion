// Uji endpoint sisa (tanpa login/DB). Jalankan: BASE=http://127.0.0.1:3000 node tests/integration.mjs
const BASE = process.env.BASE || 'http://127.0.0.1:3000';
const results = [];
const rec = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const post = (path, body, raw) =>
  fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw ?? JSON.stringify(body) }).then(async (r) => ({
    status: r.status,
    json: await r.json().catch(() => null),
  }));

for (const path of ['/', '/player', '/dashboard', '/docs', '/sample-preset.xml']) {
  const r = await fetch(BASE + path, { redirect: 'manual' });
  rec(`GET ${path} → 200`, r.status === 200, `status ${r.status}`);
}
for (const gone of ['/login', '/register', '/api/auth/me', '/api/projects', '/api/media', '/api/exports']) {
  const r = await fetch(BASE + gone);
  rec(`${gone} sudah tidak ada → 404`, r.status === 404, `status ${r.status}`);
}
const health = await fetch(BASE + '/api/health').then((r) => r.json());
rec('GET /api/health healthy', health.healthy === true);

const home = await fetch(BASE + '/').then((r) => r.text());
rec('Halaman utama tidak punya tombol Masuk', !/>\s*Masuk\s*</.test(home));
rec('Halaman utama menampilkan nama brand dari config.js', home.includes('Vincent X Zye'));
rec('Tagline "By vincent" tampil', home.includes('By vincent'));
rec('Logo AM tampil', home.includes('Logo AM'));
rec('Footer dari config.js tampil', home.includes('All rights reserved'));

const cases = [
  ['import: jenis salah → 422', { kind: 'x', url: 'https://a.com' }, 422],
  ['import: url kosong → 422', { kind: 'am', url: '' }, 422],
  ['import: bukan url → 422', { kind: 'am', url: 'bukan link' }, 422],
  ['import: SSRF localhost → 422', { kind: 'am', url: 'http://localhost/x' }, 422],
  ['import: SSRF IP privat → 422', { kind: 'am', url: 'http://10.0.0.1/x' }, 422],
  ['import: SSRF metadata cloud → 422', { kind: 'am', url: 'http://169.254.169.254/latest' }, 422],
  ['import: SSRF IPv4-mapped IPv6 → 422', { kind: 'am', url: 'http://[::ffff:7f00:1]/x' }, 422],
  ['import: link Drive di opsi AM → 422', { kind: 'am', url: 'https://drive.google.com/file/d/abc/view' }, 422],
  ['import: folder Drive → 422', { kind: 'drive', url: 'https://drive.google.com/drive/folders/abc' }, 422],
  ['import: Drive tanpa ID → 422', { kind: 'drive', url: 'https://drive.google.com/' }, 422],
];
for (const [name, body, want] of cases) {
  const r = await post('/api/presets/import', body);
  rec(name, r.status === want && typeof r.json?.error === 'string', `status ${r.status}`);
}
const bad = await post('/api/presets/import', null, '{bukan json');
rec('import: body bukan JSON → 400', bad.status === 400, `status ${bad.status}`);

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} lulus`);
process.exit(failed.length ? 1 : 0);
