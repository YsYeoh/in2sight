import { describe, expect, it } from 'vitest';
import { InstagramApiError } from '@/lib/instagram/oauth';
import { runAccount, type RunContext } from '@/lib/sync/run-account';
import { emptyState, type JobKind, type SyncState } from '@/lib/sync/schedule';
import { account, fakeAccounts, fakeIg, memoryStore, type MemoryInit } from './fixtures/sync-fakes';

const TZ = 'Asia/Kuala_Lumpur';
const NOW = new Date('2026-10-14T02:00:00Z'); // 10:00 local, local day 2026-10-14
const igErr = (code: number, status = 400, subcode?: number) => new InstagramApiError('data', status, code, subcode);

function ctx(o: { state?: Partial<SyncState>; media?: MemoryInit['media']; budgetCalls?: number } = {}) {
  const ig = fakeIg();
  const mem = memoryStore({ media: o.media });
  const acc = account({ id: 'a1' });
  const accts = fakeAccounts([acc]);
  let calls = 0;
  const c: RunContext = {
    ig,
    store: mem.store,
    accounts: accts.accounts,
    account: acc,
    token: 'IGQ-secret',
    state: { ...emptyState('a1'), ...o.state },
    tz: TZ,
    now: NOW,
    deadline: 1_000,
    // each clock() read costs one "tick"; budgetCalls limits how many checks pass before the deadline
    clock: () => (o.budgetCalls === undefined ? 0 : calls++ < o.budgetCalls ? 0 : 1_000),
  };
  return { c, ig, mem, accts };
}
const run = (c: RunContext, jobs: JobKind[]) => runAccount(c, jobs);

describe('daily job', () => {
  it('first connect backfills BACKFILL_DAYS of account insights up to yesterday, then snapshots followers on today', async () => {
    const { c, ig, mem } = ctx();
    const { result, patch } = await run(c, ['daily']);
    expect(result).toEqual({ accountId: 'a1', outcome: 'ok', jobs: ['daily'] });
    expect(ig.accountDay).toHaveBeenCalledTimes(90);
    expect(mem.daily[0].day).toBe('2026-07-16');
    expect(mem.daily.at(-1)!.day).toBe('2026-10-13');
    expect(mem.followers).toEqual([{ accountId: 'a1', day: '2026-10-14', followers: 1520 }]);
    expect(patch.dailyDoneThrough).toBe('2026-10-13');
    expect(patch.lastRun.daily).toBe(NOW.toISOString());
  });

  it('passes owner-timezone day boundaries as unix seconds', async () => {
    const { c, ig } = ctx({ state: { dailyDoneThrough: '2026-10-12' } });
    await run(c, ['daily']);
    // re-fetches the last 3 settled days: 11th, 12th, 13th (local); the 13th starts 2026-10-12T16:00Z in UTC+8
    expect(ig.accountDay.mock.calls.map((a) => a[1])).toEqual([Date.parse('2026-10-10T16:00:00Z') / 1000, Date.parse('2026-10-11T16:00:00Z') / 1000, Date.parse('2026-10-12T16:00:00Z') / 1000]);
    expect(ig.accountDay.mock.calls[2][2] - ig.accountDay.mock.calls[2][1]).toBe(86_400);
  });

  it('stops at the time budget, keeps progress, and the job stays due (no lastRun)', async () => {
    const { c, mem } = ctx({ budgetCalls: 11 }); // 1 check in runAccount + 10 days
    const { result, patch } = await run(c, ['daily']);
    expect(result.outcome).toBe('partial');
    expect(mem.daily).toHaveLength(10);
    expect(patch.dailyDoneThrough).toBe('2026-07-25');
    expect(patch.lastRun.daily).toBeUndefined();
    expect(patch.consecutiveFailures).toBe(0);
  });

  it('keeps backfill progress when a transient error hits half-way', async () => {
    const { c, ig } = ctx();
    let n = 0;
    ig.accountDay.mockImplementation(async () => {
      if (++n === 41) throw igErr(2, 500);
      return { reach: 1, views: 1, accountsEngaged: 1, totalInteractions: 1, linkTaps: 1, follows: null, unfollows: null };
    });
    const { result, patch } = await run(c, ['daily']);
    expect(result).toMatchObject({ outcome: 'failed', errorKey: 'instagram_unavailable' });
    expect(patch.dailyDoneThrough).toBe('2026-08-24'); // 40 days written
    expect(patch.consecutiveFailures).toBe(1);
  });

  it('skips days older than 30 days that Instagram rejects (unknown retention), but not recent ones', async () => {
    const { c, ig, mem } = ctx();
    ig.accountDay.mockImplementation(async (_t: string, since: number) => {
      if (since < Date.parse('2026-08-31T16:00:00Z') / 1000) throw igErr(100); // before 1 Sep (local midnight)
      return { reach: 1, views: 1, accountsEngaged: 1, totalInteractions: 1, linkTaps: 1, follows: null, unfollows: null };
    });
    const { result, patch } = await run(c, ['daily']);
    expect(result.outcome).toBe('ok');
    expect(mem.daily[0].day).toBe('2026-09-01');
    expect(patch.dailyDoneThrough).toBe('2026-10-13');
  });
});

