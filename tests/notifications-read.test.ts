import { describe, expect, it } from 'vitest';
import { loadNotifications, rowToNotification } from '@/lib/alerts/read';

const ROW = { id: 7, kind: 'reach_drop', account_id: 'a1', severity: 'warning', payload: { username: 'cafe', pct: 25 }, created_at: '2026-10-14T02:00:00Z', read_at: null };

/** Two queries (list, count) resolve to the queued results in order. */
function fakeDb(results: unknown[]) {
  const calls: unknown[][] = [];
  return {
    calls,
    db: {
      from(table: string) {
        calls.push(['from', table]);
        const r = results.shift();
        const chain: Record<string, unknown> = {};
        for (const op of ['select', 'order', 'limit', 'is']) chain[op] = (...a: unknown[]) => (calls.push([op, ...a]), chain);
        chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => (r instanceof Error ? Promise.reject(r) : Promise.resolve(r)).then(res, rej);
        return chain;
      },
    } as never,
  };
}

describe('rowToNotification', () => {
  it('maps a valid row', () => {
    expect(rowToNotification(ROW)).toEqual({ id: 7, kind: 'reach_drop', accountId: 'a1', severity: 'warning', payload: { username: 'cafe', pct: 25 }, createdAt: '2026-10-14T02:00:00Z', readAt: null });
  });

  it('drops unknown kinds and rows without id/created_at; type-checks payload fields', () => {
    expect(rowToNotification({ ...ROW, kind: 'evil' })).toBeNull();
    expect(rowToNotification({ ...ROW, id: '7' })).toBeNull();
    expect(rowToNotification({ ...ROW, created_at: null })).toBeNull();
    const n = rowToNotification({ ...ROW, severity: 'x', payload: { username: 5, pct: 'NaN', ratio: Infinity, postId: 9, extra: '<b>' } });
    expect(n?.payload).toEqual({ username: '' });
    expect(n?.severity).toBe('info');
    expect(rowToNotification({ ...ROW, payload: null })?.payload).toEqual({ username: '' });
  });
});

describe('loadNotifications', () => {
  it('newest 20 with explicit columns, plus a head-only unread count', async () => {
    const f = fakeDb([{ data: [ROW, { ...ROW, kind: 'nope' }], error: null }, { count: 3, error: null }]);
    expect(await loadNotifications(f.db)).toEqual({ items: [rowToNotification(ROW)], unread: 3 });
    expect(f.calls).toContainEqual(['select', 'id,kind,account_id,severity,payload,created_at,read_at']);
    expect(f.calls).toContainEqual(['order', 'created_at', { ascending: false }]);
    expect(f.calls).toContainEqual(['limit', 20]);
    expect(f.calls).toContainEqual(['select', 'id', { count: 'exact', head: true }]);
    expect(f.calls).toContainEqual(['is', 'read_at', null]);
  });

  it('errors and exceptions give an empty bell, never a crash', async () => {
    expect(await loadNotifications(fakeDb([{ data: null, error: { message: 'x' } }, { count: 1, error: null }]).db)).toEqual({ items: [], unread: 0 });
    expect(await loadNotifications(fakeDb([new Error('network'), { count: 1, error: null }]).db)).toEqual({ items: [], unread: 0 });
  });
});
