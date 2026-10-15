'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { htmlAttrs, parsePrefs, type Prefs } from '@/lib/prefs';
import { themeColor } from '@/lib/pwa';

type Persist = (partial: Partial<Prefs>) => Promise<void> | void;

interface PrefsContextValue {
  prefs: Prefs;
  update: (partial: Partial<Prefs>) => void;
}

const PrefsContext = createContext<PrefsContextValue | null>(null);

export function applyPrefsToDocument(p: Prefs, el: HTMLElement = document.documentElement): void {
  for (const [name, value] of Object.entries(htmlAttrs(p))) el.setAttribute(name, value);
  el.ownerDocument.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColor(p));
}

export function PrefsProvider({ initial, persist, children }: { initial: Prefs; persist: Persist; children: ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(initial);

  const update = useCallback(
    (partial: Partial<Prefs>) => {
      const next = parsePrefs({ ...prefs, ...partial }); // validates: bad values fall back
      setPrefs(next);
      applyPrefsToDocument(next); // instant, no waiting for the server
      // ponytail: failures are swallowed — the choice stays local until the next successful save
      void Promise.resolve(persist(partial)).catch(() => {});
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
