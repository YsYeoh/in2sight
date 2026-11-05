// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Op = unknown[];
const { calls, requireOwner, queue, posts } = vi.hoisted(() => ({
  calls: [] as Op[],
  requireOwner: vi.fn(),
  queue: [] as { data?: unknown; error?: unknown }[],
  posts: [] as unknown[],
}));

/** Owner-session fake: records every call; each awaited query resolves to the next queued result. */
function fakeDb() {
  return {
    from(table: string) {
      calls.push(['from', table]);
      const chain: Record<string, unknown> = {};
      for (const op of ['select', 'insert', 'update', 'delete', 'eq', 'gte', 'order', 'limit']) chain[op] = (...a: unknown[]) => (calls.push([op, ...a]), chain);
      chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(queue.shift() ?? { data: [], error: null }).then(res, rej);
      return chain;
    },
  };
}

vi.mock('@/lib/auth/require-owner', () => ({ requireOwner: () => requireOwner() }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: async () => (calls.push(['session']), fakeDb()) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabase: () => calls.push(['ADMIN']) }));
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => calls.push(['revalidate', ...a]) }));
vi.mock('@/lib/prefs.server', () => ({ getPrefs: async () => ({ timezone: 'UTC', weekStart: 'mon' }) }));
vi.mock('@/lib/dashboard/detail-read', () => ({ loadPostRows: async (...a: unknown[]) => (calls.push(['loadPostRows', a[1]]), posts) }));

import { deletePlannerItemAction, movePlannerItemAction, savePlannerItemAction, suggestSlotsAction } from '@/app/(app)/plan/planner-actions';
import { MAX_ITEM_TAGS, MAX_ITEMS, NOTES_MAX, PLANNER_FORMATS, PLANNER_STATUSES, TITLE_MAX } from '@/lib/planner/items';
import { loadPlannerItems } from '@/lib/planner/read';

const A = '7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e';
const I = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';
const input = (o: Record<string, unknown> = {}) => ({ accountId: A, title: 'Studio tour', notes: '', status: 'idea', format: null, plannedDay: null, plannedHour: null, tagIds: [], mediaId: null, ...o });
const has = (op: string, ...args: unknown[]) => calls.some((c) => c[0] === op && args.every((a, i) => JSON.stringify(c[i + 1]) === JSON.stringify(a)));

beforeEach(() => {
  calls.length = 0;
  queue.length = 0;
  posts.length = 0;
  requireOwner.mockReset().mockImplementation(async () => void calls.push(['requireOwner']));
});

describe('planner actions: authorization and boundary validation', () => {
  it.each([
    ['save', () => savePlannerItemAction(null, input())],
    ['move', () => movePlannerItemAction(I, 'drafting')],
    ['delete', () => deletePlannerItemAction(I)],
    ['suggest', () => suggestSlotsAction(A)],
  ])('%s: requireOwner runs first; a redirect propagates and nothing is touched', async (_n, run) => {
    await run();
    expect(calls[0]).toEqual(['requireOwner']);
    calls.length = 0;
    requireOwner.mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(run()).rejects.toThrow('NEXT_REDIRECT');
    expect(calls).toEqual([]);
  });

  it('never uses the admin client', async () => {
    await savePlannerItemAction(null, input());
    await movePlannerItemAction(I, 'posted');
    await suggestSlotsAction(A);
    expect(calls.some((c) => c[0] === 'ADMIN')).toBe(false);
  });

  it('invalid input returns an error key without opening a database client', async () => {
    expect(await savePlannerItemAction('x', input())).toEqual({ ok: false, error: 'not_found' });
    expect(await savePlannerItemAction(null, input({ title: '' }))).toEqual({ ok: false, error: 'invalid' });
    expect(await savePlannerItemAction(null, 'nope')).toEqual({ ok: false, error: 'invalid' });
    expect(await movePlannerItemAction("1' or 1=1", 'idea')).toEqual({ ok: false, error: 'not_found' });
    expect(await movePlannerItemAction(I, 'scheduled' as never)).toEqual({ ok: false, error: 'invalid' });
    expect(await deletePlannerItemAction('x')).toEqual({ ok: false, error: 'not_found' });
    expect(await suggestSlotsAction('x')).toEqual({ ok: false, error: 'not_found' });
    expect(calls.some((c) => c[0] === 'session')).toBe(false);
  });
});

