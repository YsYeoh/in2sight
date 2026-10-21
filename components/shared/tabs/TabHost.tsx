'use client';

// The shell side of the app-shell tabs (Plan 14c, spec §4.3). Only the TOP window runs this (AppShell in host mode):
// - keeps the tab state (lib/tabs/model.ts) and restores/saves the tab list in localStorage;
// - keeps the address bar on the active tab's URL (history.replaceState; Next keeps usePathname in sync, so the
//   sidebar highlight follows the active tab with no extra code);
// - turns clicks on links to tab pages in the shell chrome (sidebar, bottom bar, bell, user menu) into tab actions;
//   the mode comes from the nearest [data-tab-open] ("nav" sidebar, "current" bottom bar, default "exact");
// - listens to its frames (reports, open-in-tab, Alt+arrows) and to the service worker (Web Push clicks);
// - renders the live frames: mounted after hydration only, inactive ones invisible + inert, LRU-capped.
import { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { readMotionEnv } from '@/lib/motion';
import { LIVE_CAP, LIVE_CAP_COARSE, STORAGE_KEY, initialTabs, liveIds, navKeyOf, serialize, tabsReducer, type OpenMode, type Tab, type TabsState } from '@/lib/tabs/model';
import { isFramed, readFrameMessage, tabUrl, type ShellMessage } from '@/lib/tabs/protocol';
import { cn } from '@/lib/utils';

export interface TabsApi {
  state: TabsState;
  /** true once hydrated in the top window: frames, storage and listeners only exist then. */
  ready: boolean;
  open: (url: string, mode: OpenMode) => void;
  activate: (id: string) => void;
  close: (id: string) => void;
  /** Back (-1) / Forward (1) in the ACTIVE tab's own history. */
  step: (dir: -1 | 1) => void;
  /** Re-fetch the active tab's server data (router.refresh inside the frame) and clear its stale mark. */
  refresh: () => void;
  register: (id: string, el: HTMLIFrameElement | null) => void;
}

const TabsContext = createContext<TabsApi | null>(null);

export function useTabs(): TabsApi {
  const api = useContext(TabsContext);
  if (!api) throw new Error('useTabs must be used inside TabsProvider');
  return api;
}

/** The label of a tab: the page heading the frame reported, else the sidebar name of its section. */
export function useTabTitle(): (tab: Tab) => string {
  const tn = useTranslations('nav');
  return (tab) => tab.title || tn(navKeyOf(tab.url) ?? 'overview');
}

const noop = () => () => {};
const send = (w: Window | null | undefined, m: ShellMessage) => w?.postMessage(m, window.location.origin);

export function TabsProvider({ initialUrl, children }: { initialUrl: string; children: ReactNode }) {
  const [state, dispatch] = useReducer(tabsReducer, initialUrl, initialTabs);
  // false on the server and during hydration, then true in the top window only (a frame never runs the host)
  const ready = useSyncExternalStore(noop, () => !isFramed(), () => false);
  const frames = useRef(new Map<string, HTMLIFrameElement>());
  const sent = useRef(new Map<string, string>());
  const activeRef = useRef(state.active);
  const activeUrl = state.tabs.find((t) => t.id === state.active)?.url;

  useEffect(() => {
    activeRef.current = state.active;
  }, [state.active]);

  // 1. restore (declared before 2: it reads the saved list before the first save overwrites it)
  useEffect(() => {
    if (!ready) return;
    dispatch({ type: 'cap', cap: readMotionEnv(window).coarsePointer ? LIVE_CAP_COARSE : LIVE_CAP });
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch {
      // storage blocked: start with this one tab
    }
    dispatch({ type: 'restore', raw });
  }, [ready]);

  // 2. save
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(STORAGE_KEY, serialize(state));
    } catch {
      // storage blocked or full: the tabs just do not survive a reload
    }
  }, [ready, state]);

  // 3. the address bar shows the active tab
  useEffect(() => {
    if (!ready || !activeUrl || window.location.pathname + window.location.search === activeUrl) return;
    window.history.replaceState(window.history.state, '', activeUrl);
  }, [ready, activeUrl]);

  // 4. a tab whose URL moved away from what its frame shows (Back/Forward, bottom bar) tells the frame once
  useEffect(() => {
    for (const t of state.tabs) {
      if (t.frameUrl === null || t.frameUrl === t.url) {
        sent.current.delete(t.id);
        continue;
      }
      const w = frames.current.get(t.id)?.contentWindow;
      if (!w || sent.current.get(t.id) === t.url) continue;
      sent.current.set(t.id, t.url);
      send(w, { type: 'in2sight:go', url: t.url });
    }
  }, [state.tabs]);

  // 5. links in the chrome, frame messages, Web Push clicks, Alt+arrows
  useEffect(() => {
    if (!ready) return;
    const origin = window.location.origin;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      if (e.type === 'click' ? e.button !== 0 || e.shiftKey || e.altKey : e.button !== 1) return;
      const a = e.target instanceof Element ? e.target.closest('a[href]') : null;
      if (!(a instanceof HTMLAnchorElement) || a.hasAttribute('download')) return;
      const url = tabUrl(a.href, origin);
      if (!url) return;
      e.preventDefault(); // next/link skips a prevented click; NavigationProgress ignores it
      const zone = a.closest('[data-tab-open]')?.getAttribute('data-tab-open');
      const plain = e.type === 'click' && !e.ctrlKey && !e.metaKey;
      const mode: OpenMode = plain && (zone === 'nav' || zone === 'current') ? zone : 'exact';
      dispatch({ type: 'open', url, mode, now: Date.now() });
    };
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== origin) return;
      const id = [...frames.current].find(([, f]) => f.contentWindow === e.source)?.[0];
      const m = id ? readFrameMessage(e.data, origin) : null;
      if (!id || !m) return;
      if (m.type === 'in2sight:nav') dispatch({ type: 'report', id, url: m.url, title: m.title });
      else if (m.type === 'in2sight:open') dispatch({ type: 'open', url: m.url, mode: 'exact', now: Date.now() });
      else if (id === activeRef.current) dispatch({ type: 'step', id, dir: m.dir });
    };
    const onWorker = (e: MessageEvent) => {
      const m = e.origin === origin ? readFrameMessage(e.data, origin) : null;
      if (m?.type === 'in2sight:open') dispatch({ type: 'open', url: m.url, mode: 'exact', now: Date.now() });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
      e.preventDefault();
      dispatch({ type: 'step', id: activeRef.current, dir: e.key === 'ArrowLeft' ? -1 : 1 });
    };
    const sw = 'serviceWorker' in navigator ? navigator.serviceWorker : null;
    window.addEventListener('click', onClick, true); // window capture: before NavigationProgress and next/link
    window.addEventListener('auxclick', onClick, true);
    window.addEventListener('message', onMessage);
    window.addEventListener('keydown', onKey);
    sw?.addEventListener('message', onWorker);
    return () => {
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('auxclick', onClick, true);
      window.removeEventListener('message', onMessage);
      window.removeEventListener('keydown', onKey);
      sw?.removeEventListener('message', onWorker);
    };
  }, [ready]);

  const api = useMemo<TabsApi>(
    () => ({
      state,
      ready,
      open: (url, mode) => dispatch({ type: 'open', url, mode, now: Date.now() }),
      activate: (id) => dispatch({ type: 'activate', id, now: Date.now() }),
      close: (id) => dispatch({ type: 'close', id, now: Date.now() }),
      step: (dir) => dispatch({ type: 'step', id: state.active, dir }),
      refresh: () => {
        send(frames.current.get(state.active)?.contentWindow, { type: 'in2sight:refresh' });
        dispatch({ type: 'refreshed', id: state.active });
      },
      register: (id, el) => void (el ? frames.current.set(id, el) : frames.current.delete(id)),
    }),
    [state, ready],
  );

  return <TabsContext.Provider value={api}>{children}</TabsContext.Provider>;
}

function Frame({ tab, active, title, register }: { tab: Tab; active: boolean; title: string; register: TabsApi['register'] }) {
  const [src] = useState(tab.url); // loaded once: later moves happen inside the frame (links, "go"), never by reloading it
  return (
    <iframe
      ref={(el) => register(tab.id, el)}
      src={src}
      title={title}
      inert={!active}
      aria-hidden={active ? undefined : true}
      className={cn('absolute inset-0 size-full border-0 bg-background', !active && 'invisible')}
    />
  );
}

/** The live frames, stacked in one positioned box; only the active one is visible. */
export function TabFrames() {
  const { state, ready, register } = useTabs();
  const title = useTabTitle();
  if (!ready) return null;
  const live = liveIds(state);
  return (
    <>
      {state.tabs
        .filter((t) => live.has(t.id))
        .map((t) => (
          <Frame key={t.id} tab={t} active={t.id === state.active} title={title(t)} register={register} />
        ))}
    </>
  );
}
