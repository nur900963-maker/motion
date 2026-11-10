import Link from 'next/link';

import { SITE_NAME } from '@/lib/site';

export const metadata = { title: `Cara kerja — ${SITE_NAME}` };

const SECTIONS = [
  {
    h: '1. Impor preset',
    p: 'Ada tiga jalur: unggah file .xml dari perangkat (boleh 2 file: preset + grup), tempel link file XML langsung, atau tempel link file XML Google Drive yang publik. File dari perangkat diproses sepenuhnya di browser. Link diambil oleh server (browser terblokir CORS), lalu XML-nya dikirim balik ke browser; batas file lewat link ±4 MB. Link share resmi Alight Motion (alightcreative.com/am/share/…) hanya halaman web berisi judul, ukuran, dan thumbnail; isi package-nya hanya bisa dibuka aplikasi Alight Motion. Website menampilkan info link itu dan cara mendapatkan file XML-nya.',
  },
  {
    h: '2. Parsing XML',
    p: 'Parser membaca format ekspor Alight Motion: <scene> berisi <shape>/<video>/<image>/<audio>, dengan <transform> (location, scale, rotation, opacity), <property size>, <fillColor>/<gradient>, dan <effect>. Waktu keyframe pada XML berupa fraksi durasi layer, dikonversi ke milidetik; kurva cubicBezier dipakai untuk easing. Urutan layer mengikuti urutan di file. Elemen yang tidak dikenali dilewati dan dilaporkan sebagai peringatan, tidak ada nilai yang dikarang.',
  },
  {
    h: '3. Render',
    p: 'Renderer WebGL2 menggambar tiap layer aktif: posisi, skala, rotasi, opacity (dengan easing), isian media/warna/gradien, bentuk rect/roundrect/circle, parent (null object), scene bersarang (embedScene), dan mode blend. Efek dijalankan sebagai shader GPU sehingga sama di Chrome, Firefox, dan Safari/iPhone. Efek yang tersedia: tile, wipe, wavewarp, randomdisplace, zoomblur, circularripple, displacemap, stretchsegment, mirror, gradientoverlay, fourcolorgradient, lumakey, gaussianblur, hueshift, exposure, satvib, sharpen, brightcont, oscillate, swing, motionblur, lift, fade. Efek `lift` dibaca sebagai: efek sesudahnya diterapkan ke gambar di bawah layer, hanya di dalam bentuk layer (hipotesis dari pola data preset). Rumus asli Alight Motion tidak dipublikasikan, jadi semua efek adalah PERKIRAAN dari nama dan nilai parameternya; hasilnya bisa berbeda dari aplikasi aslinya. Efek yang belum punya implementasi dilaporkan di tab Proyek.',
  },
  {
    h: '4. Media',
    p: 'XML Alight Motion hanya merujuk media dari perangkat asal, jadi kamu memasang media sendiri di tab Media. Slot digabung per media asal: satu foto yang dipakai banyak layer cukup dipasang sekali. Media yang tertanam di preset (ref "am:...") tidak ikut di file XML dan harus kamu sediakan sendiri. Media tersimpan di browser kamu (tidak diunggah ke server).',
  },
  {
    h: '5. Audio',
    p: 'Di tab Audio kamu bisa memasang file ke layer audio preset, atau menambah audio sendiri (musik/voice over) dengan waktu mulai, potong awal, dan volume. Audio terdengar di preview dan ikut tercampur ke hasil ekspor. Suara dari layer video di dalam preset belum diputar.',
  },
  {
    h: '6. Ekspor',
    p: 'Ekspor merender scene secara real-time ke canvas dengan resolusi terpilih lalu merekamnya dengan MediaRecorder, lengkap dengan audio. Format: MP4 (H.264/AAC) bila browser mendukung, kalau tidak WebM. Karena real-time, perangkat yang lambat bisa menjatuhkan frame; turunkan resolusi bila gerakan terasa patah. Tidak ada yang diunggah ke server.',
  },
  {
    h: '7. Performa',
    p: 'Preview digambar langsung ke GPU tanpa merender ulang antarmuka setiap frame, dibatasi sesuai fps preset (maks 60, tidak boros di layar 90/120 Hz), dan kualitasnya turun sendiri bila perangkat tidak sanggup (Setelan → Kualitas). Foto besar diperkecil ke 2048 px saat dimuat. Preview otomatis dijeda saat aplikasi dibuka di latar belakang. Kualitas preview tidak memengaruhi hasil ekspor.',
  },
  {
    h: '8. Tanpa akun',
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
          <li>• Efek dirender sebagai perkiraan, bukan salinan persis Alight Motion (rumus aslinya tidak dipublikasikan).</li>
          <li>• Ekspor real-time lewat MediaRecorder: MP4 (H.264) bila browser mendukung, kalau tidak WebM. Perangkat lambat bisa menjatuhkan frame; turunkan resolusi.</li>
          <li>• Link share Alight Motion tidak bisa diputar langsung; perlu file XML hasil ekspor dari aplikasinya.</li>
          <li>• Media preset tidak ikut di XML; pasang manual di tab Media.</li>
          <li>• Belum dirender: shadow layer, teks, dan suara dari layer video.</li>
        </ul>
      </section>
    </main>
  );
}
