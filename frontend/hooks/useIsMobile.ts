'use client';

import { useEffect, useState } from 'react';

/** Below Tailwind's `lg` breakpoint: phones and small tablets, where the layout is reduced to the essentials. */
export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 1023px)');
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return mobile;
}
