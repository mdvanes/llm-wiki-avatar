'use client';

import { useEffect, useState } from 'react';
import { CONTINUOUS_KEY, loadContinuous } from '@/lib/continuous';

/** The continuous-listening setting; follows changes made on the settings page in another tab. */
export function useContinuousMode(): boolean {
  const [continuous, setContinuous] = useState(false);
  useEffect(() => {
    setContinuous(loadContinuous());
    const onStorage = (e: StorageEvent) => {
      if (e.key === CONTINUOUS_KEY || e.key === null) setContinuous(loadContinuous());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  return continuous;
}
