import type { Metadata } from 'next';
import { SettingsView } from '@/components/SettingsView';

export const metadata: Metadata = {
  title: 'Speech settings · LLM Wiki Avatar',
};

export default function Page() {
  return <SettingsView />;
}
