import { describe, expect, it } from 'vitest';
import { loadDaily, loadOverviewInput, loadPosts, MEDIA_LIMIT, rowToPost } from '@/lib/dashboard/read';

type Call = { table: string; select: string; ops: unknown[][] };

/** Fake Supabase client: every chained call is recorded; an awaited query resolves to the next result queued for its table. */
function fakeDb(results: Record<string, { data?: unknown; error?: unknown }[]>) {
  const calls: Call[] = [];
  const db = {
    from(table: string) {
      const call: Call = { table, select: '', ops: [] };
      calls.push(call);
      const chain: Record<string, unknown> = {};
      chain.select = (s: string) => ((call.select = s), chain);
      for (const op of ['eq', 'neq', 'gte', 'in', 'order', 'limit']) chain[op] = (...a: unknown[]) => (call.ops.push([op, ...a]), chain);
      chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(results[table]?.shift() ?? { data: [], error: null }).then(res, rej);
      return chain;
    },
  };
  return { db: db as never, calls };
}

const mediaRow = (id: string, metrics: unknown[] = [{ reach: 120, likes: 9, total_interactions: 11, captured_at: '2026-10-14T00:00:00Z' }]) => ({ id, account_id: 'a1', media_type: 'REELS', posted_at: '2026-10-10T10:00:00+00:00', permalink: 'https://www.instagram.com/reel/x/', media_metrics: metrics });

describe('loadDaily', () => {
  it('reads one account from a day on, oldest first, capped, and maps columns', async () => {
    const f = fakeDb({ account_daily: [{ data: [{ day: '2026-10-13', followers: 120, reach: 50, views: 80, accounts_engaged: 4, total_interactions: 7, follows: null, unfollows: null, link_taps: 1 }] }] });
    expect(await loadDaily(f.db, 'a1', '2026-07-17')).toEqual([{ day: '2026-10-13', followers: 120, reach: 50, views: 80, accountsEngaged: 4, interactions: 7, follows: null, unfollows: null, linkTaps: 1 }]);
    expect(f.calls[0].ops).toEqual([['eq', 'account_id', 'a1'], ['gte', 'day', '2026-07-17'], ['order', 'day', { ascending: true }], ['limit', 200]]);
  });
  it('throws a fixed message that never echoes the database error', async () => {
    const f = fakeDb({ account_daily: [{ error: { message: 'secret detail' } }] });
    await expect(loadDaily(f.db, 'a1', '2026-07-17')).rejects.toThrow(/^dashboard read: daily failed$/);
  });
});

describe('loadPosts', () => {
  it('newest 500 feed posts with only the latest metrics snapshot each', async () => {
    const f = fakeDb({ media: [{ data: [mediaRow('m1'), mediaRow('m2', [])] }] });
    const posts = await loadPosts(f.db, 'a1', 10_000);
    expect(posts[0]).toMatchObject({ id: 'm1', accountId: 'a1', mediaType: 'REELS', reach: 120, likes: 9, comments: null });
    expect(posts[1]).toMatchObject({ id: 'm2', reach: null });
    expect(f.calls[0].select).toContain('media_metrics(');
    expect(f.calls[0].ops).toEqual([
      ['eq', 'account_id', 'a1'],
      ['neq', 'media_type', 'STORY'],
      ['order', 'posted_at', { ascending: false }],
      ['order', 'captured_at', { ascending: false, referencedTable: 'media_metrics' }],
      ['limit', MEDIA_LIMIT],
      ['limit', 1, { referencedTable: 'media_metrics' }],
    ]);
  });
  it('drops rows with an unknown media type and tolerates non-numeric metrics', () => {
    expect(rowToPost({ ...mediaRow('x'), media_type: 'VIDEO' })).toBeNull();
    expect(rowToPost(mediaRow('y', [{ reach: 'NaN', likes: Infinity }]))).toMatchObject({ reach: null, likes: null });
    expect(rowToPost({ ...mediaRow('z'), media_metrics: null })).toMatchObject({ reach: null });
  });
});

describe('loadOverviewInput', () => {
  it('hides archived accounts and loads daily + posts for each remaining account', async () => {
    const acc = (id: string, status: string) => ({ id, ig_user_id: id, username: id, status, connected_at: '2026-10-01T00:00:00Z' });
    const f = fakeDb({
      accounts: [{ data: [acc('a1', 'active'), acc('a2', 'archived'), acc('a3', 'needs_reconnect')] }],
      sync_state: [{ data: [{ account_id: 'a1', last_success_at: null, last_error_key: null, consecutive_failures: 0, daily_done_through: null }] }],
    });
    const out = await loadOverviewInput(f.db, '2026-07-17');
    expect(out.accounts.map((a) => a.id)).toEqual(['a1', 'a3']);
    expect(Object.keys(out.daily)).toEqual(['a1', 'a3']);
    expect(Object.keys(out.posts)).toEqual(['a1', 'a3']);
    expect(out.sync.a1.dailyDoneThrough).toBeNull();
    expect(f.calls.filter((c) => c.table === 'account_daily')).toHaveLength(2);
    expect(f.calls.some((c) => c.table === 'account_tokens')).toBe(false);
  });
});
