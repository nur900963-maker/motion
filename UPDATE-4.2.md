# Xmotion v4.2.0 — Link share Alight Motion (paket besar) + logo AM asli

Basis: v4.1.0 (zip "last"). Sistem link share diambil dari zip "support" (v3.2.0) lalu dirapikan.

## Yang berubah
- **Link share jalan untuk paket berapa pun (8 MB, 20 MB, …)**. Sebelumnya server hanya menampilkan
  kartu info lalu menyuruh ekspor XML manual (dan menulis "di atas 5 MB hanya member"). Sekarang server
  mengunduh `projectfiles.zip` dari paket share, mengambil XML-nya, dan media aslinya diunduh per-bagian.
- Media paket otomatis masuk galeri dan **terpasang ke slot** (`amproj:` / `am:` + manifest SHA1).
  Slot dengan media pribadi pembuat (`content://`) tetap diisi manual.
- Tidak bikin HP berat: paket dibuka di server; HP hanya menerima XML kecil + media per 3 MB, satu file
  sekali jalan, dengan coba-ulang. Satu media gagal tidak membatalkan impor.
- Perapian: parser link ketat (host dicek persis), pembaca ZIP dengan batas ukuran (anti ZIP bomb),
  unduhan paket yang bersamaan digabung jadi satu, cache hasil ekstrak untuk file besar,
  `maxDuration` 60 dtk untuk unduh paket besar, kartu info lama dihapus.
- **Logo**: logo AM asli (`public/logo-am.jpg`) menggantikan monogram bawaan (`LOGO_URL` di `config.js`).

## Tes
`npm test` — termasuk `tests/share.test.mjs` (16 tes: parser link, ZIP, manifest, auto-bind).
