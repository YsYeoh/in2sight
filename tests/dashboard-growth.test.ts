import { describe, expect, it } from 'vitest';
import type { DailyRow, Post } from '@/lib/analysis/types';
import { audienceChange, buildGrowth, growthReadFrom, parseWhyParams, whyHref, type GrowthInput } from '@/lib/dashboard/growth';
import type { BreakdownRow } from '@/lib/dashboard/growth-read';
import { addDays } from '@/lib/sync/time';
import { daysBetween } from '@/lib/time-scope/range';
import { parseTimeScope, resolveScope } from '@/lib/time-scope/scope';

const KL = 'Asia/Kuala_Lumpur'; // UTC+8, no DST
const TODAY = '2026-10-15'; // a Thursday
const scopeOf = (q: string) => resolveScope(parseTimeScope(new URLSearchParams(q)), TODAY, '2026-06-01');
const opts = (q = 'from=7d') => ({ scope: scopeOf(q), today: TODAY, tz: KL, weekStart: 'mon' as const });
const row = (day: string, o: Partial<DailyRow> = {}): DailyRow => ({ day, followers: null, reach: null, views: null, accountsEngaged: null, interactions: null, follows: null, unfollows: null, linkTaps: null, ...o });
const NONE = { first: { age_gender: null, country: null, city: null }, last: { age_gender: null, country: null, city: null } };
const EMPTY: GrowthInput = { daily: [], breakdown: [], posts: [], stories: { days: {}, from: null }, comments: { days: {}, from: null }, curve: null, audience: NONE };
const post = (id: string, postedAt: string, o: Partial<Post> = {}): Post => ({ id, accountId: 'a1', mediaType: 'REELS', postedAt, permalink: null, reach: 1000, views: null, likes: null, comments: null, shares: null, saves: null, ...o });

/** 120 days ending TODAY: +5 followers a day (8 follows, 3 unfollows), reach 1000, reach split 700 followers / 300 non-followers (Reels 600/300, Stories 100/0). */
function steady(over: Record<string, Partial<DailyRow>> = {}): GrowthInput {
  const days = Array.from({ length: 120 }, (_, i) => addDays(TODAY, i - 119));
  return {
    ...EMPTY,
    daily: days.map((d, i) => row(d, { followers: 1000 + 5 * i, follows: 8, unfollows: 3, reach: 1000, ...over[d] })),
    breakdown: days.flatMap((day): BreakdownRow[] => [
      { day, followType: 'FOLLOWER', productType: 'REEL', value: 600 },
      { day, followType: 'NON_FOLLOWER', productType: 'REEL', value: 300 },
      { day, followType: 'FOLLOWER', productType: 'STORY', value: 100 },
    ]),
  };
}
/** Every number in the model is finite (no NaN / Infinity hiding in a nested field). */
const finite = (v: unknown): boolean => (typeof v === 'number' ? Number.isFinite(v) : Array.isArray(v) ? v.every(finite) : v !== null && typeof v === 'object' ? Object.values(v).every(finite) : true);

describe('growthReadFrom', () => {
  it('reads the range, the comparison and 90 days before the range (same-weekday history, baselines)', () => {
    expect(growthReadFrom(scopeOf('from=7d'), TODAY)).toBe('2026-07-11');
    expect(growthReadFrom(scopeOf('from=2026-09-01&to=2026-09-30'), TODAY)).toBe('2026-06-03');
  });
});

