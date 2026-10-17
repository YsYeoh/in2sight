// The Explorer model (creator-toolkit spec §0b "Drill-down & time scope"). Pure: the rollup rows (additive parts per
// key), the window, today and the owner's week start are inputs. Metric values come from the registry (lib/metrics.ts);
// groups are sums of their accounts' parts (never averages of averages); the comparison period is joined by key, or by
// position for time buckets (whole buckets only: a bucket cut by either range has no comparison).
import { weekOrder } from '@/lib/analysis/best-time';
import { MAX_LAG_DAYS, type Kpi } from '@/lib/analysis/growth';
import type { ItemRow } from '@/lib/explorer/read';
import { explorerHref, FORMATS, withState, type ExplorerState } from '@/lib/explorer/state';
import { METRICS, type DailyParts, type MetricId, type Parts, type PostParts } from '@/lib/metrics';
import type { WeekStart } from '@/lib/prefs';
import { addDays } from '@/lib/sync/time';
import { bucketRange, bucketStart, compareRange, minDay, type DayRange, type Granularity } from '@/lib/time-scope/range';
import { scopeQuery, type ResolvedScope, type TimeScope } from '@/lib/time-scope/scope';

export interface ScopeAccount {
  id: string;
  username: string;
  groupName: string | null;
}

/** A value with its comparison, in the shape StatCard / deltaView already understand. */
export function toKpi(value: number | null, prior: number | null): Kpi {
  if (value === null) return { value: null, prior, diff: null, change: null, reason: 'no_data' };
  if (prior === null) return { value, prior: null, diff: null, change: null, reason: null };
  const diff = value - prior;
  return { value, prior, diff, change: prior === 0 ? (diff === 0 ? 0 : null) : diff / Math.abs(prior), reason: null };
}

const add = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : a + b);

function addDaily(a: DailyParts, b: DailyParts): DailyParts {
  return { reach: add(a.reach, b.reach), views: add(a.views, b.views), interactions: add(a.interactions, b.interactions), erInteractions: add(a.erInteractions, b.erInteractions), erReach: add(a.erReach, b.erReach), netFollows: add(a.netFollows, b.netFollows), followers: add(a.followers, b.followers) };
}

function addPosts(a: PostParts, b: PostParts): PostParts {
  return {
    posts: a.posts + b.posts,
    measured: a.measured + b.measured,
    reachSum: add(a.reachSum, b.reachSum),
    viewsSum: add(a.viewsSum, b.viewsSum),
    viewsN: a.viewsN + b.viewsN,
    likes: add(a.likes, b.likes),
    comments: add(a.comments, b.comments),
    saves: add(a.saves, b.saves),
    shares: add(a.shares, b.shares),
    erInteractions: add(a.erInteractions, b.erInteractions),
    erReach: add(a.erReach, b.erReach),
  };
}

/** Parts are sums and counts, so two rows combine by adding (a missing side keeps the other). */
export function addParts(a: Parts, b: Parts): Parts {
  return {
    daily: a.daily && b.daily ? addDaily(a.daily, b.daily) : (a.daily ?? b.daily),
    posts: a.posts && b.posts ? addPosts(a.posts, b.posts) : (a.posts ?? b.posts),
  };
}

/** One published item as parts, so single posts use the same registry formulas (same rules as explorer_posts). */
export function itemParts(i: ItemRow): Parts {
  const measured = (i.reach ?? 0) > 0;
  const er = measured && i.mediaType !== 'STORY';
  return {
    daily: null,
    posts: {
      posts: 1,
      measured: measured ? 1 : 0,
      reachSum: measured ? i.reach : null,
      viewsSum: i.views,
      viewsN: i.views === null ? 0 : 1,
      likes: i.likes,
      comments: i.comments,
      saves: i.saves,
      shares: i.shares,
      erInteractions: er ? (i.likes ?? 0) + (i.comments ?? 0) + (i.saves ?? 0) + (i.shares ?? 0) : null,
      erReach: er ? i.reach : null,
    },
  };
}

/** Group key of an account: 'g:<name>' for a named group, 'a:<id>' for an isolated account (never combined, SPEC §7b). */
export const groupKey = (a: Pick<ScopeAccount, 'id' | 'groupName'>) => (a.groupName ? `g:${a.groupName}` : `a:${a.id}`);

/** Per-account rows → per-group rows (sums of parts). Accounts outside `accounts` are ignored. */
export function byGroup(rows: Map<string, Parts>, accounts: ScopeAccount[]): Map<string, Parts> {
  const out = new Map<string, Parts>();
  for (const a of accounts) {
    const r = rows.get(a.id);
    if (!r) continue;
    const k = groupKey(a);
    const prev = out.get(k);
    out.set(k, prev ? addParts(prev, r) : r);
  }
  return out;
}

