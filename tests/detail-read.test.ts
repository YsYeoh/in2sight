import { describe, expect, it } from 'vitest';
import { CALENDAR_LIMIT, loadAudience, loadMonthMedia, loadOnline, loadPostPage, loadPostRows, loadStories, loadStoryPage, loadTags, STORY_LIMIT, type PostPageArgs, type StoryPageArgs } from '@/lib/dashboard/detail-read';
import { MEDIA_LIMIT } from '@/lib/dashboard/read';

type Call = { table: string; select: string; ops: unknown[][] };

/** Fake Supabase client: every chained call is recorded; an awaited query resolves to the next result queued for its table. */
function fakeDb(results: Record<string, { data?: unknown; error?: unknown }[]>) {
  const calls: Call[] = [];
  const db = {
    from(table: string) {
      const call: Call = { table, select: '', ops: [] };
      calls.push(call);
      const chain: Record<string, unknown> = {};
      chain.select = (s: string) => ((call.select = s), chain);
      for (const op of ['eq', 'neq', 'gte', 'lt', 'in', 'order', 'limit', 'range']) chain[op] = (...a: unknown[]) => (call.ops.push([op, ...a]), chain);
      chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(results[table]?.shift() ?? { data: [], error: null }).then(res, rej);
      return chain;
    },
  };
  return { db: db as never, calls };
}

const noStar = (calls: Call[]) => calls.forEach((c) => expect(c.select).not.toContain('*'));

describe('loadPostRows', () => {
  it('feed posts with latest metrics, caption and tag ids; null caption and permalink survive', async () => {
    const f = fakeDb({
      media: [
        {
          data: [
            { id: 'm1', account_id: 'a1', media_type: 'REELS', posted_at: '2026-10-10T10:00:00Z', permalink: null, caption: null, cover_status: 'ok', children_count: 4, media_metrics: [{ reach: 50, likes: 3 }], media_tags: [{ tag_id: 't1' }, { tag_id: null }] },
            { id: 'm2', account_id: 'a1', media_type: 'IMAGE', posted_at: '2026-10-09T10:00:00Z', permalink: 'https://www.instagram.com/p/x/', caption: 'Hello', media_metrics: [], media_tags: null },
            { id: 'bad', account_id: 'a1', media_type: 'VIDEO', posted_at: '2026-10-09T10:00:00Z' },
          ],
        },
      ],
    });
    const rows = await loadPostRows(f.db, 'a1');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: 'm1', caption: null, permalink: null, reach: 50, tagIds: ['t1'], cover: 'ok', slides: 4 });
    expect(rows[1]).toMatchObject({ id: 'm2', caption: 'Hello', reach: null, tagIds: [], cover: 'pending', slides: null }); // no status read = never requested
    expect(f.calls[0].select).toContain('media_tags(tag_id)');
    expect(f.calls[0].select).toContain('cover_status,children_count');
    expect(f.calls[0].ops).toContainEqual(['neq', 'media_type', 'STORY']);
    expect(f.calls[0].ops).toContainEqual(['range', 0, MEDIA_LIMIT - 1]);
    expect(f.calls[0].ops).toContainEqual(['limit', 1, { referencedTable: 'media_metrics' }]);
    noStar(f.calls);
  });

  it('throws a fixed message that never echoes the database error', async () => {
    const f = fakeDb({ media: [{ error: { message: 'secret detail' } }] });
    await expect(loadPostRows(f.db, 'a1')).rejects.toThrow(/^dashboard read: post rows failed$/);
  });
});

