// @vitest-environment node
import { strFromU8, unzipSync } from 'fflate';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PREFS, type Prefs } from '@/lib/prefs';
import { A, sampleData, TZ } from './fixtures/export-data';

const state = vi.hoisted(() => ({ owner: true, prefs: null as Prefs | null, loads: 0, failRead: false }));
vi.mock('@/lib/auth/assert-owner', () => ({
  assertOwner: async (h?: Headers) => {
    h?.set('cache-control', 'private, no-store');
    return state.owner;
  },
}));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: async () => ({}) }));
vi.mock('@/lib/prefs.server', () => ({ getPrefs: async () => state.prefs }));
vi.mock('@/lib/accounts/supabase-store', async () => {
  const { sampleData: s } = await import('./fixtures/export-data');
  return { supabaseAccountsStore: () => ({ list: async () => s().accounts }) };
});
vi.mock('@/lib/export/read', async (orig) => ({
  ...(await orig<object>()),
  loadExportData: async (_db: unknown, accounts: { id: string }[]) => {
    state.loads++;
    if (state.failRead) throw new Error('dashboard read: posts failed secret-row-value');
    const d = (await import('./fixtures/export-data')).sampleData();
    return { ...d, accounts: d.accounts.filter((a) => accounts.some((x) => x.id === a.id)) };
  },
}));

import { GET } from '@/app/api/export/xlsx/route';

const get = (qs: string) => GET(new NextRequest(new URL(`/api/export/xlsx?${qs}`, 'https://app.test')));
beforeEach(() => {
  state.owner = true;
  state.prefs = { ...DEFAULT_PREFS, timezone: TZ };
  state.loads = 0;
  state.failRead = false;
});

describe('GET /api/export/xlsx', () => {
  it('401 for anyone but the owner, uncached, nothing read', async () => {
    state.owner = false;
    const res = await get('scope=all&period=30');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(state.loads).toBe(0);
  });

  it('400 bad_params for anything off the allow-list, before any read', async () => {
    for (const qs of ['', 'scope=all', 'scope=all&period=365', 'scope=a:not-a-uuid&period=7', 'scope=all&scope=all&period=7']) {
      const res = await get(qs);
      expect(res.status, qs).toBe(400);
      expect(await res.json()).toEqual({ error: 'bad_params' });
    }
    expect(state.loads).toBe(0);
  });

  it('404 not_found for a group or account that does not exist', async () => {
    expect((await get('scope=g:Nope&period=7')).status).toBe(404);
    expect((await get('scope=a:44444444-4444-4444-8444-444444444444&period=7')).status).toBe(404);
  });

  it('200: an .xlsx attachment named after the scope, private + no-store, six sheets', async () => {
    const res = await get(`scope=a:${A}&period=30`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="in2sight-brand.one-\d{4}-\d{2}-\d{2}\.xlsx"; filename\*=UTF-8''in2sight-%40brand\.one-/);
    const zip = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const wb = strFromU8(zip['xl/workbook.xml']);
    for (const n of ['Summary', 'Daily', 'Posts', 'Stories', 'Audience', 'Tags']) expect(wb).toContain(`name="${n}"`);
  });

  it('headers and sheet names follow the owner language', async () => {
    state.prefs = { ...DEFAULT_PREFS, locale: 'zh-CN', timezone: TZ };
    const zip = unzipSync(new Uint8Array(await (await get('scope=all&period=7')).arrayBuffer()));
    expect(strFromU8(zip['xl/workbook.xml'])).toContain('name="概要"');
    expect(strFromU8(zip['xl/sharedStrings.xml'])).toContain('全部账号'); // the totals row label
  });

  it('a failed read is a 500 with a fixed key; the error text is neither returned nor logged', async () => {
    state.failRead = true;
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await get('scope=all&period=7');
    expect(res.status).toBe(500);
    expect(await res.text()).toBe('{"error":"unexpected"}');
    expect(log).toHaveBeenCalledWith('xlsx export failed');
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret-row-value');
    log.mockRestore();
  });

  it('hostile account names only reach the file name through the sanitiser', async () => {
    const res = await get(`scope=a:${sampleData().accounts[1].id}&period=7`);
    const cd = res.headers.get('content-disposition')!;
    expect(cd).toContain('filename="in2sight-brand-two-');
    expect(cd).not.toMatch(/[/\r\n]|"[^;]*"[^;]*"/);
  });
});
