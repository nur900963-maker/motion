'use client';

import { IconAlert, IconX } from './icons';

type Share = { title?: string; description?: string; image?: string; sizeMb?: number; url: string };

/** Kartu info untuk link share Alight Motion: metadata publik + cara mendapatkan file XML. */
export default function ShareCard({ share, onClose }: { share: Share; onClose: () => void }) {
  const big = typeof share.sizeMb === 'number' && share.sizeMb > 5;
  return (
    <div className="fade-in mt-3 overflow-hidden rounded-xl border border-[var(--line)] bg-[#0e0e11]">
      <div className="flex gap-3 p-3">
        {share.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={share.image}
            alt=""
            referrerPolicy="no-referrer"
            loading="lazy"
            className="h-20 w-20 shrink-0 rounded-lg bg-[#17171b] object-cover"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--accent)]">Link share Alight Motion</p>
          <p className="mt-0.5 break-words text-sm font-semibold leading-snug">{share.title ?? 'Project tanpa judul'}</p>
          {share.description && <p className="mt-1 text-[11px] leading-snug text-[var(--muted)]">{share.description}</p>}
        </div>
        <button type="button" className="btn btn-sm btn-icon h-7 w-7 shrink-0" onClick={onClose} aria-label="Tutup">
          <IconX size={12} />
        </button>
      </div>

      {big && (
        <p className="mx-3 mb-2 flex gap-2 rounded-lg bg-[#2a2111] px-2.5 py-2 text-[11px] leading-snug text-[var(--warn)]">
          <IconAlert size={13} className="mt-0.5 shrink-0" />
          <span>
            Package {share.sizeMb?.toFixed(1)} MB. Menurut dokumentasi Alight Motion, package di atas 5 MB hanya bisa
            diimport oleh member.
          </span>
        </p>
      )}

      <div className="border-t border-[var(--line)] p-3">
        <p className="text-[11px] font-semibold">Cara memutarnya di sini</p>
        <p className="mt-1 text-[11px] leading-relaxed text-[var(--muted)]">
          Isi package ada di server Alight Motion dan hanya bisa dibuka oleh aplikasinya, jadi website ini tidak bisa
          mengambilnya dari link. Caranya:
        </p>
        <ol className="mt-1.5 list-decimal space-y-1 pl-4 text-[11px] leading-relaxed text-[var(--muted)]">
          <li>Buka link ini di HP yang ada aplikasi Alight Motion, lalu import project-nya.</li>
          <li>Di Alight Motion, ekspor project sebagai file XML (menu ekspor/bagikan).</li>
          <li>Kembali ke sini dan pakai <b className="text-[var(--paper)]">Upload Preset XML dari Perangkat</b>.</li>
        </ol>
        <a
          href={share.url}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-sm mt-3 w-full justify-center"
        >
          Buka link di Alight Motion
        </a>
      </div>
    </div>
  );
}
