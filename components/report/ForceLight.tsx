'use client';

import { useEffect } from 'react';

/** Reports are always light (SPEC §7d): switch <html data-mode> to light while mounted, restore it on the way out. */
export function ForceLight() {
  useEffect(() => {
    const el = document.documentElement;
    const before = el.getAttribute('data-mode');
    el.setAttribute('data-mode', 'light');
    return () => {
      if (before) el.setAttribute('data-mode', before);
    };
  }, []);
  return null;
}
