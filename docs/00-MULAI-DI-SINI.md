# Xmotion — Paket Serah Terima

Isi paket:
- `app/` halaman + API route (Next.js 15 App Router)
- `components/` UI (landing, player, stage, dashboard, auth)
- `lib/` parser XML, renderer canvas, store (JSON), auth, http helper, tipe
- `public/sample-preset.xml` preset contoh yang benar-benar diparse
- `scripts/` deploy-vercel.sh
- `tests/` uji unit + uji integrasi 36 skenario
- `docs/` README lengkap + laporan pengujian

Mulai cepat:
```bash
npm install
# edit config.js → isi AUTH_SECRET
npm run dev
```

Deploy (Vercel saja):
```bash
bash scripts/deploy-vercel.sh
```

Baca `docs/README.md` untuk inventaris menu, cara kerja fitur, matriks fitur, daftar API,
dan Environment Variables. Baca `docs/05-laporan-pengujian.md` untuk hasil uji nyata dan
daftar hal yang belum terverifikasi.
