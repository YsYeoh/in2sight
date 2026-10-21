// @vitest-environment node
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CellObject } from 'write-excel-file/node';
import { buildFollowerSheets } from '@/lib/export/followers';
import type { WorkbookSheet } from '@/lib/export/workbook';
import { DEFAULT_PREFS } from '@/lib/prefs';

const ACC = '3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b';
const S1 = '00000000-0000-4000-8000-000000000001';
const S2 = '00000000-0000-4000-8000-000000000002';
const state = vi.hoisted(() => ({
  owner: true,
  account: null as Record<string, unknown> | null,
  snapshots: null as Record<string, unknown>[] | null,
  data: {} as Record<string, unknown>,
  written: [] as WorkbookSheet[][],
  order: [] as string[],
}));
vi.mock('@/lib/auth/assert-owner', () => ({ assertOwner: async () => (state.order.push('assertOwner'), state.owner) }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: async () => (state.order.push('ownerSession'), {}) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabase: () => state.order.push('ADMIN') }));
vi.mock('@/lib/prefs.server', async () => ({ getPrefs: async () => ({ ...(await import('@/lib/prefs')).DEFAULT_PREFS, dateFormat: 'YYYY-MM-DD' }) }));
vi.mock('@/lib/accounts/supabase-store', () => ({ supabaseAccountsStore: () => ({ getById: async () => state.account }) }));
vi.mock('@/lib/followers/read', () => ({
  listFollowerSnapshots: async () => state.snapshots,
  loadFollowerSnapshot: async (_db: unknown, _a: string, id: string) => state.data[id] ?? null,
}));
vi.mock('@/lib/export/workbook', async (orig) => ({
  ...(await orig<object>()),
  writeWorkbook: async (sheets: WorkbookSheet[]) => (state.written.push(sheets), Buffer.from('xlsx')),
}));

import { GET } from '@/app/api/export/followers/route';
import { translator } from '@/lib/export/workbook';

const PREFS = { ...DEFAULT_PREFS, dateFormat: 'YYYY-MM-DD' as const };
const T1 = Date.parse('2026-10-05T04:00:00Z') / 1000;
const values = (s: WorkbookSheet) => s.data.map((r) => (r as (CellObject | null)[]).map((c) => (c === null ? null : c.value instanceof Date ? c.value.toISOString() : c.value)));
const call = (q: string) => GET(new NextRequest(`https://app.test/api/export/followers?${q}`));
const meta = (id: string, takenOn: string) => ({ id, takenOn, followerCount: 2, followingCount: 1, createdAt: `${takenOn}T10:00:00Z` });

beforeEach(() => {
  state.owner = true;
  state.account = { id: ACC, username: 'shop.one', status: 'active' };
  state.snapshots = [meta(S2, '2026-10-20'), meta(S1, '2026-09-20')];
  state.data = {
    [S2]: { followers: [{ username: 'bob', at: null }, { username: 'dan', at: T1 }, { username: 'ann.b', at: T1 - 60 }], following: [{ username: 'dan', at: T1 }] },
    [S1]: { followers: [{ username: 'amy', at: T1 - 999 }, { username: 'bob', at: null }], following: null },
  };
  state.written = [];
  state.order = [];
});

