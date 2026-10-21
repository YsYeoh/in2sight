// The Growth tab model (Plan 15a). Pure: today / tz / weekStart are inputs; a missing number is null with a reason, never 0.
import { bucketize } from '@/lib/analysis/buckets';
import { toKpi } from '@/lib/analysis/explorer';
import { MIN_COVERAGE, kpis, summarize, type Kpi } from '@/lib/analysis/growth';
import { PROJECTION, projectFollowers, weekdayAnomaly, type ProjectionResult } from '@/lib/analysis/trend';
import type { DailyRow, Post } from '@/lib/analysis/types';
import { WHY_METRICS, type DayPost, type FeedKind, type GrowthDay, type UnusualDay, type WhyMetric } from '@/lib/analysis/why';
import type { AudienceSnapshots } from '@/lib/dashboard/detail-read';
import type { BreakdownRow, DayCounts } from '@/lib/dashboard/growth-read';
import type { AudienceKind } from '@/lib/instagram/metrics';
import type { DeltaDef } from '@/lib/metrics';
import type { WeekStart } from '@/lib/prefs';
import { addDays, localDay, localHour } from '@/lib/sync/time';
import { bucketStart, daysBetween, daysIn, isDay, minDay, type DayRange } from '@/lib/time-scope/range';
import { readFrom, type ResolvedScope } from '@/lib/time-scope/scope';

export type GrowthKpiId = 'followers' | 'netFollows' | 'follows' | 'unfollows' | 'churnRate' | 'nonFollowerShare';
export const GROWTH_KPI_IDS: GrowthKpiId[] = ['followers', 'netFollows', 'follows', 'unfollows', 'churnRate', 'nonFollowerShare'];
export const GROWTH_KPIS: Record<GrowthKpiId, DeltaDef> = {
  followers: { kind: 'count', higherIsBetter: true },
  netFollows: { kind: 'count', higherIsBetter: true },
  follows: { kind: 'count', higherIsBetter: true },
  unfollows: { kind: 'count', higherIsBetter: false },
  churnRate: { kind: 'percent', higherIsBetter: false },
  nonFollowerShare: { kind: 'percent', higherIsBetter: true },
};
export const HOURLY_MAX_DAYS = 7;
export const LOOKBACK_DAYS = 90;
export const TOP_DAYS = 3;
export const MAX_UNUSUAL = 10;
export const AUDIENCE_TOP = 8;
export const NOTABLE_PP = 0.02;
export const MIN_AUDIENCE = 100;

export interface GrowthInput {
  daily: DailyRow[];
  breakdown: BreakdownRow[];
  posts: Post[];
  stories: DayCounts;
  comments: DayCounts;
  curve: { at: string; followers: number }[] | null;
  audience: { first: AudienceSnapshots; last: AudienceSnapshots };
}
export interface GrowthOptions { scope: ResolvedScope; today: string; tz: string; weekStart: WeekStart }
export interface FlowDay { day: string; net: number; follows: number | null; unfollows: number | null; posts: number; stories: number | null }
export interface FormatSplit { productType: string; follower: number; nonFollower: number; share: number | null; priorShare: number | null; change: number | null }
export interface ShareRow { key: string; then: number | null; now: number; change: number | null; notable: boolean }
export type AudienceDim = 'age' | 'gender' | 'country' | 'city';
export interface DimChange { from: string | null; to: string; total: number; rows: ShareRow[] }
export type AudienceChange = Record<AudienceDim, DimChange | null>;
export interface GrowthModel {
  scope: ResolvedScope;
  kpis: Record<GrowthKpiId, Kpi>;
  sparks: Record<GrowthKpiId, (number | null)[]>;
  followers: { rows: { day: string; followers: number | null }[]; partial: string[]; hourly: { at: string; followers: number }[] | null; change: { from: string; to: string; abs: number; pct: number | null } | null; firstDay: string | null };
  projection: ProjectionResult;
  flow: { rows: { day: string; follows: number | null; unfollows: number | null; net: number | null }[]; partial: string[]; source: 'instagram' | 'derived' | 'mixed' | null; best: FlowDay[]; worst: FlowDay[] };
  loyalty: { rows: { day: string; follower: number | null; nonFollower: number | null }[]; partial: string[]; formats: FormatSplit[] };
  activity: Record<string, { posts: number; stories: number | null }>;
  audience: AudienceChange;
  days: GrowthDay[];
  unusual: UnusualDay[];
  storiesFrom: string | null;
}

