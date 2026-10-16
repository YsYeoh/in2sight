import { describe, expect, it } from 'vitest';
import { InstagramApiError } from '@/lib/instagram/oauth';
import { runAccount, type RunContext } from '@/lib/sync/run-account';
import { emptyState, type JobKind, type SyncState } from '@/lib/sync/schedule';
import { account, fakeAccounts, fakeIg, memoryStore, type MemoryInit } from './fixtures/sync-fakes';

const KL = 'Asia/Kuala_Lumpur';
const NOW = new Date('2026-10-14T02:00:00Z'); // 10:00 local, local day 2026-10-14
const DAY = { reach: 1, views: 1, accountsEngaged: 1, totalInteractions: 1, linkTaps: 1, follows: null, unfollows: null };

function ctx(o: { state?: Partial<SyncState>; media?: MemoryInit['media']; budgetCalls?: number; tz?: string; now?: Date } = {}) {
  const ig = fakeIg();
  const mem = memoryStore({ media: o.media });
  const acc = account({ id: 'a1' });
  let calls = 0;
  const c: RunContext = {
    ig,
    store: mem.store,
    accounts: fakeAccounts([acc]).accounts,
    account: acc,
    token: 'IGQ-secret',
    state: { ...emptyState('a1'), ...o.state },
    tz: o.tz ?? KL,
    now: o.now ?? NOW,
    deadline: 1_000,
    clock: () => (o.budgetCalls === undefined ? 0 : calls++ < o.budgetCalls ? 0 : 1_000),
  };
  return { c, ig, mem };
}
const run = (c: RunContext, jobs: JobKind[]) => runAccount(c, jobs);
const ONBOARDING: JobKind[] = ['daily', 'mediaList', 'mediaMetrics', 'audience', 'backfill'];

describe('newest-first progressive backfill', () => {
  it('a new account gets its 90 days newest first: the newest week, then 6 Oct back to 16 Jul', async () => {
    const { c, mem } = ctx();
    const { result, patch } = await run(c, ONBOARDING);
    expect(result.outcome).toBe('ok');
    const days = mem.daily.map((d) => d.day);
    expect(days).toHaveLength(90);
    expect(days.slice(0, 8)).toEqual(['2026-10-13', '2026-10-12', '2026-10-11', '2026-10-10', '2026-10-09', '2026-10-08', '2026-10-07', '2026-10-06']);
    expect(days.at(-1)).toBe('2026-07-16');
    expect([...days].sort().reverse()).toEqual(days); // strictly newest -> oldest
    expect(patch).toMatchObject({ dailyDoneThrough: '2026-10-13', backfilledFrom: '2026-07-16' });
    expect(patch.lastRun.backfill).toBe(NOW.toISOString());
  });

  it('resumes after a budget stop from the backward edge, never re-fetching a day', async () => {
    const first = ctx({ budgetCalls: 25 });
    const a = await run(first.c, ONBOARDING);
    expect(a.result.outcome).toBe('partial');
    const second = ctx({ state: { ...emptyState('a1'), ...a.patch } });
    const b = await run(second.c, ['backfill']); // daily finished in the first pass (lastRun.daily), so only the history job is due
    expect(b.result.outcome).toBe('ok');
    const all = [...first.mem.daily, ...second.mem.daily].map((d) => d.day);
    expect(new Set(all).size).toBe(all.length);
    expect(all).toHaveLength(90);
    expect(second.ig.accountDay.mock.calls.length).toBe(90 - first.mem.daily.length);
  });

  it('an account synced before this plan (done-through set, no backward edge) is complete: nothing is re-fetched', async () => {
    const { c, ig } = ctx({ state: { dailyDoneThrough: '2026-10-13', backfilledFrom: null } });
    const { result, patch } = await run(c, ['backfill']);
    expect(result).toMatchObject({ outcome: 'ok', jobs: ['backfill'] });
    expect(ig.accountDay).not.toHaveBeenCalled();
    expect(patch.backfilledFrom).toBeNull();
    expect(patch.lastRun.backfill).toBe(NOW.toISOString());
  });

  it('empty follows/breakdown (under 100 followers) writes nulls, never zeros', async () => {
    const { c, ig, mem } = ctx();
    const written: unknown[] = [];
    const upsert = mem.store.upsertDaily;
    mem.store.upsertDaily = async (id, day, v) => (written.push(v), upsert(id, day, v));
    ig.accountDay.mockResolvedValue({ ...DAY, follows: null, unfollows: null, linkTaps: null });
    ig.accountDayBreakdown.mockResolvedValue([]);
    await run(c, ['daily']);
    expect(written).toHaveLength(7);
    expect(written.every((v) => (v as typeof DAY).follows === null && (v as typeof DAY).linkTaps === null)).toBe(true);
    expect(mem.breakdowns.every((b) => b.rows === 0)).toBe(true); // the real store skips an empty list
  });

  it('walks across a DST change with correct local-midnight boundaries (New York, clocks back on 1 Nov 2026)', async () => {
    const { c, ig } = ctx({ tz: 'America/New_York', now: new Date('2026-11-03T15:00:00Z'), state: {} });
    await run(c, ['daily']);
    const ranges = ig.accountDay.mock.calls.slice(0, 3).map(([, since, until]) => [new Date(since * 1000).toISOString(), (until - since) / 3600]);
    expect(ranges).toEqual([
      ['2026-11-02T05:00:00.000Z', 24], // 2 Nov, EST
      ['2026-11-01T04:00:00.000Z', 25], // 1 Nov: 25-hour day
      ['2026-10-31T04:00:00.000Z', 24], // 31 Oct, EDT
    ]);
  });

  it('posts: the regular media job takes recent + the newest 10 old posts; the history job takes the rest, newest first', async () => {
    const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
    const media = [{ id: 'recent', accountId: 'a1', postedAt: daysAgo(2), lastMetricsAt: null }, ...Array.from({ length: 15 }, (_, i) => ({ id: `old${String(i).padStart(2, '0')}`, accountId: 'a1', postedAt: daysAgo(40 + i), lastMetricsAt: null }))];
    const { c, ig } = ctx({ media, state: { dailyDoneThrough: '2026-10-13', backfilledFrom: '2026-07-16' } });
    await run(c, ['mediaMetrics']);
    expect(ig.feedInsights.mock.calls.map((a) => a[1])).toEqual(['recent', ...Array.from({ length: 10 }, (_, i) => `old${String(i).padStart(2, '0')}`)]);
    ig.feedInsights.mockClear();
    const { patch } = await run(c, ['backfill']);
    expect(ig.feedInsights.mock.calls.map((a) => a[1])).toEqual(['old10', 'old11', 'old12', 'old13', 'old14']);
    expect(patch.lastRun.backfill).toBe(NOW.toISOString());
  });

  it('a rate limit during the history walk stops it with the edge kept, and it is not marked done', async () => {
    const { c, ig } = ctx({ state: { dailyDoneThrough: '2026-10-13', backfilledFrom: '2026-10-07' } });
    let n = 0;
    ig.accountDay.mockImplementation(async () => {
      if (++n === 4) throw new InstagramApiError('data', 400, 80002);
      return DAY;
    });
    const { result, patch } = await run(c, ['backfill']);
    expect(result).toMatchObject({ outcome: 'failed', errorKey: 'rate_limited' });
    expect(patch.backfilledFrom).toBe('2026-10-04');
    expect(patch.lastRun.backfill).toBeUndefined();
  });
});
