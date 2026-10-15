'use client';

// The thin top bar for client navigations (creator-toolkit design §3). It starts on a plain left click on an internal
// link (one capture-phase listener, so every <Link> is covered without wrapping it) or on startProgress(href) for
// router.push / GET forms, and completes when the URL (pathname or query) changes. A failsafe ends it if the
// navigation never commits (aborted, prevented, failed). Server actions do not change the URL, so they never start it.
import { useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

export const PROGRESS_START_EVENT = 'in2sight:progress-start';
export const FAILSAFE_MS = 12_000;
export const FADE_MS = 400;

/** A same-origin page navigation that changes path or query (not a hash jump, not the same URL, not an API/download). */
export function isNavigation(href: string, here: { href: string; origin: string; pathname: string; search: string } = window.location): boolean {
  let url: URL;
  try {
    url = new URL(href, here.href);
  } catch {
    return false;
  }
  if (url.origin !== here.origin || url.pathname.startsWith('/api/')) return false;
  return url.pathname + url.search !== here.pathname + here.search;
}

/** Start the bar for a programmatic navigation. Ignored when `href` would not change the page. */
export function startProgress(href: string): void {
  if (isNavigation(href)) window.dispatchEvent(new Event(PROGRESS_START_EVENT));
}

/** The URL a GET form (next/form, action="") navigates to: same path, the form fields as the query. */
export function formHref(form: HTMLFormElement): string {
  const q = new URLSearchParams();
  new FormData(form).forEach((v, k) => q.append(k, typeof v === 'string' ? v : v.name));
  return `?${q}`;
}

function clickedLink(e: MouseEvent): string | null {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null; // new tab/window: no navigation here
  const a = e.target instanceof Element ? e.target.closest('a[href]') : null;
  if (!(a instanceof HTMLAnchorElement) || (a.target && a.target !== '_self') || a.hasAttribute('download')) return null;
  return a.href;
}

type State = 'idle' | 'loading' | 'done';

export function NavigationProgress() {
  const [state, setState] = useState<State>('idle');
  const url = `${usePathname()}?${useSearchParams()?.toString() ?? ''}`;
  const failsafe = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [seen, setSeen] = useState(url);

  // URL changed (navigation committed, or back/forward): finish a running bar. Adjusting state during render is the
  // React-recommended way to react to a changed value without an extra effect pass.
  if (url !== seen) {
    setSeen(url);
    if (state === 'loading') setState('done');
  }

  useEffect(() => {
    const start = () => {
      clearTimeout(failsafe.current);
      setState('loading');
      failsafe.current = setTimeout(() => setState('done'), FAILSAFE_MS);
    };
    const onClick = (e: MouseEvent) => {
      const href = clickedLink(e);
      if (href && isNavigation(href)) start();
    };
    document.addEventListener('click', onClick, true);
    window.addEventListener(PROGRESS_START_EVENT, start);
    return () => {
      document.removeEventListener('click', onClick, true);
      window.removeEventListener(PROGRESS_START_EVENT, start);
      clearTimeout(failsafe.current);
    };
  }, []);

  useEffect(() => {
    if (state !== 'done') return;
    clearTimeout(failsafe.current);
    const t = setTimeout(() => setState('idle'), FADE_MS);
    return () => clearTimeout(t);
  }, [state]);

  return state === 'idle' ? null : <div aria-hidden="true" data-state={state} className="nav-progress" />;
}
