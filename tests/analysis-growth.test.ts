import { describe, expect, it } from 'vitest';
import { combine, kpis, summarize } from '@/lib/analysis/growth';
import type { DailyRow, Post } from '@/lib/analysis/types';
import { addDays } from '@/lib/sync/time';

const KL = 'Asia/Kuala_Lumpur';
const TODAY = '2026-10-15';
const row = (day: string, o: Partial<DailyRow> = {}): DailyRow => ({ day, followers: null, reach: null, views: null, accountsEngaged: null, interactions: null, follows: null, unfollows: null, linkTaps: null, ...o });
/** n consecutive days ending yesterday (oldest first), each built by f(i). */
const days = (n: number, f: (i: number) => Partial<DailyRow>, end = addDays(TODAY, -1)) => Array.from({ length: n }, (_, i) => row(addDays(end, i - n + 1), f(i)));
const post = (id: string, postedAt: string, o: Partial<Post> = {}): Post => ({ id, accountId: 'a1', mediaType: 'IMAGE', postedAt, permalink: null, reach: null, views: null, likes: null, comments: null, shares: null, saves: null, ...o });

describe('summarize + kpis', () => {
  it('compares the period with the preceding period of equal length', () => {
    const rows = days(14, (i) => ({ reach: i < 7 ? 100 : 150, views: 10, interactions: i < 7 ? 5 : 15 }));
    const s = summarize(rows, [], 7, TODAY, KL);
    expect(s.endDay).toBe('2026-10-14');
    expect(s.current).toMatchObject({ reach: 1050, views: 70, interactions: 105, days: 7 });
    expect(s.prior).toMatchObject({ reach: 700, days: 7 });
    const k = kpis(s);
    expect(k.reach).toEqual({ value: 1050, prior: 700, diff: 350, change: 0.5, reason: null });
    expect(k.engagementRate.value).toBeCloseTo(0.1);
    expect(k.engagementRate.diff).toBeCloseTo(0.1 - 35 / 700); // percentage points, not a relative change
    expect(s.reachByDay).toHaveLength(7);
    expect(s.reachByDay[6]).toEqual({ day: '2026-10-14', value: 150 });
  });

  it("ends the window on the latest day with reach (Meta's 48 h lag), so a missing yesterday does not fake a drop", () => {
    const rows = days(14, () => ({ reach: 100 }), '2026-10-13'); // nothing for the 14th yet
    const s = summarize(rows, [], 7, TODAY, KL);
    expect(s.endDay).toBe('2026-10-13');
    expect(kpis(s).reach.change).toBe(0);
  });

  it('followers: latest snapshot (may be today) vs the snapshot one period earlier', () => {
    const rows = [row('2026-10-01', { followers: 900 }), row('2026-10-08', { followers: 950 }), row(TODAY, { followers: 1000 })];
    const k = kpis(summarize(rows, [], 7, TODAY, KL));
    expect(k.followers).toEqual({ value: 1000, prior: 950, diff: 50, change: 50 / 950, reason: null });
  });

  it('short history: values shown, comparison missing with a reason', () => {
    const k = kpis(summarize(days(5, () => ({ reach: 10, followers: 300 })), [], 7, TODAY, KL));
    expect(k.reach).toEqual({ value: 50, prior: null, diff: null, change: null, reason: 'not_enough_history' });
    expect(k.followers.reason).toBe('not_enough_history');
  });

  it('a zero base never produces NaN or Infinity', () => {
    const rows = days(14, (i) => ({ reach: i < 7 ? 0 : 20, interactions: 0, followers: 0 }));
    const k = kpis(summarize(rows, [], 7, TODAY, KL));
    expect(k.reach).toMatchObject({ value: 140, prior: 0, diff: 140, change: null });
    expect(k.engagementRate).toMatchObject({ value: 0, prior: null, reason: 'not_enough_history' });
    expect(k.followers).toMatchObject({ value: 0, change: 0 });
    for (const v of Object.values(k)) for (const n of [v.value, v.diff, v.change]) if (n !== null) expect(Number.isFinite(n)).toBe(true);
  });

  it('all-null metrics from Meta: every value null with reason no_data', () => {
    const k = kpis(summarize(days(14, () => ({})), [], 7, TODAY, KL));
    for (const id of ['followers', 'reach', 'views', 'engagementRate', 'netFollows'] as const) expect(k[id]).toMatchObject({ value: null, reason: 'no_data' });
    expect(k.posts).toMatchObject({ value: 0, change: 0 });
  });

  it('net follows need follow data; under 100 followers the reason says so', () => {
    const k = kpis(summarize(days(14, () => ({ reach: 5, followers: 42 })), [], 7, TODAY, KL));
    expect(k.netFollows).toMatchObject({ value: null, reason: 'needs_100_followers' });
    const k2 = kpis(summarize(days(14, () => ({ reach: 5, followers: 500, follows: 3, unfollows: 1 })), [], 7, TODAY, KL));
    expect(k2.netFollows).toMatchObject({ value: 14, prior: 14, change: 0 });
  });

  it('counts feed posts by owner-timezone day and ignores stories', () => {
    const rows = days(14, () => ({ reach: 1 }));
    // 17:00 UTC on the 7th is 01:00 on the 8th in Kuala Lumpur: first day of the current window
    const posts = [post('p1', '2026-10-07T17:00:00Z'), post('p2', '2026-10-07T15:00:00Z'), post('s1', '2026-10-10T00:00:00Z', { mediaType: 'STORY' })];
    const s = summarize(rows, posts, 7, TODAY, KL);
    expect(s.current.posts).toBe(1);
    expect(s.prior.posts).toBe(1);
  });

  it('unsorted rows and duplicate-free gaps are handled', () => {
    const rows = days(14, () => ({ reach: 10 })).reverse().filter((_, i) => i !== 3);
    const s = summarize(rows, [], 7, TODAY, KL);
    expect(s.current.days).toBe(6); // 6 of 7 ≥ 80%: still comparable
    expect(kpis(s).reach.change).toBeCloseTo(60 / 70 - 1);
  });

  it('90 days of data: windows of 90 with a 90-day prior', () => {
    const s = summarize(days(180, (i) => ({ reach: i })), [], 90, TODAY, KL);
    expect(s.reachByDay).toHaveLength(90);
    expect(s.current.days).toBe(90);
    expect(kpis(s).reach.change).toBeGreaterThan(0);
  });
});