/**
 * The latest settled insight day of the accounts in scope (Instagram lags up to 48 h): the newest `daily_done_through`
 * that is within MAX_LAG_DAYS of yesterday, else yesterday — the same rule as summarize() uses per account.
 */
export function settledDay(doneThrough: (string | null | undefined)[], today: string): string {
  const yesterday = addDays(today, -1);
  const latest = doneThrough.filter((d): d is string => typeof d === 'string' && d <= yesterday).sort().at(-1);
  return latest !== undefined && latest >= addDays(yesterday, -MAX_LAG_DAYS) ? latest : yesterday;
}

/** The Explorer's days: like the KPI cards, a rolling preset ends on the settled day and a fixed range is cut there. */
export function explorerWindow(r: ResolvedScope, settled: string): { current: DayRange; compare: DayRange | null } {
  const w = r.window;
  const to = 'last' in w ? settled : minDay(w.to, settled > w.from ? settled : w.from);
  const from = 'last' in w ? addDays(to, -(w.last - 1)) : w.from;
  return { current: { from, to }, compare: compareRange(w, { from, to }, r.scope.cmp) };
}

/** First days of every bucket that touches the range, oldest first. */
export function bucketsOf(range: DayRange, gran: Granularity, weekStart: WeekStart): string[] {
  const out: string[] = [];
  for (let b = bucketStart(range.from, gran, weekStart); b <= range.to; b = addDays(bucketRange(b, gran).to, 1)) out.push(b);
  return out;
}

export interface ExplorerRow {
  key: string; // account id, 'g:<group>' / 'a:<id>', format, tag id / 'untagged', weekday, hour, bucket start, media id
  priorKey: string | null; // the comparison bucket (time) or the same key; null without a comparison
  values: Partial<Record<MetricId, Kpi>>;
}

export interface ExplorerModel {
  rows: ExplorerRow[]; // display order
  partial: string[]; // time buckets the range starts or ends inside
}

export interface ExplorerInput {
  state: ExplorerState;
  window: { current: DayRange; compare: DayRange | null };
  current: Map<string, Parts>; // per account when by = 'group' (combined here), otherwise per key
  prior: Map<string, Parts> | null;
  accounts: ScopeAccount[]; // live accounts in scope, sorted by username
  items: ItemRow[]; // by = 'post' only
  gran: Granularity;
  weekStart: WeekStart;
}

const EMPTY: Parts = { daily: null, posts: null };

export function buildExplorer(i: ExplorerInput): ExplorerModel {
  const { state: s } = i;
  if (s.by === 'post') {
    return { rows: i.items.map((it) => ({ key: it.id, priorKey: null, values: Object.fromEntries(s.metrics.map((m) => [m, toKpi(METRICS[m].value(itemParts(it)), null)])) })), partial: [] };
  }
  const cur = s.by === 'group' ? byGroup(i.current, i.accounts) : i.current;
  const pri = i.prior && (s.by === 'group' ? byGroup(i.prior, i.accounts) : i.prior);
  let keys: string[];
  let priorKeys: (string | null)[];
  let partial: string[] = [];
  if (s.by === 'time') {
    keys = bucketsOf(i.window.current, i.gran, i.weekStart);
    const cut = (r: DayRange) => (b: string) => {
      const span = bucketRange(b, i.gran);
      return span.from < r.from || span.to > r.to;
    };
    const curCut = cut(i.window.current);
    const before = i.window.compare ? bucketsOf(i.window.compare, i.gran, i.weekStart) : [];
    const priorCut = i.window.compare ? cut(i.window.compare) : () => true;
    // bucket n of the range vs bucket n of the comparison, but only whole buckets: a bucket cut at either end (the ranges
    // cut their weeks differently) would show a fake rise or drop
    priorKeys = keys.map((k, n) => (before[n] !== undefined && !curCut(k) && !priorCut(before[n]) ? before[n] : null));
    partial = keys.filter(curCut);
  } else {
    keys =
      s.by === 'account' ? i.accounts.map((a) => a.id)
      : s.by === 'group' ? [...new Set(i.accounts.map(groupKey))]
      : s.by === 'weekday' ? weekOrder(i.weekStart).map(String)
      : s.by === 'hour' ? Array.from({ length: 24 }, (_, h) => String(h))
      : s.by === 'format' ? FORMATS.filter((f) => cur.has(f) || pri?.has(f))
      : [...new Set([...cur.keys(), ...(pri?.keys() ?? [])])]; // tags (ids and 'untagged')
    priorKeys = keys.map((k) => (pri ? k : null));
  }
  const rows = keys.map((key, n) => {
    const now = cur.get(key) ?? EMPTY;
    const pk = priorKeys[n];
    const before = pk !== null && pri ? (pri.get(pk) ?? EMPTY) : null;
    return { key, priorKey: pk, values: Object.fromEntries(s.metrics.map((m) => [m, toKpi(METRICS[m].value(now), before ? METRICS[m].value(before) : null)])) };
  });
  // people, groups and tags rank by the chart metric (stable: ties keep username / A→Z order; "untagged" always last);
  // axes (weekday, hour, time, format) keep their natural order
  if (s.by === 'account' || s.by === 'group' || s.by === 'tag') {
    const v = (r: ExplorerRow) => r.values[s.chart]?.value ?? null;
    const last = (r: ExplorerRow) => (r.key === 'untagged' ? 1 : 0);
    rows.sort((a, b) => last(a) - last(b) || (v(a) === v(b) ? 0 : v(a) === null ? 1 : v(b) === null ? -1 : v(b)! - v(a)!));
  }
  return { rows, partial };
}

