# Laporan Pengujian Nyata — Xmotion

## Update v2.1 — migrasi ke penyimpanan JSON (tanpa Postgres/Blob)

Diuji (Node 20, `next build` + `next start`, tanpa database apa pun):
- `tsc --noEmit` → 0 error; `npm run build` → sukses; `npm test` → 3/3.
- `tests/integration.mjs` → **44/44 lulus** (36 lama + isolasi antar-user, register bersamaan, JSON rusak,
  SSRF IPv4-mapped IPv6, host tak ditemukan).
- Data (akun, proyek + scene, media) **tetap ada setelah server di-restart** (disk lokal).
- `users.json` rusak → API 503 dan file TIDAK di-reset.
- Simulasi `VERCEL=1`: data ditulis ke `/tmp/xmotion-data`, batas unggah 4 MB, health `persistent:false`.

**Belum diuji / tidak bisa dijamin:**
- Deploy Vercel nyata (tidak ada kredensial Vercel di sandbox). Data di Vercel SEMENTARA (cold start menghapus `/tmp`).
- Beberapa instance yang menulis file yang sama bersamaan (kunci hanya berlaku per-proses).
- Import link Alight Motion / Google Drive nyata (hanya jalur validasi + penolakan SSRF yang diuji).
- Kesesuaian dengan situs referensi: situs referensi memblokir akses otomatis, sehingga fitur aslinya tidak bisa diverifikasi.

---

(Bagian di bawah adalah laporan v2.0 dengan Postgres; tetap disimpan sebagai riwayat.)

Tanggal: 2026-11-06. Lingkungan: sandbox Linux, Node 20, Postgres 15 lokal, Chromium (agent-browser).

## 1. Build produksi

```
npm run build   →  ✓ Compiled successfully
                   ✓ Generating static pages
                   Route (app)                    Size
                   ○ /                            ...
                   ƒ /api/...                     ...
```

- `npx tsc --noEmit` → 0 error.
- `node --test tests/parser.test.mjs` → 3/3 lulus.
- Log runtime (`next start`) diperiksa: tidak ada error 500 tak tertangani setelah perbaikan
  (sebelumnya `BLOCKED_HOST` mengembalikan 500 → diperbaiki menjadi 422).

## 2. Uji integrasi API (36 skenario)

Dijalankan dengan `node tests/integration.mjs` terhadap `next start` produksi.

| # | Skenario | Harapan | Hasil |
|---|---|---|---|
| 1 | GET /api/health | 200, healthy | ✅ |
| 2 | GET /, /player, /login, /register, /dashboard, /docs | 200 HTML | ✅ |
| 3 | GET /api/projects tanpa sesi | 401 | ✅ |
| 4 | Register input tidak valid | 422 | ✅ |
| 5 | Register valid | 201 | ✅ |
| 6 | Register email duplikat | 409 | ✅ |
| 7 | GET /api/auth/me | 200 + email | ✅ |
| 8 | Parse XML valid | 200, 2 layer, 1080×1920, 30 fps | ✅ |
| 9 | Parser membaca keyframe opacity | 2 keyframe | ✅ |
| 10 | Parse XML rusak | 422 | ✅ |
| 11 | Parse file non-XML | 415 | ✅ |
| 12 | Import URL tidak valid | 422 | ✅ |
| 13 | Import host internal (SSRF) | 422 | ✅ |
| 14 | Simpan proyek | 201 | ✅ |
| 15 | List proyek | memuat proyek | ✅ |
| 16 | Detail proyek | 200 | ✅ |
| 17 | PATCH proyek | 200 | ✅ |
| 18 | Unggah PNG | 201 | ✅ |
| 19 | GET media raw | 200 + byte | ✅ |
| 20 | Unggah tipe terlarang | 415 | ✅ |
| 21 | List media per proyek | ≥1 | ✅ |
| 22 | Unggah hasil ekspor | 201 | ✅ |
| 23 | List ekspor | ≥1 | ✅ |
| 24 | Ekspor tanpa file | 400 | ✅ |
| 25 | Hapus media | 200 | ✅ |
| 26 | Hapus proyek | 200 | ✅ |
| 27 | Proyek terhapus | 404 | ✅ |
| 28 | Logout | 200 | ✅ |
| 29 | Setelah logout | 401 | ✅ |
| 30 | Login sandi salah | 401 | ✅ |
| 31 | Login benar | 200 | ✅ |

Ringkasan: **36/36 lulus** (beberapa skenario mencakup lebih dari satu asersi).

## 3. Uji UI nyata (Chromium)

| Langkah | Hasil |
|---|---|
| Landing desktop 1440×900 | ✅ 3 kartu akordeon, tipografi & spacing sesuai |
| Landing mobile 390×844 | ✅ tidak ada overflow horizontal |
| Klik "Coba preset contoh" | ✅ pindah ke `/player?from=import`, scene 7 layer |
| Canvas merender | ✅ 9.498 piksel non-hitam pada sampling (bukan kanvas kosong) |
| Player desktop | ✅ stage 9:16, panel kanan 380 px, timeline |
| Player mobile | ✅ stage penuh lebar, panel di bawah, timeline bisa dilipat |
| Register akun baru | ✅ redirect ke `/dashboard` |
| Simpan proyek | ✅ toast "Proyek disimpan ke akun kamu." |
| Pilih media pada slot | ✅ tombol berubah "Pilih" → "Ganti" |
| Ekspor 270p, 0–2 s | ✅ "Video berhasil dirender", file 141.670 byte |
| Verifikasi DB | ✅ `exports.bytes=141670`, `media` 1 baris, `projects` 7 layer |

## 4. Yang belum / tidak dapat diverifikasi

1. **Deploy Vercel** — tidak ada kredensial Vercel di lingkungan ini (`vercel` CLI tidak terpasang,
   tidak ada `VERCEL_TOKEN`). Perintah deploy sudah disiapkan (`scripts/deploy-vercel.sh`), tetapi
   URL produksi belum ada. Ini **tidak diklaim berhasil**.
2. **Import link Alight Motion nyata** — diuji hanya jalur validasi/penolakan. Keberhasilan
   bergantung pada apakah link share mengembalikan XML publik; tidak ada link uji yang tersedia.
3. **Import Google Drive nyata** — sama, hanya jalur validasi yang diuji.
4. **Efek shader kompleks Alight Motion** — tidak direplikasi; hanya subset filter canvas.
5. **Media otomatis dari link share** — tidak diunduh otomatis; pengguna menambahkan manual.
6. **Uji perangkat Android fisik** — dilakukan dengan viewport 390×844 di Chromium, bukan perangkat
   asli. Perilaku `dvh`, safe-area, dan gesture belum diuji di hardware.
7. **Vercel Blob** — jalur Blob belum diuji karena token tidak tersedia; jalur fallback DB yang diuji.

## 5. Catatan perbaikan selama pengujian

| Masalah ditemukan | Perbaikan |
|---|---|
| Canvas meluber keluar viewport di HP | ukuran canvas dihitung dari `ResizeObserver` + mode fluid <1024 px |
| Timeline memakan seluruh tinggi di HP | timeline & daftar layer default tertutup, bisa dibuka |
| SSRF mengembalikan 500 | error diberi `status=422` + `code=BLOCKED_HOST` |
| Error 4xx ikut tercatat sebagai error server | logging hanya untuk status ≥500 |
| Slot foto menutupi cincin di preset contoh | urutan layer diperbaiki (foto di belakang) |
