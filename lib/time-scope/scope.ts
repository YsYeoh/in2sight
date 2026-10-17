// The Time Scope (creator-toolkit spec §0b): ONE URL state `?from&to&cmp&gran` shared by Overview, the account
// pages, Calendar and exports. Everything here is pure: parse never throws (hostile or malformed values fall back
// to the default), "today" is an input, days are owner-timezone 'YYYY-MM-DD' strings.
//
// URL format (canonical, defaults omitted so the default scope is a bare path):
//   from=7d|14d|30d|90d|6m|1y|ytd|all            a preset (rolling: it moves with today)
//   from=2026-09-01&to=2026-09-30                fixed days (a month, a quarter, a week or any custom range)
//   cmp=none|yoy  (default: previous period)     cfrom=…&cto=…  custom comparison days
//   gran=day|week|month (default: auto)
// Accepted as input only (pickers and old links): week=<any day of it>, month=YYYY-MM, quarter=YYYY-Qn, period=7|30|90.
import { MAX_LAG_DAYS } from '@/lib/analysis/growth';
import type { WeekStart } from '@/lib/prefs';
import { addDays } from '@/lib/sync/time';
import { autoGranularity, compareRange, daysIn, isDay, minDay, monthOf, quarterOf, stepRange, weekOf, type Compare, type DayRange, type Granularity, type Window } from '@/lib/time-scope/range';

export const PRESETS = ['7d', '14d', '30d', '90d', '6m', '1y', 'ytd', 'all'] as const;
export type Preset = (typeof PRESETS)[number];
/** Rolling presets = the last N days up to the latest settled day (6 months = 26 weeks). */
export const ROLLING: Partial<Record<Preset, number>> = { '7d': 7, '14d': 14, '30d': 30, '90d': 90, '6m': 182, '1y': 365 };
export const DEFAULT_PRESET: Preset = '30d'; // SPEC §7b default
/** The longest range anyone can ask for (about 5 years); it also bounds "all" and every read. */
export const MAX_DAYS = 1830;
export const GRANULARITIES = ['auto', 'day', 'week', 'month'] as const;
export type GranChoice = (typeof GRANULARITIES)[number];
/** URL keys owned by the scope: a link or form that sets a scope drops all of them first. */
export const SCOPE_KEYS = ['from', 'to', 'cmp', 'cfrom', 'cto', 'gran', 'week', 'month', 'quarter', 'period'] as const;

export interface TimeScope {
  range: Preset | DayRange;
  cmp: Compare;
  gran: GranChoice;
}

export const DEFAULT_SCOPE: TimeScope = { range: DEFAULT_PRESET, cmp: 'prev', gran: 'auto' };

type Params = Record<string, string | string[] | undefined> | URLSearchParams;
const pad = (n: number) => String(n).padStart(2, '0');

/** One value per key: a repeated key (?from=a&from=b) is ambiguous and counts as missing. */
function one(sp: Params, key: string): string | null {
  if (sp instanceof URLSearchParams) {
    const all = sp.getAll(key);
    return all.length === 1 ? all[0] : null;
  }
  const v = sp[key];
  return typeof v === 'string' ? v : null;
}

/** Days in order, at most MAX_DAYS long (a longer range keeps its end and loses its start). */
function ordered(a: string, b: string): DayRange {
  const [from, to] = a <= b ? [a, b] : [b, a];
  return daysIn({ from, to }) > MAX_DAYS ? { from: addDays(to, -(MAX_DAYS - 1)), to } : { from, to };
}

function parseRange(sp: Params, weekStart: WeekStart): Preset | DayRange {
  const from = one(sp, 'from');
  const to = one(sp, 'to');
  if ((PRESETS as readonly (string | null)[]).includes(from)) return from as Preset;
  if (isDay(from) && isDay(to)) return ordered(from, to);
  const week = one(sp, 'week');
  if (isDay(week)) return weekOf(week, weekStart);
  const month = one(sp, 'month')?.match(/^(20\d\d)-(0[1-9]|1[0-2])$/);
  if (month) return monthOf(`${month[0]}-01`);
  const quarter = one(sp, 'quarter')?.match(/^(20\d\d)-Q([1-4])$/);
  if (quarter) return quarterOf(`${quarter[1]}-${pad((Number(quarter[2]) - 1) * 3 + 1)}-01`);
  const period = one(sp, 'period'); // links from before the Time Scope
  return period === '7' || period === '30' || period === '90' ? (`${period}d` as Preset) : DEFAULT_PRESET;
}

/** The scope in a URL. Never throws: anything unknown, repeated or malformed falls back to the default part. */
export function parseTimeScope(sp: Params, weekStart: WeekStart = 'mon'): TimeScope {
  const range = parseRange(sp, weekStart);
  const cfrom = one(sp, 'cfrom');
  const cto = one(sp, 'cto');
  const c = one(sp, 'cmp');
  const cmp: Compare = isDay(cfrom) && isDay(cto) ? ordered(cfrom, cto) : c === 'none' || c === 'yoy' ? c : 'prev';
  const g = one(sp, 'gran');
  return {
    range,
    cmp: range === 'all' ? 'none' : cmp, // "everything" has no earlier period to compare with
    gran: (GRANULARITIES as readonly (string | null)[]).includes(g) ? (g as GranChoice) : 'auto',
  };
}

