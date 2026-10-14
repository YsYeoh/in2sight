import { beforeEach, describe, expect, it, vi } from 'vitest';

type Op = unknown[];
const { calls, requireOwner, queue } = vi.hoisted(() => ({
  calls: [] as Op[],
  requireOwner: vi.fn(),
  queue: [] as { data?: unknown; error?: unknown }[],
}));

/** Owner-session fake: records every call; each awaited query resolves to the next queued result. */
function fakeDb() {
  return {
    from(table: string) {
      calls.push(['from', table]);
      const chain: Record<string, unknown> = {};
      for (const op of ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'not', 'limit']) chain[op] = (...a: unknown[]) => (calls.push([op, ...a]), chain);
      chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(queue.shift() ?? { data: [], error: null }).then(res, rej);
      return chain;
    },
  };
}

vi.mock('@/lib/auth/require-owner', () => ({ requireOwner: () => requireOwner() }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: async () => (calls.push(['session']), fakeDb()) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabase: () => calls.push(['ADMIN']) }));
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => calls.push(['revalidate', ...a]) }));

import { TAG_LIMIT } from '@/lib/dashboard/detail-read';
import { createTagAction,deleteTagAction, renameTagAction, setPostTagsAction } from '@/app/(app)/tags/actions';

const T1 = '7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e';
const T2 = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';
const has = (op: string, ...args: unknown[]) => calls.some((c) => c[0] === op && args.every((a, i) => JSON.stringify(c[i + 1]) === JSON.stringify(a)));

beforeEach(() => {
  calls.length = 0;
  queue.length = 0;
  requireOwner.mockReset().mockImplementation(async () => void calls.push(['requireOwner']));
});

describe('tag actions: authorization and boundary validation', () => {
  it.each([
    ['create', () => createTagAction('Promo')],
    ['rename', () => renameTagAction(T1, 'Promo')],
    ['delete', () => deleteTagAction(T1)],
    ['setPostTags', () => setPostTagsAction('17895695668004550', [T1])],
  ])('%s: requireOwner runs first; a redirect propagates and nothing is touched', async (_n, run) => {
    await run();
    expect(calls[0]).toEqual(['requireOwner']);
    calls.length = 0;
    requireOwner.mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(run()).rejects.toThrow('NEXT_REDIRECT');
    expect(calls).toEqual([]);
  });

  it('never uses the admin client', async () => {
    await createTagAction('Promo');
    await setPostTagsAction('1', []);
    expect(calls.some((c) => c[0] === 'ADMIN')).toBe(false);
  });

  it('invalid input returns an error key without opening a database client', async () => {
    expect(await createTagAction('   ')).toEqual({ ok: false, error: 'invalid_name' });
    expect(await createTagAction('a'.repeat(41))).toEqual({ ok: false, error: 'invalid_name' });
    expect(await renameTagAction('nope', 'X')).toEqual({ ok: false, error: 'not_found' });
    expect(await deleteTagAction("1' or 1=1")).toEqual({ ok: false, error: 'not_found' });
    expect(await setPostTagsAction('1,2', [T1])).toEqual({ ok: false, error: 'not_found' });
    expect(await setPostTagsAction('1', ['x'])).toEqual({ ok: false, error: 'not_found' });
    expect(await setPostTagsAction('1', 'x' as unknown as string[])).toEqual({ ok: false, error: 'not_found' });
    const eleven = Array.from({ length: 11 }, (_, i) => `00000000-0000-4000-8000-0000000000${String(i).padStart(2, '0')}`);
    expect(await setPostTagsAction('1', eleven)).toEqual({ ok: false, error: 'too_many' });
    expect(calls.some((c) => c[0] === 'session')).toBe(false);
  });
});