describe('buildGrowth', () => {
  it('a steady account: KPIs as the Overview computes them, follows/unfollows/churn/non-follower share with comparisons', () => {
    const m = buildGrowth(steady(), opts());
    expect(m.kpis.followers).toMatchObject({ value: 1595, reason: null });
    expect(m.kpis.netFollows).toMatchObject({ value: 35, prior: 35, change: 0 });
    expect(m.kpis.follows).toMatchObject({ value: 56, prior: 56, change: 0, reason: null });
    expect(m.kpis.unfollows).toMatchObject({ value: 21, prior: 21 });
    expect(m.kpis.churnRate.value).toBeCloseTo(21 / 1555, 6); // the count on 7 October, the day before the KPI window
    expect(m.kpis.nonFollowerShare).toMatchObject({ value: 0.3, prior: 0.3, diff: 0, reason: null });
    expect(m.sparks.followers).toHaveLength(7);
    expect(m.days[0].day).toBe('2026-07-11');
    expect(m.days).toHaveLength(daysBetween('2026-07-11', TODAY) + 1);
    expect(m.days.at(-1)).toMatchObject({ day: TODAY, net: 5, netSource: 'instagram', reachFollower: 700, reachNonFollower: 300, storyReach: 100, stories: 0, comments: 0 });
    expect(m.flow.source).toBe('instagram');
    expect(m.flow.best.map((d) => d.day)).toEqual(['2026-10-15', '2026-10-14', '2026-10-13']); // equal nets: newest first
    expect(m.flow.worst).toEqual([]);
    expect(m.followers.change).toEqual({ from: '2026-10-09', to: '2026-10-15', abs: 30, pct: 30 / 1565 });
    expect(m.projection).toMatchObject({ method: 'median_slope', n: 28, perDay: 5, confidence: 'medium' });
    expect(m.loyalty.formats).toEqual([
      { productType: 'REEL', follower: 4200, nonFollower: 2100, share: 1 / 3, priorShare: 1 / 3, change: 0 },
      { productType: 'STORY', follower: 700, nonFollower: 0, share: 0, priorShare: 0, change: 0 },
    ]);
    expect(m.unusual).toEqual([]);
    expect(finite(m)).toBe(true);
  });

  it('a spike on a Wednesday is an unusual day (identical history, so no z); the Overview-style comparison still holds', () => {
    const m = buildGrowth(steady({ '2026-10-14': { follows: 63 } }), opts());
    expect(m.unusual).toEqual([{ day: '2026-10-14', metric: 'net', value: 60, typical: 5, z: null, direction: 'up' }]);
    expect(m.flow.best[0]).toMatchObject({ day: '2026-10-14', net: 60, follows: 63, unfollows: 3 });
  });

  it('today (only a part-day follower count, no follows/unfollows/reach) is not an unusual day, not in the flow and not in its source or best/worst', () => {
    // eight steady Thursdays at +5, then today at 09:00 with +1 so far
    const m = buildGrowth(steady({ [TODAY]: { followers: 1591, follows: null, unfollows: null, reach: null } }), opts());
    expect(m.days.at(-1)).toMatchObject({ day: TODAY, net: 1, netSource: 'derived' });
    expect(m.unusual.filter((u) => u.day === TODAY)).toEqual([]);
    expect(m.unusual).toEqual([]);
    expect(m.flow.source).toBe('instagram');
    expect(m.flow.rows.at(-1)!.day).toBe('2026-10-14');
    expect(m.flow.best.map((d) => d.day)).toEqual(['2026-10-14', '2026-10-13', '2026-10-12']);
    expect(m.flow.worst).toEqual([]);
    expect(m.followers.rows.at(-1)).toEqual({ day: TODAY, followers: 1591 }); // the count itself still shows today
  });

  it('an account whose every included day is derived says so, and today (derived from a part-day count) does not mix it in', () => {
    const daily = ['2026-10-12', '2026-10-13', '2026-10-14', TODAY].map((d, i) => row(d, { followers: 80 + i }));
    expect(buildGrowth({ ...EMPTY, daily }, opts()).flow.source).toBe('derived');
  });

  it('a day before the first captured Story is unknown (null), never "no Stories"; a later day with none is 0', () => {
    const m = buildGrowth({ ...steady(), stories: { days: { '2026-10-12': 2 }, from: null } }, opts());
    expect(m.days.find((d) => d.day === '2026-10-11')!.stories).toBeNull();
    expect(m.days.find((d) => d.day === '2026-10-12')!.stories).toBe(2);
    expect(m.days.find((d) => d.day === '2026-10-13')!.stories).toBe(0);
    expect(m.activity['2026-10-11']).toMatchObject({ stories: null });
    expect(m.activity['2026-10-13']).toMatchObject({ stories: 0 });
  });

  it('a flat-history spike is not cut off by 12 milder days (a null z is scaled by the smallest reportable change)', () => {
    // Wednesdays are flat (net 5); every other weekday alternates 5 / 6 by week, and 12 of them in the last 30 days jump to +11
    const base = steady();
    const mild = new Set(base.daily.filter((r) => r.day > '2026-09-14' && r.day < '2026-10-14' && new Date(`${r.day}T00:00:00Z`).getUTCDay() !== 3).slice(0, 12).map((r) => r.day));
    const daily = base.daily.map((r, i) => {
      const wed = new Date(`${r.day}T00:00:00Z`).getUTCDay() === 3;
      const follows = r.day === '2026-10-14' ? 63 : mild.has(r.day) ? 14 : wed ? 8 : 8 + (Math.floor(i / 7) % 2);
      return { ...r, follows };
    });
    const m = buildGrowth({ ...base, daily }, opts('from=30d'));
    expect(m.unusual).toHaveLength(10);
    expect(m.unusual[0]).toMatchObject({ day: '2026-10-14', metric: 'net', value: 60, typical: 5, z: null });
  });

  it('a new small account: no follow data (net derived from the count), no split, no projection, every KPI with a reason, nothing NaN', () => {
    const daily = [row('2026-10-13', { followers: 80 }), row('2026-10-14', { followers: 82, reach: 50 }), row(TODAY, { followers: 85 })];
    const m = buildGrowth({ ...EMPTY, daily }, opts());
    expect(m.kpis.follows).toMatchObject({ value: null, reason: 'needs_100_followers' });
    expect(m.kpis.churnRate).toMatchObject({ value: null, reason: 'needs_100_followers' });
    expect(m.kpis.nonFollowerShare).toMatchObject({ value: null, reason: 'no_data' });
    expect(m.flow.source).toBe('derived');
    expect(m.days.find((d) => d.day === '2026-10-14')).toMatchObject({ net: 2, netSource: 'derived', follows: null, reachFollower: null });
    expect(m.projection).toEqual({ reason: 'not_enough_history', n: 3 });
    expect(m.followers.firstDay).toBe('2026-10-13');
    expect(m.audience).toEqual({ age: null, gender: null, country: null, city: null });
    expect(m.loyalty.formats).toEqual([]);
    expect(finite(m)).toBe(true);
  });

  it('posts land on their owner-timezone day and hour; capped counts are unknown before their first complete day', () => {
    const m = buildGrowth({ ...steady(), posts: [post('late', '2026-10-13T15:30:00Z'), post('s', '2026-10-13T15:40:00Z', { mediaType: 'STORY' })], stories: { days: { '2026-10-14': 3 }, from: '2026-10-12' } }, opts());
    const d13 = m.days.find((d) => d.day === '2026-10-13')!;
    expect(d13.posts).toEqual([{ id: 'late', mediaType: 'REELS', postedAt: '2026-10-13T15:30:00Z', hour: 23, reach: 1000, permalink: null }]);
    expect(m.days.find((d) => d.day === '2026-10-14')).toMatchObject({ posts: [], stories: 3 });
    expect(m.days.find((d) => d.day === '2026-10-12')!.stories).toBe(0);
    expect(m.days.find((d) => d.day === '2026-10-11')!.stories).toBeNull();
    expect(m.storiesFrom).toBe('2026-10-12');
    expect(m.activity['2026-10-13']).toEqual({ posts: 1, stories: 0 });
  });

  it('the non-follower share compares only with 80 % coverage on both sides', () => {
    const input = steady();
    input.breakdown = input.breakdown.filter((b) => b.day >= '2026-10-12' || b.day < '2026-10-01');
    const m = buildGrowth(input, opts());
    expect(m.kpis.nonFollowerShare).toMatchObject({ value: 0.3, prior: null, diff: null, reason: 'not_enough_history' });
  });

  it('hourly points only for ranges of 7 days or less', () => {
    const curve = [{ at: '2026-10-15T09:00', followers: 1595 }];
    expect(buildGrowth({ ...steady(), curve }, opts('from=7d')).followers.hourly).toEqual(curve);
    expect(buildGrowth({ ...steady(), curve }, opts('from=14d')).followers.hourly).toBeNull();
  });

  it('weekly buckets: follows and reach add up, followers take the last count, partial weeks are listed', () => {
    const m = buildGrowth(steady(), opts('from=90d&gran=week'));
    const full = m.flow.rows.find((r) => !m.flow.partial.includes(r.day))!;
    expect(full).toMatchObject({ follows: 56, unfollows: 21, net: 35 });
    expect(m.loyalty.rows.find((r) => r.day === full.day)).toMatchObject({ follower: 4900, nonFollower: 2100 });
    expect(m.flow.partial.length).toBeGreaterThan(0);
  });
});

