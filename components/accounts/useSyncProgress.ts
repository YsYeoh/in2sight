'use client';

// Polls the owner-only GET /api/sync/progress while an account is importing and the tab is visible. Progress is server
// state, so a reload or a second tab shows the same thing; the server render passes the first value in. Backs off on
// errors (3 s doubling to 60 s), stops on 401 and when nothing is running, and refreshes the page's server data
// whenever a stage completes (Overview numbers appear as each step lands) and once at the end.
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AccountProgress } from '@/lib/sync/progress';

export const POLL_MS = 3_000;
export const MAX_BACKOFF_MS = 60_000;

const completed = (list: AccountProgress[]) => list.reduce((n, p) => n + (p.phase === 'done' ? 1 : 0) + p.stages.filter((s) => s.state === 'done' || s.state === 'skipped').length, 0);

export function useSyncProgress(initial: AccountProgress[]): AccountProgress[] {
  const router = useRouter();
  const [list, setList] = useState(initial);
  const [seen, setSeen] = useState(initial);
  if (initial !== seen) {
    // a new server render (router.refresh, navigation) brings fresher data: adopt it
    setSeen(initial);
    setList(initial);
  }
  const active = list.some((p) => p.phase !== 'done');

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let delay = POLL_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ctrl = new AbortController();
    const schedule = (ms: number) => {
      clearTimeout(timer);
      if (!stopped) timer = setTimeout(poll, ms);
    };
    async function poll() {
      if (document.visibilityState !== 'visible') return; // paused; visibilitychange resumes
      try {
        const res = await fetch('/api/sync/progress', { cache: 'no-store', signal: ctrl.signal });
        if (res.status === 401 || res.redirected) {
          stopped = true; // signed out (the proxy redirects to /login, assertOwner answers 401): stop; the next navigation handles it
          return;
        }
        if (!res.ok) throw new Error('progress');
        const body = (await res.json()) as { accounts?: AccountProgress[] };
        if (stopped) return;
        delay = POLL_MS;
        setList(Array.isArray(body.accounts) ? body.accounts : []);
      } catch {
        if (stopped) return;
        delay = Math.min(delay * 2, MAX_BACKOFF_MS);
      }
      schedule(delay);
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') schedule(0);
    };
    document.addEventListener('visibilitychange', onVisibility);
    schedule(POLL_MS);
    return () => {
      stopped = true;
      ctrl.abort();
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [active]);

  const done = completed(list);
  const prev = useRef(done);
  useEffect(() => {
    if (done > prev.current) router.refresh();
    prev.current = done;
  }, [done, router]);

  return list;
}
