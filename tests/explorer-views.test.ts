import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

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
      for (const op of ['select', 'insert', 'update', 'delete', 'eq', 'order', 'limit']) chain[op] = (...a: unknown[]) => (calls.push([op, ...a]), chain);
      chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(queue.shift() ?? { data: [], error: null }).then(res, rej);
      return chain;
    },
  };
}

vi.mock('@/lib/auth/require-owner', () => ({ requireOwner: () => requireOwner() }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: async () => (calls.push(['session']), fakeDb()) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabase: () => calls.push(['ADMIN']) }));
vi.mock('@/lib/prefs.server', () => ({ getPrefs: async () => ({ weekStart: 'mon' }) }));
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => calls.push(['revalidate', ...a]) }));

import { deleteViewAction, renameViewAction, saveViewAction } from '@/app/(app)/explorer/actions';
import { loadViews, MAX_VIEWS, viewHref, viewState } from '@/lib/explorer/views';

const V1 = '7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e';
const V2 = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';
const has = (op: string, ...args: unknown[]) => calls.some((c) => c[0] === op && args.every((a, i) => JSON.stringify(c[i + 1]) === JSON.stringify(a)));

beforeEach(() => {
  calls.length = 0;
  queue.length = 0;
  requireOwner.mockReset().mockImplementation(async () => void calls.push(['requireOwner']));
});

describe('viewState / viewHref', () => {
  it('keeps only Explorer and Time Scope keys, canonical; a preset stays a preset, picker shorthands become fixed days', () => {
    expect(viewState('m=likes&by=hour&from=90d&cmp=yoy&tab=posts&evil=1', 'mon')).toEqual({ m: 'likes', by: 'hour', from: '90d', cmp: 'yoy' });
    expect(viewState('by=time&month=2026-09&gran=week', 'mon')).toEqual({ m: 'reach,engagementRate,posts,avgReach', by: 'time', from: '2026-09-01', to: '2026-09-30', gran: 'week' });
    expect(viewState('m=reach&m=likes&by=format', 'mon')).toEqual({ m: 'posts,avgReach,postEngagementRate', by: 'format' }); // repeated = missing
  });

  it('a stored state is re-validated: junk JSON, unknown keys and non-strings never reach the link', () => {
    expect(viewHref({ m: 'likes', by: 'tag', from: '2026-01-01', to: '2026-03-31', x: 'y', acc: 5 }, 'mon')).toBe('/explorer?m=likes&by=tag&from=2026-01-01&to=2026-03-31');
    for (const junk of [null, 'm=likes', [], 42, { by: 'drop table', from: '<script>' }]) expect(viewHref(junk, 'mon')).toBe('/explorer?m=reach%2CengagementRate%2Cposts%2CavgReach&by=account');
  });

  it('loadViews: A→Z, at most MAX_VIEWS, links rebuilt; a failed read is an empty menu', async () => {
    queue.push({ data: [{ id: V1, name: 'Reels', state: { m: 'likes', by: 'hour' } }], error: null });
    expect(await loadViews(fakeDb() as unknown as SupabaseClient, 'mon')).toEqual([{ id: V1, name: 'Reels', href: '/explorer?m=likes&by=hour' }]);
    expect(has('order', 'name', { ascending: true })).toBe(true);
    expect(has('limit', MAX_VIEWS)).toBe(true);
    queue.push({ data: null, error: { message: 'x' } });
    expect(await loadViews(fakeDb() as unknown as SupabaseClient, 'mon')).toEqual([]);
  });
});

