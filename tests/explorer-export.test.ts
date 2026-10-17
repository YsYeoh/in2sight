// @vitest-environment node
import { strFromU8, unzipSync } from 'fflate';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PREFS, type Prefs } from '@/lib/prefs';

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const state = vi.hoisted(() => ({ owner: true, prefs: null as Prefs | null, rpcs: [] as string[], fail: false }));
vi.mock('@/lib/auth/assert-owner', () => ({
  assertOwner: async (h?: Headers) => {
    h?.set('cache-control', 'private, no-store');
    return state.owner;
  },
}));
vi.mock('@/lib/prefs.server', () => ({ getPrefs: async () => state.prefs }));
vi.mock('@/lib/sync/store', () => ({ listSyncStatus: async () => ({}) }));
vi.mock('@/lib/accounts/supabase-store', () => ({
  supabaseAccountsStore: () => ({ list: async () => [{ id: A, igUserId: '1', username: 'brand=one', displayName: null, accountType: null, profilePictureUrl: null, groupName: null, status: 'active', archivedAt: null, lastError: null, tokenExpiresAt: null, connectedAt: '2026-01-01T00:00:00Z' }] }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: async () => {
    const chain = (name: string) => {
      const c: Record<string, unknown> = {};
      for (const op of ['select', 'eq', 'in', 'order', 'limit']) c[op] = () => c;
      const data: Record<string, unknown[]> = {
        explorer_daily: [{ key: A, reach: 1200, views: 3000, interactions: 90, er_interactions: 90, er_reach: 1200, net_follows: 4, followers: 900 }],
        explorer_posts: [{ key: A, posts: 3, measured: 3, reach_sum: 600, views_sum: 900, views_n: 3, likes: 30, comments: 3, saves: 2, shares: 1, er_interactions: 36, er_reach: 600 }],
      };
      c.then = (res: (v: unknown) => unknown) => Promise.resolve(state.fail ? { data: null, error: { message: 'secret-row' } } : { data: data[name] ?? [], error: null }).then(res);
      return c;
    };
    return { from: (t: string) => chain(t), rpc: (n: string) => (state.rpcs.push(n), chain(n)) };
  },
}));

import { GET } from '@/app/api/export/explorer/route';

const get = (qs: string) => GET(new NextRequest(new URL(`/api/export/explorer?${qs}`, 'https://app.test')));
beforeEach(() => {
  state.owner = true;
  state.prefs = { ...DEFAULT_PREFS, timezone: 'UTC' };
  state.rpcs = [];
  state.fail = false;
});

describe('GET /api/export/explorer', () => {
  it('401 for anyone but the owner, uncached, nothing read', async () => {
    state.owner = false;
    const res = await get('m=reach&by=account');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(state.rpcs).toEqual([]);
  });

  it('400 bad_params for anything that is not the canonical query, before any read', async () => {
    for (const qs of ['', 'by=account', 'm=reach&by=account&m=reach', 'm=reach&by=drop', 'm=reach&by=account&x=1', 'm=reach&by=account&month=2026-09', 'by=account&m=reach', 'm=reach&by=account&acc=nope']) {
      const res = await get(qs);
      expect(res.status, qs).toBe(400);
      expect(await res.json()).toEqual({ error: 'bad_params' });
    }
    expect(state.rpcs).toEqual([]);
  });

  it('200: one sheet with the view, previous + change columns when comparing, Server-Timing, private + no-store', async () => {
    const res = await get('m=reach%2CengagementRate%2Cposts&by=account&from=90d');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('server-timing')).toMatch(/^explorer;dur=\d+\.\d$/);
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="in2sight-explorer-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.xlsx"/);
    const zip = unzipSync(new Uint8Array(await res.arrayBuffer()));
    expect(strFromU8(zip['xl/workbook.xml'])).toContain('name="Explorer"');
    const strings = strFromU8(zip['xl/sharedStrings.xml']);
    for (const s of ['Account', 'Reach', 'Reach (previous)', 'Reach change', 'Posts', '@brand=one']) expect(strings).toContain(s);
    expect(state.rpcs).toEqual(['explorer_daily', 'explorer_posts', 'explorer_daily', 'explorer_posts']); // current + comparison
  });

  it('no comparison: no previous/change columns; zh-CN headers', async () => {
    state.prefs = { ...DEFAULT_PREFS, locale: 'zh-CN', timezone: 'UTC' };
    const zip = unzipSync(new Uint8Array(await (await get('m=reach&by=account&cmp=none')).arrayBuffer()));
    const strings = strFromU8(zip['xl/sharedStrings.xml']);
    expect(strings).toContain('触达');
    expect(strings).not.toContain('之前');
  });

  it('a failed read is 500 unexpected with a fixed log line, never the database text', async () => {
    state.fail = true;
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await get('m=reach&by=account');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'unexpected' });
    expect(JSON.stringify(err.mock.calls)).not.toContain('secret-row');
    err.mockRestore();
  });
});
