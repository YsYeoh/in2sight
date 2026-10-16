// Account growth over a period vs the immediately preceding period of equal length (SPEC §7 "Delta").
// Pure and deterministic: "today" and the timezone are inputs, never read from the clock.
import { addDays, localDay } from '@/lib/sync/time';
import type { DailyRow, MissingReason, Post } from '@/lib/analysis/types';

export interface Totals {
  followers: number | null; // latest snapshot (current) / snapshot one period earlier (prior)
  reach: number | null;
  views: number | null;
  interactions: number | null;
  netFollows: number | null; // Σ(follows − unfollows); null when Instagram gave no follow data (under 100 followers)
  rate: { interactions: number; reach: number } | null; // engagement-rate parts; null unless the account has both
  posts: number; // feed posts + reels published in the window (stories excluded)
  days: number; // days in the window that have reach data (coverage)
}

export interface Summary {
  period: number;
  endDay: string; // last day of the current window
  current: Totals;
  prior: Totals;
  coverage: { current: number; prior: number }; // share of each window's days that have reach data (0–1)
  reachByDay: { day: string; value: number | null }[]; // current window, oldest first
}

export type KpiId = 'followers' | 'reach' | 'views' | 'engagementRate' | 'posts' | 'netFollows';

export interface Kpi {
  value: number | null;
  prior: number | null;
  diff: number | null; // value − prior (for engagement rate: percentage points as a ratio, 0.004 = +0.4 pp)
  change: number | null; // relative change (diff / prior); null when prior is 0 or missing
  reason: MissingReason | null; // why value or the comparison is missing
}

/** Instagram lags up to 48 h; a latest reach day older than yesterday − this means the account stopped syncing. */
export const MAX_LAG_DAYS = 3;

/** A window only counts for a comparison when at least 80% of its days have data (sync gaps, Meta's 48 h lag). */
export const MIN_COVERAGE = 0.8;

const sum = (vals: (number | null)[]): number | null => {
  const nums = vals.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  return nums.length ? nums.reduce((a, b) => a + b, 0) : null;
};

function totals(rows: DailyRow[], posts: Post[], from: string, to: string, tz: string): Omit<Totals, 'followers'> {
  const inWin = rows.filter((r) => r.day >= from && r.day <= to);
  const follow = inWin.filter((r) => r.follows !== null && r.unfollows !== null);
  const reach = sum(inWin.map((r) => r.reach));
  const interactions = sum(inWin.map((r) => r.interactions));
  return {
    reach,
    views: sum(inWin.map((r) => r.views)),
    interactions,
    rate: reach !== null && interactions !== null ? { interactions, reach } : null,
    netFollows: follow.length ? follow.reduce((a, r) => a + (r.follows as number) - (r.unfollows as number), 0) : null,
    posts: posts.filter((p) => {
      if (p.mediaType === 'STORY') return false;
      const d = localDay(new Date(p.postedAt), tz);
      return d >= from && d <= to;
    }).length,
    days: inWin.filter((r) => r.reach !== null).length,
  };
}

/** Last non-null followers value on or before `day`, with the day it was taken. */
function followersAt(sorted: DailyRow[], day: string): { day: string; value: number } | null {
  for (let i = sorted.length - 1; i >= 0; i--) {
    const r = sorted[i];
    if (r.day <= day && r.followers !== null) return { day: r.day, value: r.followers };
  }
  return null;
}

/**
 * The current window ends on the latest day with reach data before today (Instagram lags up to 48 h, so ending on
 * "yesterday" would compare a short window with a full one); with no data at all, or none within MAX_LAG_DAYS of
 * yesterday, it ends yesterday.
 * Followers are a daily snapshot written on the day they were read (can be today), so they use their own latest day.
 */
export function summarize(rows: DailyRow[], posts: Post[], period: number, today: string, tz: string): Summary {
  const sorted = [...rows].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  const yesterday = addDays(today, -1);
  const withReach = sorted.filter((r) => r.reach !== null && r.day <= yesterday);
  const latest = withReach.length ? withReach[withReach.length - 1].day : null;
  // a stale account (last reach day older than the lag allows) ends at yesterday, so its missing days count as gaps
  const endDay = latest !== null && latest >= addDays(yesterday, -MAX_LAG_DAYS) ? latest : yesterday;
  const curFrom = addDays(endDay, -(period - 1));
  const priorTo = addDays(endDay, -period);
  const priorFrom = addDays(endDay, -(2 * period - 1));
  const curF = followersAt(sorted, today);
  const priorF = curF ? followersAt(sorted, addDays(curF.day, -period)) : null;
  const byDay = new Map(sorted.map((r) => [r.day, r.reach]));
  const current: Totals = { followers: curF?.value ?? null, ...totals(sorted, posts, curFrom, endDay, tz) };
  const prior: Totals = { followers: priorF?.value ?? null, ...totals(sorted, posts, priorFrom, priorTo, tz) };
  return {
    period,
    endDay,
    current,
    prior,
    coverage: { current: current.days / period, prior: prior.days / period },
    reachByDay: Array.from({ length: period }, (_, i) => {
      const day = addDays(curFrom, i);
      return { day, value: byDay.get(day) ?? null };
    }),
  };
}

