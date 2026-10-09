import type { Metadata } from 'next';
import { connection } from 'next/server';
import { SettingsView } from '@/components/SettingsView';
import { IS_DEMO } from '@/lib/basePath';

export const metadata: Metadata = {
  title: 'Settings · LLM Wiki Avatar',
};

export default async function Page() {
  // The demo has no backend, so no model connection to show.
  if (IS_DEMO) return <SettingsView modelConfig={null} />;
  await connection();
  const { modelSettings } = await import('@/lib/server-config');
  return <SettingsView modelConfig={modelSettings()} />;
}
