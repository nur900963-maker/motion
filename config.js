/**
 * ============================================================
 *  XMOTION — KONFIGURASI (ganti .env.example)
 * ============================================================
 *  Edit nilai di bawah, lalu deploy / jalankan ulang.
 *
 *  Urutan prioritas:
 *    1. Environment Variable di Vercel / server (kalau ada, MENANG)
 *    2. Nilai di file ini
 *
 *  ⚠️  KEAMANAN — BACA INI:
 *  AUTH_SECRET dipakai untuk menandatangani cookie login.
 *  Kalau repo GitHub kamu PUBLIK dan kamu isi AUTH_SECRET di sini,
 *  siapa pun bisa membaca secret-nya lalu memalsukan login sebagai
 *  user mana pun. Pilih salah satu:
 *    a) Repo PRIVATE  → boleh isi AUTH_SECRET di file ini.
 *    b) Repo PUBLIK   → biarkan AUTH_SECRET kosong di sini dan isi
 *       lewat Vercel → Settings → Environment Variables.
 * ============================================================
 */
module.exports = {
  // WAJIB. Minimal 16 karakter, acak. Contoh cara bikin:
  //   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
  AUTH_SECRET: 'buka123',

  // Batas unggah media (MB). Di Vercel otomatis dibatasi maksimal 4 MB.
  MAX_UPLOAD_MB: 12,

  // Folder data JSON. Hanya berlaku di luar Vercel (di Vercel selalu /tmp).
  // Kosongkan untuk memakai ./data
  DATA_DIR: '',
};
