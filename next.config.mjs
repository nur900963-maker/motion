import { existsSync } from 'node:fs';

// Logo drop-in: taruh file logo di folder public/ dengan salah satu nama ini, lalu deploy.
// Dideteksi saat build supaya tidak ada permintaan 404 bila filenya tidak ada.
const LOGO_FILE = ['logo-am.png', 'logo-am.webp', 'logo-am.jpg', 'logo-am.jpeg', 'logo-am.svg'].find((f) =>
  existsSync(new URL(`./public/${f}`, import.meta.url)),
);

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: { NEXT_PUBLIC_LOGO_FILE: LOGO_FILE ? `/${LOGO_FILE}` : '' },
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    serverActions: { bodySizeLimit: '16mb' },
    cpus: 1,
    workerThreads: false,
    staticGenerationMaxConcurrency: 1,
    staticGenerationMinPagesPerWorker: 100,
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        ],
      },
    ];
  },
};
export default nextConfig;
