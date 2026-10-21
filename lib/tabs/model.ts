// App-shell tabs (Plan 14c, spec §4.3): the whole tab logic as one pure reducer. TabHost keeps this state; the frames
// only report where they are and obey "go"/"refresh". Deterministic: time comes in as `now`.
//
// url      = the page the shell wants the tab to show (the address bar shows the active tab's url).
// frameUrl = what the tab's live frame last reported (null = no report since it was mounted).
// url !== frameUrl (frameUrl not null) = a command is on its way: TabHost posts `in2sight:go` to that frame.
// Back/Forward are per-tab stacks kept here: all frames share ONE browser history, so a frame's history.back() can
// step another tab (Plan 14c, Spike A 5).
import { NAV_ITEMS, isActive, type NavItem } from '@/lib/nav';

export const HOME = '/overview';
export const LIVE_CAP = 8;
export const LIVE_CAP_COARSE = 3; // phones and tablets (lib/motion coarsePointer)
export const STALE_MS = 30 * 60_000; // the sync interval
export const HISTORY_MAX = 50;
export const STORAGE_KEY = 'in2sight.tabs';

export interface Tab {
  id: string;
  url: string;
  title: string; // '' until the frame reports a heading
  back: string[]; // oldest first
  fwd: string[]; // nearest first
  viewedAt: number; // last time it was active (0 = never since load: no frame yet)
  frameUrl: string | null;
  stale: boolean;
}
export interface TabsState {
  tabs: Tab[];
  active: string;
  next: number;
  cap: number;
}
/** nav = sidebar (path match), exact = same URL, current = navigate the active tab (phone bottom bar), new = always a new tab. */
export type OpenMode = 'nav' | 'exact' | 'current' | 'new';
export type TabsAction =
  | { type: 'open'; url: string; mode: OpenMode; now: number }
  | { type: 'activate'; id: string; now: number }
  | { type: 'close'; id: string; now: number }
  | { type: 'report'; id: string; url: string; title: string }
  | { type: 'step'; id: string; dir: -1 | 1 }
  | { type: 'refreshed'; id: string }
  | { type: 'cap'; cap: number }
  | { type: 'restore'; raw: string | null };

