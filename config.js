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

  // Logo di atas judul. Kosongkan untuk memakai logo "AM" bawaan (gambar buatan sendiri).
  // Mau pakai logo sendiri: taruh filenya di folder public/ lalu isi, mis. '/logo-am.png'.
  LOGO_URL: '',

  // Nama pemilik, tampil di footer.
  OWNER_NAME: 'Vincent Zye',

  // Teks footer. {owner} otomatis diganti OWNER_NAME.
  FOOTER_TEXT: '© 2025 {owner}. All rights reserved.',

  // Tombol panah (kanan atas) → menu kontak. Isi URL lengkap (https://...).
  // Yang dikosongkan tidak akan ditampilkan.
  CONTACTS: {
    telegram: 'https://t.me/',
    channel: 'https://t.me/',
    developer: 'https://t.me/',
  },
};
