import { describe, expect, it } from 'vitest';
import { combine, kpis, summarize } from '@/lib/analysis/growth';
import type { DailyRow, Post } from '@/lib/analysis/types';
import { addDays } from '@/lib/sync/time';

const KL = 'Asia/Kuala_Lumpur';
const TODAY = '2026-10-15';
const row = (day: string, o: Partial<DailyRow> = {}): DailyRow => ({ day, followers: null, reach: null, views: null, accountsEngaged: null, interactions: null, follows: null, unfollows: null, linkTaps: null, ...o });
/** Every day from `from` to `to` (inclusive), values from f(day). */
const span = (from: string, to: string, f: (day: string) => Partial<DailyRow>) => {
  const out: DailyRow[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(row(d, f(d)));
  return out;
};
const post = (id: string, postedAt: string): Post => ({ id, accountId: 'a1', mediaType: 'IMAGE', postedAt, permalink: null, reach: null, views: null, likes: null, comments: null, shares: null, saves: null });

describe('summarize with a window', () => {
  const rows = span('2025-09-01', '2026-10-14', (d) => ({ reach: d >= '2026-10-01' ? 20 : 10, followers: 1000 + Number(d.slice(8)), interactions: 1 }));

  it('a number is the old rolling window, compared with the previous period', () => {
    const posts = [post('p1', '2026-10-01T02:00:00Z')];
    expect(summarize(rows, posts, 30, TODAY, KL)).toEqual(summarize(rows, posts, { last: 30 }, TODAY, KL, 'prev'));
    const s = summarize(rows, posts, 30, TODAY, KL);
    expect(s).toMatchObject({ period: 30, from: '2026-09-15', endDay: '2026-10-14', compare: { from: '2026-08-16', to: '2026-09-14' } });
  });

  it('a running month is cut at the settled day and compared with the same days of the previous month', () => {
    const s = summarize(rows, [], { from: '2026-10-01', to: '2026-10-31' }, TODAY, KL);
    expect(s).toMatchObject({ period: 14, from: '2026-10-01', endDay: '2026-10-14', compare: { from: '2026-09-01', to: '2026-09-14' } });
    expect(s.current).toMatchObject({ reach: 280, days: 14 });
    expect(s.prior).toMatchObject({ reach: 140, days: 14 });
    expect(kpis(s).reach).toMatchObject({ value: 280, prior: 140, change: 1, reason: null });
    expect(s.reachByDay).toHaveLength(14);
  });

  it('a finished month: its own days; followers are read at its last day, not today', () => {
    const s = summarize(rows, [], { from: '2026-09-01', to: '2026-09-30' }, TODAY, KL);
    expect(s).toMatchObject({ period: 30, endDay: '2026-09-30', compare: { from: '2026-08-01', to: '2026-08-30' } });
    expect(s.current.followers).toBe(1030); // 30 Sep
    expect(s.prior.followers).toBe(1030); // 30 Aug: as far before as the comparison ends before the window
    expect(kpis(s).followers).toMatchObject({ value: 1030, diff: 0 });
  });

  it('same period last year: compared when that year has data, "not enough history" when it does not', () => {
    const s = summarize(rows, [], { from: '2026-09-01', to: '2026-09-30' }, TODAY, KL, 'yoy');
    expect(s.compare).toEqual({ from: '2025-09-01', to: '2025-09-30' });
    expect(kpis(s).reach).toMatchObject({ value: 300, prior: 300, change: 0 });
    const young = rows.filter((r) => r.day >= '2026-06-01');
    const k = kpis(summarize(young, [], { from: '2026-09-01', to: '2026-09-30' }, TODAY, KL, 'yoy'));
    expect(k.reach).toMatchObject({ value: 300, prior: null, change: null, reason: 'not_enough_history' });
    expect(k.followers).toMatchObject({ value: 1030, prior: null, reason: 'not_enough_history' });
  });

  it('a comparison window only partly covered compares only at ≥ 80 % of its days', () => {
    const partly = rows.filter((r) => r.day >= '2025-09-25'); // last year's September has 6 of 30 days
    expect(kpis(summarize(partly, [], { from: '2026-09-01', to: '2026-09-30' }, TODAY, KL, 'yoy')).reach.reason).toBe('not_enough_history');
    const most = rows.filter((r) => r.day >= '2025-09-07'); // 24 of 30 days = 80 %
    expect(kpis(summarize(most, [], { from: '2026-09-01', to: '2026-09-30' }, TODAY, KL, 'yoy')).reach).toMatchObject({ reason: null, value: 300, prior: 240 });
  });

  it('no comparison: values only, no delta and no reason', () => {
    const s = summarize(rows, [post('p1', '2026-10-01T02:00:00Z')], { last: 7 }, TODAY, KL, 'none');
    expect(s.compare).toBeNull();
    expect(s.coverage.prior).toBe(0);
    const k = kpis(s);
    for (const id of ['followers', 'reach', 'engagementRate', 'posts'] as const) expect(k[id]).toMatchObject({ prior: null, diff: null, change: null, reason: null });
    expect(k.reach.value).toBe(140);
    expect(k.posts.value).toBe(0); // the post is older than the 7 days
  });

  it('custom comparison days, cut to the window length', () => {
    const s = summarize(rows, [], { from: '2026-10-01', to: '2026-10-07' }, TODAY, KL, { from: '2026-01-01', to: '2026-01-31' });
    expect(s.compare).toEqual({ from: '2026-01-01', to: '2026-01-07' });
    expect(kpis(s).reach).toMatchObject({ value: 140, prior: 70, change: 1 });
  });

  it('a fixed window entirely inside the lag keeps its first day (nothing settled yet)', () => {
    const s = summarize(rows, [], { from: TODAY, to: TODAY }, TODAY, KL);
    expect(s).toMatchObject({ period: 1, from: TODAY, endDay: TODAY });
    expect(kpis(s).reach).toMatchObject({ value: null, reason: 'no_data' });
  });
});

describe('combine with fixed windows', () => {
  it('accounts settled a day apart: the longest window gives the days, positions are calendar days', () => {
    const a = summarize(span('2026-09-01', '2026-10-14', () => ({ reach: 10 })), [], { from: '2026-10-01', to: '2026-10-31' }, TODAY, KL);
    const b = summarize(span('2026-09-01', '2026-10-13', () => ({ reach: 1 })), [], { from: '2026-10-01', to: '2026-10-31' }, TODAY, KL);
    expect([a.period, b.period]).toEqual([14, 13]);
    const c = combine([b, a])!;
    expect(c).toMatchObject({ period: 14, from: '2026-10-01', endDay: '2026-10-14', compare: { from: '2026-09-01', to: '2026-09-14' } });
    expect(c.reachByDay[0]).toEqual({ day: '2026-10-01', value: 11 });
    expect(c.reachByDay[13]).toEqual({ day: '2026-10-14', value: 10 });
  });
});