describe('stories job', () => {
  const story = (id: string) => ({ id, kind: 'STORY' as const, caption: null, permalink: null, postedAt: '2026-10-14T01:00:00.000Z' });

  it('upserts live stories and snapshots each one; under-5-viewers stories are skipped, not failures', async () => {
    const { c, ig, mem } = ctx();
    ig.listStories.mockResolvedValue([story('s1'), story('s2')]);
    ig.storyInsights.mockImplementation(async (_t: string, id: string) => {
      if (id === 's2') throw igErr(10);
      return { reach: 5, views: 6, likes: null, comments: null, shares: 0, saves: null, totalInteractions: 0, replies: 0, tapsForward: 1, tapsBack: 0, exits: 1 };
    });
    const { result } = await run(c, ['stories']);
    expect(result.outcome).toBe('ok');
    expect(mem.metrics).toEqual([{ mediaId: 's1', capturedAt: NOW.toISOString() }]);
    expect(mem.media.get('s2')?.kind).toBe('STORY');
  });

  it('no live stories is fine', async () => {
    const { c, mem } = ctx();
    expect((await run(c, ['stories'])).result.outcome).toBe('ok');
    expect(mem.metrics).toEqual([]);
  });
});

describe('media jobs', () => {
  const post = (id: string, postedAt: string) => ({ id, kind: 'IMAGE' as const, caption: null, permalink: null, postedAt });

  it('first media list asks for up to 500 posts; later lists stop at 30 days', async () => {
    const first = ctx();
    await run(first.c, ['mediaList']);
    expect(first.ig.listMedia).toHaveBeenCalledWith('IGQ-secret', 500);
    const later = ctx({ state: { lastRun: { mediaList: '2026-10-14T00:00:00.000Z' } } });
    await run(later.c, ['mediaList']);
    expect(later.ig.listMedia).toHaveBeenCalledWith('IGQ-secret', 100, '2026-09-14T02:00:00.000Z');
  });

  it('backfill: every listed post gets its lifetime metrics on the first pass', async () => {
    const { c, ig, mem } = ctx();
    ig.listMedia.mockResolvedValue([post('p1', '2026-10-13T00:00:00.000Z'), post('p2', '2025-01-01T00:00:00.000Z')]);
    await run(c, ['mediaList', 'mediaMetrics']);
    expect(mem.metrics.map((m) => m.mediaId)).toEqual(['p1', 'p2']);
    expect(mem.media.get('p2')?.lastMetricsAt).toBe(NOW.toISOString());
  });

  it('deleted media are marked gone and the job carries on', async () => {
    const { c, ig, mem } = ctx({ media: [{ id: 'gone', accountId: 'a1', postedAt: '2026-10-13T00:00:00.000Z', lastMetricsAt: null }, { id: 'ok', accountId: 'a1', postedAt: '2026-10-12T00:00:00.000Z', lastMetricsAt: null }] });
    ig.feedInsights.mockImplementation(async (_t: string, id: string) => {
      if (id === 'gone') throw igErr(100, 400, 33);
      return { reach: 1, views: 1, likes: 1, comments: 1, shares: 1, saves: 1, totalInteractions: 4, replies: null, tapsForward: null, tapsBack: null, exits: null };
    });
    const { result } = await run(c, ['mediaMetrics']);
    expect(result.outcome).toBe('ok');
    expect(mem.media.get('gone')?.gone).toBe(true);
    expect(mem.metrics.map((m) => m.mediaId)).toEqual(['ok']);
  });

  const refs = (...ids: string[]) => ids.map((id, i) => ({ id, accountId: 'a1', postedAt: `2026-10-${13 - i}T00:00:00.000Z`, lastMetricsAt: null }));
  const GOOD = { reach: 1, views: 1, likes: 1, comments: 1, shares: 1, saves: 1, totalInteractions: 4, replies: null, tapsForward: null, tapsBack: null, exits: null };

  it('a post from before the Creator conversion (code 100 / 2108006) is skipped for good and later posts still get metrics', async () => {
    const { c, ig, mem } = ctx({ media: refs('old', 'p2') });
    ig.feedInsights.mockImplementation(async (_t: string, id: string) => {
      if (id === 'old') throw igErr(100, 400, 2108006);
      return GOOD;
    });
    const { result } = await run(c, ['mediaMetrics']);
    expect(result.outcome).toBe('ok');
    expect(mem.metrics.map((m) => m.mediaId)).toEqual(['p2']);
    expect(mem.media.get('old')?.lastMetricsAt).toBe(NOW.toISOString());
  });

  it('a persistent unclassified error on one post does not block the next post, is reported, and the post is marked attempted', async () => {
    const { c, ig, mem } = ctx({ media: refs('bad', 'p2') });
    ig.feedInsights.mockImplementation(async (_t: string, id: string) => {
      if (id === 'bad') throw igErr(100);
      return GOOD;
    });
    const { result } = await run(c, ['mediaMetrics']);
    expect(result).toMatchObject({ outcome: 'failed', errorKey: 'instagram_error' });
    expect(mem.metrics.map((m) => m.mediaId)).toEqual(['p2']);
    expect(mem.media.get('bad')?.lastMetricsAt).toBe(NOW.toISOString()); // no longer the head of the queue
    // next tick: only p2 is eligible later, bad is not retried at once
    const again = ctx({ media: [{ id: 'bad', accountId: 'a1', postedAt: '2026-10-13T00:00:00.000Z', lastMetricsAt: NOW.toISOString() }] });
    await run(again.c, ['mediaMetrics']);
    expect(again.ig.feedInsights).not.toHaveBeenCalled();
  });

  it('a transient error on one post is reported but the loop carries on; it stays due (not marked)', async () => {
    const { c, ig, mem } = ctx({ media: refs('flaky', 'p2') });
    ig.feedInsights.mockImplementation(async (_t: string, id: string) => {
      if (id === 'flaky') throw igErr(2, 500);
      return GOOD;
    });
    const { result } = await run(c, ['mediaMetrics']);
    expect(result).toMatchObject({ outcome: 'failed', errorKey: 'instagram_unavailable' });
    expect(mem.metrics.map((m) => m.mediaId)).toEqual(['p2']);
    expect(mem.media.get('flaky')?.lastMetricsAt).toBeNull();
  });

  it('three failures in a row abort the loop (outage or broken metric request), keeping the first error', async () => {
    const { c, ig, mem } = ctx({ media: refs('b1', 'b2', 'b3', 'b4', 'b5') });
    ig.feedInsights.mockRejectedValue(igErr(100));
    const { result } = await run(c, ['mediaMetrics']);
    expect(ig.feedInsights).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ outcome: 'failed', errorKey: 'instagram_error' });
    expect(mem.media.get('b4')?.lastMetricsAt).toBeNull();
  });

  it('an auth error mid-loop still aborts and flips the account to needs_reconnect', async () => {
    const { c, ig, accts } = ctx({ media: refs('p1', 'p2') });
    ig.feedInsights.mockRejectedValue(igErr(190, 400, 463));
    const { result } = await run(c, ['mediaMetrics']);
    expect(result).toMatchObject({ outcome: 'needs_reconnect', errorKey: 'token_invalid' });
    expect(ig.feedInsights).toHaveBeenCalledTimes(1);
    expect(accts.byId.get('a1')?.status).toBe('needs_reconnect');
  });

  it('captured media are marked even when a later post fails, so they are not re-fetched next tick', async () => {
    const { c, ig, mem } = ctx({ media: [{ id: 'p1', accountId: 'a1', postedAt: '2026-10-13T00:00:00.000Z', lastMetricsAt: null }, { id: 'p2', accountId: 'a1', postedAt: '2026-10-12T00:00:00.000Z', lastMetricsAt: null }] });
    ig.feedInsights.mockImplementation(async (_t: string, id: string) => {
      if (id === 'p2') throw igErr(80002);
      return { reach: 1, views: 1, likes: 1, comments: 1, shares: 1, saves: 1, totalInteractions: 4, replies: null, tapsForward: null, tapsBack: null, exits: null };
    });
    const { result } = await run(c, ['mediaMetrics']);
    expect(result).toMatchObject({ outcome: 'failed', errorKey: 'rate_limited' });
    expect(mem.media.get('p1')?.lastMetricsAt).toBe(NOW.toISOString());
    expect(mem.media.get('p2')?.lastMetricsAt).toBeNull();
  });
});