/** Canonical URL parameters of a scope; default parts are left out (the default scope is {}). */
export function scopeParams(s: TimeScope): Record<string, string> {
  const p: Record<string, string> = {};
  if (typeof s.range === 'object') Object.assign(p, { from: s.range.from, to: s.range.to });
  else if (s.range !== DEFAULT_PRESET) p.from = s.range;
  if (typeof s.cmp === 'object') Object.assign(p, { cfrom: s.cmp.from, cto: s.cmp.to });
  else if (s.cmp !== 'prev' && s.range !== 'all') p.cmp = s.cmp;
  if (s.gran !== 'auto') p.gran = s.gran;
  return p;
}

export const scopeQuery = (s: TimeScope): string => new URLSearchParams(scopeParams(s)).toString();

/** A relative link ('?…') that shows scope `s` and keeps the page's own parameters (tab, filters, account). */
export function scopeHref(s: TimeScope, keep: Record<string, string> = {}): string {
  const q = new URLSearchParams(keep);
  for (const k of SCOPE_KEYS) q.delete(k);
  for (const [k, v] of Object.entries(scopeParams(s))) q.set(k, v);
  return `?${q}`;
}

/** Only the scope parameters of a URL (for links into other scoped pages): '' when there are none. */
export function scopeQueryOf(search: URLSearchParams): string {
  const q = new URLSearchParams();
  for (const k of SCOPE_KEYS) for (const v of search.getAll(k)) q.append(k, v);
  return q.toString();
}

export interface ResolvedScope {
  scope: TimeScope; // what is shown (a range that starts after today has fallen back to the default)
  params: Record<string, string>; // scopeParams(scope), for hidden form fields
  query: string; // scopeQuery(scope), '' for the default; appended to internal links
  preset: Preset | null;
  window: Window; // what the KPIs measure (summarize)
  range: DayRange; // the covered days up to today: posts, Stories, calendar, labels
  compare: DayRange | null; // comparison days for labels (each account's KPIs cut their own, see compareRange)
  gran: Granularity; // chart buckets (auto resolved)
  earliest: string | null; // first captured day among the loaded rows; null when nothing was captured
  partial: boolean; // part of the range is before the first captured day
  comparePartial: boolean; // part of the comparison is before the first captured day
}

function windowOf(r: Preset | DayRange, today: string, earliest: string | null): Window {
  if (typeof r === 'object') return r;
  const days = ROLLING[r];
  if (days) return { last: days };
  if (r === 'ytd') return { from: `${today.slice(0, 4)}-01-01`, to: today };
  const floor = addDays(today, -(MAX_DAYS - 1)); // 'all': from the first captured day, at most MAX_DAYS back
  return { from: earliest === null ? today : earliest < floor ? floor : minDay(earliest, today), to: today };
}

/** Turns the URL state into concrete days. `earliest` = first captured day (see earliestDay), needed by "all". */
export function resolveScope(s: TimeScope, today: string, earliest: string | null = null): ResolvedScope {
  const scope: TimeScope = typeof s.range === 'object' && s.range.from > today ? { ...s, range: DEFAULT_PRESET } : s;
  const r = scope.range;
  const window = windowOf(r, today, earliest);
  const range = 'last' in window ? { from: addDays(today, -(window.last - 1)), to: today } : { from: window.from, to: minDay(window.to, today) };
  const compare = compareRange(window, range, scope.cmp);
  return {
    scope,
    params: scopeParams(scope),
    query: scopeQuery(scope),
    preset: typeof r === 'string' ? r : null,
    window,
    range,
    compare,
    gran: scope.gran === 'auto' ? autoGranularity(daysIn(range)) : scope.gran,
    earliest,
    partial: earliest === null || range.from < earliest,
    comparePartial: compare !== null && (earliest === null || compare.from < earliest),
  };
}

/** First day the loaders read: both windows plus Instagram's lag, and at least the 2 × 7 days the reach-drop flag needs. */
export function readFrom(s: TimeScope, today: string): string {
  if (s.range === 'all') return addDays(today, -(MAX_DAYS - 1));
  const r = resolveScope(s, today);
  const first = minDay(r.range.from, r.compare?.from ?? r.range.from);
  return minDay(addDays(first, -(1 + MAX_LAG_DAYS)), addDays(today, -(2 * 7 + 1 + MAX_LAG_DAYS)));
}

/** The first captured day across accounts (each list oldest first, as the loaders return it). */
export function earliestDay(lists: { day: string }[][]): string | null {
  return lists.reduce<string | null>((m, l) => (l.length && (m === null || l[0].day < m) ? l[0].day : m), null);
}

/** The same scope one period back or forward (Calendar arrows); null when it would start after today. */
export function stepScope(r: ResolvedScope, dir: 1 | -1, today: string): TimeScope | null {
  const rolling = 'last' in r.window;
  const next = stepRange(rolling ? r.range : (r.window as DayRange), dir, !rolling);
  return next.from > today ? null : { ...r.scope, range: next };
}
