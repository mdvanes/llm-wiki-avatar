import type { Metadata } from 'next';
import { SettingsView } from '@/components/SettingsView';
import { modelSettings } from '@/lib/server-config';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Settings · LLM Wiki Avatar',
};

export default function Page() {
  return <SettingsView modelConfig={modelSettings()} />;
}
