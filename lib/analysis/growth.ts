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
  posts: number; // feed posts + reels published in the window (stories excluded)
  days: number; // days in the window that have reach data (coverage)
}

export interface Summary {
  period: number;
  endDay: string; // last day of the current window
  current: Totals;
  prior: Totals;
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

/** A window only counts for a comparison when at least 80% of its days have data (sync gaps, Meta's 48 h lag). */
export const MIN_COVERAGE = 0.8;

const sum = (vals: (number | null)[]): number | null => {
  const nums = vals.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  return nums.length ? nums.reduce((a, b) => a + b, 0) : null;
};

function totals(rows: DailyRow[], posts: Post[], from: string, to: string, tz: string): Omit<Totals, 'followers'> {
  const inWin = rows.filter((r) => r.day >= from && r.day <= to);
  const follow = inWin.filter((r) => r.follows !== null && r.unfollows !== null);
  return {
    reach: sum(inWin.map((r) => r.reach)),
    views: sum(inWin.map((r) => r.views)),
    interactions: sum(inWin.map((r) => r.interactions)),
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
 * "yesterday" would compare a short window with a full one); with no data at all it ends yesterday.
 * Followers are a daily snapshot written on the day they were read (can be today), so they use their own latest day.
 */
export function summarize(rows: DailyRow[], posts: Post[], period: number, today: string, tz: string): Summary {
  const sorted = [...rows].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  const yesterday = addDays(today, -1);
  const withReach = sorted.filter((r) => r.reach !== null && r.day <= yesterday);
  const endDay = withReach.length ? withReach[withReach.length - 1].day : yesterday;
  const curFrom = addDays(endDay, -(period - 1));
  const priorTo = addDays(endDay, -period);
  const priorFrom = addDays(endDay, -(2 * period - 1));
  const curF = followersAt(sorted, today);
  const priorF = curF ? followersAt(sorted, addDays(curF.day, -period)) : null;
  const byDay = new Map(sorted.map((r) => [r.day, r.reach]));
  return {
    period,
    endDay,
    current: { followers: curF?.value ?? null, ...totals(sorted, posts, curFrom, endDay, tz) },
    prior: { followers: priorF?.value ?? null, ...totals(sorted, posts, priorFrom, priorTo, tz) },
    reachByDay: Array.from({ length: period }, (_, i) => {
      const day = addDays(curFrom, i);
      return { day, value: byDay.get(day) ?? null };
    }),
  };
}

const add = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : a + b);
function addTotals(a: Totals, b: Totals): Totals {
  return {
    followers: add(a.followers, b.followers),
    reach: add(a.reach, b.reach),
    views: add(a.views, b.views),
    interactions: add(a.interactions, b.interactions),
    netFollows: add(a.netFollows, b.netFollows),
    posts: a.posts + b.posts,
    days: Math.min(a.days, b.days), // a combined window is only as complete as its least complete account
  };
}

/**
 * Sums several accounts' summaries (group or all-accounts totals). Each account keeps its own window end, so the
 * daily series is merged by position (day 1 … day N of each window) and labelled with the latest end day.
 * ponytail: positional merge; switch to calendar-day merge if accounts' lags ever differ by more than a day.
 */
export function combine(list: Summary[]): Summary | null {
  if (list.length === 0) return null;
  return list.slice(1).reduce<Summary>(
    (acc, s) => ({
      period: acc.period,
      endDay: s.endDay > acc.endDay ? s.endDay : acc.endDay,
      current: addTotals(acc.current, s.current),
      prior: addTotals(acc.prior, s.prior),
      reachByDay: acc.reachByDay.map((d, i) => {
        const o = s.reachByDay[i];
        return { day: o && o.day > d.day ? o.day : d.day, value: add(d.value, o?.value ?? null) };
      }),
    }),
    list[0],
  );
}

const er = (t: Totals) => (t.interactions !== null && t.reach !== null && t.reach > 0 ? t.interactions / t.reach : null);

function kpi(value: number | null, prior: number | null, comparable: boolean, emptyReason: MissingReason): Kpi {
  if (value === null) return { value: null, prior, diff: null, change: null, reason: emptyReason };
  if (!comparable || prior === null) return { value, prior: null, diff: null, change: null, reason: 'not_enough_history' };
  const diff = value - prior;
  return { value, prior, diff, change: prior === 0 ? (diff === 0 ? 0 : null) : diff / Math.abs(prior), reason: null };
}

/** Headline numbers with their comparison. Never NaN or Infinity: a missing or zero base gives null + a reason. */
export function kpis(s: Summary): Record<KpiId, Kpi> {
  const need = Math.ceil(s.period * MIN_COVERAGE);
  const comparable = s.current.days >= need && s.prior.days >= need;
  const fewFollowers: MissingReason = s.current.followers !== null && s.current.followers < 100 ? 'needs_100_followers' : 'no_data';
  return {
    followers: kpi(s.current.followers, s.prior.followers, true, 'no_data'),
    reach: kpi(s.current.reach, s.prior.reach, comparable, 'no_data'),
    views: kpi(s.current.views, s.prior.views, comparable, 'no_data'),
    engagementRate: kpi(er(s.current), er(s.prior), comparable, 'no_data'),
    // media history comes from the 500-post backfill, not from daily snapshots, so post counts always compare
    posts: kpi(s.current.posts, s.prior.posts, true, 'no_data'),
    netFollows: kpi(s.current.netFollows, s.prior.netFollows, comparable, fewFollowers),
  };
}
