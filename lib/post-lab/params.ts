// Post Lab URL state: its two toggles (?peers=90, ?er=followers) plus the Time Scope it only CARRIES for its links
// (the Post Lab is per item and has no scope of its own). Pure; anything unknown falls back to the default.
import type { ErBasis, PeerCount } from '@/lib/analysis/post-lab';
import type { WeekStart } from '@/lib/prefs';
import { parseTimeScope, scopeParams } from '@/lib/time-scope/scope';

type Params = Record<string, string | string[] | undefined>;

export interface LabParams {
  peers: PeerCount;
  er: ErBasis;
  scope: Record<string, string>; // the canonical Time Scope parameters (scopeParams), never raw URL values
}

export function parseLabParams(sp: Params, weekStart: WeekStart = 'mon'): LabParams {
  return {
    peers: sp.peers === '90' ? 90 : 30,
    er: sp.er === 'followers' ? 'followers' : 'reach',
    scope: scopeParams(parseTimeScope(sp, weekStart)),
  };
}

/** The Post Lab of one item. `query` = the referring page's scope query (ResolvedScope.query), '' for none. */
export function postLabHref(accountId: string, mediaId: string, query = ''): string {
  return `/accounts/${encodeURIComponent(accountId)}/media/${encodeURIComponent(mediaId)}${query ? `?${query}` : ''}`;
}

/** The query of this Post Lab with one toggle changed: the scope first, then only non-default toggles. */
export function labQuery(p: LabParams, patch: Partial<Pick<LabParams, 'peers' | 'er'>> = {}): string {
  const next = { ...p, ...patch };
  const q = new URLSearchParams(p.scope);
  if (next.peers !== 30) q.set('peers', String(next.peers));
  if (next.er !== 'reach') q.set('er', next.er);
  return q.toString();
}

/** Back to the account's Posts (or Stories) tab, with the scope. */
export function backHref(accountId: string, story: boolean, p: LabParams): string {
  const q = new URLSearchParams({ tab: story ? 'stories' : 'posts', ...p.scope });
  return `/accounts/${encodeURIComponent(accountId)}?${q}`;
}
