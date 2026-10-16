import { describe, expect, it } from 'vitest';
import { dueJobs, emptyState, firstWeekPending, isBackfilling, pickDueMedia, type ScheduleInput, type SyncState } from '@/lib/sync/schedule';

const TZ = 'Asia/Kuala_Lumpur'; // UTC+8
const NOW = new Date('2026-10-14T02:00:00Z'); // 10:00 local, local day 2026-10-14
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();
const input = (state: SyncState, o: Partial<ScheduleInput> = {}): ScheduleInput => ({ status: 'active', tokenExpiresAt: '2026-12-01T00:00:00Z', state, ...o });
const st = (o: Partial<SyncState> = {}): SyncState => ({ ...emptyState('a1'), ...o });

describe('isBackfilling / firstWeekPending', () => {
  it('a new account is backfilling and its first week is pending', () => {
    expect(isBackfilling(st())).toBe(true);
    expect(firstWeekPending(st(), '2026-10-14')).toBe(true);
  });

  it('half-way through the newest week: still pending; the week is complete once 7 days back is reached', () => {
    expect(firstWeekPending(st({ dailyDoneThrough: '2026-10-13', backfilledFrom: '2026-10-10' }), '2026-10-14')).toBe(true);
    expect(firstWeekPending(st({ dailyDoneThrough: '2026-10-13', backfilledFrom: '2026-10-07' }), '2026-10-14')).toBe(false);
  });

  it('a row synced before this plan (done-through set, backfilled_from empty) is complete: never re-fetched', () => {
    const legacy = st({ dailyDoneThrough: '2026-10-13', backfilledFrom: null });
    expect(isBackfilling(legacy)).toBe(false);
    expect(firstWeekPending(legacy, '2026-10-14')).toBe(false);
  });

  it('the import is done once the backfill job has finished once', () => {
    expect(isBackfilling(st({ dailyDoneThrough: '2026-10-13', backfilledFrom: '2026-07-16', lastRun: { backfill: minsAgo(5) } }))).toBe(false);
  });
});

describe('dueJobs lanes', () => {
  it('lane 1 gives a brand-new account only its time-critical jobs; lane 2 runs the onboarding in order', () => {
    expect(dueJobs(input(st()), NOW, TZ, { lane: 'regular' })).toEqual(['stories']);
    expect(dueJobs(input(st()), NOW, TZ)).toEqual(['stories', 'daily', 'mediaList', 'mediaMetrics', 'audience', 'backfill']);
  });

  it('once the newest week is in, lane 1 runs the regular jobs and never the history import', () => {
    const importing = st({ dailyDoneThrough: '2026-10-13', backfilledFrom: '2026-09-20', lastAttemptAt: minsAgo(30), lastRun: { stories: minsAgo(40), daily: minsAgo(60), mediaList: minsAgo(70), audience: minsAgo(60) } });
    expect(dueJobs(input(importing), NOW, TZ, { lane: 'regular' })).toEqual(['stories', 'mediaList', 'mediaMetrics']);
    expect(dueJobs(input(importing), NOW, TZ)).toEqual(['stories', 'mediaList', 'mediaMetrics', 'backfill']);
  });

  it('a first week stopped half-way keeps daily due at any hour (03:00 local), in lane 2 only', () => {
    const early = new Date('2026-10-13T19:00:00Z');
    const half = st({ dailyDoneThrough: '2026-10-13', backfilledFrom: '2026-10-11', lastRun: { stories: minsAgo(500) } });
    expect(dueJobs(input(half), early, TZ)).toContain('daily');
    expect(dueJobs(input(half), early, TZ, { lane: 'regular' })).not.toContain('daily');
  });

  it('token refresh stays in lane 1 even for a new account; a rate-limited account gets nothing in either lane', () => {
    expect(dueJobs(input(st(), { tokenExpiresAt: '2026-10-20T00:00:00Z' }), NOW, TZ, { lane: 'regular' })).toEqual(['stories', 'tokenRefresh']);
    const limited = st({ lastErrorKey: 'rate_limited', consecutiveFailures: 1, lastAttemptAt: minsAgo(5) });
    expect(dueJobs(input(limited), NOW, TZ, { lane: 'regular' })).toEqual([]);
    expect(dueJobs(input(limited), NOW, TZ)).toEqual([]);
  });

  it('a legacy (pre-Plan-11a) complete account never gets the backfill job', () => {
    const legacy = st({ dailyDoneThrough: '2026-10-13', lastRun: { stories: minsAgo(10), daily: minsAgo(60), mediaList: minsAgo(10), audience: minsAgo(60) } });
    expect(dueJobs(input(legacy), NOW, TZ)).toEqual(['mediaMetrics']);
  });
});

describe('pickDueMedia old-post cap', () => {
  const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
  it('takes every recent post but only the newest N never-measured posts older than 30 days', () => {
    const refs = [
      { id: 'recent', postedAt: daysAgo(3), lastMetricsAt: null },
      ...Array.from({ length: 5 }, (_, i) => ({ id: `old${i}`, postedAt: daysAgo(40 + i), lastMetricsAt: null })),
    ];
    expect(pickDueMedia(refs, NOW, 2)).toEqual(['recent', 'old0', 'old1']);
    expect(pickDueMedia(refs, NOW, Infinity)).toHaveLength(6);
    expect(pickDueMedia(refs, NOW)).toHaveLength(6); // default cap (10) is above 5
  });
});
