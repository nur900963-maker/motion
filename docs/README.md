# Xmotion Vincent Zye — Preset AM Player

Player & renderer preset **Alight Motion (XML)** yang jalan penuh di browser. Tanpa login, tanpa database,
tanpa Environment Variable. Deploy: **Vercel** (Next.js 15).

## Alur

1. **Impor preset** (halaman utama) — tiga jalur:
   - **Upload XML dari perangkat**: diparse di browser (tanpa batas ukuran server).
   - **Import link Alight Motion**: link share resmi (`alightcreative.com/am/share/...`) hanya halaman web; website menampilkan judul/ukuran/thumbnail dan cara mendapatkan XML. Link yang langsung berupa file XML tetap bisa diimpor.
   - **Import dari Google Drive**: file XML publik ("Siapa saja yang memiliki link").
2. **Player** — pratinjau scene (canvas 2D), timeline, daftar layer.
3. **Media** — XML hanya merujuk media dari HP asal (`content://...`), jadi pasang foto/video kamu di tab
   Media. Satu foto otomatis dipasang ke semua layer yang merujuk foto asal yang sama.
4. **Ekspor** — render dari canvas yang sama dengan preview → rekam `MediaRecorder` → simpan ke perangkat.
5. **Proyek saya** — simpan scene + media di browser (IndexedDB). Per-perangkat, bukan per-akun.

## Performa

Preview memakai loop `requestAnimationFrame` imperatif (React hanya diperbarui 20×/detik untuk penggeser/jam),
batas fps mengikuti preset (maks 60), kualitas adaptif (720→540→405→304→228 px), foto di-downscale ke 2048 px,
dijeda otomatis saat tab disembunyikan. Setelan → Kualitas/FPS/Efek bisa diatur manual.

## Logo

Simpan gambar logo sebagai `public/logo-am.png` (atau `.webp/.jpg/.svg`), deploy ulang → otomatis tampil.
Tanpa file itu dipakai monogram "AM" bawaan (bukan logo resmi Alight Motion).

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

Renderer **WebGL2** (jalan di Chrome, Firefox, Safari/iPhone). Cadangan canvas 2D bila WebGL2 tidak ada (tanpa efek).

Dirender: posisi/skala/rotasi/opacity berkeyframe (easing `cubicBezier` dan `elastic`), isian media
(fill/fit/stretch), warna, gradien, garis tepi, bentuk rect/roundrect/circle, mode blend, **parent (null object)**,
**scene bersarang (embedScene)**, dan efek: `tile, wipe, wavewarp, randomdisplace, zoomblur, circularripple,
displacemap, stretchsegment, mirror, gradientoverlay, fourcolorgradient, lumakey, gaussianblur, hueshift,
exposure, satvib, sharpen, brightcont, oscillate, swing, motionblur, lift, fade`.

**Semua efek adalah PERKIRAAN.** Rumus asli Alight Motion tidak dipublikasikan; efek dihitung dari nama dan nilai
parameternya. Yang paling berisiko meleset: arti efek `lift` (diimplementasikan sebagai "efek sesudahnya diterapkan ke gambar di bawah layer, hanya di dalam bentuk layer", berdasarkan pola data), arti angka `blendMode` di gradientoverlay/fourcolorgradient,
panjang gelombang wavewarp, arah/sisi mirror, dan 3 parameter terakhir easing elastic.
Untuk kalibrasi dibutuhkan hasil render asli Alight Motion (screenshot/video) dari preset yang sama.

**Belum**: efek lain di luar daftar di atas (dilaporkan di tab Proyek), teks, shadow layer, pemutaran suara dari
layer video, speed/time-remap pada keyframe.

## Audio

Tab Audio: pasang file ke layer audio preset, atau tambah audio sendiri (mulai di detik ke-N, potong awal, volume).
Preview memakai `<audio>` yang disinkronkan ke timeline; ekspor memakai Web Audio (decode → jadwalkan → track
audio digabung ke stream video).

Format XML Alight Motion tidak didokumentasikan resmi; parser dibangun dari file ekspor asli dan bisa
meleset pada fitur yang belum pernah ditemui (elemen tak dikenal dilewati dan dilaporkan).

## Batasan

- Impor lewat link maks ±4 MB (batas respons fungsi Vercel). Lebih besar → upload dari perangkat.
- Ekspor real-time (MediaRecorder): perangkat lambat bisa menjatuhkan frame. MP4 (H.264/AAC) bila didukung (Safari, Chrome 130+ dengan encoder), selain itu WebM. WebM dari MediaRecorder tidak punya metadata durasi.
- Efek berat (banyak layer dengan tile/zoomblur/motionblur) butuh GPU yang layak; preview dirender 720 px.
- Data "Proyek saya" hilang jika pengguna menghapus data situs.

## Tes

```bash
npm test                              # unit: parser, easing, logika Drive
npm run build && npm start            # lalu:
BASE=http://127.0.0.1:3000 node tests/integration.mjs
```
