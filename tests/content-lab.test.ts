// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LabValues } from '@/lib/analysis/post-lab';
import { buildContentLab, contentHref, parseContentPicks } from '@/lib/dashboard/content-lab';
import { LATEST_CHUNK, loadContentLab, type ContentRow } from '@/lib/dashboard/content-lab-read';
import type { PostRow } from '@/lib/dashboard/detail-read';
import { parseTimeScope, resolveScope } from '@/lib/time-scope/scope';

const reads = vi.hoisted(() => ({ rows: [] as unknown[], stories: { days: {}, from: null } as unknown }));
vi.mock('@/lib/dashboard/detail-read', async (orig) => ({ ...(await orig<object>()), loadPostRows: vi.fn(async () => reads.rows) }));
vi.mock('@/lib/dashboard/growth-read', async (orig) => ({ ...(await orig<object>()), loadStoryDays: vi.fn(async () => reads.stories) }));

const KL = 'Asia/Kuala_Lumpur';
const TODAY = '2026-10-28';
const row = (id: string, postedAt: string, o: Partial<PostRow> = {}): PostRow => ({ id, accountId: 'a1', mediaType: 'IMAGE', postedAt, permalink: null, reach: 1, views: null, likes: null, comments: null, shares: null, saves: null, caption: null, tagIds: [], cover: 'ok', slides: null, ...o });
const V = (o: Partial<LabValues>): LabValues => ({ reach: null, views: null, likes: null, comments: null, saves: null, shares: null, interactions: null, replies: null, tapsForward: null, tapsBack: null, exits: null, swipeForward: null, follows: null, profileVisits: null, linkTaps: null, avgWatchMs: null, totalWatchMs: null, skipRate: null, ...o });
const scopeOf = (q: string) => resolveScope(parseTimeScope(new URLSearchParams(q)), TODAY, '2026-09-01');

function fakeDb(answer: (ids: string[]) => { data: unknown; error: unknown }) {
  const calls: string[][] = [];
  return { calls, db: { rpc: async (name: string, a: { p_ids: string[] }) => (expect(name).toBe('post_lab_latest'), calls.push(a.p_ids), answer(a.p_ids)) } as never };
}

describe('loadContentLab', () => {
  beforeEach(() => {
    reads.stories = { days: { '2026-10-10': 1 }, from: null };
  });

  it('keeps the posts of [from, to), reads their latest KNOWN numbers by ids in chunks of 100, and the newest post overall', async () => {
    reads.rows = [row('new', '2026-10-28T20:00:00Z'), ...Array.from({ length: 150 }, (_, i) => row(`p${i}`, '2026-10-10T04:00:00+00:00')), row('old', '2026-09-01T04:00:00Z')];
    const f = fakeDb((ids) => ({ data: ids.map((id) => ({ media_id: id, reach: 10, follows: 2, profile_visits: null })), error: null }));
    const r = await loadContentLab(f.db, 'a1', '2026-09-30T16:00:00.000Z', '2026-10-28T16:00:00.000Z', KL);
    expect(r!.rows).toHaveLength(150); // 'new' is after the range, 'old' before it (dates compared as instants, not strings)
    expect(f.calls.map((c) => c.length)).toEqual([LATEST_CHUNK, 50]);
    expect(r!.rows[0].latest).toMatchObject({ reach: 10, follows: 2, profileVisits: null });
    expect(r!.lastPostAt).toBe('2026-10-28T20:00:00Z');
    expect(r!.stories).toEqual({ days: { '2026-10-10': 1 }, from: null });
  });

  it('a post without any snapshot has latest null; no posts = no call', async () => {
    reads.rows = [row('x', '2026-10-10T04:00:00Z')];
    const f = fakeDb(() => ({ data: [], error: null }));
    expect((await loadContentLab(f.db, 'a1', '2026-09-30T16:00:00Z', '2026-10-28T16:00:00Z', KL))!.rows[0].latest).toBeNull();
    reads.rows = [];
    const g = fakeDb(() => ({ data: [], error: null }));
    expect(await loadContentLab(g.db, 'a1', '2026-09-30T16:00:00Z', '2026-10-28T16:00:00Z', KL)).toEqual({ rows: [], lastPostAt: null, stories: reads.stories });
    expect(g.calls).toEqual([]);
  });

  it('missing function = null (needs a database update); any other error throws a fixed message', async () => {
    reads.rows = [row('x', '2026-10-10T04:00:00Z')];
    expect(await loadContentLab(fakeDb(() => ({ data: null, error: { code: 'PGRST202', message: 'secret detail' } })).db, 'a1', '2026-09-30T16:00:00Z', '2026-10-28T16:00:00Z', KL)).toBeNull();
    await expect(loadContentLab(fakeDb(() => ({ data: null, error: { code: '57014', message: 'secret detail' } })).db, 'a1', '2026-09-30T16:00:00Z', '2026-10-28T16:00:00Z', KL)).rejects.toThrow(/^content lab read: latest failed$/);
  });
});

