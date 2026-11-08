# Xmotion Vincent Zye — Preset AM Player

Player & renderer preset **Alight Motion (XML)** yang jalan penuh di browser. Tanpa login, tanpa database,
tanpa Environment Variable. Deploy: **Vercel** (Next.js).

## Alur

1. **Impor preset** (halaman utama) — tiga jalur:
   - **Upload XML dari perangkat**: diparse di browser (tanpa batas ukuran server). Boleh 2 file
     sekaligus (preset + grup/cc).
   - **Import link Alight Motion**: tempel link share `https://alightcreative.com/am/share/u/…/p/…`
     atau link pendek `alight.link/…` → **XML + seluruh media preset terunduh otomatis** dan
     terpasang sendiri ke slot-nya (auto-bind lewat nama file & manifest SHA1). Link ke file XML
     langsung juga didukung.
   - **Import dari Google Drive**: file XML publik ("Siapa saja yang memiliki link").
2. **Player** — pratinjau scene (canvas 2D), timeline, daftar layer, bookmark, shortcut keyboard.
3. **Media** — slot preset yang tersisa (media pribadi pembuat preset, ref `content://`) tinggal
   diisi di sini. Upload file dengan nama yang sama dengan media asli → langsung menempel otomatis.
   Satu media dipasang ke semua layer yang merujuk sumber yang sama.
4. **Audio** — tambah MP3/M4A/WAV/OGG dari perangkat sebagai track scene: atur waktu mulai,
   volume, mute. Ikut diputar di preview dan dirender saat ekspor.
5. **Ekspor** — render dari canvas yang sama dengan preview → rekam `MediaRecorder` (MP4/WebM,
   sampai 4K, atur bitrate & rentang waktu) → simpan/bagikan ke perangkat.
6. **Proyek saya** — simpan scene + media di browser (IndexedDB). Per-perangkat, bukan per-akun.

## Yang dirender

- Posisi/skala/rotasi/opacity berkeyframe; easing `cubicBezier`, `elastic`, `reverse elastic`,
  `bounce`, `overshoot`, `anticipate`, `hold`.
- Isian media (fill/fit/stretch), warna, gradien, bentuk rect/roundrect/circle, mode blend lengkap,
  stroke (`<path-stroke>`), glow/bayangan (`<shadow>`).
- **23+ efek** sebagai perkiraan canvas 2D (bukan shader asli AM): tile, oscillate, swing, motionblur
  (dengan switch usePos/useScale/useAngle), fade, wipe, lumakey, randomdisplace, wavewarp (dengan
  damping), zoomblur, circularripple, displacemap (invert/fromctr), stretchsegment, mirror,
  fourcolorgradient, gradientoverlay (linear/radial + offset), brightcont, lift, gaussianblur,
  hueshift, exposure, satvib, sharpen.
- Elemen XML: `<media>` (deklarasi media), `<nullobj>`, `<embedScene>` (precomp), speed layer,
  bookmark, bgcolor.

Efek yang benar-benar belum ada polanya dilaporkan jujur di tab Proyek (catatan parser) — tidak
diam-diam dihilangkan.

## Pengaturan: `config.js`

Edit lalu push. Tidak ada rahasia di file ini (tampil di website).

| Kunci | Fungsi |
|---|---|
| `SITE_NAME` | judul tab & lencana |
| `HERO_NAME`, `ENGINE_NAME`, `TAGLINE`, `AUTHOR` | hero halaman utama |
| `OWNER_NAME`, `FOOTER_TEXT` | footer (`{owner}` diganti nama pemilik) |
| `CONTACTS.telegram / channel / developer` | menu tombol panah di kanan atas. Kosongkan = disembunyikan |

## Deploy ke Vercel

Import repo di Vercel → Framework Next.js (otomatis) → Deploy. Tidak ada env yang wajib.

## Struktur

```
app/              halaman (/, /player, /dashboard, /docs) + API
app/api/presets/import   ambil XML/media dari link (AM share / Drive / XML langsung)
app/api/presets/asset    kirim file media dari paket share (per-bagian 3 MB)
components/       landing, player, stage, dashboard, contact-menu
lib/am-xml.ts     parser XML Alight Motion + evaluasi keyframe/easing
lib/renderer.ts   renderer canvas 2D (semua efek)
lib/am-share.ts   link share AM + pembaca ZIP + manifest (server)
lib/bind.ts       auto-bind media galeri → slot preset
lib/drive.ts      logika impor Google Drive (fungsi murni, ada unit test)
lib/local-db.ts   penyimpanan IndexedDB
config.js         pengaturan situs
scripts/audit.mjs tes menyeluruh dengan data nyata (parser, efek, easing, ZIP, auto-bind)
```

## Batasan

- Paket share diunduh server-side dengan cache 15 menit; file media dikirim per-bagian 3 MB supaya
  aman dari batas respons serverless.
- Ekspor WebM dari MediaRecorder tidak punya metadata durasi; pilih MP4 bila browser mendukung.
- `ctx.filter` (sebagian efek warna) tidak didukung Safari iOS lama.
- Data "Proyek saya" hilang jika pengguna menghapus data situs.

## Tes

```bash
bun scripts/audit.mjs                 # atau: node --experimental-strip-types scripts/audit.mjs
npm test                              # unit: parser, easing, logika Drive
npm run build && npm start            # lalu:
BASE=http://127.0.0.1:3000 node tests/integration.mjs
```
