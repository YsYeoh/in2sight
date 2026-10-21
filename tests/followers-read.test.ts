import { beforeEach, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { MAX_SNAPSHOTS } from '@/lib/followers/payload';
import { deleteFollowerSnapshot, listFollowerSnapshots, loadFollowerSnapshot, saveFollowerSnapshot } from '@/lib/followers/read';

type Op = unknown[];
const calls: Op[] = [];
const queue: { data?: unknown; error?: unknown; count?: number | null }[] = [];

/** Owner-session fake: records every call; each awaited query (or maybeSingle) resolves to the next queued result. */
function fakeDb(): SupabaseClient {
  return {
    from(table: string) {
      calls.push(['from', table]);
      const chain: Record<string, unknown> = {};
      for (const op of ['select', 'insert', 'delete', 'eq', 'order', 'limit']) chain[op] = (...a: unknown[]) => (calls.push([op, ...a]), chain);
      const next = () => Promise.resolve(queue.shift() ?? { data: [], error: null });
      chain.maybeSingle = () => (calls.push(['maybeSingle']), next());
      chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => next().then(res, rej);
      return chain;
    },
  } as unknown as SupabaseClient;
}

const ACC = '3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b';
const SNAP = '00000000-0000-4000-8000-000000000001';
const SECRET = { code: 'XX000', message: 'row contains alice.secret' };

beforeEach(() => {
  calls.length = 0;
  queue.length = 0;
});

describe('listFollowerSnapshots', () => {
  it('the account\'s snapshots, newest first, without the arrays', async () => {
    queue.push({ data: [{ id: SNAP, taken_on: '2026-10-20', follower_count: 3, following_count: null, created_at: '2026-10-20T10:00:00Z' }], error: null });
    expect(await listFollowerSnapshots(fakeDb(), ACC)).toEqual([{ id: SNAP, takenOn: '2026-10-20', followerCount: 3, followingCount: null, createdAt: '2026-10-20T10:00:00Z' }]);
    expect(calls).toEqual([
      ['from', 'follower_exports'],
      ['select', 'id,taken_on,follower_count,following_count,created_at'],
      ['eq', 'account_id', ACC],
      ['order', 'taken_on', { ascending: false }],
      ['order', 'created_at', { ascending: false }],
      ['limit', MAX_SNAPSHOTS],
    ]);
  });

  it('table missing (migration not applied) → null; any other error → a fixed message that never echoes the database', async () => {
    for (const code of ['PGRST205', '42P01']) {
      queue.push({ data: null, error: { code } });
      expect(await listFollowerSnapshots(fakeDb(), ACC)).toBeNull();
    }
    queue.push({ data: null, error: SECRET });
    const e = await listFollowerSnapshots(fakeDb(), ACC).catch((x: Error) => x);
    expect((e as Error).message).toBe('followers list failed');
    expect(String((e as Error).message)).not.toContain('alice');
  });
});

describe('loadFollowerSnapshot', () => {
  it('reads one snapshot of THIS account and pairs names with their times (null kept)', async () => {
    queue.push({ data: { followers: ['alice', 'bob'], followers_at: [1_700_000_000, null], following: ['carol'], following_at: [1_710_000_000] }, error: null });
    expect(await loadFollowerSnapshot(fakeDb(), ACC, SNAP)).toEqual({
      followers: [{ username: 'alice', at: 1_700_000_000 }, { username: 'bob', at: null }],
      following: [{ username: 'carol', at: 1_710_000_000 }],
    });
    expect(calls).toEqual([['from', 'follower_exports'], ['select', 'followers,followers_at,following,following_at'], ['eq', 'id', SNAP], ['eq', 'account_id', ACC], ['maybeSingle']]);
  });

  it('no following.json → following null; not found → null; an error → fixed message', async () => {
    queue.push({ data: { followers: [], followers_at: [], following: null, following_at: null }, error: null });
    expect(await loadFollowerSnapshot(fakeDb(), ACC, SNAP)).toEqual({ followers: [], following: null });
    queue.push({ data: null, error: null });
    expect(await loadFollowerSnapshot(fakeDb(), ACC, SNAP)).toBeNull();
    queue.push({ data: null, error: SECRET });
    await expect(loadFollowerSnapshot(fakeDb(), ACC, SNAP)).rejects.toThrow(/^followers load failed$/);
  });
});

describe('saveFollowerSnapshot', () => {
  const upload = { takenOn: '2026-10-20', followers: [{ username: 'alice', at: 1_700_000_000 }, { username: 'bob', at: null }], following: null };

  it('counts the account\'s snapshots, then inserts parallel arrays (nothing selected back)', async () => {
    queue.push({ count: 3, error: null }, { error: null });
    expect(await saveFollowerSnapshot(fakeDb(), ACC, upload)).toBe('ok');
    expect(calls).toEqual([
      ['from', 'follower_exports'],
      ['select', 'id', { count: 'exact', head: true }],
      ['eq', 'account_id', ACC],
      ['from', 'follower_exports'],
      ['insert', { account_id: ACC, taken_on: '2026-10-20', followers: ['alice', 'bob'], followers_at: [1_700_000_000, null], following: null, following_at: null }],
    ]);
  });

  it('at the cap → tooManySnapshots without inserting; table missing → notReady; other errors → fixed messages', async () => {
    queue.push({ count: MAX_SNAPSHOTS, error: null });
    expect(await saveFollowerSnapshot(fakeDb(), ACC, upload)).toBe('tooManySnapshots');
    expect(calls.some((c) => c[0] === 'insert')).toBe(false);
    queue.push({ count: null, error: { code: 'PGRST205' } });
    expect(await saveFollowerSnapshot(fakeDb(), ACC, upload)).toBe('notReady');
    queue.push({ count: 0, error: null }, { error: SECRET });
    await expect(saveFollowerSnapshot(fakeDb(), ACC, upload)).rejects.toThrow(/^followers insert failed$/);
  });
});

describe('deleteFollowerSnapshot', () => {
  it('deletes by snapshot id AND account id; false when nothing matched', async () => {
    queue.push({ data: [{ id: SNAP }], error: null });
    expect(await deleteFollowerSnapshot(fakeDb(), ACC, SNAP)).toBe(true);
    expect(calls).toEqual([['from', 'follower_exports'], ['delete'], ['eq', 'id', SNAP], ['eq', 'account_id', ACC], ['select', 'id']]);
    queue.push({ data: [], error: null });
    expect(await deleteFollowerSnapshot(fakeDb(), ACC, SNAP)).toBe(false);
  });
});
