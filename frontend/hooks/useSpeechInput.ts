'use client';

import type { Language } from '@/lib/language';
import type { SttModel } from '@/lib/stt/models';
import { type PushToTalk, usePushToTalk } from './usePushToTalk';
import { useSpeechEngines } from './useSpeechEngines';
import { useWebSpeechInput } from './useWebSpeechInput';

interface Options {
  /** The on-device model; only loaded when the on-device engine is chosen. */
  model: SttModel | undefined;
  language: Language;
  continuous?: boolean;
  paused?: boolean;
  onPress?: () => void;
  onResult: (text: string, elapsedMs: number) => void;
}

/** Speech input with the engine chosen in the settings. Both hooks always run; the one that is not chosen stays idle. */
export function useSpeechInput({ model, ...rest }: Options): PushToTalk & { engine?: 'device' | 'browser' } {
  const { input } = useSpeechEngines();
  const device = usePushToTalk({
    model: input === 'device' ? model : undefined,
    ...rest,
  });
  const browser = useWebSpeechInput({ enabled: input === 'browser', ...rest });
  return { ...(input === 'browser' ? browser : device), engine: input };
}
