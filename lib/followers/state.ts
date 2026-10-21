// URL state of the Followers tab (Plan 15b; docs/UI_STANDARDS.md rule 3: the URL is the state). Parsed on the server,
// every value validated: snapshot ids must belong to this account's list, the list name to the allow-list.
import { FOLLOWER_LISTS, SEARCH_MAX, type FollowerList } from '@/lib/followers/diff';
import { isUuid } from '@/lib/tags';

/** One snapshot without its arrays (what the snapshot list and the selects show). */
export interface SnapshotMeta {
  id: string;
  takenOn: string; // YYYY-MM-DD
  followerCount: number;
  followingCount: number | null; // null = no following.json
  createdAt: string; // ISO
}
export interface FollowerState {
  snap: string | null; // the newer snapshot; null = the newest
  vs: string | null; // the snapshot to compare with; null = the one just before
  list: FollowerList | null; // null = defaultList()
  q: string; // lower-cased, no spaces, no leading @, at most 30 characters
  page: number;
}
export const STALE_DAYS = 30;
/** The tab's own URL keys: the account page's Suspense key ignores them, so the toolbar stays mounted while a page streams. */
export const FOLLOWER_KEYS = ['snap', 'vs', 'list', 'q', 'page'] as const;

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined): string | null => (typeof v === 'string' ? v : null);

/** `snapshots` newest first (as listFollowerSnapshots returns them). */
export function parseFollowerState(sp: Params, snapshots: SnapshotMeta[]): FollowerState {
  const known = (v: string | null): string | null => (v !== null && isUuid(v) && snapshots.some((s) => s.id === v.toLowerCase()) ? v.toLowerCase() : null);
  const snap = known(one(sp.snap));
  const vs = known(one(sp.vs));
  const list = one(sp.list);
  const q = [...(one(sp.q) ?? '').replace(/\s+/g, '').replace(/^@/, '').toLowerCase()].slice(0, SEARCH_MAX).join('');
  const n = Number(one(sp.page));
  return {
    snap,
    vs: vs === snap ? null : vs,
    list: list !== null && (FOLLOWER_LISTS as readonly string[]).includes(list) ? (list as FollowerList) : null,
    q,
    page: Number.isInteger(n) && n >= 1 ? n : 1,
  };
}

/** The two snapshots to compare: newer = snap (default the newest), older = vs (default the next older one); two given ids are put in date order. */
export function resolvePair(s: FollowerState, snapshots: SnapshotMeta[]): { newer: SnapshotMeta | null; older: SnapshotMeta | null } {
  const at = (id: string | null) => (id === null ? -1 : snapshots.findIndex((x) => x.id === id));
  let a = Math.max(0, at(s.snap));
  let b = at(s.vs);
  if (b >= 0 && b < a) [a, b] = [b, a]; // vs is the later export: it becomes the newer one
  if (b < 0 || b === a) b = a + 1;
  return { newer: snapshots[a] ?? null, older: snapshots[b] ?? null };
}

/** A link inside the tab: the patch applied, page back to 1 unless patched, defaults omitted; `keep` = the Time Scope params (they ride along untouched). */
export function followerHref(s: FollowerState, patch: Partial<FollowerState>, keep: Record<string, string> = {}): string {
  const n = { ...s, page: 1, ...patch };
  const p: Record<string, string> = { tab: 'followers' };
  if (n.snap) p.snap = n.snap;
  if (n.vs) p.vs = n.vs;
  if (n.list) p.list = n.list;
  if (n.q) p.q = n.q;
  if (n.page > 1) p.page = String(n.page);
  const q = new URLSearchParams(p);
  for (const [k, v] of Object.entries(keep)) if (!q.has(k)) q.set(k, v); // never overrides the tab's own params
  return `?${q}`;
}

/** Days since the newest export when that is more than 30, else null (the quiet reminder line). */
export function staleDays(snapshots: SnapshotMeta[], today: string): number | null {
  const newest = snapshots[0];
  if (!newest) return null;
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${newest.takenOn}T00:00:00Z`)) / 86_400_000);
  return days > STALE_DAYS ? days : null;
}
