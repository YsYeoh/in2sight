import { describe, expect, it } from 'vitest';
import { backoffMs, byOldestAttempt, dueJobs, emptyState, pickDueMedia, type ScheduleInput, type SyncState } from '@/lib/sync/schedule';

const TZ = 'Asia/Kuala_Lumpur'; // UTC+8
// 2026-10-14 10:00 local
const NOW = new Date('2026-10-14T02:00:00Z');
const minsAgo = (m: number, from = NOW) => new Date(from.getTime() - m * 60_000).toISOString();
const inDays = (d: number) => new Date(NOW.getTime() + d * 86_400_000).toISOString();

// a healthy account that has been syncing for a while, everything fresh as of this morning
const fresh = (o: Partial<SyncState> = {}): SyncState => ({
  ...emptyState('a1'),
  lastAttemptAt: minsAgo(30),
  lastSuccessAt: minsAgo(30),
  dailyDoneThrough: '2026-10-13',
  lastRun: { stories: minsAgo(10), daily: minsAgo(60), mediaList: minsAgo(10), mediaMetrics: minsAgo(10), audience: minsAgo(60) },
  ...o,
});
const input = (state: SyncState, o: Partial<ScheduleInput> = {}): ScheduleInput => ({ status: 'active', tokenExpiresAt: inDays(50), state, ...o });

describe('dueJobs', () => {
  it('a brand-new active account is due for everything except token refresh (first-connect backfill)', () => {
    expect(dueJobs(input(emptyState('a1')), NOW, TZ)).toEqual(['stories', 'daily', 'mediaList', 'mediaMetrics', 'audience', 'backfill']);
  });

  it('archived and needs_reconnect accounts get nothing', () => {
    expect(dueJobs(input(emptyState('a1'), { status: 'archived' }), NOW, TZ)).toEqual([]);
    expect(dueJobs(input(emptyState('a1'), { status: 'needs_reconnect' }), NOW, TZ)).toEqual([]);
  });

  it('an account leased by another tick gets nothing; an expired lease is ignored', () => {
    expect(dueJobs(input(emptyState('a1'), {}), NOW, TZ).length).toBeGreaterThan(0);
    expect(dueJobs(input({ ...emptyState('a1'), leaseUntil: inDays(0.001) }), NOW, TZ)).toEqual([]);
    expect(dueJobs(input({ ...emptyState('a1'), leaseUntil: minsAgo(1) }), NOW, TZ).length).toBeGreaterThan(0);
  });

  it('stories are due every tick (30 min, with 5 min slack for an early scheduler)', () => {
    expect(dueJobs(input(fresh({ lastRun: { ...fresh().lastRun, stories: minsAgo(26) } })), NOW, TZ)).toContain('stories');
    expect(dueJobs(input(fresh({ lastRun: { ...fresh().lastRun, stories: minsAgo(20) } })), NOW, TZ)).not.toContain('stories');
  });

  it('media list is hourly; media metrics is always considered (pickDueMedia decides)', () => {
    expect(dueJobs(input(fresh()), NOW, TZ)).toEqual(['mediaMetrics']);
    expect(dueJobs(input(fresh({ lastRun: { ...fresh().lastRun, mediaList: minsAgo(56) } })), NOW, TZ)).toContain('mediaList');
  });

  it('daily runs once per owner-local day, only after DAILY_HOUR', () => {
    // last daily run yesterday local time
    const yesterday = fresh({ dailyDoneThrough: '2026-10-12', lastRun: { ...fresh().lastRun, daily: '2026-10-13T01:00:00Z', audience: '2026-10-13T01:00:00Z' } });
    expect(dueJobs(input(yesterday), NOW, TZ)).toEqual(expect.arrayContaining(['daily', 'audience']));
    // 05:00 local on the 14th: before DAILY_HOUR, and not behind (done through the 12th = today-2)
    const early = new Date('2026-10-13T21:00:00Z');
    expect(dueJobs(input(yesterday), early, TZ)).not.toContain('daily');
    expect(dueJobs(input(yesterday), early, TZ)).not.toContain('audience');
  });

  it('day boundaries follow the owner timezone, not UTC', () => {
    // 2026-10-14 23:30 UTC is already the 15th 07:30 in Kuala Lumpur: a new local day, after DAILY_HOUR
    const late = new Date('2026-10-14T23:30:00Z');
    const ranLocal14th = fresh({ lastRun: { ...fresh().lastRun, daily: '2026-10-14T02:00:00Z' } });
    expect(dueJobs(input(ranLocal14th), late, TZ)).toContain('daily');
    expect(dueJobs(input(ranLocal14th), late, 'UTC')).not.toContain('daily');
  });

  it('a daily job that fell behind (missed days or partial backfill) is due immediately, whatever the hour', () => {
    const early = new Date('2026-10-13T19:00:00Z'); // 03:00 local on the 14th
    expect(dueJobs(input(fresh({ dailyDoneThrough: '2026-10-10' })), early, TZ)).toContain('daily');
    expect(dueJobs(input(fresh({ dailyDoneThrough: null })), early, TZ)).toContain('daily');
  });

  it('token refresh: only within 14 days of expiry, retried at most daily', () => {
    expect(dueJobs(input(fresh(), { tokenExpiresAt: inDays(15) }), NOW, TZ)).not.toContain('tokenRefresh');
    expect(dueJobs(input(fresh(), { tokenExpiresAt: inDays(13) }), NOW, TZ)).toContain('tokenRefresh');
    expect(dueJobs(input(fresh({ lastRun: { ...fresh().lastRun, tokenRefresh: minsAgo(60) } }), { tokenExpiresAt: inDays(13) }), NOW, TZ)).not.toContain('tokenRefresh');
    expect(dueJobs(input(fresh(), { tokenExpiresAt: null }), NOW, TZ)).not.toContain('tokenRefresh');
    expect(dueJobs(input(fresh(), { tokenExpiresAt: inDays(13) }), NOW, TZ).at(-1)).toBe('tokenRefresh');
  });

  it('after a rate limit the account backs off (30, 60, 120, 240 min); other errors retry next tick', () => {
    const limited = (failures: number, mins: number) => fresh({ lastErrorKey: 'rate_limited', consecutiveFailures: failures, lastAttemptAt: minsAgo(mins), lastRun: {} });
    expect(dueJobs(input(limited(1, 20)), NOW, TZ)).toEqual([]);
    expect(dueJobs(input(limited(1, 30)), NOW, TZ).length).toBeGreaterThan(0);
    expect(dueJobs(input(limited(3, 100)), NOW, TZ)).toEqual([]);
    expect(dueJobs(input(limited(3, 120)), NOW, TZ).length).toBeGreaterThan(0);
    expect(dueJobs(input(fresh({ lastErrorKey: 'instagram_unavailable', consecutiveFailures: 5, lastAttemptAt: minsAgo(30), lastRun: {} })), NOW, TZ).length).toBeGreaterThan(0);
  });

  it('manual "sync now" ignores back-off and forces stories + media list', () => {
    const limited = fresh({ lastErrorKey: 'rate_limited', consecutiveFailures: 4, lastAttemptAt: minsAgo(1) });
    expect(dueJobs(input(limited), NOW, TZ, { manual: true })).toEqual(['stories', 'mediaList', 'mediaMetrics']);
    expect(dueJobs(input(limited, { status: 'archived' }), NOW, TZ, { manual: true })).toEqual([]);
  });
});

