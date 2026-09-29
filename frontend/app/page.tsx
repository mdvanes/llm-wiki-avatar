import { App } from '@/components/App';
import { serverConfig } from '@/lib/server-config';

// Read the avatar settings per request, so changing .env needs a restart but no rebuild.
export const dynamic = 'force-dynamic';

export default function Page() {
  return <App avatar={serverConfig().avatar} />;
}
