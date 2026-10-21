// App-shell tabs (Plan 14c): the messages between the shell (top window), its frames and the service worker. Every
// message is checked here before anyone acts on it: same origin only, URLs must be same-origin tab pages, titles are
// plain strings. Senders always pass `location.origin` as targetOrigin (never '*'). No tokens or user data, only
// URLs and page headings.
import { isTabPath } from '@/lib/tabs/model';

/** frame → shell: where the frame is now (after every navigation and when its heading changes). */
export type NavReport = { type: 'in2sight:nav'; url: string; title: string };
/** frame or service worker → shell: open a tab for this URL, or jump to the tab that has exactly this URL. */
export type OpenRequest = { type: 'in2sight:open'; url: string };
/** frame → shell: Alt+Left / Alt+Right pressed inside the frame. */
export type HistoryRequest = { type: 'in2sight:history'; dir: -1 | 1 };
export type FrameMessage = NavReport | OpenRequest | HistoryRequest;
/** shell → frame: navigate (client-side) to this URL / re-fetch the server data of the current page. */
export type ShellMessage = { type: 'in2sight:go'; url: string } | { type: 'in2sight:refresh' };

export const TITLE_MAX = 120;

/** A same-origin tab page as path + query (hash dropped), or null for anything else (other origins, /login, /api…). */
export function tabUrl(href: string, origin: string): string | null {
  let u: URL;
  try {
    u = new URL(href, origin);
  } catch {
    return null;
  }
  return u.origin === origin && isTabPath(u.pathname) ? u.pathname + u.search : null;
}

/** True inside a frame. A cross-origin parent throws on access: that is framed too. */
export function isFramed(w: Window = window): boolean {
  try {
    return w.self !== w.top;
  } catch {
    return true;
  }
}

type Raw = { type?: unknown; url?: unknown; title?: unknown; dir?: unknown };
const raw = (data: unknown): Raw | null => (data !== null && typeof data === 'object' ? (data as Raw) : null);
const url = (d: Raw, origin: string) => (typeof d.url === 'string' ? tabUrl(d.url, origin) : null);

/** A message from a frame or the service worker, validated; null when it is not ours or not valid. */
export function readFrameMessage(data: unknown, origin: string): FrameMessage | null {
  const d = raw(data);
  if (!d) return null;
  if (d.type === 'in2sight:nav' || d.type === 'in2sight:open') {
    const u = url(d, origin);
    if (!u) return null;
    return d.type === 'in2sight:open' ? { type: d.type, url: u } : { type: d.type, url: u, title: typeof d.title === 'string' ? d.title.trim().slice(0, TITLE_MAX) : '' };
  }
  if (d.type === 'in2sight:history' && (d.dir === -1 || d.dir === 1)) return { type: d.type, dir: d.dir };
  return null;
}

/** A command from the shell, validated; null when it is not ours or not valid. */
export function readShellMessage(data: unknown, origin: string): ShellMessage | null {
  const d = raw(data);
  if (!d) return null;
  if (d.type === 'in2sight:refresh') return { type: d.type };
  if (d.type === 'in2sight:go') {
    const u = url(d, origin);
    return u ? { type: d.type, url: u } : null;
  }
  return null;
}