describe('backoffMs', () => {
  it('doubles from 30 minutes and caps at 4 hours', () => {
    expect([0, 1, 2, 3, 4, 9].map((f) => backoffMs(f) / 60_000)).toEqual([0, 30, 60, 120, 240, 240]);
  });
});

describe('byOldestAttempt', () => {
  it('never-attempted first, then oldest attempt', () => {
    const s = (id: string, at: string | null) => ({ ...emptyState(id), lastAttemptAt: at });
    const list = [s('b', '2026-10-14T01:00:00Z'), s('c', null), s('a', '2026-10-14T00:00:00Z')].sort(byOldestAttempt);
    expect(list.map((x) => x.accountId)).toEqual(['c', 'a', 'b']);
  });
});

describe('pickDueMedia', () => {
  const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
  it('never captured -> due (backfill); <48h hourly; <30d daily; older never', () => {
    const refs = [
      { id: 'never', postedAt: hoursAgo(24 * 200), lastMetricsAt: null },
      { id: 'young-due', postedAt: hoursAgo(5), lastMetricsAt: hoursAgo(1) },
      { id: 'young-fresh', postedAt: hoursAgo(5), lastMetricsAt: hoursAgo(0.5) },
      { id: 'week-due', postedAt: hoursAgo(24 * 7), lastMetricsAt: hoursAgo(24) },
      { id: 'week-fresh', postedAt: hoursAgo(24 * 7), lastMetricsAt: hoursAgo(12) },
      { id: 'old', postedAt: hoursAgo(24 * 31), lastMetricsAt: hoursAgo(24 * 5) },
    ];
    expect(pickDueMedia(refs, NOW)).toEqual(['young-due', 'week-due', 'never']);
  });
});
