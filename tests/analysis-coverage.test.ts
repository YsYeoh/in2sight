import { describe, expect, it } from 'vitest';
import type { StoredAccount } from '@/lib/accounts/types';
import { combine, kpis, summarize } from '@/lib/analysis/growth';
import type { DailyRow } from '@/lib/analysis/types';
import { buildOverview } from '@/lib/dashboard/overview';
import { addDays } from '@/lib/sync/time';
import { parseTimeScope, resolveScope } from '@/lib/time-scope/scope';

const KL = 'Asia/Kuala_Lumpur';
const TODAY = '2026-10-15';
const NOW = new Date('2026-10-15T04:00:00Z');
const row = (day: string, o: Partial<DailyRow> = {}): DailyRow => ({ day, followers: null, reach: null, views: null, accountsEngaged: null, interactions: null, follows: null, unfollows: null, linkTaps: null, ...o });
/** n consecutive days ending yesterday (oldest first). */
const days = (n: number, o: Partial<DailyRow> = {}) => Array.from({ length: n }, (_, i) => row(addDays(TODAY, i - n), o));
const acct = (id: string): StoredAccount => ({ id, igUserId: id, username: id, displayName: null, accountType: null, profilePictureUrl: null, groupName: null, status: 'active', archivedAt: null, lastError: null, tokenExpiresAt: '2026-12-01T00:00:00Z', connectedAt: '2026-09-01T00:00:00Z' });

describe('coverage per window', () => {
  it('reports the share of days with reach in each window', () => {
    const s = summarize(days(10, { reach: 5 }), [], 7, TODAY, KL);
    expect(s.coverage).toEqual({ current: 1, prior: 3 / 7 });
  });

  it('coverage boundary: 6 of 7 days compares, 5 of 7 says not enough history; while importing the prior window must be complete (the gap is always the old side)', () => {
    const gap = (n: number) => [...days(14, { reach: 10 })].filter((_, i) => i >= 7 - n); // prior window keeps n days, current all 7
    const six = summarize(gap(6), [], 7, TODAY, KL);
    expect(kpis(six).reach).toMatchObject({ reason: null, diff: 10 }); // 70 vs 60
    expect(kpis(six, { backfilling: true }).reach).toMatchObject({ value: 70, diff: null, change: null, reason: 'backfilling' }); // 60 is a partial base
    expect(kpis(summarize(gap(7), [], 7, TODAY, KL), { backfilling: true }).reach).toMatchObject({ reason: null, diff: 0 });
    const five = summarize(gap(5), [], 7, TODAY, KL);
    expect(kpis(five, { backfilling: true }).reach).toMatchObject({ value: 70, change: null, reason: 'backfilling' });
    expect(kpis(five).reach.reason).toBe('not_enough_history');
  });

  it('a half-finished import shows real partial numbers, never a fake drop or zero', () => {
    const s = summarize(days(10, { reach: 100, views: 200, interactions: 10, followers: 1500 }), [], 30, TODAY, KL);
    const k = kpis(s, { backfilling: true });
    expect(k.reach).toMatchObject({ value: 1_000, diff: null, change: null, reason: 'backfilling' });
    expect(k.views.value).toBe(2_000);
    expect(k.followers).toMatchObject({ value: 1500, reason: 'backfilling' }); // no follower history a period back yet
    expect(s.coverage.current).toBeCloseTo(10 / 30);
    const nothing = kpis(summarize([], [], 30, TODAY, KL), { backfilling: true });
    expect(nothing.reach).toMatchObject({ value: null, reason: 'backfilling' });
  });

  it('combine carries the weakest coverage of its accounts', () => {
    const c = combine([summarize(days(14, { reach: 1 }), [], 7, TODAY, KL), summarize(days(3, { reach: 1 }), [], 7, TODAY, KL)])!;
    expect(c.coverage.current).toBeCloseTo(3 / 7);
  });
});

describe('Overview while an account is importing', () => {
  const synced = { lastSuccessAt: '2026-10-15T03:00:00Z', lastErrorKey: null, consecutiveFailures: 0, dailyDoneThrough: '2026-10-14' };
  it('7-day KPIs appear as soon as the newest week lands; totals keep excluding the importing account', () => {
    const m = buildOverview(
      {
        accounts: [acct('old'), acct('new')],
        sync: { old: { ...synced, backfilling: false }, new: { ...synced, backfilling: true } },
        daily: { old: days(14, { reach: 100, followers: 1000, interactions: 10 }), new: days(7, { reach: 40, followers: 300, interactions: 4 }) },
        posts: {},
      },
      { scope: resolveScope(parseTimeScope({ from: '7d' }), TODAY), today: TODAY, now: NOW, tz: KL, locale: 'en', weekStart: 'mon' },
    );
    const card = m.sections.flatMap((s) => s.cards).find((c) => c.id === 'new')!;
    expect(card.state).toBe('backfilling');
    expect(card.kpis.reach).toMatchObject({ value: 280, reason: 'backfilling', change: null });
    expect(card.coverage).toBe(1);
    expect(m.totals!.reach).toMatchObject({ value: 700, reason: null }); // only the complete account, still compared
    expect(m.totals!.reach.diff).toBe(0);
  });

  it('a sync row without the flag (older data) keeps the old rule: rows or a done-through date mean not importing', () => {
    const m = buildOverview({ accounts: [acct('x')], sync: { x: synced }, daily: { x: days(14, { reach: 1 }) }, posts: {} }, { scope: resolveScope(parseTimeScope({ from: '7d' }), TODAY), today: TODAY, now: NOW, tz: KL, locale: 'en', weekStart: 'mon' });
    expect(m.sections[0].cards[0].state).toBe('ok');
  });
});
