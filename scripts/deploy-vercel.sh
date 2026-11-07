#!/usr/bin/env bash
# Deploy Xmotion ke Vercel (satu-satunya target deployment yang didukung).
set -euo pipefail

need() { command -v "$1" >/dev/null 2>&1 || { echo "✗ '$1' tidak ditemukan. $2"; exit 1; }; }

need node "Pasang Node.js 20+."
need npx  "Pasang Node.js 20+."

if [ -z "${VERCEL_TOKEN:-}" ] && [ ! -f "$HOME/.vercel/auth.json" ] && [ ! -f "$HOME/.local/share/com.vercel.cli/auth.json" ]; then
  echo "✗ Belum login Vercel. Jalankan: npx vercel login"
  echo "  (atau set VERCEL_TOKEN untuk CI)"
  exit 1
fi

if [ -z "${AUTH_SECRET:-}" ] && ! grep -Eq "AUTH_SECRET: *'[^']{16,}'" config.js; then
  echo "⚠  AUTH_SECRET belum diisi. Isi di config.js (repo private) atau di"
  echo "   Vercel → Settings → Environment Variables → AUTH_SECRET"
fi

echo "→ Build produksi lokal (verifikasi dulu)…"
npm run build

echo "→ Deploy ke Vercel…"
npx --yes vercel deploy --prod --yes

echo "✓ Selesai. Pastikan AUTH_SECRET sudah diset di Vercel, lalu redeploy bila baru ditambahkan."
echo "  PERINGATAN: data JSON di Vercel disimpan di /tmp dan hilang saat cold start."
