import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PEER_MAX } from '@/lib/analysis/post-lab';
import { loadPostLab } from '@/lib/post-lab/read';

const A = '7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e';
const TZ = 'Asia/Kuala_Lumpur';
type Result = { data?: unknown; error?: unknown };

/** Owner-session fake: records every call; each `from(table)` takes the next queued result of that table, each rpc its own. */
function fakeDb(tables: Record<string, Result[]>, rpcs: Record<string, Result> = {}) {
  const calls: unknown[][] = [];
  const chain = (result: Result) => {
    const c: Record<string, unknown> = {};
    for (const op of ['select', 'eq', 'lt', 'gte', 'in', 'order', 'limit']) c[op] = (...a: unknown[]) => (calls.push([op, ...a]), c);
    c.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej);
    return c;
  };
  const db = {
    from: (t: string) => (calls.push(['from', t]), chain(tables[t]?.shift() ?? { data: [], error: null })),
    rpc: (n: string, a: unknown) => (calls.push(['rpc', n, a]), chain(rpcs[n] ?? { data: [], error: null })),
  };
  return { db: db as unknown as SupabaseClient, calls };
}

const media = (id: string, o: Record<string, unknown> = {}) => ({ id, account_id: A, media_type: 'REELS', posted_at: '2026-10-05T15:30:00Z', expires_at: null, gone_at: null, permalink: 'https://www.instagram.com/reel/x/', caption: 'Hi', cover_status: 'ok', children_count: null, media_tags: [{ tag_id: 't1' }], ...o });

describe('loadPostLab', () => {
  it('reads the item of THIS account, its same-format predecessors, then latest values, checkpoints and follower counts', async () => {
    const { db, calls } = fakeDb(
      {
        media: [{ data: [media('42')], error: null }, { data: [media('41', { posted_at: '2026-10-01T01:00:00Z', media_tags: [] })], error: null }],
        account_daily: [{ data: [{ day: '2026-10-05', followers: 1000 }, { day: '2026-10-01', followers: null }], error: null }],
      },
      {
        post_lab_latest: { data: [{ media_id: '42', captured_at: '2026-10-07T01:00:00Z', reach: 200, views: '900', skip_rate: 41.5, profile_activity: { bio_link_clicked: 3, CALL: 1 }, total_watch_ms: 123456 }], error: null },
        post_lab_points: { data: [{ media_id: '42', mark: 60, reach: 10, views: 20 }, { media_id: '42', mark: 1440, reach: 150, views: null }, { media_id: '41', mark: 999, reach: 1, views: 1 }], error: null },
      },
    );
    const r = await loadPostLab(db, A, '42', TZ);
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(calls.slice(0, 4)).toEqual([['from', 'media'], ['select', expect.any(String)], ['eq', 'id', '42'], ['eq', 'account_id', A]]);
    expect(calls).toContainEqual(['eq', 'media_type', 'REELS']);
    expect(calls).toContainEqual(['lt', 'posted_at', '2026-10-05T15:30:00Z']);
    expect(calls).toContainEqual(['limit', PEER_MAX]);
    expect(calls).toContainEqual(['rpc', 'post_lab_latest', { p_ids: ['42', '41'] }]);
    expect(calls).toContainEqual(['rpc', 'post_lab_points', { p_ids: ['42', '41'], p_marks: [60, 360, 1440, 2880, 10080], p_tols: [30, 60, 120, 180, 720] }]);
    expect(calls).toContainEqual(['in', 'day', ['2026-10-05', '2026-10-01']]); // 15:30 UTC = 23:30 in Kuala Lumpur
    const { item, peers, day, followers } = r.input;
    expect(item).toMatchObject({ id: '42', mediaType: 'REELS', tagIds: ['t1'], cover: 'ok', slides: null, measuredAt: '2026-10-07T01:00:00Z', points: { '1h': { reach: 10, views: 20 }, '24h': { reach: 150, views: null } } });
    expect(item.latest).toMatchObject({ reach: 200, views: 900, skipRate: 0.415, linkTaps: 3, totalWatchMs: 123456, likes: null });
    expect(peers).toHaveLength(1);
    expect(peers[0]).toMatchObject({ id: '41', cover: 'ok', latest: null, measuredAt: null, points: {} }); // an unknown mark is ignored
    expect(day).toEqual([]);
    expect(followers).toEqual({ '2026-10-05': 1000 });
  });

  it('a Story also reads the Stories of its owner-timezone day', async () => {
    const story = media('9', { media_type: 'STORY', posted_at: '2026-10-05T01:00:00Z', expires_at: '2026-10-06T01:00:00Z' });
    const { db, calls } = fakeDb({ media: [{ data: [story], error: null }, { data: [], error: null }, { data: [story, media('8', { media_type: 'STORY' })], error: null }] });
    const r = await loadPostLab(db, A, '9', TZ);
    expect(calls).toContainEqual(['gte', 'posted_at', '2026-10-04T16:00:00.000Z']);
    expect(calls).toContainEqual(['lt', 'posted_at', '2026-10-05T16:00:00.000Z']);
    expect(calls).toContainEqual(['rpc', 'post_lab_latest', { p_ids: ['9', '8'] }]);
    expect(r.kind === 'ok' && r.input.day.map((d) => d.id)).toEqual(['9', '8']);
  });

  it('another account’s media (no row) is not_found; a missing function is needs_migration; other errors are fixed text', async () => {
    expect(await loadPostLab(fakeDb({ media: [{ data: [], error: null }] }).db, A, '42', TZ)).toEqual({ kind: 'not_found' });
    const missing = fakeDb({ media: [{ data: [media('42')], error: null }] }, { post_lab_points: { error: { code: 'PGRST202', message: 'Could not find the function' } } });
    expect(await loadPostLab(missing.db, A, '42', TZ)).toEqual({ kind: 'needs_migration' });
    await expect(loadPostLab(fakeDb({ media: [{ error: { message: 'secret' } }] }).db, A, '42', TZ)).rejects.toThrow('post lab read: item failed');
    const broken = fakeDb({ media: [{ data: [media('42')], error: null }] }, { post_lab_latest: { error: { code: '57014', message: 'secret' } } });
    await expect(loadPostLab(broken.db, A, '42', TZ)).rejects.toThrow('post lab read: latest failed');
  });
});
