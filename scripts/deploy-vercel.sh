#!/usr/bin/env bash
# Deploy Xmotion ke Vercel (satu-satunya target deployment yang didukung).
set -euo pipefail

command -v node >/dev/null 2>&1 || { echo "✗ Pasang Node.js 20+."; exit 1; }

if [ -z "${VERCEL_TOKEN:-}" ] && [ ! -f "$HOME/.vercel/auth.json" ] && [ ! -f "$HOME/.local/share/com.vercel.cli/auth.json" ]; then
  echo "✗ Belum login Vercel. Jalankan: npx vercel login (atau set VERCEL_TOKEN untuk CI)"
  exit 1
fi

echo "→ Build produksi lokal…"
npm run build
echo "→ Deploy ke Vercel…"
npx --yes vercel deploy --prod --yes
echo "✓ Selesai. Tidak ada Environment Variable yang wajib."