const add = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : a + b);

type SumField = 'followers' | 'reach' | 'views' | 'interactions' | 'netFollows';
const SUM_FIELDS: SumField[] = ['followers', 'reach', 'views', 'interactions', 'netFollows'];

/**
 * Totals of several accounts. Comparability rule, per field: if any account contributes a current value but has NO
 * prior value (a newly connected account has no follower history), the combined prior is null, so the comparison is
 * "not enough history" instead of the new account's whole value showing up as growth. Accounts without a current
 * value contribute to neither side. Engagement rate sums interactions and reach over accounts that have both, so an
 * account with reach but no interactions never understates the rate.
 */
function combineTotals(cur: Totals[], pri: Totals[]): { current: Totals; prior: Totals } {
  const current = { posts: cur.reduce((n, t) => n + t.posts, 0), days: Math.min(...cur.map((t) => t.days)) } as Totals;
  const prior = { posts: pri.reduce((n, t) => n + t.posts, 0), days: Math.min(...pri.map((t) => t.days)) } as Totals;
  for (const f of SUM_FIELDS) {
    const who = cur.map((t, i) => (t[f] !== null ? i : -1)).filter((i) => i >= 0);
    current[f] = sum(who.map((i) => cur[i][f]));
    prior[f] = who.every((i) => pri[i][f] !== null) ? sum(who.map((i) => pri[i][f])) : null;
  }
  const who = cur.map((t, i) => (t.rate ? i : -1)).filter((i) => i >= 0);
  const rate = (list: Totals[]) => (who.every((i) => list[i].rate) && who.length ? who.reduce((a, i) => ({ interactions: a.interactions + list[i].rate!.interactions, reach: a.reach + list[i].rate!.reach }), { interactions: 0, reach: 0 }) : null);
  current.rate = rate(cur);
  prior.rate = rate(pri);
  return { current, prior };
}

/**
 * Sums several accounts' summaries (group or all-accounts totals). Each account keeps its own window end, so the
 * daily series is merged by position (day 1 … day N of each window) and labelled with the latest end day.
 * ponytail: positional merge; switch to calendar-day merge if accounts' lags ever differ by more than a day.
 */
export function combine(list: Summary[]): Summary | null {
  if (list.length === 0) return null;
  const { current, prior } = combineTotals(list.map((s) => s.current), list.map((s) => s.prior));
  return {
    period: list[0].period,
    endDay: list.reduce((d, s) => (s.endDay > d ? s.endDay : d), list[0].endDay),
    current,
    prior,
    coverage: { current: current.days / list[0].period, prior: prior.days / list[0].period },
    reachByDay: list[0].reachByDay.map((d0, i) => ({
      day: list.reduce((d, s) => (s.reachByDay[i] && s.reachByDay[i].day > d ? s.reachByDay[i].day : d), d0.day),
      value: list.reduce<number | null>((v, s) => add(v, s.reachByDay[i]?.value ?? null), null),
    })),
  };
}

const er = (t: Totals) => (t.rate && t.rate.reach > 0 ? t.rate.interactions / t.rate.reach : null);

function kpi(value: number | null, prior: number | null, comparable: boolean, emptyReason: MissingReason, shortReason: MissingReason = 'not_enough_history'): Kpi {
  if (value === null) return { value: null, prior, diff: null, change: null, reason: emptyReason };
  if (!comparable || prior === null) return { value, prior: null, diff: null, change: null, reason: shortReason };
  const diff = value - prior;
  return { value, prior, diff, change: prior === 0 ? (diff === 0 ? 0 : null) : diff / Math.abs(prior), reason: null };
}

/**
 * Headline numbers with their comparison. Never NaN or Infinity: a missing or zero base gives null + a reason.
 * backfilling (history still importing): a window with gaps says "Importing history…" instead of "not enough history",
 * and a metric with no day yet says the same instead of "no data". The values themselves stay the real partial sums.
 */
export function kpis(s: Summary, opts: { backfilling?: boolean } = {}): Record<KpiId, Kpi> {
  const need = Math.ceil(s.period * MIN_COVERAGE);
  const comparable = s.current.days >= need && s.prior.days >= need;
  const short: MissingReason = opts.backfilling ? 'backfilling' : 'not_enough_history';
  const empty: MissingReason = opts.backfilling ? 'backfilling' : 'no_data';
  const fewFollowers: MissingReason = s.current.followers !== null && s.current.followers < 100 ? 'needs_100_followers' : empty;
  return {
    followers: kpi(s.current.followers, s.prior.followers, true, empty, short),
    reach: kpi(s.current.reach, s.prior.reach, comparable, empty, short),
    views: kpi(s.current.views, s.prior.views, comparable, empty, short),
    engagementRate: kpi(er(s.current), er(s.prior), comparable, empty, short),
    // media history comes from the 500-post backfill, not from daily snapshots, so post counts always compare
    posts: kpi(s.current.posts, s.prior.posts, true, 'no_data'),
    netFollows: kpi(s.current.netFollows, s.prior.netFollows, comparable, fewFollowers, short),
  };
}
