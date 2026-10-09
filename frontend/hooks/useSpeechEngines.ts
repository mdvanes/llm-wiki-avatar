'use client';

import { useEffect, useState } from 'react';
import { ENGINE_KEYS, type Engine, loadEngine } from '@/lib/speech/engine';

export interface Engines {
  /** `undefined` until the stored choice has been read in the browser. */
  input?: Engine;
  output?: Engine;
}

/** The speech engines chosen on the settings page; follows changes made there in another tab. */
export function useSpeechEngines(): Engines {
  const [engines, setEngines] = useState<Engines>({});
  useEffect(() => {
    const read = () => setEngines({ input: loadEngine('input'), output: loadEngine('output') });
    read();
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === ENGINE_KEYS.input || e.key === ENGINE_KEYS.output) read();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  return engines;
}
