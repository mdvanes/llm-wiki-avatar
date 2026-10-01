import { App } from '@/components/App';
import { serverConfig } from '@/lib/server-config';

// Read the settings per request, so changing .env needs a restart but no rebuild.
export const dynamic = 'force-dynamic';

export default function Page() {
  return <App defaultPresentation={serverConfig().defaultPresentation} />;
}
