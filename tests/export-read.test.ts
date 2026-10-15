import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { calls, fail, rec } = vi.hoisted(() => {
  const calls: unknown[][] = [];
  const fail = { op: '' };
  const rec =
    (op: string, value: unknown) =>
    async (...args: unknown[]) => {
      calls.push([op, ...args.slice(1)]); // drop the db argument
      if (fail.op === op) throw new Error(`dashboard read: ${op} failed`);
      return value;
    };
  return { calls, fail, rec };
});

vi.mock('@/lib/dashboard/read', () => ({ loadDaily: rec('daily', [{ day: '2026-10-14' }]) }));
vi.mock('@/lib/dashboard/detail-read', () => ({
  loadPostRows: rec('posts', [{ id: 'p' }]),
  loadStories: rec('stories', [{ id: 's' }]),
  loadAudience: rec('audience', { age_gender: null, country: null, city: null }),
  loadOnline: rec('online', { x: [] }),
  loadTags: rec('tags', [{ id: 't', name: 'T', color: 'chart-1' }]),
}));
vi.mock('@/lib/sync/store', () => ({ listSyncStatus: rec('sync', {}) }));

import { exportWindow } from '@/lib/export/params';
import { loadExportData } from '@/lib/export/read';
import { A, acct, B } from './fixtures/export-data';

const db = {} as SupabaseClient;
beforeEach(() => {
  calls.length = 0;
  fail.op = '';
});

describe('exportWindow', () => {
  it('is the last N days including today', () => {
    expect(exportWindow(7, '2026-10-15')).toEqual({ from: '2026-10-09', to: '2026-10-15' });
    expect(exportWindow(30, '2026-03-01')).toEqual({ from: '2026-01-31', to: '2026-03-01' });
  });
});

describe('loadExportData', () => {
  it('reads each account through the owner-session readers with the right windows', async () => {
    const accounts = [acct(A, 'a'), acct(B, 'b')];
    const d = await loadExportData(db, accounts, { period: 7, today: '2026-10-15', tz: 'Asia/Kuala_Lumpur' });
    expect(d.accounts).toBe(accounts);
    expect(Object.keys(d.daily)).toEqual([A, B]);
    expect(d.posts[B]).toEqual([{ id: 'p' }]);
    expect(d.tags).toHaveLength(1);
    expect(calls).toContainEqual(['daily', A, '2026-09-29']); // fromDayFor(7): two windows + 2 days lag
    expect(calls).toContainEqual(['stories', B, '2026-10-08T16:00:00.000Z']); // 2026-10-09 00:00 in Kuala Lumpur
    expect(calls).toContainEqual(['online', [A, B], '2026-09-15']);
    expect(calls.filter((c) => c[0] === 'audience')).toHaveLength(2);
  });

  it('no accounts: only the shared reads, empty maps', async () => {
    const d = await loadExportData(db, [], { period: 30, today: '2026-10-15', tz: 'UTC' });
    expect(d.daily).toEqual({});
    expect(calls.map((c) => c[0]).sort()).toEqual(['online', 'sync', 'tags']);
  });

  it('a failed read rejects with the fixed message (the route maps it to an error key)', async () => {
    fail.op = 'stories';
    await expect(loadExportData(db, [acct(A, 'a')], { period: 7, today: '2026-10-15', tz: 'UTC' })).rejects.toThrow('dashboard read: stories failed');
  });
});
