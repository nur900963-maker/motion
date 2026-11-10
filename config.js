/**
 * ============================================================
 *  XMOTION — PENGATURAN (edit file ini, lalu push / deploy)
 * ============================================================
 *  Tidak perlu Environment Variable apa pun. Semua yang ada di
 *  sini tampil di website (bukan rahasia), jadi JANGAN taruh
 *  password / token / API key di file ini.
 * ============================================================
 */
module.exports = {
  // Nama yang tampil di judul tab & lencana halaman utama.
  SITE_NAME: 'Xmotion Vincent Zye',

  // Teks besar di bagian paling atas halaman utama.
  BRAND_TITLE: 'Vincent X Zye',

  // Ditambahkan di akhir kalimat pembuka halaman utama.
  TAGLINE_BY: 'By vincent.',

  // Logo di atas judul.
  // CARA TERCEPAT: simpan gambar logo (ikon aplikasi) di folder public/ dengan nama
  //   logo-am.png  (atau logo-am.webp / logo-am.jpg / logo-am.svg)
  // lalu deploy ulang. Otomatis dipakai, tidak perlu mengisi apa pun di sini.
  // Sekarang: memakai logo AM asli di public/logo-am.jpg. Untuk kembali ke monogram bawaan: hapus file itu DAN kosongkan nilai di bawah.
  // Isi manual hanya kalau nama filenya lain, mis. '/ikon.png'.
  LOGO_URL: '/logo-am.jpg',

  // Nama pemilik, tampil di footer.
  OWNER_NAME: 'Vincent',

  // Teks footer. {owner} otomatis diganti OWNER_NAME.
  FOOTER_TEXT: '© 2026 {owner}. All rights reserved.',

  // Tombol panah (kanan atas) → menu kontak. Isi URL lengkap (https://...).
  // Yang dikosongkan tidak akan ditampilkan.
  CONTACTS: {
    telegram: 'https://t.me/pakvncnt',
    channel: 'https://t.me/testipakvncnt',
    developer: 'https://t.me/pakvncnt',
  },
};
