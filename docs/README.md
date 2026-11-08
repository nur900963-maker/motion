# Xmotion Vincent Zye — Preset AM Player

Player & renderer preset **Alight Motion (XML)** yang jalan penuh di browser. Tanpa login, tanpa database,
tanpa Environment Variable. Deploy: **Vercel** (Next.js 15).

## Alur

1. **Impor preset** (halaman utama) — tiga jalur:
   - **Upload XML dari perangkat**: diparse di browser (tanpa batas ukuran server).
   - **Import link Alight Motion**: server mengambil link; harus berupa file XML langsung.
   - **Import dari Google Drive**: file XML publik ("Siapa saja yang memiliki link").
2. **Player** — pratinjau scene (canvas 2D), timeline, daftar layer.
3. **Media** — XML hanya merujuk media dari HP asal (`content://...`), jadi pasang foto/video kamu di tab
   Media. Satu foto otomatis dipasang ke semua layer yang merujuk foto asal yang sama.
4. **Ekspor** — render dari canvas yang sama dengan preview → rekam `MediaRecorder` → simpan ke perangkat.
5. **Proyek saya** — simpan scene + media di browser (IndexedDB). Per-perangkat, bukan per-akun.

## Pengaturan: `config.js`

Edit lalu push. Tidak ada rahasia di file ini (tampil di website).

| Kunci | Fungsi |
|---|---|
| `SITE_NAME` | judul tab & lencana |
| `OWNER_NAME`, `FOOTER_TEXT` | footer (`{owner}` diganti nama pemilik) |
| `CONTACTS.telegram / channel / developer` | menu tombol panah di kanan atas. Kosongkan = disembunyikan |

## Deploy ke Vercel

Import repo di Vercel → Framework Next.js (otomatis) → Deploy. Tidak ada env yang wajib.

## Struktur

```
app/            halaman (/, /player, /dashboard, /docs) + API (/api/presets/import, /api/health)
components/     landing, player, stage, dashboard, contact-menu
lib/am-xml.ts   parser XML Alight Motion + evaluasi keyframe/easing
lib/renderer.ts renderer canvas 2D
lib/drive.ts    logika impor Google Drive (fungsi murni, ada unit test)
lib/local-db.ts penyimpanan IndexedDB
config.js       pengaturan situs
```

## Yang dirender & yang tidak

Dirender: posisi, skala, rotasi, opacity berkeyframe dengan easing `cubicBezier`; isian media (fill/fit/stretch),
warna, gradien linear; bentuk rect/roundrect/circle; mode blend; perkiraan efek `gaussianblur`, `hueshift`,
`exposure`, `satvib`, `sharpen` (pendekatan, bukan identik dengan Alight Motion).

**Tidak dirender**: efek lain (tile, oscillate, motionblur, wavewarp, lift, swing, spin, pixelate, rgbsep,
vignette, dll.), teks, pemutaran audio, speed/time-remap. Semuanya dilaporkan sebagai peringatan di tab Proyek.

Format XML Alight Motion tidak didokumentasikan resmi; parser dibangun dari file ekspor asli dan bisa
meleset pada fitur yang belum pernah ditemui (elemen tak dikenal dilewati dan dilaporkan).

## Batasan

- Impor lewat link maks ±4 MB (batas respons fungsi Vercel). Lebih besar → upload dari perangkat.
- Ekspor berformat WebM (VP9) di Chrome; WebM dari MediaRecorder tidak punya metadata durasi.
- `ctx.filter` (efek) tidak didukung Safari iOS.
- Data "Proyek saya" hilang jika pengguna menghapus data situs.

## Tes

```bash
npm test                              # unit: parser, easing, logika Drive
npm run build && npm start            # lalu:
BASE=http://127.0.0.1:3000 node tests/integration.mjs
```
