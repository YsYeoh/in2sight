import { beforeEach, describe, expect, it, vi } from 'vitest';

const { calls, requireOwner, queue } = vi.hoisted(() => ({
  calls: [] as unknown[][],
  requireOwner: vi.fn(),
  queue: [] as { error?: unknown }[],
}));

/** Owner-session fake: records every call; each awaited query resolves to the next queued result. */
function fakeDb() {
  return {
    from(table: string) {
      calls.push(['from', table]);
      const chain: Record<string, unknown> = {};
      for (const op of ['update', 'eq', 'is']) chain[op] = (...a: unknown[]) => (calls.push([op, ...a]), chain);
      chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(queue.shift() ?? { error: null }).then(res, rej);
      return chain;
    },
  };
}

vi.mock('@/lib/auth/require-owner', () => ({ requireOwner: () => requireOwner() }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: async () => (calls.push(['session']), fakeDb()) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabase: () => calls.push(['ADMIN']) }));
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => calls.push(['revalidate', ...a]) }));

import { markAllReadAction, markReadAction } from '@/app/(app)/notifications/actions';

const has = (op: string, ...args: unknown[]) => calls.some((c) => c[0] === op && args.every((a, i) => JSON.stringify(c[i + 1]) === JSON.stringify(a)));

beforeEach(() => {
  calls.length = 0;
  queue.length = 0;
  requireOwner.mockReset().mockImplementation(async () => void calls.push(['requireOwner']));
});

describe('notification actions', () => {
  it.each([
    ['markRead', () => markReadAction(7)],
    ['markAllRead', () => markAllReadAction()],
  ])('%s: requireOwner runs first; a redirect propagates and nothing is touched', async (_n, run) => {
    await run();
    expect(calls[0]).toEqual(['requireOwner']);
    calls.length = 0;
    requireOwner.mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(run()).rejects.toThrow('NEXT_REDIRECT');
    expect(calls).toEqual([]);
  });

  it('markRead updates only read_at of that unread row, with the owner session, and revalidates the layout', async () => {
    expect(await markReadAction(7)).toEqual({ ok: true });
    expect(has('from', 'notifications')).toBe(true);
    const update = calls.find((c) => c[0] === 'update')![1] as Record<string, unknown>;
    expect(Object.keys(update)).toEqual(['read_at']);
    expect(has('eq', 'id', 7)).toBe(true);
    expect(has('is', 'read_at', null)).toBe(true);
    expect(has('revalidate', '/', 'layout')).toBe(true);
    expect(calls.some((c) => c[0] === 'ADMIN')).toBe(false);
  });

  it('markAllRead updates every unread row', async () => {
    expect(await markAllReadAction()).toEqual({ ok: true });
    expect(has('is', 'read_at', null)).toBe(true);
    expect(calls.some((c) => c[0] === 'eq')).toBe(false);
  });

  it('invalid ids return not_found without opening a client', async () => {
    for (const id of [0, -1, 1.5, NaN, '7' as unknown as number, null as unknown as number]) expect(await markReadAction(id)).toEqual({ ok: false, error: 'not_found' });
    expect(calls.filter((c) => c[0] === 'session')).toEqual([]);
  });

  it('a database error returns unexpected and does not revalidate', async () => {
    queue.push({ error: { message: 'x' } });
    expect(await markReadAction(7)).toEqual({ ok: false, error: 'unexpected' });
    expect(calls.some((c) => c[0] === 'revalidate')).toBe(false);
  });
});
