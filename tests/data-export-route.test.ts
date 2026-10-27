// @vitest-environment node
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PREFS } from '@/lib/prefs';

const state = vi.hoisted(() => ({ owner: true, tables: [] as string[], pages: [] as unknown[][], fail: false, admin: 0 }));
vi.mock('@/lib/auth/assert-owner', () => ({
  assertOwner: async (h?: Headers) => {
    h?.set('cache-control', 'private, no-store');
    return state.owner;
  },
}));
vi.mock('@/lib/prefs.server', () => ({ getPrefs: async () => ({ ...DEFAULT_PREFS, timezone: 'UTC' }) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabase: () => (state.admin++, {}) }));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: async () => ({
    from(table: string) {
      state.tables.push(table);
      const q = { select: () => q, order: () => q, or: () => q, limit: async () => (state.fail ? { data: null, error: { message: 'row secret' } } : { data: state.pages.shift() ?? [], error: null }) };
      return q;
    },
  }),
}));

import { GET } from '@/app/api/export/data/route';

const get = (qs: string) => GET(new NextRequest(new URL(`/api/export/data?${qs}`, 'https://app.test')));
beforeEach(() => {
  state.owner = true;
  state.tables = [];
  state.pages = [];
  state.fail = false;
  state.admin = 0;
});

describe('GET /api/export/data', () => {
  it('401 for anyone but the owner, uncached, nothing read', async () => {
    state.owner = false;
    const res = await get('table=media');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(state.tables).toEqual([]);
  });

  it.each(['', 'table=account_tokens', 'table=push_subscriptions', 'table=sync_runs', 'table=media&table=tags', 'table=media&x=1', 'table=Media', 'table=media%00'])('400 for %s, nothing read', async (qs) => {
    const res = await get(qs);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'bad_params' });
    expect(state.tables).toEqual([]);
  });

  it('streams the whole table as one JSON array file, private and uncached, on the owner session (never the admin client)', async () => {
    state.pages = [[{ id: 'a' }, { id: 'b' }], [{ id: 'c' }], []];
    const res = await get('table=media');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="in2sight-media-\d{4}-\d{2}-\d{2}\.json"/);
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(JSON.parse(await res.text())).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    expect(state.tables).toEqual(['media', 'media', 'media']);
    expect(state.admin).toBe(0);
  });

  it('a read failure breaks the download instead of saving a partial file, and never leaks the error', async () => {
    state.fail = true;
    const res = await get('table=comments');
    expect(res.status).toBe(200); // headers are already sent when the first page is read
    await expect(res.text()).rejects.toThrow(/^export failed$/);
  });
});