describe('savePlannerItemAction', () => {
  it('creates: checks the cap, inserts the normalised row, revalidates /plan', async () => {
    queue.push({ data: [{ id: 'x' }] }, { error: null });
    expect(await savePlannerItemAction(null, input({ title: '  Studio   tour ', tagIds: [] }))).toEqual({ ok: true });
    expect(has('limit', MAX_ITEMS)).toBe(true);
    expect(has('insert', { account_id: A, title: 'Studio tour', notes: '', status: 'idea', format: null, planned_day: null, planned_hour: null, tag_ids: [], media_id: null })).toBe(true);
    expect(has('revalidate', '/plan')).toBe(true);
  });

  it('refuses a new item at the cap', async () => {
    queue.push({ data: Array.from({ length: MAX_ITEMS }, (_, i) => ({ id: i })) });
    expect(await savePlannerItemAction(null, input())).toEqual({ ok: false, error: 'too_many' });
    expect(calls.some((c) => c[0] === 'insert')).toBe(false);
  });

  it('updates by id; a vanished item is not_found', async () => {
    queue.push({ data: [{ id: I }] });
    expect(await savePlannerItemAction(I.toUpperCase(), input({ status: 'drafting' }))).toEqual({ ok: true });
    expect(has('eq', 'id', I)).toBe(true);
    queue.push({ data: [] });
    expect(await savePlannerItemAction(I, input())).toEqual({ ok: false, error: 'not_found' });
  });

  it('a linked post must belong to the item’s account', async () => {
    queue.push({ data: [] });
    expect(await savePlannerItemAction(I, input({ status: 'posted', mediaId: '178' }))).toEqual({ ok: false, error: 'not_found' });
    expect(has('from', 'media')).toBe(true);
    expect(has('eq', 'account_id', A)).toBe(true);
    expect(calls.some((c) => c[0] === 'update')).toBe(false);

    calls.length = 0;
    queue.push({ data: [{ id: '178' }] }, { data: [{ id: I }] });
    expect(await savePlannerItemAction(I, input({ status: 'posted', mediaId: '178' }))).toEqual({ ok: true });
    expect(calls.some((c) => c[0] === 'update' && (c[1] as { media_id: string }).media_id === '178')).toBe(true);
  });

  it.each([
    ['PGRST205', 'needs_update'],
    ['42P01', 'needs_update'],
    ['23503', 'not_found'],
    ['23514', 'invalid'],
    ['XX000', 'unexpected'],
  ])('database error %s → %s', async (code, key) => {
    queue.push({ data: [] }, { error: { code, message: 'secret detail' } });
    expect(await savePlannerItemAction(null, input())).toEqual({ ok: false, error: key });
  });
});

describe('movePlannerItemAction', () => {
  it('to posted keeps the link; to any other column drops it', async () => {
    queue.push({ data: [{ id: I }] }, { data: [{ id: I }] });
    expect(await movePlannerItemAction(I, 'posted')).toEqual({ ok: true });
    expect(has('update', { status: 'posted' })).toBe(true);
    expect(await movePlannerItemAction(I, 'ready')).toEqual({ ok: true });
    expect(has('update', { status: 'ready', media_id: null })).toBe(true);
  });

  it('a vanished item is not_found', async () => {
    queue.push({ data: [] });
    expect(await movePlannerItemAction(I, 'idea')).toEqual({ ok: false, error: 'not_found' });
  });
});

describe('deletePlannerItemAction', () => {
  it('deletes by id and revalidates', async () => {
    queue.push({ data: [{ id: I }] });
    expect(await deletePlannerItemAction(I)).toEqual({ ok: true });
    expect(has('delete')).toBe(true);
    expect(has('eq', 'id', I)).toBe(true);
    expect(has('revalidate', '/plan')).toBe(true);
  });
});

describe('suggestSlotsAction', () => {
  it('reads the account’s posts and its planned days after today; too few posts → no slots, with the reason', async () => {
    queue.push({ data: [{ planned_day: '2099-01-01' }] });
    const r = await suggestSlotsAction(A);
    expect(r).toEqual({ ok: true, slots: [], sample: 0, reason: 'not_enough_posts' });
    expect(has('loadPostRows', A)).toBe(true);
    expect(has('eq', 'account_id', A)).toBe(true);
    expect(calls.some((c) => c[0] === 'gte' && c[1] === 'planned_day')).toBe(true);
    expect(calls.some((c) => c[0] === 'revalidate')).toBe(false); // read-only
  });

  it('without the migration: needs_update', async () => {
    queue.push({ error: { code: 'PGRST205' } });
    expect(await suggestSlotsAction(A)).toEqual({ ok: false, error: 'needs_update' });
  });
});

describe('loadPlannerItems', () => {
  it('newest first, capped; maps rows (unknown status / format fall back); no table → null; other errors → a fixed message', async () => {
    const db = fakeDb() as never;
    queue.push({ data: [{ id: I, account_id: A, title: 'T', notes: null, status: 'weird', format: 'VIDEO', planned_day: '2026-11-10', planned_hour: 19, tag_ids: [A], media_id: null, created_at: 'c' }] });
    expect(await loadPlannerItems(db)).toEqual([{ id: I, accountId: A, title: 'T', notes: '', status: 'idea', format: null, plannedDay: '2026-11-10', plannedHour: 19, tagIds: [A], mediaId: null, createdAt: 'c' }]);
    expect(has('order', 'created_at', { ascending: false })).toBe(true);
    expect(has('limit', MAX_ITEMS)).toBe(true);
    queue.push({ error: { code: 'PGRST205' } });
    expect(await loadPlannerItems(db)).toBeNull();
    queue.push({ error: { code: 'XX000', message: 'secret detail' } });
    await expect(loadPlannerItems(db)).rejects.toThrow(/^planner read failed$/);
  });
});

describe('the app limits equal the migration checks (20261105000001)', () => {
  it('title, notes, status, format and tag caps', () => {
    const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261105000001_planner_items.sql'), 'utf8');
    const list = (xs: readonly string[]) => xs.map((x) => `'${x}'`).join(', ');
    expect(sql).toContain(`char_length(title) between 1 and ${TITLE_MAX}`);
    expect(sql).toContain(`char_length(notes) <= ${NOTES_MAX}`);
    expect(sql).toContain(`status in (${list(PLANNER_STATUSES)})`);
    expect(sql).toContain(`format in (${list(PLANNER_FORMATS)})`);
    expect(sql).toContain(`cardinality(tag_ids) <= ${MAX_ITEM_TAGS}`);
  });
});
