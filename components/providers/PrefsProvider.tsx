'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { htmlAttrs, parsePrefs, type Prefs } from '@/lib/prefs';
import { themeColor } from '@/lib/pwa';
import { isFramed } from '@/lib/tabs/protocol';

type Persist = (partial: Partial<Prefs>) => Promise<void> | void;

interface PrefsContextValue {
  prefs: Prefs;
  update: (partial: Partial<Prefs>) => void;
}

const PrefsContext = createContext<PrefsContextValue | null>(null);

/**
 * Every document of the app (the tab shell and each tab's frame, Plan 14c; also other windows) has its own provider: a
 * change made in one is sent to the others on this same-origin channel and applied there at once. A language change is
 * sent after it is saved and makes the top window reload (server-rendered text); other format changes reach the
 * server-rendered parts of another tab on its next navigation or Refresh.
 */
export const PREFS_CHANNEL = 'in2sight:prefs';

export function applyPrefsToDocument(p: Prefs, el: HTMLElement = document.documentElement): void {
  for (const [name, value] of Object.entries(htmlAttrs(p))) el.setAttribute(name, value);
  el.ownerDocument.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColor(p));
}

export function PrefsProvider({ initial, persist, children }: { initial: Prefs; persist: Persist; children: ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(initial);
  const channel = useRef<BroadcastChannel | null>(null);
  const latest = useRef(prefs);

  useEffect(() => {
    latest.current = prefs;
  }, [prefs]);

  // changes made in the app's other documents (other tabs, the shell): parsePrefs validates them like any input
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel(PREFS_CHANNEL);
    ch.onmessage = (e: MessageEvent) => {
      const partial = e.data !== null && typeof e.data === 'object' ? (e.data as Partial<Prefs>) : {};
      const next = parsePrefs({ ...latest.current, ...partial });
      setPrefs(next);
      applyPrefsToDocument(next);
      if ('locale' in partial && !isFramed()) window.location.reload(); // the frames reload with the shell
    };
    channel.current = ch;
    return () => {
      ch.close();
      channel.current = null;
    };
  }, []);

  const update = useCallback(
    (partial: Partial<Prefs>) => {
      const next = parsePrefs({ ...prefs, ...partial }); // validates: bad values fall back
      setPrefs(next);
      applyPrefsToDocument(next); // instant, no waiting for the server
      // ponytail: failures are swallowed — the choice stays local until the next successful save
      const saved = Promise.resolve(persist(partial)).catch(() => {});
      const share = () => channel.current?.postMessage(partial);
      if ('locale' in partial) void saved.then(share); // the others reload: the cookie must be saved first
      else share();
    },
    [prefs, persist],
  );

  const value = useMemo(() => ({ prefs, update }), [prefs, update]);
  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePrefs(): PrefsContextValue {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error('usePrefs must be used inside <PrefsProvider>');
  return ctx;
}
