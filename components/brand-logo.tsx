import { LOGO_URL } from '@/lib/site';

/**
 * Logo "AM" di atas judul. Bawaan: monogram gambar sendiri (bukan logo resmi Alight Motion).
 * Untuk memakai logo lain, isi LOGO_URL di config.js dengan file di folder public/.
 */
export default function BrandLogo({ size = 60 }: { size?: number }) {
  if (LOGO_URL) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={LOGO_URL} alt="Logo" width={size} height={size} className="rounded-2xl object-contain" style={{ width: size, height: size }} />;
  }
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="Logo AM" className="shrink-0">
      <defs>
        <linearGradient id="am-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1fc8ee" />
          <stop offset="1" stopColor="#6c5cff" />
        </linearGradient>
        <linearGradient id="am-sh" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.28" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="16" fill="url(#am-bg)" />
      <rect x="2" y="2" width="60" height="30" rx="16" fill="url(#am-sh)" />
      {/* A */}
      <path d="M9 47 L21 17 L25 17 L37 47 L31.6 47 L28.6 39 L17.4 39 L14.4 47 Z M19 34.5 L27 34.5 L23 23.5 Z" fill="#fff" fillRule="evenodd" />
      {/* M */}
      <path d="M38 47 V17 H43.2 L49.5 33 L55.8 17 H61 V47 H56 V28 L50.8 41 H48.2 L43 28 V47 Z" fill="#fff" fillOpacity="0.92" />
    </svg>
  );
}