export const pathOf = (url: string): string => url.split(/[?#]/, 1)[0];

/** Pages that live in a tab: the six main sections and everything below them. Anything else breaks out of a frame. */
export const isTabPath = (pathname: string): boolean => NAV_ITEMS.some((i) => isActive(pathname, i.href));

/** Sidebar rule: same section path; "Accounts" means the list page only, not an account. */
export function navMatches(tabUrl: string, href: string): boolean {
  const p = pathOf(tabUrl);
  const h = pathOf(href);
  return h === '/accounts' ? p === h : isActive(p, h);
}

export function navKeyOf(url: string): NavItem['key'] | null {
  const p = pathOf(url);
  return NAV_ITEMS.find((i) => isActive(p, i.href))?.key ?? null;
}

const blank = (id: string, url: string, title = ''): Tab => ({ id, url, title, back: [], fwd: [], viewedAt: 0, frameUrl: null, stale: false });

export function initialTabs(url: string): TabsState {
  return { tabs: [blank('t0', url)], active: 't0', next: 1, cap: LIVE_CAP };
}

/** The frames that stay mounted: the active tab plus the most recently viewed others, up to the cap (LRU). */
export function liveIds(s: TabsState): Set<string> {
  const others = s.tabs.filter((t) => t.id !== s.active && t.viewedAt > 0).sort((a, b) => b.viewedAt - a.viewedAt);
  return new Set([s.active, ...others.slice(0, Math.max(0, s.cap - 1)).map((t) => t.id)]);
}

/** A tab whose frame was discarded forgets its frame report: the next mount loads `url` fresh. */
function settle(s: TabsState): TabsState {
  const live = liveIds(s);
  return { ...s, tabs: s.tabs.map((t) => (live.has(t.id) || (t.frameUrl === null && !t.stale) ? t : { ...t, frameUrl: null, stale: false })) };
}

const patch = (s: TabsState, id: string, f: (t: Tab) => Tab): TabsState => ({ ...s, tabs: s.tabs.map((t) => (t.id === id ? f(t) : t)) });
const push = (list: string[], url: string) => [...list, url].slice(-HISTORY_MAX);

function activate(s: TabsState, id: string, now: number): TabsState {
  if (id === s.active || !s.tabs.some((t) => t.id === id)) return s;
  const wasLive = liveIds(s).has(id);
  const tabs = s.tabs.map((t) => {
    if (t.id === s.active) return { ...t, viewedAt: now };
    if (t.id !== id) return t;
    return { ...t, viewedAt: now, stale: wasLive && t.viewedAt > 0 && now - t.viewedAt >= STALE_MS };
  });
  return settle({ ...s, tabs, active: id });
}

function open(s: TabsState, url: string, mode: OpenMode, now: number): TabsState {
  if (mode === 'current') {
    const cur = s.tabs.find((t) => t.id === s.active);
    return !cur || cur.url === url ? s : patch(s, s.active, (t) => ({ ...t, url, back: push(t.back, t.url), fwd: [], stale: false }));
  }
  const hits = mode === 'exact' ? s.tabs.filter((t) => t.url === url) : mode === 'nav' ? s.tabs.filter((t) => navMatches(t.url, url)) : [];
  const hit = hits.find((t) => t.id === s.active) ?? [...hits].sort((a, b) => b.viewedAt - a.viewedAt)[0];
  if (hit) return activate(s, hit.id, now);
  const id = `t${s.next}`;
  return activate({ ...s, tabs: [...s.tabs, blank(id, url)], next: s.next + 1 }, id, now);
}

function close(s: TabsState, id: string, now: number): TabsState {
  const i = s.tabs.findIndex((t) => t.id === id);
  if (i < 0) return s;
  const tabs = s.tabs.filter((t) => t.id !== id);
  if (!tabs.length) {
    const nid = `t${s.next}`;
    return { ...s, tabs: [{ ...blank(nid, HOME), viewedAt: now }], active: nid, next: s.next + 1 };
  }
  if (id !== s.active) return settle({ ...s, tabs });
  return activate({ ...s, tabs }, (tabs[i] ?? tabs[i - 1]).id, now);
}

function report(t: Tab, url: string, title: string): Tab {
  if (url === t.frameUrl) return { ...t, title: title || t.title }; // the frame has not moved: a title update (or a command still on its way)
  if (t.frameUrl === null || url === t.url) return { ...t, url, frameUrl: url, title: title || (url === t.url ? t.title : '') }; // first load (or a redirect), or a command arrived
  return { ...t, url, frameUrl: url, title, back: push(t.back, t.url), fwd: [] }; // a navigation inside the tab
}

function step(t: Tab, dir: -1 | 1): Tab {
  if (dir < 0) return t.back.length ? { ...t, url: t.back[t.back.length - 1], back: t.back.slice(0, -1), fwd: [t.url, ...t.fwd].slice(0, HISTORY_MAX), stale: false } : t;
  return t.fwd.length ? { ...t, url: t.fwd[0], fwd: t.fwd.slice(1), back: push(t.back, t.url), stale: false } : t;
}

function restore(s: TabsState, raw: string | null): TabsState {
  let saved: { url: string; title: string }[];
  try {
    const v = JSON.parse(raw ?? 'null') as { v?: unknown; tabs?: unknown } | null;
    if (v?.v !== 1 || !Array.isArray(v.tabs)) return s;
    saved = (v.tabs as { url?: unknown; title?: unknown }[])
      .filter((t) => typeof t?.url === 'string' && t.url.startsWith('/') && !t.url.startsWith('//') && isTabPath(pathOf(t.url)))
      .map((t) => ({ url: t.url as string, title: typeof t.title === 'string' ? t.title.slice(0, 120) : '' }));
  } catch {
    return s;
  }
  if (!saved.length) return s;
  const cur = s.tabs.find((t) => t.id === s.active)!;
  const at = saved.findIndex((t) => t.url === cur.url);
  const tabs = saved.map((t, k) => (k === at ? { ...cur, title: cur.title || t.title } : blank(`t${s.next + k}`, t.url, t.title)));
  return { ...s, tabs: at < 0 ? [...tabs, cur] : tabs, next: s.next + saved.length };
}

export function tabsReducer(s: TabsState, a: TabsAction): TabsState {
  switch (a.type) {
    case 'open':
      return open(s, a.url, a.mode, a.now);
    case 'activate':
      return activate(s, a.id, a.now);
    case 'close':
      return close(s, a.id, a.now);
    case 'report':
      return patch(s, a.id, (t) => report(t, a.url, a.title));
    case 'step':
      return patch(s, a.id, (t) => step(t, a.dir));
    case 'refreshed':
      return patch(s, a.id, (t) => ({ ...t, stale: false }));
    case 'cap':
      return settle({ ...s, cap: a.cap });
    case 'restore':
      return restore(s, a.raw);
  }
}

export function serialize(s: TabsState): string {
  return JSON.stringify({ v: 1, tabs: s.tabs.map(({ url, title }) => ({ url, title })) });
}
