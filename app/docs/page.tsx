import Link from 'next/link';

import { SITE_NAME } from '@/lib/site';

export const metadata = { title: `Cara kerja — ${SITE_NAME}` };

const SECTIONS = [
  {
    h: '1. Impor preset',
    p: 'Ada tiga jalur: unggah file .xml dari perangkat (boleh 2 file: preset + grup), tempel link yang langsung mengarah ke file XML, atau tempel link file XML Google Drive yang publik. File dari perangkat diproses sepenuhnya di browser. Link diambil oleh server (browser terblokir CORS), lalu XML-nya dikirim balik ke browser untuk diproses; batas file lewat link ±4 MB.',
  },
  {
    h: '2. Parsing XML',
    p: 'Parser membaca format ekspor Alight Motion: <scene> berisi <shape>/<video>/<image>/<audio>, dengan <transform> (location, scale, rotation, opacity), <property size>, <fillColor>/<gradient>, dan <effect>. Waktu keyframe pada XML berupa fraksi durasi layer, dikonversi ke milidetik; kurva cubicBezier dipakai untuk easing. Urutan layer mengikuti urutan di file. Elemen yang tidak dikenali dilewati dan dilaporkan sebagai peringatan, tidak ada nilai yang dikarang.',
  },
  {
    h: '3. Render',
    p: 'Renderer canvas 2D menggambar setiap layer aktif pada waktu t: posisi, skala, rotasi, opacity (dengan easing cubic-bezier, elastic/reverse elastic, bounce, dan hold), isian media/warna/gradien, bentuk rect/roundrect/circle, mode blend, stroke, dan glow/bayangan. Efek yang dihampiri di canvas: tile (mirror tile), oscillate, swing, fade, wipe, motionblur (sampling transform), lumakey, randomdisplace, wavewarp, zoomblur, circularripple, mirror, stretchsegment, displacemap (noise), fourcolorgradient, gradientoverlay, exposure, brightcont, lift, gaussianblur, hueshift, satvib, dan sharpen. Semuanya adalah perkiraan canvas 2D — bukan salinan shader Alight Motion — tapi pola gerak dan tampilannya mendekati. Efek di luar daftar ini tetap dilaporkan di tab Proyek.',
  },
  {
    h: '3b. Audio',
    p: 'Tab Audio bisa menambah lagu/suara (MP3, M4A, WAV, OGG) langsung dari perangkat sebagai track scene: atur waktu mulai, volume, mute, atau hapus. Track audio bawaan preset juga bisa dipasang file-nya. Semua audio diputar sinkron dengan timeline di preview dan ikut masuk hasil ekspor bila opsi "Sertakan audio" aktif.',
  },
  {
    h: '4. Media',
    p: 'XML Alight Motion hanya merujuk media dari perangkat asal, jadi kamu memasang media sendiri di tab Media. Satu foto otomatis dipasang ke semua layer yang merujuk foto asal yang sama. Media tersimpan di browser kamu (tidak diunggah ke server).',
  },
  {
    h: '5. Ekspor',
    p: 'Ekspor merender ulang scene ke canvas pada resolusi terpilih, merekamnya dengan MediaRecorder, lalu hasilnya bisa langsung disimpan ke perangkat. Format keluaran bergantung pada dukungan browser (umumnya WebM). Tidak ada yang diunggah ke server.',
  },
  {
    h: '6. Tanpa akun',
    p: 'Tidak ada login. "Proyek saya" menyimpan scene dan media di penyimpanan browser (IndexedDB) perangkat ini, jadi tidak ikut pindah ke perangkat lain dan hilang bila data situs dihapus.',
  },
];

export default function Docs() {
  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-10">
      <Link href="/" className="mb-6 inline-flex items-center gap-2 text-xs text-[var(--muted)] hover:text-[var(--paper)]">
        ← Kembali
      </Link>
      <h1 className="text-2xl font-bold tracking-tight">Cara kerja Xmotion</h1>
      <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
        Ringkasan alur nyata aplikasi ini — dari file XML sampai video hasil ekspor.
      </p>

      <div className="mt-7 space-y-5">
        {SECTIONS.map((s) => (
          <section key={s.h} className="card p-4">
            <h2 className="text-sm font-semibold">{s.h}</h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-[#b3b9c6]">{s.p}</p>
          </section>
        ))}
      </div>

      <section className="card mt-5 p-4">
        <h2 className="text-sm font-semibold">Pintasan papan tik</h2>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] text-[var(--muted)]">
          <dt>Spasi</dt>
          <dd>putar / jeda</dd>
          <dt>← / →</dt>
          <dd>mundur / maju 1 frame</dd>
          <dt>Shift + ← / →</dt>
          <dd>mundur / maju 1 detik</dd>
          <dt>Home / End</dt>
          <dd>ke awal / akhir</dd>
          <dt>+ / −</dt>
          <dd>zoom timeline</dd>
          <dt>L / R / M</dt>
          <dd>loop / reset / bisukan</dd>
          <dt>B</dt>
          <dd>pasang atau buang penanda</dd>
        </dl>
      </section>

      <section className="card mt-5 p-4">
        <h2 className="text-sm font-semibold">Batasan yang diketahui</h2>
        <ul className="mt-2 space-y-1.5 text-[12px] leading-relaxed text-[var(--muted)]">
          <li>• Efek shader kompleks Alight Motion tidak direplikasi; hanya subset filter canvas.</li>
          <li>• Ekspor memakai MediaRecorder, jadi formatnya WebM (atau MP4 bila browser mendukung).</li>
          <li>• Link share Alight Motion hanya bisa diimpor bila halamannya mengembalikan XML publik.</li>
          <li>• Media preset dari link share tidak otomatis terunduh; tambahkan manual di tab Media.</li>
        </ul>
      </section>
    </main>
  );
}
