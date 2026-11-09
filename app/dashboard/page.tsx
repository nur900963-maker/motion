import Dashboard from '@/components/dashboard';

import { SITE_NAME } from '@/lib/site';

export const metadata = { title: `Proyek saya — ${SITE_NAME}` };

export default function Page() {
  return <Dashboard />;
}
