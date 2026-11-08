import type { Metadata, Viewport } from 'next';
import './globals.css';
import { SITE_NAME } from '@/lib/site';

export const metadata: Metadata = {
  title: `${SITE_NAME} — Preset AM Player`,
  description:
    'Xmotion Rendering Engine. Impor preset Alight Motion (XML, link share, atau Google Drive), pasang media kamu, lalu ekspor video langsung dari browser.',
  applicationName: SITE_NAME,
  icons: {
    icon: [
      {
        url:
          "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%23000'/%3E%3Cpath d='M18 18l28 28M46 18L18 46' stroke='%23ededeb' stroke-width='7' stroke-linecap='round'/%3E%3C/svg%3E",
        type: 'image/svg+xml',
      },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: '#050505',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
