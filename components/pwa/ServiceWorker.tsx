'use client';

import { useEffect } from 'react';

/** Registers /sw.js once per page load. Production builds only: in dev it would cache stale bundles between edits. */
export function ServiceWorker({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (!enabled || !('serviceWorker' in navigator) || !window.isSecureContext) return;
    // ponytail: a failed registration only means no offline page on this device; push setup registers again on demand
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
  }, [enabled]);
  return null;
}