describe('saved view actions: authorization and validation', () => {
  it.each([
    ['save', () => saveViewAction('Reels by hour', 'by=hour')],
    ['rename', () => renameViewAction(V1, 'New')],
    ['delete', () => deleteViewAction(V1)],
  ])('%s: requireOwner runs first; a redirect propagates and nothing is touched', async (_n, run) => {
    await run();
    expect(calls[0]).toEqual(['requireOwner']);
    calls.length = 0;
    requireOwner.mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(run()).rejects.toThrow('NEXT_REDIRECT');
    expect(calls).toEqual([]);
  });

  it('invalid input returns an error key without opening a database client; never the admin client', async () => {
    expect(await saveViewAction('   ', 'by=hour')).toEqual({ ok: false, error: 'invalid_name' });
    expect(await saveViewAction('a'.repeat(61), 'by=hour')).toEqual({ ok: false, error: 'invalid_name' });
    expect(await saveViewAction('ok', 'x'.repeat(4001))).toEqual({ ok: false, error: 'invalid_state' });
    expect(await saveViewAction('ok', 42 as unknown as string)).toEqual({ ok: false, error: 'invalid_state' });
    expect(await renameViewAction("1' or 1=1", 'x')).toEqual({ ok: false, error: 'not_found' });
    expect(await deleteViewAction('nope')).toEqual({ ok: false, error: 'not_found' });
    expect(calls.some((c) => c[0] === 'session' || c[0] === 'ADMIN')).toBe(false);
  });
});

describe('saveViewAction', () => {
  it('stores the normalised name and the canonical state, then revalidates', async () => {
    queue.push({ data: [{ id: V2, name: 'Other' }] }, { error: null });
    expect(await saveViewAction('  Reels   by hour ', 'm=likes&by=hour&from=30d&tab=x')).toEqual({ ok: true });
    expect(has('insert', { name: 'Reels by hour', state: { m: 'likes', by: 'hour' } })).toBe(true);
    expect(has('revalidate', '/explorer')).toBe(true);
  });

  it('duplicate names (any case), too many views, a DB race and unexpected errors map to keys, never messages', async () => {
    queue.push({ data: [{ id: V2, name: 'reels' }] });
    expect(await saveViewAction('REELS', '')).toEqual({ ok: false, error: 'duplicate' });
    queue.push({ data: Array.from({ length: MAX_VIEWS }, (_, i) => ({ id: `v${i}`, name: `View ${i}` })) });
    expect(await saveViewAction('One more', '')).toEqual({ ok: false, error: 'too_many' });
    queue.push({ data: [] }, { error: { code: '23505', message: 'duplicate key' } });
    expect(await saveViewAction('Race', '')).toEqual({ ok: false, error: 'duplicate' });
    queue.push({ error: { message: 'secret' } });
    expect(await saveViewAction('Boom', '')).toEqual({ ok: false, error: 'unexpected' });
    expect(calls.some((c) => c[0] === 'insert' && JSON.stringify(c).includes('One more'))).toBe(false);
  });
});

describe('renameViewAction / deleteViewAction', () => {
  it('rename: own name in another case is fine, another view with that name is a duplicate, a gone view is not_found', async () => {
    queue.push({ data: [{ id: V1, name: 'reels' }] }, { data: [{ id: V1 }] });
    expect(await renameViewAction(V1, 'Reels')).toEqual({ ok: true });
    expect(calls.some((c) => c[0] === 'update' && (c[1] as { name: string }).name === 'Reels')).toBe(true);
    expect(has('eq', 'id', V1)).toBe(true);
    queue.push({ data: [{ id: V2, name: 'Reels' }] });
    expect(await renameViewAction(V1, 'reels')).toEqual({ ok: false, error: 'duplicate' });
    queue.push({ data: [] }, { data: [] });
    expect(await renameViewAction(V1, 'X')).toEqual({ ok: false, error: 'not_found' });
  });

  it('delete: removes by id; a gone view is not_found', async () => {
    queue.push({ data: [{ id: V1 }] });
    expect(await deleteViewAction(V1)).toEqual({ ok: true });
    expect(has('delete')).toBe(true);
    queue.push({ data: [] });
    expect(await deleteViewAction(V1)).toEqual({ ok: false, error: 'not_found' });
  });
});
