import cfg from '../config';

/** Pengaturan situs dari config.js — aman dibaca di browser (tidak ada rahasia di sini). */
export type ContactLink = { label: string; url: string };

export const SITE_NAME: string = cfg.SITE_NAME || 'Xmotion';
export const BRAND_TITLE: string = cfg.BRAND_TITLE || 'Vincent X Zye';
export const TAGLINE_BY: string = cfg.TAGLINE_BY || '';
export const LOGO_URL: string = cfg.LOGO_URL || '';
export const OWNER_NAME: string = cfg.OWNER_NAME || '';
export const FOOTER_TEXT: string = cfg.FOOTER_TEXT || '';

const LABELS: [keyof typeof cfg.CONTACTS, string][] = [
  ['telegram', 'Telegram'],
  ['channel', 'Channel'],
  ['developer', 'Developer'],
];

/** Hanya link yang diisi dan berawalan http(s) yang ditampilkan. */
export const CONTACTS: ContactLink[] = LABELS.map(([k, label]) => ({
  label,
  url: String((cfg.CONTACTS as Record<string, string>)[k] ?? '').trim(),
})).filter((c) => /^https?:\/\//i.test(c.url));
