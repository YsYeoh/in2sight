import { describe, expect, it } from 'vitest';
import { audienceRow } from '@/lib/dashboard/detail-read';
import { BREAKDOWN_LIMIT, DAY_COUNT_LIMIT, loadAudienceEnds, loadCommentDays, loadFollowerCurve, loadReachBreakdown, loadStoryDays } from '@/lib/dashboard/growth-read';

type Call = { table: string; select: string; ops: unknown[][] };
type Result = { data?: unknown; error?: unknown };

/** Fake Supabase client: chained calls are recorded; an awaited query resolves to the next result queued for its table; rpc() to the next one queued under `rpc:<name>`. */
function fakeDb(results: Record<string, Result[]>) {
  const calls: Call[] = [];
  const next = (key: string) => Promise.resolve(results[key]?.shift() ?? { data: [], error: null });
  const db = {
    from(table: string) {
      const call: Call = { table, select: '', ops: [] };
      calls.push(call);
      const chain: Record<string, unknown> = {};
      chain.select = (s: string) => ((call.select = s), chain);
      for (const op of ['eq', 'gte', 'lte', 'lt', 'order', 'limit', 'range']) chain[op] = (...a: unknown[]) => (call.ops.push([op, ...a]), chain);
      chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => next(table).then(res, rej);
      return chain;
    },
    rpc(name: string, args: unknown) {
      calls.push({ table: `rpc:${name}`, select: '', ops: [['args', args]] });
      return next(`rpc:${name}`);
    },
  };
  return { db: db as never, calls };
}

const KL = 'Asia/Kuala_Lumpur'; // UTC+8, no DST

describe('loadReachBreakdown', () => {
  it('reach rows of one account and day window, newest first, paged; non-numeric values dropped', async () => {
    const f = fakeDb({ account_daily_breakdown: [{ data: [{ day: '2026-10-14', follow_type: 'FOLLOWER', product_type: 'REEL', value: 120 }, { day: '2026-10-14', follow_type: 'NON_FOLLOWER', product_type: 'REEL', value: 'x' }] }] });
    expect(await loadReachBreakdown(f.db, 'a1', '2026-07-01', '2026-10-14')).toEqual([{ day: '2026-10-14', followType: 'FOLLOWER', productType: 'REEL', value: 120 }]);
    const c = f.calls[0];
    expect(c.select).toBe('day,follow_type,product_type,value');
    expect(c.ops).toEqual(expect.arrayContaining([['eq', 'account_id', 'a1'], ['eq', 'metric', 'reach'], ['gte', 'day', '2026-07-01'], ['lte', 'day', '2026-10-14'], ['order', 'day', { ascending: false }], ['range', 0, 999]]));
  });

  it('a read capped at BREAKDOWN_LIMIT drops its oldest day (it may be cut: FOLLOWER rows without their NON_FOLLOWER rows)', async () => {
    const page = (n: number, day: string) => ({ data: Array.from({ length: n }, () => ({ day, follow_type: 'FOLLOWER', product_type: 'REEL', value: 1 })) });
    const pages = [...Array.from({ length: 19 }, () => page(1000, '2026-10-14')), { data: [...page(500, '2026-10-14').data, ...page(500, '2026-10-13').data] }];
    const rows = await loadReachBreakdown(fakeDb({ account_daily_breakdown: pages }).db, 'a1', '2026-07-01', '2026-10-14');
    expect(BREAKDOWN_LIMIT).toBe(20_000);
    expect(rows).toHaveLength(19_500);
    expect(rows.every((r) => r.day === '2026-10-14')).toBe(true);
  });

  it('a database error becomes a fixed message', async () => {
    const f = fakeDb({ account_daily_breakdown: [{ error: { message: 'secret' } }] });
    await expect(loadReachBreakdown(f.db, 'a1', '2026-07-01', '2026-10-14')).rejects.toThrow(/^dashboard read: reach breakdown failed$/);
  });
});

describe('loadFollowerCurve', () => {
  it('the hourly curve from explorer_followers (owner timezone); junk rows dropped', async () => {
    const f = fakeDb({ 'rpc:explorer_followers': [{ data: [{ at: '2026-10-14T09:00', followers: 1200 }, { at: null, followers: 3 }, { at: '2026-10-14T10:00', followers: null }] }] });
    expect(await loadFollowerCurve(f.db, 'a1', '2026-10-07T16:00:00.000Z', '2026-10-14T16:00:00.000Z', KL)).toEqual([{ at: '2026-10-14T09:00', followers: 1200 }]);
    expect(f.calls[0].ops[0]).toEqual(['args', { p_account: 'a1', p_from: '2026-10-07T16:00:00.000Z', p_to: '2026-10-14T16:00:00.000Z', p_tz: KL, p_hourly: true }]);
  });

  it('a missing function is null (the tab falls back to daily points); any other error throws a fixed message', async () => {
    expect(await loadFollowerCurve(fakeDb({ 'rpc:explorer_followers': [{ error: { code: 'PGRST202' } }] }).db, 'a1', 'x', 'y', KL)).toBeNull();
    await expect(loadFollowerCurve(fakeDb({ 'rpc:explorer_followers': [{ error: { code: '500', message: 'secret' } }] }).db, 'a1', 'x', 'y', KL)).rejects.toThrow(/^dashboard read: follower curve failed$/);
  });
});

