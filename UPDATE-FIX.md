# Xmotion v3.2.0 — Import Link Share Alight Motion + Audit Total

Update terbesar Xmotion: sekarang bisa impor langsung dari **link share Alight Motion**
(alightcreative.com/am/share/u/…/p/… atau alight.link/…), dan XML-nya **plus seluruh media
preset** diunduh otomatis — tidak perlu pasang media satu-satu lagi.

## Yang baru di v3.2.0

### 1. Import via link share Alight Motion (fitur utama)
- Tempel link `https://alightcreative.com/am/share/u/<user>/p/<package>` di menu
  "Import Preset Alight Motion" → XML + SEMUA media asli preset (gambar/video/audio)
  terunduh otomatis dari paket share.
- Media otomatis masuk galeri dan **terpasang sendiri ke slot-nya** (auto-bind via nama
  file & manifest SHA1). Preset 39 layer langsung jalan tanpa upload manual.
- Link pendek `alight.link/…` juga didukung (diikuti alihannya sampai paket ketemu).
- Kalau slot butuh media pribadi (ref `content://`), aplikasi memberi tahu slot mana yang
  masih perlu media kamu — sisanya sudah terpasang otomatis.

### 2. Audit renderer dengan katalog efek resmi (reverse-engineering APK AM)
Semua parameter efek preset dibandingkan satu per satu dengan XML nyata. Perbaikan:
- `gradientoverlay2`: `gradType` (linear/radial) + `offset` pusat gradien.
- `wavewarp2`: `damping`, `dampingOrigin`, `dampingSpace` (amplitudo membesar menjauhi
  titik asal — gaya khas AM), `screenSpace` diterima.
- `motionblur3/4`: switch `usePos` / `useScale` / `useAngle` dihormati — channel yang
  dimatikan tidak lagi ikut menggelcak.
- `displacemap3`: `invert` + `fromctr` (geseran radial dari pusat).
- `stretchsegment`: `smooth` (48 irisan halus vs 24).
- `fade`: satuan `inTime`/`outTime` diperbaiki menjadi DETIK (sebelumnya fraksi durasi —
  fade jadi kecepatan salah).
- `lumakey3` (`weighted`) & `zoomblur3` (`adaptive`) diterima sebagai parameter.

### 3. Auto-bind media makin pintar
- Upload file dengan nama yang SAMA dengan media preset (mis. `Elemen Baru 2 [60B2C69].png`)
  → langsung menempel ke slot yang merujuknya, tanpa pilih manual.
- Ref `amproj:` dari paket share dikenali selain `am:`.
- Slot yang sudah dipasangi media lain tidak ditimpa otomatis.

### 4. Chenel teknis
- Pembaca ZIP sendiri (tanpa dependensi): EOCD + central directory + inflate — dipakai
  untuk mengekstrak XML/media dari paket share di server.
- Endpoint baru `POST /api/presets/asset` mengirim file media per-bagian 3 MB (aman dari
  batas respons serverless ±4,5 MB), dengan cache paket in-memory 15 menit.
- Proteksi SSRF & rate limit tetap aktif untuk semua sumber link.

## Cara pakai link share
1. Di Alight Motion: buka proyek → Share → "Copy Link" (atau pakai tombol share preset).
2. Tempel di menu "Import Preset Alight Motion" → tekan Ambil.
3. Tunggu "Mengunduh media preset 1/6…" selesai — player terbuka dengan media terpasang.
4. Tekan Putar. Slot yang masih kosong (media pribadi pembuat preset) tinggal diganti
   lewat tab Media → Pilih.

## Tes
`node scripts/audit.mjs` (atau `bun scripts/audit.mjs`) menjalankan 44 tes: parser XML
nyata, 23 jenis efek, easing elastic/reverse-elastic, pembacaan ZIP paket asli, pencocokan
manifest, dan auto-bind slot.
