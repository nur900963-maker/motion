import Link from 'next/link';

export const metadata = { title: 'Cara kerja — Xmotion' };

const SECTIONS = [
  {
    h: '1. Impor preset',
    p: 'Ada tiga jalur masuk: unggah file .xml dari perangkat (boleh 2 file: preset + grup/cc), tempel link share Alight Motion, atau tempel link file XML Google Drive yang publik. Ketiganya berakhir di endpoint yang sama — /api/presets/parse atau /api/presets/import — yang memvalidasi XML lalu membangun model scene.',
  },
  {
    h: '2. Parsing XML',
    p: 'Parser membaca <project>/<scene>/<layer>. Nilai properti dibaca dari atribut (value="…") maupun elemen anak <property name="…"><kf t="…" v="…"/></property>. Properti yang tidak ditemukan dibiarkan pada default dan dicatat sebagai peringatan — tidak ada nilai yang dikarang.',
  },
  {
    h: '3. Render',
    p: 'Renderer canvas 2D menggambar setiap layer aktif pada waktu t, dengan interpolasi linear antar keyframe untuk location, scale, rotation, dan opacity. Efek yang dikenali (blur, glow, sharpen, vignette, exposure, satvasi) dipetakan ke filter canvas; efek lain diabaikan dan dilaporkan.',
  },
  {
    h: '4. Media',
    p: 'Media diunggah ke /api/media. File disimpan sebagai berkas di folder data server dan disajikan lewat /api/media/:id/raw (di Vercel dibatasi 4 MB per file). Slot media pada layer dipasangkan dengan id media, sehingga preview langsung berubah.',
  },
  {
    h: '5. Ekspor',
    p: 'Ekspor merender ulang scene ke canvas offscreen pada resolusi terpilih, merekamnya dengan MediaRecorder, lalu mengunggah hasilnya ke /api/exports. Hasil disimpan di folder data server (di Vercel hanya bila ≤ 4 MB) dan bisa diunduh lagi dari riwayat ekspor.',
  },
  {
    h: '6. Akun & penyimpanan',
    p: 'Sesi memakai JWT HttpOnly (AUTH_SECRET). Proyek, media, dan ekspor disimpan sebagai file JSON di folder data dan terikat ke pemiliknya (di Vercel sifatnya sementara); setiap endpoint memeriksa kepemilikan sebelum membaca atau mengubah data.',
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
