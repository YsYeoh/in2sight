import { describe, expect, it } from 'vitest';
import { buildProgress, coveredDays, isTracked, type LiveProgress, type ProgressInput } from '@/lib/sync/progress';
import { emptyState } from '@/lib/sync/schedule';

const NOW = new Date('2026-10-14T02:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const MIN = 60_000;
const live = (o: Partial<LiveProgress> = {}): LiveProgress => ({ stage: null, state: 'waiting', done: 0, total: null, detailDay: null, errorKey: null, startedAt: ago(MIN), updatedAt: ago(1_000), finishedAt: null, ...o });
const input = (o: Partial<ProgressInput> = {}, state: Partial<ProgressInput['state']> = {}): ProgressInput => ({
  accountId: 'a1',
  needsReconnect: false,
  state: { ...emptyState('a1'), ...state },
  live: null,
  posts: { total: 0, measured: 0 },
  followers: null,
  ...o,
});
const stage = (p: ReturnType<typeof buildProgress>, s: string) => p.stages.find((x) => x.stage === s)!;

describe('coveredDays', () => {
  it('counts handled days between the two edges, 0 before anything, 90 for a pre-Plan-11a row', () => {
    expect(coveredDays({ dailyDoneThrough: null, backfilledFrom: null })).toBe(0);
    expect(coveredDays({ dailyDoneThrough: '2026-10-13', backfilledFrom: '2026-10-07' })).toBe(7);
    expect(coveredDays({ dailyDoneThrough: '2026-10-13', backfilledFrom: '2026-05-01' })).toBe(90);
    expect(coveredDays({ dailyDoneThrough: '2026-10-13', backfilledFrom: null })).toBe(90);
  });
});

describe('buildProgress', () => {
  it('right after connect: waiting, 0 %, every stage pending, no estimate yet', () => {
    const p = buildProgress(input({ live: live() }), NOW);
    expect(p.phase).toBe('waiting');
    expect(p.percent).toBe(0);
    expect(p.stages.map((s) => s.state)).toEqual(Array(6).fill('pending'));
    expect(p.etaMs).toBeNull();
    expect(p.elapsedMs).toBe(MIN);
  });

  it('while importing days: running, the live day count beats the saved edge, current activity names the day', () => {
    const p = buildProgress(
      input({ followers: 1520, live: live({ stage: 'account_days', state: 'running', done: 30, total: 90, detailDay: '2026-09-14' }) }, { lastRun: { stories: ago(MIN) }, dailyDoneThrough: '2026-10-13', backfilledFrom: '2026-10-07' }),
      NOW,
    );
    expect(p.phase).toBe('running');
    expect(stage(p, 'account_days')).toEqual({ stage: 'account_days', state: 'running', done: 30, total: 90, reason: null });
    expect(p.current).toEqual({ stage: 'account_days', day: '2026-09-14', done: 30, total: 90 });
    expect(p.percent).toBe(21); // (2 + 3 + 50 x 30/90) of 100
  });

  it('half-finished history with posts listed: honest estimate from the remaining days and posts', () => {
    const p = buildProgress(input({ posts: { total: 40, measured: 10 }, live: live({ stage: 'account_days', state: 'running', done: 60, total: 90 }) }, { lastRun: { stories: ago(MIN), mediaList: ago(MIN) }, dailyDoneThrough: '2026-10-13', backfilledFrom: '2026-08-15' }), NOW);
    expect(p.etaMs).toBe(30 * 1_500 + 30 * 400);
    expect(stage(p, 'post_metrics')).toMatchObject({ state: 'pending', done: 10, total: 40 });
  });

  it('a lease that expired with no fresh write is not "running forever": waiting, then stalled after 35 min', () => {
    const run = (mins: number) => buildProgress(input({ live: live({ stage: 'account_days', state: 'running', updatedAt: ago(mins * MIN) }) }, { lastAttemptAt: ago(mins * MIN), leaseUntil: ago(1_000), dailyDoneThrough: '2026-10-13', backfilledFrom: '2026-10-01' }), NOW);
    expect(run(2).phase).toBe('waiting');
    expect(run(2).current).toBeNull();
    expect(run(40).phase).toBe('stalled');
  });

  it('a held lease counts as running even between writes', () => {
    expect(buildProgress(input({ live: live({ state: 'waiting', updatedAt: ago(5 * MIN) }) }, { leaseUntil: new Date(NOW.getTime() + MIN).toISOString() }), NOW).phase).toBe('running');
  });

  it('rate limited: says when the back-off ends (2 failures = 60 min after the last attempt)', () => {
    const p = buildProgress(input({ live: live() }, { lastErrorKey: 'rate_limited', consecutiveFailures: 2, lastAttemptAt: ago(10 * MIN) }), NOW);
    expect(p.phase).toBe('rate_limited');
    expect(p.resumeInMs).toBe(50 * MIN);
    expect(p.errorKey).toBe('rate_limited');
  });

  it('failed: the stage that was running carries the error key', () => {
    const p = buildProgress(input({ posts: { total: 5, measured: 1 }, live: live({ stage: 'post_metrics', state: 'failed' }) }, { lastErrorKey: 'instagram_error', consecutiveFailures: 1, lastRun: { mediaList: ago(MIN) } }), NOW);
    expect(p.phase).toBe('failed');
    expect(stage(p, 'post_metrics')).toMatchObject({ state: 'failed', reason: 'instagram_error' });
  });

  it('needs reconnect beats everything', () => {
    const p = buildProgress(input({ needsReconnect: true, live: live({ stage: 'stories' }) }), NOW);
    expect(p).toMatchObject({ phase: 'needs_reconnect', errorKey: 'token_invalid' });
    expect(stage(p, 'stories').state).toBe('failed');
  });

  it('skips with a reason: no posts at all, audience under 100 followers', () => {
    const p = buildProgress(input({ followers: 42, live: live() }, { lastRun: { mediaList: ago(MIN), audience: ago(MIN) }, dailyDoneThrough: '2026-10-13', backfilledFrom: '2026-10-07' }), NOW);
    expect(stage(p, 'post_metrics')).toMatchObject({ state: 'skipped', reason: 'no_posts' });
    expect(stage(p, 'audience')).toMatchObject({ state: 'skipped', reason: 'needs_100_followers' });
  });

  it('never shows 100 % before the import is really finished; finished = 100 % with a summary', () => {
    const almost = buildProgress(input({ followers: 500, posts: { total: 3, measured: 3 }, live: live({ state: 'waiting' }) }, { lastRun: { stories: ago(MIN), mediaList: ago(MIN), audience: ago(MIN) }, dailyDoneThrough: '2026-10-13', backfilledFrom: '2026-07-16' }), NOW);
    expect(almost.percent).toBe(99);
    const finished = buildProgress(input({ posts: { total: 3, measured: 3 }, live: live({ state: 'done', finishedAt: ago(MIN) }) }, { lastRun: { backfill: ago(MIN), mediaList: ago(MIN) }, dailyDoneThrough: '2026-10-13', backfilledFrom: '2026-07-16' }), NOW);
    expect(finished).toMatchObject({ phase: 'done', percent: 100, etaMs: null, summary: { days: 90, posts: 3 } });
  });
});

describe('isTracked', () => {
  const doneState = { ...emptyState('a1'), lastRun: { backfill: ago(MIN) }, dailyDoneThrough: '2026-10-13', backfilledFrom: '2026-07-16' };
  it('importing accounts and unfinished runs are shown; a finished run for 10 minutes; a quiet complete account never', () => {
    expect(isTracked({ state: emptyState('a1'), live: null }, NOW)).toBe(true);
    expect(isTracked({ state: doneState, live: live() }, NOW)).toBe(true);
    expect(isTracked({ state: doneState, live: live({ state: 'done', finishedAt: ago(9 * MIN) }) }, NOW)).toBe(true);
    expect(isTracked({ state: doneState, live: live({ state: 'done', finishedAt: ago(11 * MIN) }) }, NOW)).toBe(false);
    expect(isTracked({ state: { ...emptyState('a1'), dailyDoneThrough: '2026-10-13' }, live: null }, NOW)).toBe(false);
  });

  it('a "Sync now" that found the account leased ends when that other tick succeeds (not "waiting" forever)', () => {
    const session = live({ state: 'waiting', startedAt: ago(20 * MIN), updatedAt: ago(20 * MIN) });
    const after = { ...doneState, lastSuccessAt: ago(15 * MIN) };
    expect(buildProgress(input({ live: session }, after), NOW).phase).toBe('done');
    expect(isTracked({ state: after, live: session }, NOW)).toBe(false); // ended 15 min ago
    expect(buildProgress(input({ live: session }, { ...doneState, lastSuccessAt: ago(30 * MIN) }), NOW).phase).toBe('waiting');
  });
});
