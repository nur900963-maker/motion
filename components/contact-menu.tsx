'use client';

import { useEffect, useRef, useState } from 'react';
import { CONTACTS } from '@/lib/site';
import { IconChevronDown, IconCode, IconMegaphone, IconSend } from './icons';

const ICONS: Record<string, typeof IconSend> = {
  Telegram: IconSend,
  Channel: IconMegaphone,
  Developer: IconCode,
};

/** Tombol panah → menu kontak. Link diatur di config.js (CONTACTS). */
export default function ContactMenu() {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!CONTACTS.length) return null;

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        className="btn btn-icon"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Kontak"
        onClick={() => setOpen((v) => !v)}
      >
        <IconChevronDown size={18} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          role="menu"
          className="fade-in card absolute right-0 top-[calc(100%+8px)] z-40 w-52 overflow-hidden p-1.5 shadow-2xl"
        >
          {CONTACTS.map((c) => {
            const Icon = ICONS[c.label] ?? IconSend;
            return (
              <a
                key={c.label}
                role="menuitem"
                href={c.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-[var(--paper)] transition hover:bg-[#17171c]"
                onClick={() => setOpen(false)}
              >
                <Icon size={16} className="text-[var(--accent)]" />
                {c.label}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
