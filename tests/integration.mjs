/**
 * Uji integrasi nyata terhadap server produksi (next start).
 * Jalankan: BASE=http://127.0.0.1:3100 node tests/integration.mjs
 */
const BASE = process.env.BASE || 'http://127.0.0.1:3100';
const results = [];
let cookie = '';

function rec(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function call(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: {
      ...(opts.body && !(opts.body instanceof FormData) ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
      ...(opts.headers || {}),
    },
    redirect: 'manual',
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* bukan json */
  }
  return { status: res.status, json, text, headers: res.headers };
}

const SAMPLE = `<?xml version="1.0"?>
<project name="Uji Integrasi" width="1080" height="1920" fps="30" duration="4000">
  <scene name="Uji" width="1080" height="1920" fps="30" duration="4000">
    <layer id="a" label="Kotak" type="shape" startTime="0" endTime="4000">
      <property name="location" value="540,960"/>
      <property name="size" value="400,400"/>
      <property name="color" value="#1fc8ee"/>
      <property name="opacity"><kf t="0" v="0"/><kf t="2000" v="1"/></property>
    </layer>
    <layer id="b" label="Teks" type="text" startTime="0" endTime="4000">
      <property name="location" value="540,1400"/>
      <property name="text" value="HALO"/>
    </layer>
  </scene>
</project>`;

async function main() {
  // 1. Health
  const health = await call('/api/health');
  rec('GET /api/health', health.status === 200 && health.json?.healthy === true, `status ${health.status}`);

  // 2. Halaman HTML
  for (const p of ['/', '/player', '/login', '/register', '/dashboard', '/docs']) {
    const r = await call(p);
    rec(`GET ${p}`, r.status === 200 && r.text.includes('<html'), `status ${r.status}`);
  }

  // 3. Auth: unauthorized
  const unauth = await call('/api/projects');
  rec('GET /api/projects tanpa sesi → 401', unauth.status === 401, `status ${unauth.status}`);

  // 4. Register validasi
  const badReg = await call('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'A', email: 'bukan-email', password: '123' }),
  });
  rec('POST /api/auth/register input tidak valid → 422', badReg.status === 422, `status ${badReg.status}`);

  // 5. Register sukses
  const email = `uji${Date.now()}@example.com`;
  const reg = await call('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'Penguji Xmotion', email, password: 'rahasia12345' }),
  });
  rec('POST /api/auth/register valid → 201', reg.status === 201 && reg.json?.user?.email === email, `status ${reg.status}`);

  // 6. Duplikat email
  const dup = await call('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'Penguji', email, password: 'rahasia12345' }),
  });
  rec('POST /api/auth/register email duplikat → 409', dup.status === 409, `status ${dup.status}`);

  // 7. Me
  const me = await call('/api/auth/me');
  rec('GET /api/auth/me dengan sesi', me.status === 200 && me.json?.user?.email === email, `status ${me.status}`);

  // 8. Parse XML valid
  const parse = await call('/api/presets/parse', {
    method: 'POST',
    body: JSON.stringify({ files: [{ name: 'uji.xml', text: SAMPLE }] }),
  });
  const scene = parse.json?.scene;
  rec(
    'POST /api/presets/parse XML valid',
    parse.status === 200 && scene?.layers?.length === 2 && scene?.width === 1080 && scene?.fps === 30,
    `status ${parse.status}, layer ${scene?.layers?.length}`,
  );
  rec(
    'Parser membaca keyframe opacity',
    Array.isArray(scene?.layers?.[0]?.keyframes?.opacity) && scene.layers[0].keyframes.opacity.length === 2,
    JSON.stringify(scene?.layers?.[0]?.keyframes?.opacity ?? null),
  );

  // 9. Parse XML rusak
  const badXml = await call('/api/presets/parse', {
    method: 'POST',
    body: JSON.stringify({ files: [{ name: 'rusak.xml', text: '<project><scene><layer>' }] }),
  });
  rec('POST /api/presets/parse XML rusak → 422', badXml.status === 422, `status ${badXml.status}`);

  // 10. Bukan XML
  const notXml = await call('/api/presets/parse', {
    method: 'POST',
    body: JSON.stringify({ files: [{ name: 'foto.png', text: 'xx' }] }),
  });
  rec('POST /api/presets/parse file non-XML → 415', notXml.status === 415, `status ${notXml.status}`);

  // 11. Import link tidak valid
  const badUrl = await call('/api/presets/import', {
    method: 'POST',
    body: JSON.stringify({ kind: 'am', url: 'bukan-url' }),
  });
  rec('POST /api/presets/import URL tidak valid → 422', badUrl.status === 422, `status ${badUrl.status}`);

  // 12. Import SSRF ditolak
  const ssrf = await call('/api/presets/import', {
    method: 'POST',
    body: JSON.stringify({ kind: 'am', url: 'http://127.0.0.1:3100/api/health' }),
  });
  rec('POST /api/presets/import host internal ditolak → 422', ssrf.status === 422, `status ${ssrf.status}`);

  // 13. Simpan proyek
  const create = await call('/api/projects', {
    method: 'POST',
    body: JSON.stringify({ name: 'Proyek Uji', scene, xmlText: SAMPLE, sourceKind: 'xml' }),
  });
  const pid = create.json?.id;
  rec('POST /api/projects → 201', create.status === 201 && Number.isFinite(pid), `status ${create.status}`);

  // 14. List proyek
  const list = await call('/api/projects');
  rec('GET /api/projects memuat proyek', list.status === 200 && list.json?.projects?.some((p) => p.id === pid), `status ${list.status}`);

  // 15. Detail proyek
  const detail = await call(`/api/projects/${pid}`);
  rec('GET /api/projects/:id', detail.status === 200 && detail.json?.project?.name === 'Proyek Uji', `status ${detail.status}`);

  // 16. Patch proyek
  const patch = await call(`/api/projects/${pid}`, {
    method: 'PATCH',
    body: JSON.stringify({ name: 'Proyek Uji (diubah)' }),
  });
  rec('PATCH /api/projects/:id', patch.status === 200, `status ${patch.status}`);

  // 17. Upload media (PNG 1x1 nyata)
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const form = new FormData();
  form.append('file', new File([png], 'piksel.png', { type: 'image/png' }));
  form.append('projectId', String(pid));
  const up = await call('/api/media', { method: 'POST', body: form });
  const mid = up.json?.media?.id;
  rec('POST /api/media unggah PNG → 201', up.status === 201 && Number.isFinite(mid), `status ${up.status}`);

  // 18. Raw media
  const raw = await call(`/api/media/${mid}/raw`);
  rec('GET /api/media/:id/raw mengembalikan byte', raw.status === 200 && raw.text.length > 0, `status ${raw.status}`);

  // 19. Upload tipe ditolak
  const badForm = new FormData();
  badForm.append('file', new File([Buffer.from('x')], 'a.exe', { type: 'application/x-msdownload' }));
  const badUp = await call('/api/media', { method: 'POST', body: badForm });
  rec('POST /api/media tipe tidak didukung → 415', badUp.status === 415, `status ${badUp.status}`);

  // 20. List media
  const mediaList = await call(`/api/media?projectId=${pid}`);
  rec('GET /api/media?projectId', mediaList.status === 200 && mediaList.json?.media?.length >= 1, `status ${mediaList.status}`);

  // 21. Upload ekspor
  const exForm = new FormData();
  exForm.append('file', new File([Buffer.from('fake-webm-bytes')], 'out.webm', { type: 'video/webm' }));
  exForm.append('projectId', String(pid));
  exForm.append('preset', JSON.stringify({ width: 720, height: 1280, fps: 30 }));
  const ex = await call('/api/exports', { method: 'POST', body: exForm });
  const eid = ex.json?.export?.id;
  rec('POST /api/exports → 201', ex.status === 201 && Number.isFinite(eid), `status ${ex.status}`);

  // 22. List ekspor
  const exList = await call('/api/exports');
  rec('GET /api/exports', exList.status === 200 && exList.json?.exports?.length >= 1, `status ${exList.status}`);

  // 23. Ekspor tanpa file
  const exBad = await call('/api/exports', { method: 'POST', body: new FormData() });
  rec('POST /api/exports tanpa file → 400', exBad.status === 400, `status ${exBad.status}`);

  // 24. Hapus media
  const delMedia = await call(`/api/media/${mid}`, { method: 'DELETE' });
  rec('DELETE /api/media/:id', delMedia.status === 200, `status ${delMedia.status}`);

  // 25. Hapus proyek
  const delProj = await call(`/api/projects/${pid}`, { method: 'DELETE' });
  rec('DELETE /api/projects/:id', delProj.status === 200, `status ${delProj.status}`);

  // 26. Proyek hilang → 404
  const gone = await call(`/api/projects/${pid}`);
  rec('GET proyek terhapus → 404', gone.status === 404, `status ${gone.status}`);

  // 27. Logout
  const out = await call('/api/auth/logout', { method: 'POST' });
  rec('POST /api/auth/logout', out.status === 200, `status ${out.status}`);
  cookie = '';
  const after = await call('/api/projects');
  rec('Setelah logout → 401', after.status === 401, `status ${after.status}`);

  // 28. Login salah
  const badLogin = await call('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password: 'salah-sekali' }),
  });
  rec('POST /api/auth/login sandi salah → 401', badLogin.status === 401, `status ${badLogin.status}`);

  // 29. Login benar
  const login = await call('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password: 'rahasia12345' }),
  });
  rec('POST /api/auth/login benar → 200', login.status === 200, `status ${login.status}`);

  // 30. Isolasi antar-user + register bersamaan (race) + JSON rusak
  cookie = '';
  const emailB = `ujib${Date.now()}@example.com`;
  const regB = await call('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'User B', email: emailB, password: 'rahasia12345' }),
  });
  rec('User B terdaftar', regB.status === 201, `status ${regB.status}`);
  const cookieB = cookie;
  // User A membuat proyek + media, user B tidak boleh melihatnya
  cookie = '';
  await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password: 'rahasia12345' }) });
  const pA = await call('/api/projects', { method: 'POST', body: JSON.stringify({ name: 'Milik A', scene, sourceKind: 'xml' }) });
  const fA = new FormData();
  fA.append('file', new File([png], 'a.png', { type: 'image/png' }));
  const mA = await call('/api/media', { method: 'POST', body: fA });
  cookie = cookieB;
  const peekP = await call(`/api/projects/${pA.json?.id}`);
  rec('User B tidak bisa baca proyek user A → 404', peekP.status === 404, `status ${peekP.status}`);
  const peekM = await call(`/api/media/${mA.json?.media?.id}/raw`);
  rec('User B tidak bisa baca media user A → 404', peekM.status === 404, `status ${peekM.status}`);
  const listB = await call('/api/projects');
  rec('Daftar proyek user B kosong', listB.status === 200 && listB.json?.projects?.length === 0, `status ${listB.status}`);

  cookie = '';
  const raceEmail = `race${Date.now()}@example.com`;
  const race = await Promise.all(
    [1, 2, 3, 4].map(() =>
      fetch(BASE + '/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Race', email: raceEmail, password: 'rahasia12345' }),
      }).then((r) => r.status),
    ),
  );
  rec('Register email sama bersamaan → hanya 1 sukses', race.filter((x) => x === 201).length === 1 && race.every((x) => x === 201 || x === 409), race.join(','));

  const badJson = await call('/api/auth/login', { method: 'POST', body: '{bukan json' });
  rec('Body bukan JSON → 400', badJson.status === 400, `status ${badJson.status}`);

  const ssrf2 = await call('/api/presets/import', {
    method: 'POST',
    body: JSON.stringify({ kind: 'am', url: 'http://[::ffff:7f00:1]/x' }),
  });
  rec('SSRF IPv4-mapped IPv6 ditolak → 422', ssrf2.status === 422, `status ${ssrf2.status}`);
  const ssrf3 = await call('/api/presets/import', {
    method: 'POST',
    body: JSON.stringify({ kind: 'am', url: 'http://localhost.localdomain.invalid/x' }),
  });
  rec('Host tak ditemukan → 422 (bukan 500)', ssrf3.status === 422, `status ${ssrf3.status}`);

  if (process.env.PERSIST_FILE) {
    const fs = await import('node:fs');
    fs.writeFileSync(process.env.PERSIST_FILE, JSON.stringify({ email, projectId: pA.json?.id }));
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} lulus`);
  if (failed.length) {
    console.log('GAGAL:', failed.map((f) => f.name).join(', '));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
