// Saved Explorer views (table explorer_views, owner-authored, RLS is_owner()). A view stores the canonical query of the
// Explorer plus the Time Scope exactly as Plan 12a writes it (a preset stays rolling, fixed days stay fixed). The stored
// JSON is never trusted: it is re-validated through both parsers when saved AND when read.
import type { SupabaseClient } from '@supabase/supabase-js';
import { EXPLORER_KEYS, explorerParams, parseExplorerState } from '@/lib/explorer/state';
import type { WeekStart } from '@/lib/prefs';
import { parseTimeScope, SCOPE_KEYS, scopeParams } from '@/lib/time-scope/scope';

export const VIEW_NAME_MAX = 60;
export const MAX_VIEWS = 50;

export interface SavedView {
  id: string;
  name: string;
  href: string; // '/explorer?…' rebuilt from the validated state
}

/** The canonical parameters to store for a query: Explorer keys + Time Scope keys only, each re-serialised by its parser. */
export function viewState(query: string, weekStart: WeekStart): Record<string, string> {
  const q = new URLSearchParams(query);
  const one = (k: string) => (q.getAll(k).length === 1 ? q.get(k)! : undefined); // repeated = missing (as on the page)
  const state = parseExplorerState(Object.fromEntries(EXPLORER_KEYS.map((k) => [k, one(k)])));
  return { ...Object.fromEntries(explorerParams(state)), ...scopeParams(parseTimeScope(q, weekStart)) };
}

/** A stored state (any JSON) → a safe Explorer link. Unknown keys and non-string values are dropped before parsing. */
export function viewHref(stored: unknown, weekStart: WeekStart): string {
  const o = stored !== null && typeof stored === 'object' && !Array.isArray(stored) ? (stored as Record<string, unknown>) : {};
  const allowed: readonly string[] = [...EXPLORER_KEYS, ...SCOPE_KEYS];
  const q = new URLSearchParams(Object.entries(o).filter((e): e is [string, string] => allowed.includes(e[0]) && typeof e[1] === 'string'));
  return `/explorer?${new URLSearchParams(viewState(q.toString(), weekStart))}`;
}

/** The owner's saved views, A→Z (owner session, RLS). Never throws: the Explorer still works without its menu. */
export async function loadViews(db: SupabaseClient, weekStart: WeekStart): Promise<SavedView[]> {
  const { data, error } = await db.from('explorer_views').select('id,name,state').order('name', { ascending: true }).limit(MAX_VIEWS);
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map((r) => ({ id: String(r.id), name: String(r.name), href: viewHref(r.state, weekStart) }));
}
