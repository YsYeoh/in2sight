import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ITEM_LIMIT, loadItems, loadRollup, rollupArgs, type RollupQuery } from '@/lib/explorer/read';
import { parseExplorerState } from '@/lib/explorer/state';

const A = '7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e';
const T = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';
const Q: RollupQuery = { accounts: [A], from: '2026-10-01', to: '2026-10-31', tz: 'Asia/Kuala_Lumpur', weekStart: 'mon', grain: 'week' };

/** Owner-session fake: records rpc calls and chained modifiers; resolves to the queued result per rpc name. */
function fakeDb(results: Record<string, { data?: unknown; error?: unknown }>) {
  const calls: unknown[][] = [];
  const db = {
    rpc(name: string, args: unknown) {
      calls.push(['rpc', name, args]);
      const chain: Record<string, unknown> = {};
      for (const op of ['select', 'order', 'limit']) chain[op] = (...a: unknown[]) => (calls.push([op, ...a]), chain);
      chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(results[name] ?? { data: [], error: null }).then(res, rej);
      return chain;
    },
  };
  return { db: db as unknown as SupabaseClient, calls };
}

describe('rollupArgs: every state maps to fixed RPC arguments', () => {
  it('account totals + post numbers by account: both rollups, owner-timezone instants for posts, Stories excluded', () => {
    const a = rollupArgs(parseExplorerState({ m: 'reach,posts', by: 'account' }), Q);
    expect(a.daily).toEqual({ p_accounts: [A], p_from: '2026-10-01', p_to: '2026-10-31', p_by: 'account', p_grain: 'week', p_week_start: 'mon' });
    expect(a.posts).toEqual({
      p_accounts: [A], p_from: '2026-09-30T16:00:00.000Z', p_to: '2026-10-31T16:00:00.000Z', p_tz: 'Asia/Kuala_Lumpur', p_format: null, p_stories: false,
      p_tag: null, p_untagged: false, p_weekday: null, p_hour: null, p_by: 'account', p_grain: 'week', p_week_start: 'mon',
    });
  });

  it('groups are read per account (summed later); time uses the grain; only the needed rollup is called', () => {
    expect(rollupArgs(parseExplorerState({ m: 'reach', by: 'group' }), Q)).toMatchObject({ daily: { p_by: 'account' }, posts: null });
    expect(rollupArgs(parseExplorerState({ m: 'reach', by: 'time' }), Q)).toMatchObject({ daily: { p_by: 'time', p_grain: 'week' }, posts: null });
    expect(rollupArgs(parseExplorerState({ m: 'likes', by: 'time' }), Q)).toMatchObject({ daily: null, posts: { p_by: 'time' } });
  });

  it('filters become typed arguments; Stories only when chosen or grouped by format; untagged is a flag', () => {
    expect(rollupArgs(parseExplorerState({ m: 'posts', by: 'hour', fmt: 'STORY', tag: T, wd: '2' }), Q).posts).toMatchObject({ p_format: 'STORY', p_stories: true, p_tag: T, p_untagged: false, p_weekday: 2, p_hour: null, p_by: 'hour' });
    expect(rollupArgs(parseExplorerState({ m: 'posts', by: 'format', tag: 'untagged' }), Q).posts).toMatchObject({ p_format: null, p_stories: true, p_tag: null, p_untagged: true });
  });

  it('single posts read no rollup at all', () => {
    expect(rollupArgs(parseExplorerState({ by: 'post' }), Q)).toMatchObject({ daily: null, posts: null });
  });
});

describe('loadRollup', () => {
  it('merges both rollups by key into additive parts (nulls stay null, counts default to 0)', async () => {
    const { db, calls } = fakeDb({
      explorer_daily: { data: [{ key: A, reach: 100, views: 200, interactions: 10, er_interactions: 9, er_reach: 90, net_follows: null, followers: 1500 }], error: null },
      explorer_posts: { data: [{ key: A, posts: 3, measured: 2, reach_sum: 400, views_sum: null, views_n: 0, likes: 7, comments: null, saves: 1, shares: 0, er_interactions: 8, er_reach: 400 }], error: null },
    });
    const out = await loadRollup(db, parseExplorerState({ m: 'reach,posts', by: 'account' }), Q);
    expect(calls.map((c) => c[1])).toEqual(['explorer_daily', 'explorer_posts']);
    expect(out.get(A)).toEqual({
      daily: { reach: 100, views: 200, interactions: 10, erInteractions: 9, erReach: 90, netFollows: null, followers: 1500 },
      posts: { posts: 3, measured: 2, reachSum: 400, viewsSum: null, viewsN: 0, likes: 7, comments: null, saves: 1, shares: 0, erInteractions: 8, erReach: 400 },
    });
  });

  it('no accounts in scope: no query at all', async () => {
    const { db, calls } = fakeDb({});
    expect((await loadRollup(db, parseExplorerState({}), { ...Q, accounts: [] })).size).toBe(0);
    expect(calls).toEqual([]);
  });

  it('a failed rollup throws a fixed message (never the database text)', async () => {
    const { db } = fakeDb({ explorer_posts: { data: null, error: { message: 'secret detail' } } });
    await expect(loadRollup(db, parseExplorerState({ m: 'posts' }), Q)).rejects.toThrow('explorer read: posts failed');
  });
});

describe('loadItems', () => {
  it('reads the newest ITEM_LIMIT + 1 through explorer_media and reports the cut; keeps https permalinks only', async () => {
    const rows = Array.from({ length: ITEM_LIMIT + 1 }, (_, i) => ({ id: `m${i}`, account_id: A, media_type: 'REELS', posted_at: '2026-10-05T01:00:00Z', permalink: i === 0 ? 'javascript:alert(1)' : 'https://www.instagram.com/p/x/', caption: 'c', reach: 1, views: null, likes: 0, comments: 0, saves: 0, shares: 0 }));
    const { db, calls } = fakeDb({ explorer_media: { data: rows, error: null } });
    const r = await loadItems(db, parseExplorerState({ by: 'post', fmt: 'REELS' }), Q);
    expect(calls[0]).toEqual(['rpc', 'explorer_media', expect.objectContaining({ p_format: 'REELS', p_stories: false })]);
    expect(calls).toContainEqual(['order', 'posted_at', { ascending: false }]);
    expect(calls).toContainEqual(['limit', ITEM_LIMIT + 1]);
    expect(r.truncated).toBe(true);
    expect(r.items).toHaveLength(ITEM_LIMIT);
    expect(r.items[0].permalink).toBeNull();
    expect(r.items[1].permalink).toBe('https://www.instagram.com/p/x/');
  });
});
