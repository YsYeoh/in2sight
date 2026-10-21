'use client';

// A page that is not a tab page (login, 2FA, setup, sign-out, the report preview…) must never render inside a tab's
// frame (Plan 14c): it takes over the whole window. Mounted in the ROOT layout, so it also runs on pages outside the
// (app) group, and after a proxy redirect or a server-action redirect to /login inside a frame. Same origin, so the
// frame may navigate the top window itself; this works even if the shell's own script failed.
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { isTabPath } from '@/lib/tabs/model';
import { isFramed } from '@/lib/tabs/protocol';

export const shouldBreakOut = (pathname: string, framed: boolean): boolean => framed && !isTabPath(pathname);

export function FrameBreakout() {
  const pathname = usePathname();
  useEffect(() => {
    if (shouldBreakOut(pathname, isFramed())) window.top?.location.replace(window.location.href);
  }, [pathname]);
  return null;
}