describe('audienceChange', () => {
  const snap = (day: string, data: Record<string, number>) => ({ day, data });
  it('then vs now per dimension: top keys of now, shares, change in points, notable from 2 points with 100+ people on both sides', () => {
    const a = audienceChange(
      { age_gender: snap('2026-09-16', { '18-24|F': 30, '18-24|M': 20, '25-34|F': 50 }), country: snap('2026-09-16', { MY: 60, SG: 40 }), city: null },
      { age_gender: snap('2026-10-14', { '18-24|F': 40, '18-24|M': 20, '25-34|F': 40 }), country: snap('2026-10-14', { MY: 50, ID: 50 }), city: null },
    );
    expect(a.age).toMatchObject({ from: '2026-09-16', to: '2026-10-14', total: 100 });
    expect(a.age!.rows.map((r) => [r.key, r.then, r.now, r.notable])).toEqual([['18-24', 0.5, 0.6, true], ['25-34', 0.5, 0.4, true]]);
    expect(a.gender!.rows.map((r) => [r.key, r.now, r.change, r.notable])).toEqual([['F', 0.8, 0, false], ['M', 0.2, 0, false]]);
    expect(a.country!.rows.map((r) => [r.key, r.then, r.now])).toEqual([['ID', null, 0.5], ['MY', 0.6, 0.5]]); // ID was outside the top-45 list: unknown, not 0
    expect(a.city).toBeNull();
  });

  it('one snapshot (same day) has no "then"; fewer than 100 people is never notable', () => {
    const one = snap('2026-10-14', { MY: 30, SG: 20 });
    expect(audienceChange({ age_gender: null, country: one, city: null }, { age_gender: null, country: one, city: null }).country).toMatchObject({ from: null, rows: [{ key: 'MY', then: null, change: null, notable: false }, { key: 'SG', then: null }] });
    const small = audienceChange({ age_gender: null, country: snap('2026-09-16', { MY: 10, SG: 40 }), city: null }, { age_gender: null, country: snap('2026-10-14', { MY: 40, SG: 10 }), city: null });
    expect(small.country!.rows.every((r) => !r.notable)).toBe(true);
  });
});

