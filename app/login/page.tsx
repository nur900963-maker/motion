import { Suspense } from 'react';
import AuthForm from '@/components/auth-form';

export const metadata = { title: 'Masuk — Xmotion' };

export default function Page() {
  return (
    <Suspense fallback={<div className="grid min-h-dvh place-items-center text-sm text-[var(--muted)]">Memuat…</div>}>
      <AuthForm mode="login" />
    </Suspense>
  );
}