/** The first day the tab reads: the scope's own read window, 90 days before the range (same-weekday history, Why baselines) and the last 28 days (projection). */
export function growthReadFrom(scope: ResolvedScope, today: string): string {
  return minDay(minDay(readFrom(scope.scope, today), addDays(scope.range.from, -LOOKBACK_DAYS)), addDays(today, -(PROJECTION.days - 1)));
}

const inRange = (day: string, r: DayRange) => day >= r.from && day <= r.to;
const sumOf = (xs: (number | null)[]): number | null => {
  const n = xs.filter((x): x is number => x !== null);
  return n.length ? n.reduce((a, b) => a + b, 0) : null;
};
const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null);
const nfShare = (d: { reachFollower: number | null; reachNonFollower: number | null }): number | null =>
  d.reachFollower === null || d.reachNonFollower === null ? null : ratio(d.reachNonFollower, d.reachFollower + d.reachNonFollower);

export function buildGrowth(input: GrowthInput, o: GrowthOptions): GrowthModel {
  const { scope, today, tz, weekStart } = o;
  const range = scope.range;
  const byDay = new Map(input.daily.map((r) => [r.day, r]));

  // 2. per-day facts
  const bd = new Map<string, { f: number; nf: number; story: number }>();
  for (const b of input.breakdown) {
    const e = bd.get(b.day) ?? { f: 0, nf: 0, story: 0 };
    if (b.followType === 'FOLLOWER') e.f += b.value;
    if (b.followType === 'NON_FOLLOWER') e.nf += b.value;
    if (b.productType === 'STORY') e.story += b.value;
    bd.set(b.day, e);
  }
  const postsByDay = new Map<string, DayPost[]>();
  for (const p of input.posts) {
    if (p.mediaType === 'STORY') continue;
    const at = new Date(p.postedAt);
    const day = localDay(at, tz);
    postsByDay.set(day, [...(postsByDay.get(day) ?? []), { id: p.id, mediaType: p.mediaType as FeedKind, postedAt: p.postedAt, hour: localHour(at, tz), reach: p.reach, permalink: p.permalink }]);
  }
  const counted = (c: DayCounts, day: string): number | null => (c.from !== null && day < c.from ? null : (c.days[day] ?? 0));
  const start = growthReadFrom(scope, today);
  const days: GrowthDay[] = Array.from({ length: daysBetween(start, range.to) + 1 }, (_, i) => {
    const day = addDays(start, i);
    const r = byDay.get(day);
    const prev = byDay.get(addDays(day, -1));
    const follows = r?.follows ?? null;
    const unfollows = r?.unfollows ?? null;
    const followers = r?.followers ?? null;
    const [net, netSource] =
      follows !== null && unfollows !== null ? [follows - unfollows, 'instagram' as const]
        : followers !== null && prev?.followers != null ? [followers - prev.followers, 'derived' as const]
          : [null, null];
    const b = bd.get(day);
    return {
      day, followers, follows, unfollows, net, netSource, reach: r?.reach ?? null,
      reachFollower: b ? b.f : null, reachNonFollower: b ? b.nf : null, storyReach: b ? b.story : null,
      posts: postsByDay.get(day) ?? [], stories: counted(input.stories, day), comments: counted(input.comments, day),
    };
  });
  const dayOf = new Map(days.map((d) => [d.day, d]));
  const rangeDays = days.filter((d) => inRange(d.day, range));

  // 3. KPIs
  const s = summarize(input.daily, input.posts, scope.window, today, tz, scope.scope.cmp);
  const base = kpis(s);
  const cur: DayRange = { from: s.from, to: s.endDay };
  const rowsBoth = (w: DayRange) => input.daily.filter((r) => inRange(r.day, w) && r.follows !== null && r.unfollows !== null);
  const counts = [...input.daily].filter((r) => r.followers !== null).sort((a, b) => (a.day < b.day ? -1 : 1));
  const churn = (w: DayRange): number | null => {
    const unf = sumOf(rowsBoth(w).map((r) => r.unfollows));
    const before = counts.filter((r) => r.day < w.from).at(-1) ?? counts.find((r) => inRange(r.day, w));
    return unf === null || !before || before.followers! <= 0 ? null : unf / before.followers!;
  };
  const like = (ref: Kpi, current: number | null, prior: number | null): Kpi => {
    if (current === null) return { value: null, prior: null, diff: null, change: null, reason: ref.reason ?? 'no_data' };
    if (ref.prior === null) return { value: current, prior: null, diff: null, change: null, reason: ref.reason };
    return toKpi(current, prior);
  };
  const win = (f: (w: DayRange) => number | null): [number | null, number | null] => [f(cur), s.compare ? f(s.compare) : null];
  const [fo, foP] = win((w) => sumOf(rowsBoth(w).map((r) => r.follows)));
  const [un, unP] = win((w) => sumOf(rowsBoth(w).map((r) => r.unfollows)));
  const [ch, chP] = win(churn);
  const share = (w: DayRange) => {
    const have = days.filter((d) => inRange(d.day, w) && d.reachFollower !== null && d.reachNonFollower !== null);
    const f = have.reduce((a, d) => a + d.reachFollower!, 0);
    const n = have.reduce((a, d) => a + d.reachNonFollower!, 0);
    return { value: ratio(n, f + n), coverage: have.length / daysIn(w) };
  };
  const nfCur = share(cur);
  const nfPrior = s.compare ? share(s.compare) : null;
  const nonFollowerShare: Kpi =
    nfCur.value === null ? toKpi(null, null)
      : !nfPrior ? toKpi(nfCur.value, null)
        : nfCur.coverage < MIN_COVERAGE || nfPrior.coverage < MIN_COVERAGE || nfPrior.value === null
          ? { value: nfCur.value, prior: null, diff: null, change: null, reason: 'not_enough_history' }
          : toKpi(nfCur.value, nfPrior.value);
  const kpiMap: Record<GrowthKpiId, Kpi> = {
    followers: base.followers, netFollows: base.netFollows,
    follows: like(base.netFollows, fo, foP), unfollows: like(base.netFollows, un, unP), churnRate: like(base.netFollows, ch, chP),
    nonFollowerShare,
  };

  // 4. sparks
  const curDays = Array.from({ length: s.period }, (_, i) => dayOf.get(addDays(s.from, i)));
  const sparks: Record<GrowthKpiId, (number | null)[]> = {
    followers: curDays.map((d) => d?.followers ?? null),
    netFollows: curDays.map((d) => d?.net ?? null),
    follows: curDays.map((d) => d?.follows ?? null),
    unfollows: curDays.map((d) => d?.unfollows ?? null),
    churnRate: curDays.map((d) => {
      const prev = d && dayOf.get(addDays(d.day, -1))?.followers;
      return d && d.unfollows !== null && typeof prev === 'number' ? ratio(d.unfollows, prev) : null;
    }),
    nonFollowerShare: curDays.map((d) => (d ? nfShare(d) : null)),
  };

  // 5. followers
  const fb = bucketize(rangeDays.map((d) => ({ day: d.day, followers: d.followers })), scope.gran, weekStart, { followers: 'last' });
  const withCount = rangeDays.filter((d) => d.followers !== null);
  const [first, last] = [withCount[0], withCount[withCount.length - 1]];
  const abs = withCount.length >= 2 ? last.followers! - first.followers! : null;
  const followers: GrowthModel['followers'] = {
    rows: fb.rows, partial: fb.partial,
    hourly: daysIn(range) <= HOURLY_MAX_DAYS ? input.curve : null,
    change: abs === null ? null : { from: first.day, to: last.day, abs, pct: first.followers! > 0 ? abs / first.followers! : null },
    firstDay: counts[0]?.day ?? null,
  };
  const projection = projectFollowers(counts.map((r) => ({ day: r.day, value: r.followers! })));

  // 6. flow
  const fl = bucketize(rangeDays.map((d) => ({ day: d.day, follows: d.follows, unfollows: d.unfollows, net: d.net })), scope.gran, weekStart, { follows: 'sum', unfollows: 'sum', net: 'sum' });
  const sources = new Set(rangeDays.map((d) => d.netSource).filter(Boolean));
  const flowDay = (d: GrowthDay): FlowDay => ({ day: d.day, net: d.net!, follows: d.follows, unfollows: d.unfollows, posts: d.posts.length, stories: d.stories });
  const netDays = rangeDays.filter((d) => d.net !== null && d.net !== 0);
  const top = (dir: 1 | -1) => netDays.filter((d) => d.net! * dir > 0).sort((a, b) => (b.net! - a.net!) * dir || (a.day < b.day ? 1 : -1)).slice(0, TOP_DAYS).map(flowDay);
  const flow: GrowthModel['flow'] = {
    rows: fl.rows, partial: fl.partial,
    source: sources.size === 0 ? null : sources.size === 2 ? 'mixed' : (sources.has('instagram') ? 'instagram' : 'derived'),
    best: top(1), worst: top(-1),
  };

  // 7. loyalty
  const lb = bucketize(rangeDays.map((d) => ({ day: d.day, follower: d.reachFollower, nonFollower: d.reachNonFollower })), scope.gran, weekStart, { follower: 'sum', nonFollower: 'sum' });
  const split = (r: DayRange | null) => {
    const m = new Map<string, { f: number; nf: number }>();
    if (r) for (const b of input.breakdown) {
      if (!inRange(b.day, r)) continue;
      const e = m.get(b.productType) ?? { f: 0, nf: 0 };
      if (b.followType === 'FOLLOWER') e.f += b.value;
      if (b.followType === 'NON_FOLLOWER') e.nf += b.value;
      m.set(b.productType, e);
    }
    return m;
  };
  const now = split(range);
  const then = split(scope.compare);
  const formats: FormatSplit[] = [...now]
    .filter(([, e]) => e.f + e.nf > 0)
    .map(([productType, e]) => {
      const p = then.get(productType);
      const share = ratio(e.nf, e.f + e.nf);
      const priorShare = p ? ratio(p.nf, p.f + p.nf) : null;
      return { productType, follower: e.f, nonFollower: e.nf, share, priorShare, change: share !== null && priorShare !== null ? share - priorShare : null };
    })
    .sort((a, b) => b.follower + b.nonFollower - (a.follower + a.nonFollower) || (a.productType < b.productType ? -1 : 1));

  // 8. activity
  const activity: GrowthModel['activity'] = {};
  for (const d of rangeDays) {
    const k = bucketStart(d.day, scope.gran, weekStart);
    const a = activity[k] ?? { posts: 0, stories: 0 as number | null };
    activity[k] = { posts: a.posts + d.posts.length, stories: a.stories === null || d.stories === null ? null : a.stories + d.stories };
  }

  // 9. unusual days
  const unusual: UnusualDay[] = [];
  for (const metric of WHY_METRICS) {
    const series = Object.fromEntries(days.map((d) => [d.day, d[metric]]));
    for (const d of rangeDays) {
      const a = weekdayAnomaly(series, d.day);
      if (a && 'unusual' in a && a.unusual) unusual.push({ day: d.day, metric, value: a.value, typical: a.median, z: a.z, direction: a.direction });
    }
  }
  unusual.sort((a, b) => ((a.z === null ? 1 : 0) - (b.z === null ? 1 : 0) || (a.z !== null && b.z !== null ? Math.abs(b.z) - Math.abs(a.z) : 0)) || (a.day < b.day ? 1 : -1));

  return {
    scope, kpis: kpiMap, sparks, followers, projection, flow,
    loyalty: { rows: lb.rows, partial: lb.partial, formats },
    activity, audience: audienceChange(input.audience.first, input.audience.last),
    days, unusual: unusual.slice(0, MAX_UNUSUAL), storiesFrom: input.stories.from,
  };
}

