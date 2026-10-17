import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import en from '@/messages/en.json';
import type { StoredAccount } from '@/lib/accounts/types';
import { rowLabel, type LabelContext } from '@/lib/explorer/labels';
import { loadExplorer } from '@/lib/explorer/load';
import { translator } from '@/lib/export/workbook';
import type { FormatPrefs } from '@/lib/format';
const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'aaaaaaaa-0000-4000-8000-000000000002';
const C = 'aaaaaaaa-0000-4000-8000-000000000003';
const acct = (id: string, username: string, groupName: string | null, status: StoredAccount['status'] = 'active'): StoredAccount => ({ id, igUserId: id, username, displayName: null, accountType: null, profilePictureUrl: null, groupName, status, archivedAt: status === 'archived' ? '2026-01-01T00:00:00Z' : null, lastError: null, tokenExpiresAt: null, connectedAt: '2026-01-01T00:00:00Z' });
const ACCOUNTS = [acct(B, 'beta', 'Food'), acct(A, 'alpha', 'Food'), acct(C, 'gamma', null, 'archived')];
const SYNC = { [A]: { lastSuccessAt: null, lastErrorKey: null, consecutiveFailures: 0, dailyDoneThrough: '2026-10-15' } };
const O = { today: '2026-10-17', tz: 'UTC', weekStart: 'mon' as const, accounts: ACCOUNTS, sync: SYNC };

/** Owner-session fake: records table/rpc calls; resolves each name to its result. */
function fakeDb(results: Record<string, { data?: unknown; error?: unknown }> = {}) {
  const calls: unknown[][] = [];
  const chainFor = (name: string) => {
    const chain: Record<string, unknown> = {};
    for (const op of ['select', 'eq', 'in', 'order', 'limit']) chain[op] = (...a: unknown[]) => (calls.push([op, ...a]), chain);
    chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(results[name] ?? { data: [], error: null }).then(res, rej);
    return chain;
  };
  return { db: { from: (t: string) => (calls.push(['from', t]), chainFor(t)), rpc: (n: string, a: unknown) => (calls.push(['rpc', n, a]), chainFor(n)) } as unknown as SupabaseClient, calls };
}
const rpcs = (calls: unknown[][]) => calls.filter((c) => c[0] === 'rpc').map((c) => [c[1], (c[2] as { p_from: string }).p_from, (c[2] as { p_to: string }).p_to]);

