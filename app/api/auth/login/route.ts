import { z } from 'zod';
import { findUserByEmail } from '@/lib/store';
import { assertAuthConfigured, createSession, verifyPassword } from '@/lib/auth';
import { fail, handleError, ok, rateLimit, clientIp } from '@/lib/http';

export const runtime = 'nodejs';

const Body = z.object({
  email: z.string().trim().toLowerCase().email('Format email tidak valid.'),
  password: z.string().min(1, 'Kata sandi wajib diisi.'),
});

export async function POST(req: Request) {
  try {
    if (!rateLimit(`login:${clientIp(req)}`, 20, 60_000)) {
      return fail('Terlalu banyak percobaan masuk. Coba lagi sebentar.', 429, 'RATE_LIMIT');
    }
    assertAuthConfigured();
    const body = Body.parse(await req.json());
    const row = await findUserByEmail(body.email);
    if (!row) return fail('Email atau kata sandi salah.', 401, 'BAD_CREDENTIALS');
    const valid = await verifyPassword(body.password, row.passwordHash);
    if (!valid) return fail('Email atau kata sandi salah.', 401, 'BAD_CREDENTIALS');

    const user = { id: row.id, email: row.email, name: row.name };
    await createSession(user);
    return ok({ user });
  } catch (err) {
    return handleError(err);
  }
}
