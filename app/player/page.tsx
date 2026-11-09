import Player from '@/components/player';

import { SITE_NAME } from '@/lib/site';

export const metadata = { title: `${SITE_NAME} — Preset Player` };

export default function Page() {
  return <Player />;
}
