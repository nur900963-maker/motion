# Xmotion — Rebuild & Dokumentasi

Rekonstruksi website **XMotion** (referensi: https://xmotion-project.vercel.app/) sebagai proyek baru:
Next.js 15 (App Router) + TypeScript + Tailwind, backend Next.js Route Handlers (Vercel Functions),
penyimpanan **file JSON di folder `data/`** (tanpa database, tanpa layanan eksternal).

> Status kejujuran: lihat `docs/05-laporan-pengujian.md` — apa yang sudah diuji nyata, apa yang belum,
> dan apa yang tidak bisa diverifikasi. Tidak ada fitur yang diklaim selesai tanpa bukti uji.

---

## 1. Inventaris menu & halaman referensi

Referensi diperiksa dengan deep discovery (HTML + JS bundle + CSS diambil langsung dari situs).

| # | Area | Isi yang teramati | Status di rebuild |
|---|------|-------------------|-------------------|
| 1 | Landing `/` | Judul besar "Xmotion", tagline "Xmotion Rendering Engine. Import your preset here, then upload your media here and just export instantly!", 3 kartu akordeon: **Upload Preset XML dari Perangkat**, **Import Preset Alight Motion**, **Import Preset XML dari Google Drive** | ✅ Diimplementasikan, 3 jalur impor berfungsi nyata |
| 2 | Player `/player` | Header (logo, nama proyek, simpan, setelan, ekspor), stage preview, transport (play/pause/restart/loop/mute/bookmark), timeline + scene tree, panel tab | ✅ Diimplementasikan |
| 3 | Tab **Proyek** | Nama proyek, statistik scene, peringatan parser, simpan, ganti preset, XML sumber | ✅ |
| 4 | Tab **Media** | Slot media preset, galeri media, tambah/hapus | ✅ |
| 5 | Tab **Audio** | Track audio scene, unggah audio, daftar audio | ✅ |
| 6 | Tab **Layer** | Daftar layer + toggle visibilitas | ✅ |
| 7 | Tab **Ekspor** | Pengaturan ekspor (resolusi, fps, bitrate, rentang waktu), render, unduh, bagikan, riwayat | ✅ |
| 8 | Modal **Setelan** | Kualitas render, target FPS, auto-quality, efek, debug, safe area, daftar pintasan | ✅ |
| 9 | Halaman akun | Tidak ada di referensi (referensi tanpa login) | ➕ Ditambahkan: `/login`, `/register`, `/dashboard` |
| 10 | Halaman bantuan | Tidak ada di referensi | ➕ Ditambahkan: `/docs` |

**Halaman referensi yang TIDAK dapat diperiksa:** tidak ada route lain yang dapat dijangkau dari
landing/player pada snapshot yang diambil (tidak ada tautan ke halaman legal, pricing, atau blog).
Bila situs referensi punya halaman yang hanya muncul setelah login, halaman itu **belum diperiksa**
dan tidak direkonstruksi.

---

## 2. Cara kerja tiap fitur

### 2.1 Impor preset XML dari perangkat
1. Pengguna memilih 1–2 file `.xml` (preset + grup/cc opsional).
2. Klien memvalidasi ekstensi, ukuran (≤12 MB), dan well-formedness XML (`DOMParser`).
3. `POST /api/presets/parse` mem-parse ulang di server dengan `fast-xml-parser` (otoritatif).
4. Scene disimpan sementara di `sessionStorage`, lalu `/player` membukanya.

### 2.2 Impor link Alight Motion
`POST /api/presets/import` dengan `kind=am`. Server mengambil URL (timeout 20 s, batas 12 MB,
host internal ditolak), lalu mem-parse XML hasilnya. Bila sumber mengembalikan HTML (bukan XML),
respons 422 dengan pesan yang menjelaskan penyebabnya.

### 2.3 Impor dari Google Drive
`kind=drive`. ID file diekstrak dari pola `/file/d/<id>/` atau `?id=<id>`, lalu diunduh via
`https://drive.google.com/uc?export=download&id=<id>`. File yang tidak publik menghasilkan
pesan "pastikan akses Siapa saja yang memiliki link".

### 2.4 Parser XML
- Membaca `<project>` / `<scene>` / `<layer>`.
- Properti dibaca dari atribut (`value="…"`) **dan** elemen anak
  `<property name="…"><kf t="…" v="…"/></property>`.
- Properti yang tidak ditemukan → nilai default + entri di `warnings` (tidak dikarang).
- Tipe layer dipetakan: image/video/audio/text/shape/scene/group/other.

### 2.5 Renderer
Canvas 2D. Untuk setiap layer aktif pada waktu `t`:
- interpolasi linear keyframe untuk `location`, `scale`, `rotation`, `opacity`;
- transform (translate → rotate → scale), filter efek yang dikenali
  (blur, glow, sharpen, vignette, exposure, saturasi);
- slot media kosong digambar sebagai placeholder berlabel "Slot media kosong" (bukan gambar palsu).

### 2.6 Media
`POST /api/media` (multipart). Tipe diizinkan: png/jpeg/webp/gif/avif, mp4/webm/quicktime,
mpeg/mp4/wav/ogg/aac. Metadata di `data/media.json`, byte di `data/blobs/media-<id>`,
disajikan lewat `/api/media/:id/raw`. Batas unggah: `MAX_UPLOAD_MB` (di Vercel otomatis ≤ 4 MB). Memilih media pada slot langsung mengubah `mediaRef`
layer sehingga preview berubah.

### 2.7 Ekspor
1. Canvas offscreen pada resolusi terpilih.
2. `drawFrame` yang sama dengan preview, dirender per frame selama rentang waktu.
3. `canvas.captureStream(fps)` + `MediaRecorder` (vp9 → vp8 → webm → mp4).
4. Hasil diunggah ke `POST /api/exports` dan disimpan di `data/blobs/export-<id>` (di Vercel hanya bila ≤ 4 MB; selebihnya cukup diunduh dari browser).

### 2.8 Akun & sesi
JWT HS256 di cookie `xm_session` (HttpOnly, SameSite=Lax, Secure di produksi), umur 30 hari.
Password di-hash bcrypt (cost 10). Setiap endpoint proyek/media/ekspor memeriksa `user_id`.

---

## 3. Matriks fitur referensi vs implementasi

| Fitur referensi | Implementasi | Bukti |
|---|---|---|
| Upload preset XML | ✅ | uji integrasi #8, #9, #10 |
| Import link Alight Motion | ✅ (bergantung pada XML publik dari link) | uji #11, #12 |
| Import Google Drive | ✅ (file harus publik) | uji #11 (validasi URL) |
| Player + preview | ✅ canvas 2D | screenshot desktop/mobile |
| Play/pause/seek/loop/mute | ✅ | uji UI |
| Timeline + scene tree | ✅ (bisa dilipat di HP) | screenshot |
| Panel Proyek/Media/Audio/Layer/Ekspor | ✅ | uji UI |
| Setelan render | ✅ | modal setelan |
| Ekspor video | ✅ MediaRecorder + simpan server | uji ekspor (141 KB tersimpan) |
| Simpan proyek | ✅ (butuh akun) | uji #13–#16 |
| Riwayat ekspor | ✅ | uji #21–#22 |
| Akun/login | ➕ tambahan | uji #4–#7, #27–#29 |
| Efek shader kompleks AM | ⚠️ sebagian (subset filter canvas) | — |
| Media otomatis dari link share | ❌ tidak diunduh otomatis | — |

---

## 4. Daftar API

| Method | Path | Auth | Keterangan |
|---|---|---|---|
| GET | `/api/health` | – | status app/storage/auth + flag `persistent` |
| POST | `/api/auth/register` | – | daftar (validasi zod, 409 bila email ada) |
| POST | `/api/auth/login` | – | masuk, set cookie |
| POST | `/api/auth/logout` | – | hapus cookie |
| GET | `/api/auth/me` | – | user aktif atau null |
| POST | `/api/presets/parse` | – | parse 1–2 file XML |
| POST | `/api/presets/import` | – | impor dari link AM / Drive |
| GET | `/api/projects` | ✔ | daftar proyek milik user |
| POST | `/api/projects` | ✔ | simpan proyek baru |
| GET | `/api/projects/:id` | ✔ | detail + media proyek |
| PATCH | `/api/projects/:id` | ✔ | ubah nama/scene |
| DELETE | `/api/projects/:id` | ✔ | hapus proyek |
| GET | `/api/media` | ✔ | daftar media (opsional `?projectId=`) |
| POST | `/api/media` | ✔ | unggah media |
| GET | `/api/media/:id/raw` | ✔ | byte media dari folder data |
| DELETE | `/api/media/:id` | ✔ | hapus media |
| GET | `/api/exports` | ✔ | riwayat ekspor |
| POST | `/api/exports` | ✔ | unggah hasil render |
| GET | `/api/exports/:id/file` | ✔ | unduh hasil dari folder data |
| DELETE | `/api/exports/:id` | ✔ | hapus ekspor |

---

## 5. Environment Variables

| Nama | Wajib | Keterangan |
|---|---|---|
| `AUTH_SECRET` | ✅ | string acak ≥16 karakter untuk JWT |
| `DATA_DIR` | ⬜ | folder data JSON di luar Vercel, default `./data` |
| `MAX_UPLOAD_MB` | ⬜ | batas unggah media, default 12 (di Vercel dibatasi 4) |

### Struktur `data/`
`meta.json` (counter ID) · `users.json` · `projects.json` (indeks) + `projects/<id>.json` ·
`media.json` · `exports.json` · `blobs/` (byte media & ekspor). Tulis atomik (tmp → rename) dengan
kunci per-file. File JSON yang rusak **tidak** di-reset diam-diam; API membalas 503.

### ⚠ Batasan penyimpanan JSON di Vercel
- Filesystem fungsi Vercel hanya bisa ditulis di `/tmp`, dan isinya **hilang saat cold start** serta
  tidak dibagi antar-instance. Akun/proyek yang dibuat di Vercel **tidak permanen**.
- Request body maksimal ±4,5 MB, jadi unggah media/ekspor di Vercel dibatasi 4 MB.
- Data permanen hanya bila dijalankan di mesin dengan disk persisten (`npm run build && npm start`).

---

## 6. Menjalankan lokal

```bash
npm install
cp .env.example .env.local   # isi AUTH_SECRET
npm run dev                  # http://localhost:3000
npm run build && npm start   # produksi
npm test                     # uji unit
BASE=http://127.0.0.1:3000 node tests/integration.mjs   # uji integrasi
```

## 7. Deploy ke Vercel

```bash
npm i -g vercel
vercel login
vercel link
vercel env add AUTH_SECRET production
vercel --prod
```

Atau `bash scripts/deploy-vercel.sh` (memeriksa prasyarat lalu menjalankan urutan di atas).
`vercel.json` sudah menetapkan framework `nextjs` dan `maxDuration` 60 s untuk route API.
