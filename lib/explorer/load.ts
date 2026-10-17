// Everything one Explorer view needs, for the page AND the Excel export (two callers, one loader): URL → state and
// Time Scope → accounts in scope → window → the fixed RPCs → the model. OWNER SESSION client only (RLS).
import type { SupabaseClient } from '@supabase/supabase-js';
import type { StoredAccount } from '@/lib/accounts/types';
import { buildExplorer, explorerWindow, settledDay, type ExplorerModel, type ScopeAccount } from '@/lib/analysis/explorer';
import type { Tag } from '@/lib/analysis/types';
import { loadTags } from '@/lib/dashboard/detail-read';
import { loadFirstDay } from '@/lib/dashboard/read';
import { loadItem, type ItemDetail } from '@/lib/explorer/item';
import { loadItems, loadRollup, type ItemRow, type RollupQuery } from '@/lib/explorer/read';
import { parseExplorerState, type ExplorerState } from '@/lib/explorer/state';
import type { WeekStart } from '@/lib/prefs';
import type { SyncStatus } from '@/lib/sync/store';
import { daysIn, type DayRange } from '@/lib/time-scope/range';
import { parseTimeScope, resolveScope, type ResolvedScope } from '@/lib/time-scope/scope';

const MAX_DAY_BUCKETS = 900; // below PostgREST's 1,000-row cap, with room for the other rows

export interface ExplorerData {
  state: ExplorerState;
  scope: ResolvedScope;
  window: { current: DayRange; compare: DayRange | null };
  live: ScopeAccount[]; // every live account, by username (filter choices)
  accounts: ScopeAccount[]; // the ones the filters keep
  groups: string[]; // named groups A→Z
  tags: Tag[];
  model: ExplorerModel;
  items: ItemRow[]; // single posts (by = 'post')
  truncated: boolean;
  item: ItemDetail | null; // the single-item level (state.item)
}

type Params = Record<string, string | string[] | undefined>;

export async function loadExplorer(db: SupabaseClient, sp: Params, o: { today: string; tz: string; weekStart: WeekStart; accounts: StoredAccount[]; sync: Record<string, SyncStatus> }): Promise<ExplorerData> {
  const state = parseExplorerState(sp);
  const live: ScopeAccount[] = o.accounts
    .filter((a) => a.status !== 'archived') // archived = hidden from every view (SPEC §7c)
    .sort((a, b) => a.username.localeCompare(b.username))
    .map((a) => ({ id: a.id, username: a.username, groupName: a.groupName }));
  const accounts = live.filter((a) => (state.group === null || a.groupName === state.group) && (state.accounts.length === 0 || state.accounts.includes(a.id)));
  const ids = accounts.map((a) => a.id);
  const [earliest, tags] = await Promise.all([loadFirstDay(db, ids), loadTags(db)]);
  const resolved = resolveScope(parseTimeScope(sp, o.weekStart), o.today, earliest);
  const window = explorerWindow(resolved, settledDay(accounts.map((a) => o.sync[a.id]?.dailyDoneThrough), o.today));
  // ONE grain for the rollup query, the model and the labels (data.scope.gran): daily buckets over more than
  // MAX_DAY_BUCKETS days would pass PostgREST's 1,000-row cap, which cuts the NEWEST days (rows come oldest first)
  const gran = resolved.gran === 'day' && daysIn(window.current) > MAX_DAY_BUCKETS ? 'week' : resolved.gran;
  const scope: ResolvedScope = { ...resolved, gran };
  const q: RollupQuery = { accounts: ids, from: window.current.from, to: window.current.to, tz: o.tz, weekStart: o.weekStart, grain: gran };
  const base = { state, scope, window, live, accounts, groups: [...new Set(live.flatMap((a) => (a.groupName ? [a.groupName] : [])))].sort((a, b) => a.localeCompare(b)), tags };
  const empty: ExplorerModel = { rows: [], partial: [] };
  if (state.item !== null) return { ...base, model: empty, items: [], truncated: false, item: await loadItem(db, state.item, ids, o.tz) };
  if (state.by === 'post') {
    // "all" lists every stored post (listRange reaches back MAX_DAYS), not only those since the first captured insight day:
    // the best-time cells count all of them. Every other scope lists the window the chart rows were counted over.
    const days = scope.preset === 'all' ? scope.listRange : window.current;
    const { items, truncated } = await loadItems(db, state, { ...q, from: days.from, to: days.to });
    return { ...base, items, truncated, item: null, model: buildExplorer({ state, window, current: new Map(), prior: null, accounts, items, gran, weekStart: o.weekStart }) };
  }
  const [current, prior] = await Promise.all([loadRollup(db, state, q), window.compare ? loadRollup(db, state, { ...q, from: window.compare.from, to: window.compare.to }) : null]);
  return { ...base, items: [], truncated: false, item: null, model: buildExplorer({ state, window, current, prior, accounts, items: [], gran, weekStart: o.weekStart }) };
}