describe('loadStories', () => {
  it('stories in [from, to) with every snapshot oldest first; a story without snapshots keeps an empty list', async () => {
    const f = fakeDb({
      media: [
        {
          data: [
            { id: 's1', posted_at: '2026-10-14T08:00:00Z', expires_at: '2026-10-15T08:00:00Z', permalink: null, cover_status: 'ok', media_metrics: [{ captured_at: '2026-10-14T08:30:00Z', views: 10, exits: 1, total_interactions: 2 }] },
            { id: 's2', posted_at: '2026-10-13T08:00:00Z', expires_at: null, permalink: null, media_metrics: [] },
          ],
        },
      ],
    });
    const { stories: out, truncated } = await loadStories(f.db, 'a1', '2026-10-01T00:00:00.000Z', '2026-10-15T16:00:00.000Z');
    expect(out[0].snapshots[0]).toEqual({ capturedAt: '2026-10-14T08:30:00Z', reach: null, views: 10, replies: null, shares: null, interactions: 2, tapsForward: null, tapsBack: null, exits: 1 });
    expect(out[1].snapshots).toEqual([]);
    expect([out[0].cover, out[1].cover]).toEqual(['ok', 'pending']);
    expect(f.calls[0].select).toContain('cover_status');
    expect(truncated).toBe(false);
    expect(f.calls[0].ops).toEqual([
      ['eq', 'account_id', 'a1'],
      ['eq', 'media_type', 'STORY'],
      ['gte', 'posted_at', '2026-10-01T00:00:00.000Z'],
      ['lt', 'posted_at', '2026-10-15T16:00:00.000Z'],
      ['order', 'posted_at', { ascending: false }],
      ['order', 'captured_at', { ascending: true, referencedTable: 'media_metrics' }],
      ['limit', STORY_LIMIT + 1],
    ]);
    noStar(f.calls);
  });

  it('caps at STORY_LIMIT and says so (the tab shows it; never silent)', async () => {
    const story = (i: number) => ({ id: `s${i}`, posted_at: '2026-10-14T08:00:00Z', expires_at: null, permalink: null, media_metrics: [] });
    const f = fakeDb({ media: [{ data: Array.from({ length: STORY_LIMIT + 1 }, (_, i) => story(i)) }] });
    const r = await loadStories(f.db, 'a1', 'a', 'b');
    expect(r.stories).toHaveLength(STORY_LIMIT);
    expect(r.truncated).toBe(true);
  });
});

describe('loadAudience', () => {
  it('latest snapshot per kind; missing kinds are null; non-numeric counts dropped', async () => {
    const f = fakeDb({
      audience_snapshots: [{ data: [{ day: '2026-10-14', data: { '18-24|F': 10, '25-34|M': 'x' } }] }, { data: [{ day: '2026-10-14', data: { MY: 40, XK: 2 } }] }, { data: [] }],
    });
    const out = await loadAudience(f.db, 'a1');
    expect(out.age_gender).toEqual({ day: '2026-10-14', data: { '18-24|F': 10 } });
    expect(out.country).toEqual({ day: '2026-10-14', data: { MY: 40, XK: 2 } });
    expect(out.city).toBeNull();
    expect(f.calls.map((c) => c.ops[1])).toEqual([['eq', 'kind', 'age_gender'], ['eq', 'kind', 'country'], ['eq', 'kind', 'city']]);
    for (const c of f.calls) expect(c.ops).toContainEqual(['limit', 1]);
    noStar(f.calls);
  });
});

