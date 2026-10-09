import { connection } from 'next/server';
import { App } from '@/components/App';
import { IS_DEMO } from '@/lib/basePath';
import { DEFAULT_PRESENTATION } from '@/lib/presentation';

export default async function Page() {
  // Read the settings per request, so changing .env needs a restart but no rebuild. The demo is static.
  if (IS_DEMO) return <App defaultPresentation={DEFAULT_PRESENTATION} />;
  await connection();
  const { serverConfig } = await import('@/lib/server-config');
  return <App defaultPresentation={serverConfig().defaultPresentation} />;
}