describe('buildContentLab', () => {
  const content = (id: string, postedAt: string, latest: Partial<LabValues> | null, o: Partial<PostRow> = {}): ContentRow => ({ ...row(id, postedAt, o), latest: latest && V(latest) });
  const input = (rows: ContentRow[]) => ({ rows, lastPostAt: rows[0]?.postedAt ?? null, stories: { days: { '2026-10-05': 2, '2026-10-20': 1 }, from: null }, tags: [], connectedAt: '2026-10-15T00:00:00Z' });
  const opts = (q: string) => ({ scope: scopeOf(q), today: TODAY, tz: KL, weekStart: 'mon' as const });

  it('the range in the owner timezone; snippets only; splits, hashtags, cadence from the same posts', () => {
    const long = `${'x'.repeat(200)} #Travel`;
    const rows = [
      content('a', '2026-10-27T23:30:00Z', { reach: 300, saves: 9 }, { caption: long, mediaType: 'REELS' }), // 07:30 on 10-28 in KL
      content('b', '2026-10-01T15:30:00Z', { reach: 100 }, { caption: 'hi #travel' }), // 23:30 on 10-01
      content('c', '2026-09-28T15:30:00Z', { reach: 50 }), // 23:30 on 09-28 in KL: the day before the 30-day range
    ];
    const m = buildContentLab(input(rows), opts('from=30d'));
    expect(m.range).toEqual({ from: '2026-09-29', to: TODAY });
    expect(m.posts.map((p) => p.id)).toEqual(['a', 'b']);
    expect(m.posts[0].caption).toHaveLength(81); // 80 characters + the ellipsis: the whole caption never reaches the browser
    expect(m.posts[0].values?.reach).toBe(300);
    expect(m.measured).toBe(2);
    expect(m.formats.map((r) => [r.key, r.posts])).toEqual([['REELS', 1], ['IMAGE', 1]]);
    expect(m.dayparts.map((r) => r.key)).toEqual(['morning', 'evening']);
    expect(m.captions.map((r) => r.key)).toEqual(['short', 'medium']);
    expect([m.hashtags.posts, m.hashtags.withHashtags, m.hashtags.rows]).toEqual([2, 2, null]);
    expect(m.cadence.posts).toBe(2);
    expect(m.cadence.stories?.range.from).toBe('2026-10-15'); // Stories are known from the connect day
    expect(m.cadence.stories?.days).toBe(1);
    expect(m.frequency).toBeNull();
  });

  it('"All time" starts at the oldest post, not the 5-year floor', () => {
    const m = buildContentLab(input([content('a', '2026-10-20T04:00:00Z', null), content('b', '2025-06-02T04:00:00Z', null)]), opts('from=all'));
    expect(m.range).toEqual({ from: '2025-06-02', to: TODAY });
    expect(buildContentLab(input([]), opts('from=all')).range).toEqual({ from: TODAY, to: TODAY });
  });
});

describe('content picks', () => {
  it('allow-listed, defaults left out of the URL, other params kept', () => {
    expect(parseContentPicks(new URLSearchParams('section=hashtags&metric=saveRate&fmt=REELS&group=tag'))).toEqual({ section: 'hashtags', metric: 'saveRate', format: 'REELS', group: 'tag' });
    expect(parseContentPicks(new URLSearchParams('section=x&metric=__proto__&fmt=STORY&group=tag&group=week'))).toEqual({ section: 'leaderboards', metric: 'reach', format: null, group: 'none' });
    const sp = new URLSearchParams('tab=content&from=90d&metric=saves');
    expect(contentHref(sp, { section: 'cadence', metric: 'reach', format: 'IMAGE', group: 'none' })).toBe('?tab=content&from=90d&section=cadence&fmt=IMAGE');
  });
});