describe('audience job', () => {
  it('writes non-empty demographics and online followers', async () => {
    const { c, ig, mem } = ctx();
    ig.audience.mockImplementation(async (_t: string, kind: string): Promise<Record<string, number>> => (kind === 'country' ? { MY: 900 } : {}));
    ig.onlineFollowers.mockResolvedValue([{ day: '2026-10-13', hourly: Array(24).fill(1) }]);
    expect((await run(c, ['audience'])).result.outcome).toBe('ok');
    expect(mem.audience).toEqual([{ accountId: 'a1', kind: 'country' }]);
    expect(mem.online).toEqual([{ accountId: 'a1', day: '2026-10-13' }]);
  });

  it('an account under 100 followers (all empty) succeeds and writes nothing', async () => {
    const { c, mem } = ctx();
    expect((await run(c, ['audience'])).result.outcome).toBe('ok');
    expect(mem.audience).toEqual([]);
    expect(mem.online).toEqual([]);
  });
});

describe('token refresh job', () => {
  it('saves the new token and the non-secret expiry copy', async () => {
    const { c, accts } = ctx();
    await run(c, ['tokenRefresh']);
    expect(accts.tokens.a1).toEqual({ accessToken: 'IGQ-new', expiresAt: '2027-01-01T00:00:00.000Z' });
    expect(accts.byId.get('a1')?.tokenExpiresAt).toBe('2027-01-01T00:00:00.000Z');
  });
});

