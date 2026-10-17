import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { calls, fail, rec, capped } = vi.hoisted(() => {
  const calls: unknown[][] = [];
  const fail = { op: '' };
  const capped = new Set<unknown>(); // account ids whose Stories hit STORY_LIMIT
  const rec =
    (op: string, value: unknown) =>
    async (...args: unknown[]) => {
      calls.push([op, ...args.slice(1)]); // drop the db argument
      if (fail.op === op) throw new Error(`dashboard read: ${op} failed`);
      return value;
    };
  return { calls, fail, rec, capped };
});

vi.mock('@/lib/dashboard/read', () => ({ loadDaily: rec('daily', [{ day: '2026-10-14' }]) }));
vi.mock('@/lib/dashboard/detail-read', () => ({
  loadPostRows: rec('posts', [{ id: 'p' }]),
  loadStories: async (...args: unknown[]) => ({ ...((await rec('stories', { stories: [{ id: 's' }] })(...args)) as object), truncated: capped.has(args[1]) }),
  loadAudience: rec('audience', { age_gender: null, country: null, city: null }),
  loadOnline: rec('online', { x: [] }),
  loadTags: rec('tags', [{ id: 't', name: 'T', color: 'chart-1' }]),
}));
vi.mock('@/lib/sync/store', () => ({ listSyncStatus: rec('sync', {}) }));

import { loadExportData } from '@/lib/export/read';
import { parseTimeScope } from '@/lib/time-scope/scope';
import { A, acct, B } from './fixtures/export-data';

const db = {} as SupabaseClient;
beforeEach(() => {
  calls.length = 0;
  fail.op = '';
  capped.clear();
});

const time = (q: string) => parseTimeScope(new URLSearchParams(q));

describe('loadExportData', () => {
  it('reads each account through the owner-session readers with the right windows', async () => {
    const accounts = [acct(A, 'a'), acct(B, 'b')];
    const d = await loadExportData(db, accounts, { time: time('from=7d'), today: '2026-10-15', tz: 'Asia/Kuala_Lumpur' });
    expect(d.accounts).toBe(accounts);
    expect(Object.keys(d.daily)).toEqual([A, B]);
    expect(d.posts[B]).toEqual([{ id: 'p' }]);
    expect(d.tags).toHaveLength(1);
    expect(d.scope).toMatchObject({ preset: '7d', range: { from: '2026-10-09', to: '2026-10-15' }, earliest: '2026-10-14' });
    expect(calls).toContainEqual(['daily', A, '2026-09-27']); // readFrom(7d): both windows + lag, at least the reach-drop days
    expect(calls).toContainEqual(['posts', A, '2026-09-26T16:00:00.000Z']); // every post back to that day (Kuala Lumpur midnight)
    expect(calls).toContainEqual(['stories', B, '2026-10-08T16:00:00.000Z', '2026-10-15T16:00:00.000Z']); // [2026-10-09, 2026-10-16) 00:00 in Kuala Lumpur
    expect(d.stories[A]).toEqual([{ id: 's' }]);
    expect(calls).toContainEqual(['online', [A, B], '2026-09-15']);
    expect(calls.filter((c) => c[0] === 'audience')).toHaveLength(2);
  });

  it('says which accounts hit the Stories cap (the rest of their Stories are not in the export)', async () => {
    capped.add(B);
    const d = await loadExportData(db, [acct(A, 'a'), acct(B, 'b')], { time: time('from=7d'), today: '2026-10-15', tz: 'UTC' });
    expect(d.storiesTruncated).toEqual([B]);
    capped.clear();
    expect((await loadExportData(db, [acct(A, 'a'), acct(B, 'b')], { time: time('from=7d'), today: '2026-10-15', tz: 'UTC' })).storiesTruncated).toEqual([]);
  });

  it('no accounts: only the shared reads, empty maps', async () => {
    const d = await loadExportData(db, [], { time: time(''), today: '2026-10-15', tz: 'UTC' });
    expect(d.daily).toEqual({});
    expect(calls.map((c) => c[0]).sort()).toEqual(['online', 'sync', 'tags']);
  });

  it('a failed read rejects with the fixed message (the route maps it to an error key)', async () => {
    fail.op = 'stories';
    await expect(loadExportData(db, [acct(A, 'a')], { time: time('from=7d'), today: '2026-10-15', tz: 'UTC' })).rejects.toThrow('dashboard read: stories failed');
  });

  it('a fixed month: Stories of that month only, in the owner timezone', async () => {
    await loadExportData(db, [acct(A, 'a')], { time: time('from=2026-09-01&to=2026-09-30'), today: '2026-10-15', tz: 'Asia/Kuala_Lumpur' });
    expect(calls).toContainEqual(['stories', A, '2026-08-31T16:00:00.000Z', '2026-09-30T16:00:00.000Z']);
  });
});