/** Where a click on a row / bar goes: one level deeper, or a narrower range. Null = the deepest level. */
export function drillTarget(s: ExplorerState, key: string, gran: Granularity): { state: ExplorerState; range?: DayRange; gran?: Granularity } | null {
  switch (s.by) {
    case 'group':
      return key.startsWith('g:') ? { state: withState(s, { group: key.slice(2), accounts: [], by: 'account' }) } : { state: withState(s, { accounts: [key.slice(2)], by: 'format' }) };
    case 'account':
      return { state: withState(s, { accounts: [key], by: 'format' }) };
    case 'format':
      return { state: withState(s, { format: key as ExplorerState['format'], by: 'post' }) };
    case 'tag':
      return { state: withState(s, { tag: key, by: 'post' }) };
    case 'weekday':
      return { state: withState(s, { weekday: Number(key), by: 'hour' }) };
    case 'hour':
      return { state: withState(s, { hour: Number(key), by: 'post' }) };
    case 'time': {
      const range = bucketRange(key, gran);
      if (gran === 'day') return { state: withState(s, { by: 'post' }), range };
      return { state: s, range, gran: gran === 'month' ? 'week' : 'day' };
    }
    case 'post':
      return { state: withState(s, { item: key }) };
  }
}

/** The link of a drill target: the Explorer state plus the scope (kept, or the clicked bucket as fixed days). */
export function drillHref(s: ExplorerState, key: string, r: Pick<ResolvedScope, 'scope' | 'query' | 'gran'>): string | null {
  const t = drillTarget(s, key, r.gran);
  if (!t) return null;
  if (!t.range) return explorerHref(t.state, r.query);
  const scope: TimeScope = { range: t.range, cmp: typeof r.scope.cmp === 'object' ? 'prev' : r.scope.cmp, gran: t.gran ?? 'auto' };
  return explorerHref(t.state, scopeQuery(scope));
}

export interface Crumb {
  kind: 'all' | 'group' | 'account' | 'format' | 'item';
  key: string; // '' for all, the group name, account id, format, media id
  href: string;
}

/** The vertical trail of the current state: All accounts › group › @account › format › post. Every link keeps the scope. */
export function breadcrumbs(s: ExplorerState, o: { query: string; hasGroups: boolean }): Crumb[] {
  const base = withState(s, { accounts: [], group: null, format: null, tag: null, weekday: null, hour: null, item: null, by: o.hasGroups ? 'group' : 'account' });
  const out: Crumb[] = [{ kind: 'all', key: '', href: explorerHref(base, o.query) }];
  let at = base;
  if (s.group !== null) {
    at = withState(at, { group: s.group, by: 'account' });
    out.push({ kind: 'group', key: s.group, href: explorerHref(at, o.query) });
  }
  if (s.accounts.length === 1) {
    at = withState(at, { accounts: s.accounts, by: 'format' });
    out.push({ kind: 'account', key: s.accounts[0], href: explorerHref(at, o.query) });
  }
  if (s.format !== null) {
    at = withState(at, { format: s.format, by: 'post' });
    out.push({ kind: 'format', key: s.format, href: explorerHref(at, o.query) });
  }
  if (s.item !== null) out.push({ kind: 'item', key: s.item, href: explorerHref(s, o.query) });
  return out;
}
