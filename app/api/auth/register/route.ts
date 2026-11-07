import { z } from 'zod';
import { createUser, findUserByEmail } from '@/lib/store';
import { assertAuthConfigured, createSession, hashPassword } from '@/lib/auth';
import { fail, handleError, ok, rateLimit, clientIp } from '@/lib/http';

export const runtime = 'nodejs';

const Body = z.object({
  name: z.string().trim().min(2, 'Nama minimal 2 karakter.').max(60),
  email: z.string().trim().toLowerCase().email('Format email tidak valid.'),
  password: z.string().min(8, 'Kata sandi minimal 8 karakter.').max(200),
});

export async function POST(req: Request) {
  try {
    if (!rateLimit(`reg:${clientIp(req)}`, 10, 60_000)) {
      return fail('Terlalu banyak percobaan. Coba lagi sebentar.', 429, 'RATE_LIMIT');
    }
    assertAuthConfigured(); // jangan buat akun bila sesi tidak mungkin dibuat
    const body = Body.parse(await req.json());
    if (await findUserByEmail(body.email)) {
      return fail('Email ini sudah terdaftar. Silakan masuk.', 409, 'EMAIL_TAKEN');
    }

    const hash = await hashPassword(body.password);
    // createUser mengecek ulang email di dalam lock (cegah dua pendaftaran bersamaan).
    const row = await createUser({ email: body.email, name: body.name, passwordHash: hash });
    if (!row) return fail('Email ini sudah terdaftar. Silakan masuk.', 409, 'EMAIL_TAKEN');
    const user = { id: row.id, email: row.email, name: row.name };
    await createSession(user);
    return ok({ user }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}