describe('failure handling', () => {
  it('token expired mid-run: account flips to needs_reconnect and nothing else runs', async () => {
    const { c, ig, accts } = ctx();
    ig.listStories.mockRejectedValue(igErr(190, 400, 463));
    const { result, patch } = await run(c, ['stories', 'daily', 'audience']);
    expect(result).toMatchObject({ outcome: 'needs_reconnect', errorKey: 'token_invalid', jobs: [] });
    expect(ig.accountDay).not.toHaveBeenCalled();
    expect(accts.byId.get('a1')).toMatchObject({ status: 'needs_reconnect', lastError: 'token_invalid' });
    expect(patch).toMatchObject({ consecutiveFailures: 1, lastErrorKey: 'token_invalid' });
    expect(patch.lastSuccessAt).toBeUndefined();
  });

  it('rate limit: stops the account and records rate_limited (the scheduler backs off)', async () => {
    const { c, ig } = ctx({ state: { consecutiveFailures: 2 } });
    ig.listStories.mockRejectedValue(igErr(80002));
    const { result, patch } = await run(c, ['stories', 'audience']);
    expect(result).toMatchObject({ outcome: 'failed', errorKey: 'rate_limited' });
    expect(result.appRateLimited).toBeUndefined();
    expect(ig.audience).not.toHaveBeenCalled();
    expect(patch.consecutiveFailures).toBe(3);
  });

  it('app-wide throttle (code 4) is flagged so the tick stops starting accounts', async () => {
    const { c, ig } = ctx();
    ig.listStories.mockRejectedValue(igErr(4));
    expect((await run(c, ['stories'])).result.appRateLimited).toBe(true);
  });

  it('any other error is recorded but later jobs still run (a broken metric must not starve stories)', async () => {
    const { c, ig } = ctx();
    ig.audience.mockRejectedValue(igErr(100));
    const { result, patch } = await run(c, ['audience', 'stories']);
    expect(result).toMatchObject({ outcome: 'failed', errorKey: 'instagram_error', jobs: ['stories'] });
    expect(patch.lastRun.stories).toBe(NOW.toISOString());
    expect(patch.lastRun.audience).toBeUndefined();
  });

  it('non-Instagram errors (e.g. the database) are "unexpected" and never leak details', async () => {
    const { c, mem } = ctx();
    mem.store.upsertMedia = async () => {
      throw new Error('sync store: upsertMedia failed');
    };
    const { result } = await run(c, ['stories']);
    expect(result).toEqual({ accountId: 'a1', outcome: 'failed', jobs: [], errorKey: 'unexpected' });
  });

  it('a clean run resets failures and stamps last success', async () => {
    const { c } = ctx({ state: { consecutiveFailures: 3, lastErrorKey: 'rate_limited' } });
    const { patch } = await run(c, ['stories']);
    expect(patch).toMatchObject({ consecutiveFailures: 0, lastErrorKey: null, lastSuccessAt: NOW.toISOString(), lastAttemptAt: NOW.toISOString() });
  });

  it('the result never contains the token', async () => {
    const { c, ig } = ctx();
    ig.listStories.mockRejectedValue(igErr(190));
    expect(JSON.stringify(await run(c, ['stories']))).not.toContain('IGQ-secret');
  });
});
