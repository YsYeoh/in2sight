'use client';

import { useEffect } from 'react';
import { FORCE_LIGHT_ATTR } from '@/components/providers/PrefsProvider';

/** Reports are always light (SPEC §7d): switch <html data-mode> to light while mounted, restore it on the way out. */
export function ForceLight() {
  useEffect(() => {
    const el = document.documentElement;
    const before = el.getAttribute('data-mode');
    el.setAttribute(FORCE_LIGHT_ATTR, 'true'); // the preferences code (Auto listener, cross-tab sync) then leaves data-mode alone
    el.setAttribute('data-mode', 'light');
    return () => {
      el.removeAttribute(FORCE_LIGHT_ATTR);
      if (before) el.setAttribute('data-mode', before);
    };
  }, []);
  return null;
}
