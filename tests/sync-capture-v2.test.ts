import { describe, expect, it } from 'vitest';
import { igData } from '@/lib/instagram/data';
import { InstagramApiError } from '@/lib/instagram/oauth';
import { runAccount, type RunContext } from '@/lib/sync/run-account';
import { emptyState, type JobKind } from '@/lib/sync/schedule';
import { account, fakeAccounts, fakeIg, memoryStore } from './fixtures/sync-fakes';

const NOW = new Date('2026-10-14T02:00:00Z');
const igErr = (code: number, status = 400) => new InstagramApiError('data', status, code);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function ctx(state: Partial<ReturnType<typeof emptyState>> = {}) {
  const ig = fakeIg();
  const mem = memoryStore();
  const acc = account({ id: 'a1' });
  const c: RunContext = { ig, store: mem.store, accounts: fakeAccounts([acc]).accounts, account: acc, token: 'IGQ-secret', state: { ...emptyState('a1'), ...state }, tz: 'Asia/Kuala_Lumpur', now: NOW, deadline: 1_000, clock: () => 0 };
  return { c, ig, mem };
}
const run = (c: RunContext, jobs: JobKind[]) => runAccount(c, jobs);

describe('follower snapshot on every Stories pass', () => {
  it('writes one snapshot with followers, following and media count', async () => {
    const { c, mem } = ctx();
    await run(c, ['stories']);
    expect(mem.snapshots).toEqual([{ accountId: 'a1', capturedAt: NOW.toISOString(), followers: 1520 }]);
  });

  it('a non-fatal failure of the extra call never costs the Stories capture', async () => {
    const { c, ig, mem } = ctx();
    ig.profile.mockRejectedValue(igErr(100));
    const { result } = await run(c, ['stories']);
    expect(result.outcome).toBe('ok');
    expect(ig.listStories).toHaveBeenCalled();
    expect(mem.snapshots).toHaveLength(0);
  });

  it('an expired token still stops the job (needs reconnect)', async () => {
    const { c, ig } = ctx();
    ig.profile.mockRejectedValue(igErr(190, 401));
    const { result } = await run(c, ['stories']);
    expect(result.outcome).toBe('needs_reconnect');
  });
});

describe('daily follower/non-follower x format breakdown', () => {
  it('stores the split for every backfilled day', async () => {
    const { c, ig, mem } = ctx();
    ig.accountDayBreakdown.mockResolvedValue([
      { metric: 'reach', followType: 'FOLLOWER', productType: 'STORY', value: 350 },
      { metric: 'reach', followType: 'NON_FOLLOWER', productType: 'STORY', value: 4 },
    ]);
    await run(c, ['daily']);
    expect(ig.accountDayBreakdown).toHaveBeenCalledTimes(90);
    expect(mem.breakdowns).toHaveLength(90);
    expect(mem.breakdowns[0]).toEqual({ accountId: 'a1', day: '2026-07-16', rows: 2 });
  });

  it('an unsupported day does not wedge the backfill', async () => {
    const { c, ig } = ctx();
    ig.accountDayBreakdown.mockRejectedValue(igErr(100));
    const { result, patch } = await run(c, ['daily']);
    expect(result.outcome).toBe('ok');
    expect(patch.dailyDoneThrough).toBe('2026-10-13');
  });

  it('a Meta rate limit stops the backfill instead of being swallowed', async () => {
    const { c, ig } = ctx();
    ig.accountDayBreakdown.mockRejectedValue(igErr(80002, 400));
    const { result } = await run(c, ['daily']);
    expect(result.outcome).not.toBe('ok');
  });
});

describe('data client', () => {
  it('accountDayBreakdown asks reach and views with both breakdowns and flattens the pairs', async () => {
    const seen: URL[] = [];
    const fn = (async (input: string | URL) => {
      const u = new URL(String(input));
      seen.push(u);
      const m = u.searchParams.get('metric');
      return json({ data: [{ name: m, total_value: { value: 1, breakdowns: [{ dimension_keys: ['follow_type', 'media_product_type'], results: [{ dimension_values: ['FOLLOWER', 'STORY'], value: m === 'reach' ? 350 : 965 }, { dimension_values: ['NON_FOLLOWER', 'REEL'], value: 6 }] }] } }] });
    }) as typeof fetch;
    const rows = await igData('v25.0', fn).accountDayBreakdown('IGQ-secret', 100, 200);
    expect(seen.map((u) => u.searchParams.get('metric'))).toEqual(['reach', 'views']);
    expect(seen.every((u) => u.searchParams.get('breakdown') === 'follow_type,media_product_type' && u.searchParams.get('metric_type') === 'total_value')).toBe(true);
    expect(rows).toContainEqual({ metric: 'reach', followType: 'FOLLOWER', productType: 'STORY', value: 350 });
    expect(rows).toContainEqual({ metric: 'views', followType: 'FOLLOWER', productType: 'STORY', value: 965 });
    expect(rows).toHaveLength(4);
  });

  it('returns nothing (not zeros) when Instagram sends no breakdown', async () => {
    const fn = (async () => json({ data: [] })) as typeof fetch;
    expect(await igData('v25.0', fn).accountDayBreakdown('IGQ-secret', 1, 2)).toEqual([]);
  });
});