const DIMS: Record<AudienceDim, { kind: AudienceKind; key: (k: string) => string; complete: boolean }> = {
  age: { kind: 'age_gender', key: (k) => k.split('|')[0].trim(), complete: true },
  gender: { kind: 'age_gender', key: (k) => { const g = k.split('|')[1]?.trim().toUpperCase(); return g === 'F' || g === 'M' ? g : 'U'; }, complete: true },
  country: { kind: 'country', key: (k) => k.trim().toUpperCase(), complete: false },
  city: { kind: 'city', key: (k) => k.trim(), complete: false },
};

function tally(data: Record<string, number>, keyOf: (k: string) => string) {
  const m = new Map<string, number>();
  let total = 0;
  for (const [k, v] of Object.entries(data)) {
    if (!Number.isFinite(v) || v <= 0) continue;
    m.set(keyOf(k), (m.get(keyOf(k)) ?? 0) + v);
    total += v;
  }
  return { m, total };
}

/** Then (first snapshot of the range) vs now (the latest), per dimension; Instagram lists only the top 45 countries and cities, so a key missing from "then" there is unknown, not 0. */
export function audienceChange(first: AudienceSnapshots, last: AudienceSnapshots): AudienceChange {
  const one = (dim: AudienceDim): DimChange | null => {
    const { kind, key, complete } = DIMS[dim];
    const nowSnap = last[kind];
    if (!nowSnap) return null;
    const now = tally(nowSnap.data, key);
    if (now.total <= 0) return null;
    const thenSnap = first[kind];
    const th = thenSnap && thenSnap.day !== nowSnap.day ? tally(thenSnap.data, key) : null;
    const then = th && th.total > 0 ? th : null;
    const rows = [...now.m]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, AUDIENCE_TOP)
      .map(([k, n]): ShareRow => {
        const nowShare = n / now.total;
        const had = then?.m.get(k);
        const thenShare = !then ? null : had !== undefined ? had / then.total : complete ? 0 : null;
        const change = thenShare === null ? null : nowShare - thenShare;
        return { key: k, then: thenShare, now: nowShare, change, notable: change !== null && Math.abs(change) >= NOTABLE_PP && now.total >= MIN_AUDIENCE && then!.total >= MIN_AUDIENCE };
      });
    return { from: then ? thenSnap!.day : null, to: nowSnap.day, total: now.total, rows };
  };
  return { age: one('age'), gender: one('gender'), country: one('country'), city: one('city') };
}

/** ?day (one real day inside the range, else null) and ?why ('reach', else 'net'). */
export function parseWhyParams(sp: URLSearchParams, range: DayRange): { day: string | null; metric: WhyMetric } {
  const days = sp.getAll('day');
  const whys = sp.getAll('why');
  return { day: days.length === 1 && isDay(days[0]) && inRange(days[0], range) ? days[0] : null, metric: whys.length === 1 && whys[0] === 'reach' ? 'reach' : 'net' };
}

/** The same URL with day set and why set ('reach') or removed ('net'); every other param kept. Returns '?…'. */
export function whyHref(sp: URLSearchParams, day: string, metric: WhyMetric): string {
  const q = new URLSearchParams(sp);
  q.set('day', day);
  if (metric === 'reach') q.set('why', 'reach');
  else q.delete('why');
  return `?${q.toString()}`;
}
