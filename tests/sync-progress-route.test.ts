// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decideRoute } from '@/lib/auth/route-policy';
import type { StoredAccount } from '@/lib/accounts/types';
import { loadSyncProgress, rowToLive } from '@/lib/sync/progress-read';

const state = vi.hoisted(() => ({ owner: true, reads: 0, fail: false }));
vi.mock('@/lib/auth/assert-owner', () => ({
  assertOwner: async (h?: Headers) => {
    h?.set('x-from-supabase', 'kept');
    return state.owner;
  },
}));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: async () => ({ __db: true }) }));
vi.mock('@/lib/accounts/supabase-store', () => ({
  supabaseAccountsStore: () => ({
    list: async () => {
      state.reads++;
      if (state.fail) throw new Error('dashboard read: accounts failed secret-value');
      return [];
    },
  }),
}));

import { GET } from '@/app/api/sync/progress/route';

beforeEach(() => {
  state.owner = true;
  state.reads = 0;
  state.fail = false;
});

describe('GET /api/sync/progress', () => {
  it('401 for anyone but the owner, uncached, nothing read; the auth headers are kept', async () => {
    state.owner = false;
    const res = await GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('x-from-supabase')).toBe('kept');
    expect(state.reads).toBe(0);
  });

  it('200 with the progress list for the owner, uncached', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accounts: [] });
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('x-from-supabase')).toBe('kept');
  });

  it('a read failure is a fixed 500 that never echoes the error', async () => {
    state.fail = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await GET();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('secret');
  });

  it('stays session-protected: no public exemption in the route policy', () => {
    expect(decideRoute({ pathname: '/api/sync/progress', configured: true, signedIn: false, aal: null, mfaRequired: false })).toEqual({ type: 'redirect', to: '/login' });
  });
});

/** Minimal PostgREST stand-in: each table returns its rows; count queries return `counts[table]`. */
function fakeDb(rows: Record<string, unknown[]>, o: { counts?: number[]; errors?: string[] } = {}) {
  const counts = [...(o.counts ?? [])];
  const queried: string[] = [];
  return {
    queried,
    db: {
      from(table: string) {
        queried.push(table);
        let head = false;
        const q: Record<string, unknown> = {};
        const result = () => (o.errors?.includes(table) ? { data: null, error: { message: 'x' }, count: null } : head ? { data: null, error: null, count: counts.shift() ?? 0 } : { data: rows[table] ?? [], error: null });
        q.select = (_c: string, opts?: { head?: boolean }) => ((head = !!opts?.head), q);
        for (const f of ['in', 'eq', 'neq', 'is', 'not', 'order', 'limit']) q[f] = () => q;
        q.maybeSingle = async () => ({ data: (rows[table] ?? [])[0] ?? null, error: null });
        q.then = (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res);
        return q;
      },
    } as never,
  };
}

const NOW = new Date('2026-10-14T02:00:00Z');
const acct = (id: string, o: Partial<StoredAccount> = {}) => ({ id, status: 'active', ...o }) as StoredAccount;

describe('loadSyncProgress', () => {
  it('only importing / unfinished accounts are returned, with counts and keys only', async () => {
    const { db, queried } = fakeDb(
      {
        sync_state: [
          { account_id: 'new', daily_done_through: '2026-10-13', backfilled_from: '2026-10-07', last_run: { daily: NOW.toISOString() }, consecutive_failures: 0, lease_id: 'secret-lease' },
          { account_id: 'done', daily_done_through: '2026-10-13', backfilled_from: '2026-07-16', last_run: { backfill: NOW.toISOString() }, consecutive_failures: 0 },
        ],
        sync_progress: [{ account_id: 'new', stage: 'account_days', state: 'running', done: 7, total: 90, detail_day: '2026-10-06', started_at: '2026-10-14T01:59:00Z', updated_at: '2026-10-14T01:59:58Z' }],
        follower_snapshots: [{ followers: 1520 }],
      },
      { counts: [12, 3] },
    );
    const out = await loadSyncProgress(db, [acct('new'), acct('done'), acct('gone', { status: 'archived' })], NOW);
    expect(out.map((p) => p.accountId)).toEqual(['new']);
    expect(out[0]).toMatchObject({ phase: 'running', current: { stage: 'account_days', day: '2026-10-06', done: 7, total: 90 } });
    expect(out[0].stages.find((s) => s.stage === 'post_metrics')).toMatchObject({ done: 3, total: 12 });
    expect(JSON.stringify(out)).not.toContain('secret');
    expect(queried.filter((t) => t === 'media')).toHaveLength(2); // counts only for the tracked account
  });

  it('works before the migration is applied (sync_progress missing): the state alone drives the panel', async () => {
    const { db } = fakeDb({ sync_state: [] }, { errors: ['sync_progress'] });
    const out = await loadSyncProgress(db, [acct('brand-new')], NOW);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ accountId: 'brand-new', phase: 'waiting', percent: 0 });
  });

  it('never throws: a failing state read gives an empty list', async () => {
    expect(await loadSyncProgress(fakeDb({}, { errors: ['sync_state'] }).db, [acct('a')], NOW)).toEqual([]);
    expect(await loadSyncProgress({} as never, [acct('a')], NOW)).toEqual([]);
  });

  it('rowToLive defaults unknown states to waiting and missing numbers safely', () => {
    expect(rowToLive({ state: 'weird', done: 'x' })).toMatchObject({ state: 'waiting', done: 0, total: null, stage: null });
  });
});
