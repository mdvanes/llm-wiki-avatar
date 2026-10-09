'use client';

import { useEffect } from 'react';

/** Keeps the screen on while `active`, so a hands-free session is not cut off by the screen lock. */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | undefined;
    let released = false;
    const acquire = () => {
      if (released || document.visibilityState !== 'visible') return;
      navigator.wakeLock
        .request('screen')
        .then((sentinel) => {
          if (released) void sentinel.release();
          else lock = sentinel;
        })
        .catch(() => undefined);
    };
    acquire();
    // The browser drops the lock whenever the page is hidden.
    document.addEventListener('visibilitychange', acquire);
    return () => {
      released = true;
      document.removeEventListener('visibilitychange', acquire);
      void lock?.release().catch(() => undefined);
    };
  }, [active]);
}