describe('buildFollowerSheets', () => {
  it('the list sheet: username text cells, real date-time cells (empty when unknown), a profile link; an About sheet', () => {
    const [list, about] = buildFollowerSheets({ account: '=evil', list: 'new', newer: '2026-10-20', older: '2026-09-20', people: [{ username: 'dan', at: T1 }, { username: 'eve', at: null }] }, translator('en'), PREFS);
    expect(list.sheet).toBe('New followers');
    expect(list.stickyRowsCount).toBe(1);
    expect(values(list)).toEqual([
      ['Username', 'Followed you on', 'Profile link'],
      ['dan', '2026-10-05T12:00:00.000Z', 'https://www.instagram.com/dan/'], // the owner's wall clock (Kuala Lumpur, UTC+8) as the cell value
      ['eve', null, 'https://www.instagram.com/eve/'],
    ]);
    expect((list.data[1] as CellObject[])[1]).toMatchObject({ type: Date, format: 'yyyy-mm-dd hh:mm' });
    expect(about.sheet).toBe('About');
    const rows = values(about);
    expect(rows[1]).toEqual(['Account', "'=evil"]); // the formula-injection guard of lib/export/cells.ts
    expect(rows[5][1]).toBe('They follow you in the export of 2026-10-20 but not in the one of 2026-09-20. Snapshot-based: only people who followed or unfollowed between these two files, not everything in between.');
  });

  it('the time column follows the list; zh-CN sheet names', () => {
    const [list] = buildFollowerSheets({ account: 'a', list: 'theyDontFollow', newer: 'x', older: null, people: [] }, translator('en'), PREFS);
    expect(values(list)[0][1]).toBe('You followed on');
    const zh = buildFollowerSheets({ account: 'a', list: 'mutual', newer: 'x', older: null, people: [] }, translator('zh-CN'), { ...PREFS, locale: 'zh-CN' });
    expect(zh.map((s) => s.sheet)).toEqual(['互相关注', '说明']);
  });
});

describe('GET /api/export/followers', () => {
  it('the whole filtered list as xlsx: private, nosniff, a clean file name; owner first, never the admin client', async () => {
    const res = await call(`account=${ACC}&snap=${S2}&vs=${S1}&list=new&q=NN`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-disposition')).toContain('in2sight-shop.one-new-2026-10-20.xlsx');
    expect(values(state.written[0][0]).slice(1).map((r) => r[0])).toEqual(['ann.b']); // "NN" → lower-cased search; dan and ann.b are new, only ann.b matches
    expect(state.order[0]).toBe('assertOwner');
    expect(state.order).not.toContain('ADMIN');
  });

  it('every list, sorted as on screen (newest follow first, unknown last)', async () => {
    await call(`account=${ACC}&snap=${S2}&list=iDontFollow`);
    expect(values(state.written[0][0]).slice(1).map((r) => r[0])).toEqual(['ann.b', 'bob']);
  });

  it('a stranger gets 401 before anything is read', async () => {
    state.owner = false;
    const res = await call(`account=${ACC}&snap=${S2}&list=new`);
    expect([res.status, await res.json()]).toEqual([401, { error: 'unauthorized' }]);
    expect(state.order).toEqual(['assertOwner']);
  });

  it.each([
    ['no parameters', ''],
    ['an unknown key', `account=${ACC}&snap=${S2}&list=new&from=2026-01-01`],
    ['a repeated key', `account=${ACC}&snap=${S2}&list=new&list=lost`],
    ['a bad account id', `account=x&snap=${S2}&list=new`],
    ['a bad snapshot id', `account=${ACC}&snap=${S2}'--&list=new`],
    ['an unknown list', `account=${ACC}&snap=${S2}&list=everyone`],
    ['a list these snapshots cannot answer', `account=${ACC}&snap=${S1}&list=mutual`],
  ])('%s → 400 bad_params', async (_n, q) => {
    const res = await call(q);
    expect([res.status, await res.json()]).toEqual([400, { error: 'bad_params' }]);
    expect(state.written).toEqual([]);
  });

  it('another account, an archived one, an unknown snapshot or the migration missing → 404', async () => {
    const q = `account=${ACC}&snap=${S2}&list=new`;
    state.account = { id: ACC, username: 'shop.one', status: 'archived' };
    expect((await call(q)).status).toBe(404);
    state.account = { id: ACC, username: 'shop.one', status: 'active' };
    expect((await call(`account=${ACC}&snap=00000000-0000-4000-8000-000000000009&list=new`)).status).toBe(404);
    state.snapshots = null;
    expect((await call(q)).status).toBe(404);
    state.account = null;
    expect((await call(q)).status).toBe(404);
  });
});