describe('loadStoryDays / loadCommentDays', () => {
  it('counts by owner-timezone day (23:30 and 00:30 local fall on different days); a complete read has from = null', async () => {
    const f = fakeDb({ media: [{ data: [{ posted_at: '2026-10-13T16:30:00Z' }, { posted_at: '2026-10-13T16:10:00Z' }, { posted_at: '2026-10-13T15:30:00Z' }] }] });
    expect(await loadStoryDays(f.db, 'a1', '2026-10-01T16:00:00Z', '2026-10-14T16:00:00Z', KL)).toEqual({ days: { '2026-10-14': 2, '2026-10-13': 1 }, from: null });
    expect(f.calls[0].select).toBe('posted_at');
    expect(f.calls[0].ops).toEqual(expect.arrayContaining([['eq', 'account_id', 'a1'], ['eq', 'media_type', 'STORY'], ['gte', 'posted_at', '2026-10-01T16:00:00Z'], ['lt', 'posted_at', '2026-10-14T16:00:00Z'], ['order', 'posted_at', { ascending: false }]]));
  });

  it('a read capped at DAY_COUNT_LIMIT (newest first) says from which day the counts are complete', async () => {
    const page = (day: number) => ({ data: Array.from({ length: 1000 }, () => ({ commented_at: `2026-10-${day}T04:00:00Z` })) });
    const f = fakeDb({ comments: [page(14), page(13), page(12), page(11), page(10)] });
    const out = await loadCommentDays(f.db, 'a1', '2026-09-01T16:00:00Z', '2026-10-14T16:00:00Z', KL);
    expect(DAY_COUNT_LIMIT).toBe(5000);
    expect(out.from).toBe('2026-10-11'); // 10 October may be cut off: unknown, not 1,000
    expect(out.days['2026-10-14']).toBe(1000);
    expect(out.days['2026-10-10']).toBeUndefined();
    expect(f.calls).toHaveLength(5);
    expect(f.calls[0].select).toBe('commented_at');
    expect(f.calls[0].ops).toEqual(expect.arrayContaining([['eq', 'account_id', 'a1'], ['order', 'commented_at', { ascending: false }]]));
  });

  it('orders by time, then by the unique id, so paging never skips or repeats a row at a page boundary', async () => {
    const f = fakeDb({ media: [{ data: [] }], comments: [{ data: [] }] });
    await loadStoryDays(f.db, 'a1', 'x', 'y', KL);
    await loadCommentDays(f.db, 'a1', 'x', 'y', KL);
    for (const c of f.calls) expect(c.ops.filter((o) => o[0] === 'order').map((o) => o[1])).toEqual([c.select, 'id']);
  });

  it('errors become fixed messages', async () => {
    await expect(loadStoryDays(fakeDb({ media: [{ error: { message: 's' } }] }).db, 'a1', 'x', 'y', KL)).rejects.toThrow(/^dashboard read: story days failed$/);
    await expect(loadCommentDays(fakeDb({ comments: [{ error: { message: 's' } }] }).db, 'a1', 'x', 'y', KL)).rejects.toThrow(/^dashboard read: comment days failed$/);
  });
});

describe('loadAudienceEnds', () => {
  it('per kind: the first and the latest snapshot inside the day window (6 single-row reads)', async () => {
    const snap = (day: string, data: unknown) => ({ data: [{ day, data }] });
    const f = fakeDb({
      audience_snapshots: [snap('2026-09-16', { '18-24|F': 10 }), snap('2026-10-14', { '18-24|F': 12, '25-34|M': 'x' }), snap('2026-09-16', { MY: 40 }), snap('2026-10-14', { MY: 50 }), { data: [] }, { data: [] }],
    });
    const out = await loadAudienceEnds(f.db, 'a1', '2026-09-15', '2026-10-14');
    expect(out.first).toEqual({ age_gender: { day: '2026-09-16', data: { '18-24|F': 10 } }, country: { day: '2026-09-16', data: { MY: 40 } }, city: null });
    expect(out.last).toEqual({ age_gender: { day: '2026-10-14', data: { '18-24|F': 12 } }, country: { day: '2026-10-14', data: { MY: 50 } }, city: null });
    expect(f.calls.map((c) => [c.ops[1], c.ops.find((o) => o[0] === 'order')])).toEqual([
      [['eq', 'kind', 'age_gender'], ['order', 'day', { ascending: true }]],
      [['eq', 'kind', 'age_gender'], ['order', 'day', { ascending: false }]],
      [['eq', 'kind', 'country'], ['order', 'day', { ascending: true }]],
      [['eq', 'kind', 'country'], ['order', 'day', { ascending: false }]],
      [['eq', 'kind', 'city'], ['order', 'day', { ascending: true }]],
      [['eq', 'kind', 'city'], ['order', 'day', { ascending: false }]],
    ]);
    for (const c of f.calls) expect(c.ops).toEqual(expect.arrayContaining([['gte', 'day', '2026-09-15'], ['lte', 'day', '2026-10-14'], ['limit', 1]]));
  });

  it('audienceRow: no row or a non-object payload is null; non-numeric counts are dropped', () => {
    expect(audienceRow(undefined)).toBeNull();
    expect(audienceRow({ day: '2026-10-14', data: [1, 2] })).toBeNull();
    expect(audienceRow({ day: '2026-10-14', data: { MY: 3, XX: '4' } })).toEqual({ day: '2026-10-14', data: { MY: 3 } });
  });
});