describe('createTagAction', () => {
  it('stores the normalised name with the least-used colour and revalidates', async () => {
    queue.push({ data: [{ id: T2, name: 'Old', color: 'chart-1' }] }, { error: null });
    expect(await createTagAction('  Behind   the scenes ')).toEqual({ ok: true });
    expect(has('insert', { name: 'Behind the scenes', color: 'chart-2' })).toBe(true);
    expect(has('revalidate', '/tags')).toBe(true);
  });

  it('a duplicate in a different case returns duplicate (app check) and 23505 maps to duplicate (race)', async () => {
    queue.push({ data: [{ id: T2, name: 'Promo', color: 'chart-1' }] });
    expect(await createTagAction('PROMO')).toEqual({ ok: false, error: 'duplicate' });
    expect(calls.some((c) => c[0] === 'insert')).toBe(false);
    queue.push({ data: [] }, { error: { code: '23505', message: 'duplicate key value violates unique constraint "tags_name_lower_key"' } });
    expect(await createTagAction('Promo')).toEqual({ ok: false, error: 'duplicate' });
  });

  it('refuses to create beyond TAG_LIMIT tags', async () => {
    queue.push({ data: Array.from({ length: TAG_LIMIT }, (_, i) => ({ id: `t${i}`, name: `Tag ${i}`, color: 'chart-1' })) });
    expect(await createTagAction('One more')).toEqual({ ok: false, error: 'too_many' });
    expect(calls.some((c) => c[0] === 'insert')).toBe(false);
  });

  it('an unexpected database error returns unexpected, never the message', async () => {
    queue.push({ error: { message: 'secret' } });
    expect(await createTagAction('Promo')).toEqual({ ok: false, error: 'unexpected' });
  });
});

describe('renameTagAction / deleteTagAction', () => {
  it('rename: renaming to its own name in another case is allowed; another tag with that name is a duplicate', async () => {
    queue.push({ data: [{ id: T1, name: 'promo', color: 'chart-1' }] }, { data: [{ id: T1 }] });
    expect(await renameTagAction(T1, 'Promo')).toEqual({ ok: true });
    expect(has('update', { name: 'Promo' })).toBe(true);
    expect(has('eq', 'id', T1)).toBe(true);
    queue.push({ data: [{ id: T2, name: 'Promo', color: 'chart-1' }] });
    expect(await renameTagAction(T1, 'promo')).toEqual({ ok: false, error: 'duplicate' });
  });

  it('rename / delete of a tag that is gone returns not_found', async () => {
    queue.push({ data: [] }, { data: [] });
    expect(await renameTagAction(T1, 'X')).toEqual({ ok: false, error: 'not_found' });
    queue.push({ data: [] });
    expect(await deleteTagAction(T1)).toEqual({ ok: false, error: 'not_found' });
    queue.push({ data: [{ id: T1 }] });
    expect(await deleteTagAction(T1)).toEqual({ ok: true });
  });
});

describe('setPostTagsAction', () => {
  it('upserts the deduplicated set, then removes every other tag of that post', async () => {
    expect(await setPostTagsAction('17895695668004550', [T1, T1.toUpperCase(), T2])).toEqual({ ok: true });
    expect(has('upsert', [{ media_id: '17895695668004550', tag_id: T1 }, { media_id: '17895695668004550', tag_id: T2 }], { onConflict: 'media_id,tag_id', ignoreDuplicates: true })).toBe(true);
    expect(has('not', 'tag_id', 'in', `(${T1},${T2})`)).toBe(true);
    expect(has('revalidate', '/accounts/[id]', 'page')).toBe(true);
  });

  it('an empty list clears the post (no upsert, plain delete)', async () => {
    expect(await setPostTagsAction('1', [])).toEqual({ ok: true });
    expect(calls.some((c) => c[0] === 'upsert' || c[0] === 'not')).toBe(false);
    expect(has('delete')).toBe(true);
    expect(has('eq', 'media_id', '1')).toBe(true);
  });

  it('a missing post or tag (foreign key) returns not_found', async () => {
    queue.push({ error: { code: '23503' } });
    expect(await setPostTagsAction('1', [T1])).toEqual({ ok: false, error: 'not_found' });
  });
});
