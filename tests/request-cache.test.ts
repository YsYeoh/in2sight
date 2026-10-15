import { beforeEach, describe, expect, it, vi } from 'vitest';

const list = vi.fn();
const sync = vi.fn();
const clients = vi.fn();
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: async () => (clients(), { owner: true }) }));
vi.mock('@/lib/accounts/supabase-store', () => ({ supabaseAccountsStore: (db: unknown) => ({ list: () => list(db) }) }));
vi.mock('@/lib/sync/store', () => ({ listSyncStatus: (db: unknown) => sync(db) }));

// server semantics of React.cache with a request scope the tests control (see tests/require-owner.test.ts)
const request = vi.hoisted(() => ({ scope: null as Map<unknown, unknown> | null }));
vi.mock('react', async (importOriginal) => {
  const React = await importOriginal<typeof import('react')>();
  const cache =
    <A extends unknown[], R>(fn: (...a: A) => R) =>
    (...a: A): R => {
      if (!request.scope) return fn(...a);
      if (!request.scope.has(fn)) request.scope.set(fn, fn(...a));
      return request.scope.get(fn) as R;
    };
  return { ...React, cache, default: { ...React, cache } };
});

import { loadAccounts, loadSyncStatus } from '@/lib/dashboard/cached';

beforeEach(() => {
  request.scope = new Map();
  list.mockReset().mockResolvedValue([{ id: 'a1' }]);
  sync.mockReset().mockResolvedValue({ a1: { consecutiveFailures: 0 } });
  clients.mockReset();
});

describe('per-request loaders', () => {
  it('loadAccounts: every caller in one request shares one query, with the owner-session client', async () => {
    const [a, b] = await Promise.all([loadAccounts(), loadAccounts()]);
    expect(a).toBe(b);
    expect(list).toHaveBeenCalledOnce();
    expect(list).toHaveBeenCalledWith({ owner: true });
  });

  it('loadSyncStatus: one query per request', async () => {
    await loadSyncStatus();
    await loadSyncStatus();
    expect(sync).toHaveBeenCalledOnce();
  });

  it('a new request queries again (nothing crosses requests)', async () => {
    await loadAccounts();
    request.scope = new Map();
    list.mockResolvedValue([{ id: 'b2' }]);
    expect(await loadAccounts()).toEqual([{ id: 'b2' }]);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('a failed accounts read rejects for every caller of that request (the page error boundary shows), then retries next request', async () => {
    list.mockRejectedValueOnce(new Error('accounts store: list failed'));
    await expect(loadAccounts()).rejects.toThrow('list failed');
    await expect(loadAccounts()).rejects.toThrow('list failed');
    request.scope = new Map();
    await expect(loadAccounts()).resolves.toEqual([{ id: 'a1' }]);
  });
});