describe('combine', () => {
  it('sums accounts; coverage is the least complete account', () => {
    const a = summarize(days(14, () => ({ reach: 10, followers: 100 })), [], 7, TODAY, KL);
    const b = summarize(days(9, () => ({ reach: 5, followers: 50 })), [], 7, TODAY, KL);
    const c = combine([a, b])!;
    expect(c.current).toMatchObject({ reach: 105, followers: 150, days: 7 });
    expect(c.prior.days).toBe(2);
    expect(kpis(c).reach.reason).toBe('not_enough_history');
    expect(c.reachByDay[6].value).toBe(15);
    expect(combine([])).toBeNull();
  });

  it('a newly connected account does not show up as follower growth', () => {
    const a = summarize([row('2026-10-01', { followers: 900 }), row('2026-10-08', { followers: 950 }), row(TODAY, { followers: 1000 })], [], 7, TODAY, KL);
    const b = summarize([row(TODAY, { followers: 12000 })], [], 7, TODAY, KL); // connected today: no history
    const k = kpis(combine([a, b])!);
    expect(k.followers).toMatchObject({ value: 13000, prior: null, diff: null, change: null, reason: 'not_enough_history' });
  });

  it('followers: every account with history compares normally', () => {
    const mk = (n: number) => summarize([row('2026-10-08', { followers: n }), row(TODAY, { followers: n + 50 })], [], 7, TODAY, KL);
    expect(kpis(combine([mk(100), mk(200)])!).followers).toMatchObject({ value: 400, prior: 300, diff: 100 });
  });

  it('engagement rate ignores an account with reach but no interactions', () => {
    const ok = days(14, () => ({ reach: 100, interactions: 10 }));
    const noInt = days(14, () => ({ reach: 900 }));
    const k = kpis(combine([summarize(ok, [], 7, TODAY, KL), summarize(noInt, [], 7, TODAY, KL)])!);
    expect(k.engagementRate.value).toBeCloseTo(0.1);
    expect(k.engagementRate.diff).toBeCloseTo(0);
    expect(k.reach.value).toBe(7 * 1000); // reach itself still sums every account
  });
});

describe('stale accounts', () => {
  it('a latest reach day older than the lag allows ends the window at yesterday, leaving gaps', () => {
    const rows = days(14, () => ({ reach: 100 }), '2026-10-07'); // stopped syncing a week ago
    const s = summarize(rows, [], 7, TODAY, KL);
    expect(s.endDay).toBe('2026-10-14');
    expect(s.current.days).toBe(0);
    expect(s.reachByDay.every((d) => d.value === null)).toBe(true);
    expect(kpis(s).reach.reason).toBe('no_data');
  });

  it('three days behind yesterday still counts as lag', () => {
    expect(summarize(days(14, () => ({ reach: 1 }), '2026-10-11'), [], 7, TODAY, KL).endDay).toBe('2026-10-11');
    expect(summarize(days(14, () => ({ reach: 1 }), '2026-10-10'), [], 7, TODAY, KL).endDay).toBe('2026-10-14');
  });
});