describe('parseWhyParams / whyHref', () => {
  const range = { from: '2026-10-09', to: '2026-10-15' };
  it('a real day inside the range and why=reach are kept; anything else is ignored', () => {
    expect(parseWhyParams(new URLSearchParams('day=2026-10-12&why=reach'), range)).toEqual({ day: '2026-10-12', metric: 'reach' });
    for (const q of ['day=2026-10-30', 'day=2026-10-08', 'day=12-10-2026', 'day=2026-02-30', 'day=2026-10-12&day=2026-10-13', 'day=<script>']) expect(parseWhyParams(new URLSearchParams(q), range).day, q).toBeNull();
    expect(parseWhyParams(new URLSearchParams('why=junk'), range).metric).toBe('net');
    expect(parseWhyParams(new URLSearchParams('why=reach&why=reach'), range).metric).toBe('net');
  });

  it('keeps every other param (tab, range); net is the default and is left out', () => {
    const sp = new URLSearchParams('tab=growth&from=7d&why=reach');
    expect(whyHref(sp, '2026-10-12', 'net')).toBe('?tab=growth&from=7d&day=2026-10-12');
    expect(whyHref(sp, '2026-10-12', 'reach')).toBe('?tab=growth&from=7d&why=reach&day=2026-10-12');
  });
});