describe('loadExplorer', () => {
  it('archived accounts are hidden; the window ends on the settled day; the comparison is a second rollup', async () => {
    const { db, calls } = fakeDb({ explorer_daily: { data: [{ key: A, reach: 10 }], error: null }, account_daily: { data: [{ day: '2026-01-01' }], error: null } });
    const d = await loadExplorer(db, { m: 'reach' }, O);
    expect(d.live.map((a) => a.username)).toEqual(['alpha', 'beta']);
    expect(d.groups).toEqual(['Food']);
    expect(d.window).toEqual({ current: { from: '2026-09-16', to: '2026-10-15' }, compare: { from: '2026-08-17', to: '2026-09-15' } });
    expect(rpcs(calls)).toEqual([['explorer_daily', '2026-09-16', '2026-10-15'], ['explorer_daily', '2026-08-17', '2026-09-15']]);
    expect(d.model.rows.map((r) => [r.key, r.values.reach?.value])).toEqual([[A, 10], [B, null]]);
  });

  it('account and group filters intersect; an unknown or archived id is simply not in scope', async () => {
    const { db } = fakeDb();
    expect((await loadExplorer(db, { acc: `${A},${C}`, grp: 'Food' }, O)).accounts.map((a) => a.id)).toEqual([A]);
    expect((await loadExplorer(db, { grp: 'Nope' }, O)).accounts).toEqual([]);
  });

  it('daily buckets over ~2.5 years would pass the 1,000-row cap: one grain, weekly, for the query, the model and the labels', async () => {
    const first = { account_daily: { data: [{ day: '2020-01-01' }], error: null } };
    const long = fakeDb(first);
    const d = await loadExplorer(long.db, { m: 'reach,posts', by: 'time', from: '2022-01-01', to: '2026-10-01', gran: 'day', cmp: 'none' }, O);
    const grains = long.calls.filter((c) => c[0] === 'rpc').map((c) => (c[2] as { p_grain: string }).p_grain);
    expect(grains).toEqual(['week', 'week']); // explorer_daily and explorer_posts
    expect(d.scope.gran).toBe('week'); // ExplorerView labels and drills with this
    expect(d.model.rows[0].key).toBe('2021-12-27'); // Monday of the first week, not a day
    expect(d.model.rows.length).toBe(Math.ceil((Date.parse('2026-10-05') - Date.parse('2021-12-27')) / (7 * 86_400_000)));
    const short = fakeDb(first);
    const s = await loadExplorer(short.db, { m: 'reach', by: 'time', from: '2026-01-01', to: '2026-10-01', gran: 'day', cmp: 'none' }, O);
    expect(short.calls.filter((c) => c[0] === 'rpc').map((c) => (c[2] as { p_grain: string }).p_grain)).toEqual(['day']);
    expect(s.scope.gran).toBe('day');
    expect(s.model.rows[0].key).toBe('2026-01-01');
  });

  it('single posts read the capped list (no rollup); the item level reads only the item', async () => {
    const posts = fakeDb({ explorer_media: { data: [{ id: 'm1', account_id: A, media_type: 'IMAGE', posted_at: '2026-10-01T00:00:00Z', permalink: null, caption: null, reach: 5, views: null, likes: 1, comments: 0, saves: 0, shares: 0 }], error: null } });
    const d = await loadExplorer(posts.db, { by: 'post', from: '7d', cmp: 'none' }, O);
    expect(rpcs(posts.calls).map((c) => c[0])).toEqual(['explorer_media']);
    expect(d.model.rows.map((r) => r.key)).toEqual(['m1']);
    const item = fakeDb();
    const i = await loadExplorer(item.db, { item: '42' }, O);
    expect(i.item).toBeNull(); // not found in the fake: the page shows "not in your accounts"
    expect(rpcs(item.calls)).toEqual([]);
    expect(item.calls).toContainEqual(['eq', 'id', '42']);
  });
});

describe('rowLabel', () => {
  const t = translator('en');
  const P: FormatPrefs = { locale: 'en', dateFormat: 'D MMM YYYY', timeFormat: '24h', numberFormat: '1,234.5', timezone: 'UTC' };
  const c: LabelContext = { accounts: [{ id: A, username: 'alpha', groupName: 'Food' }], tags: [{ id: 't1', name: 'Promo', color: 'chart-1' }], items: [{ id: 'm1', accountId: A, mediaType: 'REELS', postedAt: '2026-10-05T09:30:00Z', permalink: null, caption: null, reach: null, views: null, likes: null, comments: null, saves: null, shares: null }], gran: 'week' };

  it('reads the same on screen and in the file', () => {
    expect(rowLabel('account', A, c, t, P)).toBe('@alpha');
    expect(rowLabel('group', 'g:Food', c, t, P)).toBe('Food');
    expect(rowLabel('group', `a:${A}`, c, t, P)).toBe('@alpha');
    expect(rowLabel('format', 'CAROUSEL_ALBUM', c, t, P)).toBe(en.analysis.format.CAROUSEL_ALBUM);
    expect(rowLabel('tag', 't1', c, t, P)).toBe('Promo');
    expect(rowLabel('tag', 'untagged', c, t, P)).toBe(en.explorer.untagged);
    expect(rowLabel('tag', 'gone', c, t, P)).toBe(en.explorer.deletedTag);
    expect(rowLabel('weekday', '0', c, t, P)).toBe('Sun');
    expect(rowLabel('hour', '9', c, t, P)).toBe('09:00');
    expect(rowLabel('time', '2026-10-05', c, t, P)).toBe('Week of 5 Oct 2026');
    expect(rowLabel('time', '2026-10-01', { ...c, gran: 'month' }, t, P)).toBe('October 2026');
    expect(rowLabel('post', 'm1', c, t, P)).toBe('Reel · 5 Oct 2026 09:30');
  });
});
