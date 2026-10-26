'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { htmlAttrs, parsePrefs, type Prefs } from '@/lib/prefs';
import { themeColor } from '@/lib/pwa';
import { isFramed } from '@/lib/tabs/protocol';

/** `{ ok: false }` (or a rejection) = not saved; anything else (including void) = saved. */
type Persist = (partial: Partial<Prefs>) => Promise<{ ok: boolean } | void> | { ok: boolean } | void;

/** idle = nothing saved yet in this document; error = at least one change is not saved (retry() re-sends it). */
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface PrefsContextValue {
  prefs: Prefs;
  update: (partial: Partial<Prefs>) => void;
  status: SaveStatus;
  retry: () => void;
}

const PrefsContext = createContext<PrefsContextValue | null>(null);

/**
 * Every document of the app (the tab shell and each tab's frame, Plan 14c; also other windows) has its own provider: a
 * change made in one is sent to the others on this same-origin channel and applied there at once. A language change is
 * sent after it is saved and makes the top window reload (server-rendered text); other format changes reach the
 * server-rendered parts of another tab on its next navigation or Refresh.
 */
export const PREFS_CHANNEL = 'in2sight:prefs';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** The device's colour scheme (for Auto mode only; never for layout). false where matchMedia is missing. */
export const systemDark = (): boolean => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches;

export function applyPrefsToDocument(p: Prefs, el: HTMLElement = document.documentElement): void {
  const dark = systemDark();
  for (const [name, value] of Object.entries(htmlAttrs(p, dark))) el.setAttribute(name, value);
  el.ownerDocument.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColor(p, dark));
}

const pickKeys = (p: Prefs, keys: string[]): Partial<Prefs> => Object.fromEntries(keys.filter((k) => Object.hasOwn(p, k)).map((k) => [k, p[k as keyof Prefs]]));

export function PrefsProvider({ initial, persist, children }: { initial: Prefs; persist: Persist; children: ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(initial);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const channel = useRef<BroadcastChannel | null>(null);
  const latest = useRef(prefs);
  const unsaved = useRef<Partial<Prefs>>({}); // keys whose last save failed (retry sends their CURRENT values)
  const inflight = useRef(0);

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

  // Auto mode follows the device while it is chosen (the listener goes when the mode changes or the provider unmounts)
  useEffect(() => {
    if (prefs.mode !== 'auto' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(DARK_QUERY);
    const follow = () => applyPrefsToDocument(latest.current);
    follow(); // the server rendered light; the inline script may have fixed it already, this makes the meta tag agree
    mq.addEventListener('change', follow);
    return () => mq.removeEventListener('change', follow);
  }, [prefs.mode]);

  // Never swallowed: a failure keeps the keys in `unsaved` and sets status 'error' until a later save of them succeeds.
  const save = useCallback(
    (partial: Partial<Prefs>) => {
      inflight.current++;
      setStatus('saving');
      void Promise.resolve()
        .then(() => persist(partial))
        .then(
          (r) => !(r !== null && typeof r === 'object' && r.ok === false),
          () => false,
        )
        .then((ok) => {
          inflight.current--;
          const keys = Object.keys(partial);
          if (ok) for (const k of keys) delete unsaved.current[k as keyof Prefs];
          else unsaved.current = { ...unsaved.current, ...pickKeys(latest.current, keys) };
          if (ok && 'locale' in partial) channel.current?.postMessage(partial); // the others reload: the cookie is saved now
          setStatus(Object.keys(unsaved.current).length > 0 ? 'error' : inflight.current > 0 ? 'saving' : 'saved');
        });
    },
    [persist],
  );

  const update = useCallback(
    (partial: Partial<Prefs>) => {
      const next = parsePrefs({ ...prefs, ...partial }); // validates: bad values fall back
      setPrefs(next);
      latest.current = next;
      applyPrefsToDocument(next); // instant, no waiting for the server
      save(partial);
      if (!('locale' in partial)) channel.current?.postMessage(partial);
    },
    [prefs, save],
  );

  const retry = useCallback(() => {
    const p = unsaved.current;
    if (Object.keys(p).length > 0) save({ ...p });
  }, [save]);

  const value = useMemo(() => ({ prefs, update, status, retry }), [prefs, update, status, retry]);
  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePrefs(): PrefsContextValue {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error('usePrefs must be used inside <PrefsProvider>');
  return ctx;
}