describe('loadOnline, loadTags, loadMonthMedia', () => {
  it('online followers grouped by account; no query without accounts', async () => {
    const f = fakeDb({ online_followers: [{ data: [{ account_id: 'a1', day: '2026-10-13', hourly: [1, 'x', 3] }] }] });
    expect(await loadOnline(f.db, ['a1', 'a2'], '2026-09-14')).toEqual({ a1: [{ day: '2026-10-13', hourly: [1, null, 3] }], a2: [] });
    expect(f.calls[0].ops[0]).toEqual(['in', 'account_id', ['a1', 'a2']]);
    const empty = fakeDb({});
    expect(await loadOnline(empty.db, [], '2026-09-14')).toEqual({});
    expect(empty.calls).toHaveLength(0);
  });

  it('tags ordered by name with explicit columns', async () => {
    const f = fakeDb({ tags: [{ data: [{ id: 't1', name: 'Promo', color: 'chart-2' }] }] });
    expect(await loadTags(f.db)).toEqual([{ id: 't1', name: 'Promo', color: 'chart-2' }]);
    expect(f.calls[0].select).toBe('id,name,color');
  });

  it('month media: posts and stories in [from, to) for the accounts', async () => {
    const f = fakeDb({ media: [{ data: [{ id: 's', account_id: 'a1', media_type: 'STORY', posted_at: '2026-10-01T00:00:00Z', permalink: null, caption: null, cover_status: 'unavailable', children_count: null }] }] });
    const out = await loadMonthMedia(f.db, ['a1'], '2026-09-30T16:00:00.000Z', '2026-10-31T16:00:00.000Z');
    expect(out).toEqual({ media: [{ id: 's', accountId: 'a1', mediaType: 'STORY', postedAt: '2026-10-01T00:00:00Z', permalink: null, caption: null, cover: 'unavailable', slides: null }], truncated: false });
    expect(f.calls[0].select).toBe('id,account_id,media_type,posted_at,permalink,caption,cover_status,children_count');
    expect(f.calls[0].ops.slice(0, 3)).toEqual([['in', 'account_id', ['a1']], ['gte', 'posted_at', '2026-09-30T16:00:00.000Z'], ['lt', 'posted_at', '2026-10-31T16:00:00.000Z']]);
    noStar(f.calls);
  });

  it('pages through 1,000-row pages and flags truncation only at CALENDAR_LIMIT', async () => {
    const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `m${i}`, account_id: 'a1', media_type: 'IMAGE', posted_at: '2026-10-01T00:00:00Z', permalink: null, caption: null }));
    const two = fakeDb({ media: [{ data: rows(1000) }, { data: rows(999) }] });
    const r = await loadMonthMedia(two.db, ['a1'], 'a', 'b');
    expect(r).toMatchObject({ truncated: false });
    expect(r.media).toHaveLength(1999);
    expect(two.calls.map((c) => c.ops.at(-1))).toEqual([['range', 0, 999], ['range', 1000, 1999]]);
    const full = fakeDb({ media: Array.from({ length: CALENDAR_LIMIT / 1000 }, () => ({ data: rows(1000) })) });
    const capped = await loadMonthMedia(full.db, ['a1'], 'a', 'b');
    expect(capped.truncated).toBe(true);
    expect(capped.media).toHaveLength(CALENDAR_LIMIT);
  });

  it('keeps only https permalinks (stored values are rendered as external links)', async () => {
    const row = (id: string, permalink: unknown) => ({ id, account_id: 'a1', media_type: 'IMAGE', posted_at: '2026-10-01T00:00:00Z', permalink, caption: null });
    const f = fakeDb({ media: [{ data: [row('a', 'https://www.instagram.com/p/x/'), row('b', 'HTTPS://instagram.com/p/y/'), row('c', 'javascript:alert(1)'), row('d', 'http://instagram.com/p/z/'), row('e', 5)] }] });
    expect((await loadMonthMedia(f.db, ['a1'], 'a', 'b')).media.map((m) => m.permalink)).toEqual(['https://www.instagram.com/p/x/', 'HTTPS://instagram.com/p/y/', null, null, null]);
    const story = (id: string, permalink: string) => ({ id, posted_at: '2026-10-14T08:00:00Z', expires_at: null, permalink, media_metrics: [] });
    const s = fakeDb({ media: [{ data: [story('s1', 'javascript:alert(1)'), story('s2', 'https://www.instagram.com/stories/x/')] }] });
    expect((await loadStories(s.db, 'a1', 'x', 'y')).stories.map((r) => r.permalink)).toEqual([null, 'https://www.instagram.com/stories/x/']);
  });
});

/** Fake owner-session client for the list functions: each rpc takes the next result queued for its name; calls recorded. */
function rpcDb(results: Record<string, { data?: unknown; error?: unknown }[]>) {
  const calls: [string, Record<string, unknown>][] = [];
  const db = { rpc: (name: string, args: Record<string, unknown>) => (calls.push([name, args]), Promise.resolve(results[name]?.shift() ?? { data: [], error: null })) };
  return { db: db as never, calls };
}

describe('loadPostPage', () => {
  const T1 = '7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e';
  const args: PostPageArgs = { fromIso: '2021-10-13T16:00:00.000Z', toIso: '2026-10-17T16:00:00.000Z', q: '', format: null, tag: null, sort: { key: 'date', asc: false }, page: 1, size: 50 };
  const post = (id: string, o: Record<string, unknown> = {}) => ({ id, media_type: 'REELS', posted_at: '2026-10-10T10:00:00Z', permalink: 'https://www.instagram.com/reel/x/', caption: 'Hi', cover_status: 'ok', children_count: null, reach: 50, views: 70, likes: 3, comments: null, saves: 1, shares: null, tag_ids: [T1], n: 51, total: 120, ...o });

  it('calls post_list with this account, the window, the filters, the sort and the page; maps rows like loadPostRows', async () => {
    const f = rpcDb({ post_list: [{ data: [post('m1'), post('m2', { media_type: 'IMAGE', permalink: 'javascript:x', caption: null, cover_status: 'weird', tag_ids: null, reach: null })], error: null }] });
    const r = await loadPostPage(f.db, 'a1', { ...args, q: '50% off', format: 'REELS', tag: T1, sort: { key: 'engagement', asc: true }, page: 2 });
    expect(f.calls).toEqual([['post_list', { p_account: 'a1', p_from: args.fromIso, p_to: args.toIso, p_q: '50% off', p_format: 'REELS', p_tag: T1, p_untagged: false, p_sort: 'engagement', p_asc: true, p_offset: 50, p_limit: 50 }]]);
    expect(r).toMatchObject({ total: 120, page: 2 });
    expect(r!.rows[0]).toEqual({ id: 'm1', accountId: 'a1', mediaType: 'REELS', postedAt: '2026-10-10T10:00:00Z', permalink: 'https://www.instagram.com/reel/x/', reach: 50, views: 70, likes: 3, comments: null, shares: null, saves: 1, caption: 'Hi', tagIds: [T1], cover: 'ok', slides: null });
    expect(r!.rows[1]).toMatchObject({ id: 'm2', permalink: null, caption: null, tagIds: [], cover: 'pending', reach: null });
  });

  it('no search = null; untagged is its own flag; an empty first page is a total of 0', async () => {
    const f = rpcDb({});
    expect(await loadPostPage(f.db, 'a1', { ...args, tag: 'untagged' })).toEqual({ rows: [], total: 0, page: 1 });
    expect(f.calls[0][1]).toMatchObject({ p_q: null, p_tag: null, p_untagged: true });
  });

  it('a page past the end (stale link) is read again as page 1', async () => {
    const f = rpcDb({ post_list: [{ data: [], error: null }, { data: [post('m1', { n: 1, total: 1 })], error: null }] });
    const r = await loadPostPage(f.db, 'a1', { ...args, page: 9 });
    expect(f.calls.map(([, a]) => a.p_offset)).toEqual([400, 0]);
    expect(r).toMatchObject({ total: 1, page: 1 });
  });

  it('a missing function (migration not applied) is null; any other error is a fixed message', async () => {
    for (const code of ['PGRST202', '42883']) expect(await loadPostPage(rpcDb({ post_list: [{ error: { code, message: 'x' } }] }).db, 'a1', args)).toBeNull();
    await expect(loadPostPage(rpcDb({ post_list: [{ error: { code: '42501', message: 'secret detail' } }] }).db, 'a1', args)).rejects.toThrow(/^dashboard read: post page failed$/);
  });
});

describe('loadStoryPage', () => {
  const args: StoryPageArgs = { fromIso: 'a', toIso: 'b', tz: 'Asia/Kuala_Lumpur', measured: null, sort: 'newest', page: 1, size: 7 };
  const row = (id: string, o: Record<string, unknown> = {}) => ({ id, posted_at: '2026-10-15T01:00:00Z', expires_at: '2026-10-16T01:00:00Z', permalink: null, cover_status: 'ok', captured_at: '2026-10-15T20:00:00Z', reach: 39, views: 40, replies: 1, shares: 0, total_interactions: 2, taps_forward: 7, taps_back: 0, exits: 2, snapshots: 2, progression: [10, 40], n: 1, items: 12, days: 5, ...o });

  it('calls story_list with this account, the window, the timezone, the filter, the sort and the page; final numbers, count and series', async () => {
    const f = rpcDb({ story_list: [{ data: [row('s1'), row('s2', { captured_at: null, reach: null, views: null, exits: null, snapshots: 0, progression: [] })], error: null }] });
    const r = await loadStoryPage(f.db, 'a1', { ...args, measured: false, sort: 'exit', page: 3, size: 48 });
    expect(f.calls).toEqual([['story_list', { p_account: 'a1', p_from: 'a', p_to: 'b', p_tz: 'Asia/Kuala_Lumpur', p_measured: false, p_sort: 'exit', p_offset: 96, p_limit: 48 }]]);
    expect(r).toMatchObject({ items: 12, days: 5, page: 3 });
    expect(r!.stories[0]).toEqual({ id: 's1', postedAt: '2026-10-15T01:00:00Z', expiresAt: '2026-10-16T01:00:00Z', permalink: null, cover: 'ok', final: { capturedAt: '2026-10-15T20:00:00Z', reach: 39, views: 40, replies: 1, shares: 0, interactions: 2, tapsForward: 7, tapsBack: 0, exits: 2 }, snapshots: 2, progression: [10, 40] });
    expect(r!.stories[1]).toMatchObject({ final: null, snapshots: 0, progression: [] });
  });

  it('a stale page is read again as page 1; a missing function is null; other errors are fixed text', async () => {
    const f = rpcDb({ story_list: [{ data: [] }, { data: [row('s1')] }] });
    expect(await loadStoryPage(f.db, 'a1', { ...args, page: 4 })).toMatchObject({ page: 1, days: 5 });
    expect(f.calls.map(([, a]) => a.p_offset)).toEqual([21, 0]);
    expect(await loadStoryPage(rpcDb({ story_list: [{ error: { code: 'PGRST202' } }] }).db, 'a1', args)).toBeNull();
    await expect(loadStoryPage(rpcDb({ story_list: [{ error: { code: 'XX000', message: 'secret' } }] }).db, 'a1', args)).rejects.toThrow(/^dashboard read: story page failed$/);
  });
});
