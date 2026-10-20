import { describe, expect, it } from 'vitest';
import { buildPosts, buildStories, storyDays } from '@/lib/dashboard/content';
import type { PostRow, StoryRow } from '@/lib/dashboard/detail-read';
import {
  ALL_TIME,
  cleanSearch,
  listWindow,
  pageCount,
  pagePosts,
  pageStories,
  parsePostList,
  parseStoryList,
  postHref,
  postListParams,
  postPageSize,
  postSortFor,
  postSortOf,
  POST_SORTS,
  samePlace,
  sortPosts,
  sortStories,
  storyHref,
  storyListParams,
  storyPageSize,
  type PostListState,
  type StoryListState,
} from '@/lib/dashboard/lists';

const T1 = '7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e';
const KL = 'Asia/Kuala_Lumpur';
const POSTS: PostListState = { dates: ALL_TIME, q: '', format: null, tag: null, sort: 'newest', page: 1, view: null };
const STORIES: StoryListState = { dates: ALL_TIME, measured: null, sort: 'newest', page: 1 };

describe('parsePostList / parseStoryList', () => {
  it('defaults: All time, no search or filters, newest first, page 1, automatic view', () => {
    expect(parsePostList({})).toEqual(POSTS);
    expect(parseStoryList({})).toEqual(STORIES);
  });

  it('keeps valid values (a tag id lower-cased; custom dates win over a preset; reversed dates swapped)', () => {
    expect(parsePostList({ pr: '30d', q: '  launch   day ', format: 'REELS', tag: T1.toUpperCase(), sort: 'engagement_asc', page: '3', view: 'grid' })).toEqual({ dates: { pr: '30d', from: null, to: null }, q: 'launch day', format: 'REELS', tag: T1, sort: 'engagement_asc', page: 3, view: 'grid' });
    expect(parsePostList({ pr: '7d', pfrom: '2026-10-31', pto: '2026-10-01' }).dates).toEqual({ pr: null, from: '2026-10-01', to: '2026-10-31' });
    expect(parsePostList({ pfrom: '2026-10-01' }).dates).toEqual({ pr: null, from: '2026-10-01', to: null });
    expect(parsePostList({ tag: 'untagged' }).tag).toBe('untagged');
    expect(parseStoryList({ pr: 'year', measured: 'no', sort: 'exit', page: '2' })).toEqual({ dates: { pr: 'year', from: null, to: null }, measured: false, sort: 'exit', page: 2 });
    expect(parseStoryList({ measured: 'yes' }).measured).toBe(true);
  });

  it('drops invalid values, never echoes them; the old ?from&to are not list dates', () => {
    expect(parsePostList({ pr: '1y', pfrom: '2026-02-31', pto: '20261001', format: 'STORY', tag: "x' or 1=1", sort: 'likes', page: '0', view: 'list', from: '2026-09-01', to: '2026-09-30' })).toEqual(POSTS);
    for (const page of ['-1', 'abc', '1e3', '9999999', '2.5', ''] as const) expect(parsePostList({ page }).page, page).toBe(1);
    expect(parsePostList({ q: ['a', 'b'], format: ['REELS'] })).toEqual(POSTS);
    expect(parseStoryList({ measured: 'maybe', sort: 'reach', from: '7d' })).toEqual(STORIES);
  });

  it('search text: whitespace collapsed, at most 100 code points, emoji never split', () => {
    expect(cleanSearch(' a \n b ')).toBe('a b');
    expect([...cleanSearch('😀'.repeat(150))]).toHaveLength(100);
    expect(cleanSearch(null)).toBe('');
  });
});

describe('list links', () => {
  const keep = { from: '90d', cmp: 'yoy' }; // the page's Time Scope rides along untouched

  it('a fixed order, defaults left out, the scope last', () => {
    expect(postListParams(POSTS)).toEqual({ tab: 'posts' });
    const s: PostListState = { dates: { pr: null, from: '2026-10-01', to: '2026-10-31' }, q: '50% off', format: 'IMAGE', tag: 'untagged', sort: 'reach', page: 2, view: 'table' };
    expect(new URLSearchParams(postListParams(s, keep)).toString()).toBe('tab=posts&pfrom=2026-10-01&pto=2026-10-31&q=50%25+off&format=IMAGE&tag=untagged&sort=reach&page=2&view=table&from=90d&cmp=yoy');
    expect(new URLSearchParams(storyListParams({ dates: { pr: '7d', from: null, to: null }, measured: true, sort: 'views', page: 4 }, keep)).toString()).toBe('tab=stories&pr=7d&measured=yes&sort=views&page=4&from=90d&cmp=yoy');
  });

  it('a change goes back to page 1 and keeps every other filter; an explicit page is kept', () => {
    const s: PostListState = { ...POSTS, q: 'cat', format: 'REELS', sort: 'views', page: 5 };
    expect(postHref(s, { tag: T1 }, keep)).toBe(`?tab=posts&q=cat&format=REELS&tag=${T1}&sort=views&from=90d&cmp=yoy`);
    expect(postHref(s, { page: 6 })).toBe('?tab=posts&q=cat&format=REELS&sort=views&page=6');
    expect(storyHref({ ...STORIES, measured: false, page: 3 }, { sort: 'exit' })).toBe('?tab=stories&measured=no&sort=exit');
  });
});

describe('listWindow', () => {
  const today = '2026-10-17';
  it('presets end today; This year starts on 1 January; All time and open ends reach back MAX_DAYS', () => {
    expect(listWindow({ pr: '7d', from: null, to: null }, today)).toEqual({ from: '2026-10-11', to: today });
    expect(listWindow({ pr: '30d', from: null, to: null }, today)).toEqual({ from: '2026-09-18', to: today });
    expect(listWindow({ pr: '90d', from: null, to: null }, today)).toEqual({ from: '2026-07-20', to: today });
    expect(listWindow({ pr: 'year', from: null, to: null }, today)).toEqual({ from: '2026-01-01', to: today });
    expect(listWindow(ALL_TIME, today)).toEqual({ from: '2021-10-14', to: today }); // = the Time Scope's "all" list range
    expect(listWindow({ pr: null, from: '2026-10-01', to: null }, today)).toEqual({ from: '2026-10-01', to: today });
    expect(listWindow({ pr: null, from: null, to: '2026-01-31' }, today)).toEqual({ from: '2021-10-14', to: '2026-01-31' });
  });
});

describe('page sizes and sort keys', () => {
  it('24 in the grid, 50 in the table and the automatic view; 7 days or 48 Stories; at least one page', () => {
    expect([postPageSize('grid'), postPageSize('table'), postPageSize(null)]).toEqual([24, 50, 50]);
    expect([storyPageSize('newest'), storyPageSize('views'), storyPageSize('exit')]).toEqual([7, 48, 48]);
    expect([pageCount(0, 50), pageCount(50, 50), pageCount(51, 50)]).toEqual([1, 1, 2]);
    expect([samePlace(3, 50, 24), samePlace(3, 24, 50), samePlace(1, 24, 50)]).toEqual([5, 1, 1]); // table page 3 starts at post 101 = grid page 5; grid page 3 starts at post 49 = table page 1
  });

  it('every sort maps to a SQL key and direction and back', () => {
    for (const s of POST_SORTS) {
      const { key, asc } = postSortOf(s);
      expect(postSortFor(key, asc), s).toBe(s);
    }
    expect(postSortOf('newest')).toEqual({ key: 'date', asc: false });
    expect(postSortOf('views_asc')).toEqual({ key: 'views', asc: true });
  });
});

// The fixture of the plan's SQL dry run (latest snapshots as post_list reads them). The expected orders below are the
// orders post_list returned for it on PostgreSQL: the TypeScript mirror must agree exactly.
const row = (id: string, day: number, o: Partial<PostRow> = {}): PostRow => ({ id, accountId: 'a1', mediaType: 'IMAGE', postedAt: `2026-10-0${day}T10:00:00Z`, permalink: null, reach: null, views: null, likes: null, comments: null, shares: null, saves: null, caption: null, tagIds: [], ...o });
const FIXTURE = [
  row('p3', 3, { likes: 1 }), // no reach
  row('p7', 7), // no snapshot
  row('p1', 1, { reach: 100, likes: 10, views: 300 }),
  row('p5', 5, { mediaType: 'REELS', reach: 50, likes: 1, saves: 2, views: 70 }), // (1 + 2) / 50
  row('p8', 8, { likes: 60, views: 6 }), // the latest snapshot has no reach (an older one had)
  row('p2', 2, { mediaType: 'REELS', reach: 0, likes: 5, views: 10 }),
  row('p6', 6, { reach: 100, likes: 10, views: 300 }), // ties p1: newest first
  row('p4', 4, { mediaType: 'CAROUSEL_ALBUM', reach: 200, views: 900 }), // reach but no interaction parts
];

describe('sortPosts / sortStories: the TypeScript mirror orders the dry-run fixture exactly as the SQL did', () => {
  const views = buildPosts(FIXTURE, [], { format: null, tag: null, from: null, to: null }, 'UTC');
  it.each([
    ['newest', ['p8', 'p7', 'p6', 'p5', 'p4', 'p3', 'p2', 'p1']],
    ['oldest', ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']],
    ['engagement', ['p6', 'p1', 'p5', 'p8', 'p7', 'p4', 'p3', 'p2']],
    ['engagement_asc', ['p5', 'p6', 'p1', 'p8', 'p7', 'p4', 'p3', 'p2']],
    ['reach', ['p4', 'p6', 'p1', 'p5', 'p2', 'p8', 'p7', 'p3']],
    ['reach_asc', ['p2', 'p5', 'p6', 'p1', 'p4', 'p8', 'p7', 'p3']],
    ['views', ['p4', 'p6', 'p1', 'p5', 'p2', 'p8', 'p7', 'p3']],
  ] as const)('%s', (sort, ids) => {
    expect(sortPosts(views, sort).map((p) => p.id)).toEqual(ids);
  });

  // Stories of the dry run (Kuala Lumpur days): s1 + s2 on 15 Oct, s3 13 Oct, s4 12 Oct (never measured), s5 10 Oct (no expires_at)
  const snap = (capturedAt: string, views: number, exits: number | null) => ({ capturedAt, reach: views, views, replies: null, shares: null, interactions: null, tapsForward: null, tapsBack: null, exits });
  const story = (id: string, postedAt: string, expiresAt: string | null, snapshots: ReturnType<typeof snap>[]): StoryRow => ({ id, postedAt, expiresAt, permalink: null, snapshots });
  const STORY_FIXTURE = buildStories(
    [
      story('s5', '2026-10-10T02:00:00Z', null, [snap('2026-10-11T05:00:00Z', 30, null)]), // only snapshot is after posted + 1 day: still the final
      story('s3', '2026-10-13T02:00:00Z', '2026-10-14T02:00:00Z', [snap('2026-10-13T12:00:00Z', 50, 5), snap('2026-10-14T05:00:00Z', 99, 0)]), // after expiry: ignored
      story('s1', '2026-10-14T23:30:00Z', '2026-10-15T23:30:00Z', [snap('2026-10-15T00:00:00Z', 10, 1), snap('2026-10-15T20:00:00Z', 40, 2)]),
      story('s4', '2026-10-12T02:00:00Z', '2026-10-13T02:00:00Z', []),
      story('s2', '2026-10-15T01:00:00Z', '2026-10-16T01:00:00Z', [snap('2026-10-15T02:00:00Z', 20, 4)]),
    ],
    new Date('2026-10-20T00:00:00Z'),
  );
  it.each([
    ['newest', ['s2', 's1', 's3', 's4', 's5']],
    ['views', ['s3', 's1', 's5', 's2', 's4']],
    ['exit', ['s2', 's3', 's1', 's4', 's5']],
  ] as const)('stories: %s', (sort, ids) => {
    expect(sortStories(STORY_FIXTURE, sort).map((s) => s.id)).toEqual(ids);
  });

  it('stories: measured / not measured and the counts (5 Stories on 4 days, as story_list returned)', () => {
    expect(pageStories(STORY_FIXTURE, STORIES, KL)).toMatchObject({ items: 5, days: 4, page: 1 });
    expect(pageStories(STORY_FIXTURE, { ...STORIES, measured: true }, KL).stories.map((s) => s.id).sort()).toEqual(['s1', 's2', 's3', 's5']);
    expect(pageStories(STORY_FIXTURE, { ...STORIES, measured: false }, KL)).toMatchObject({ items: 1, days: 1 });
    expect(pageStories(STORY_FIXTURE, { ...STORIES, sort: 'exit' }, KL).stories.map((s) => s.id)).toEqual(['s2', 's3', 's1', 's4', 's5']);
  });
});

describe('pagePosts / pageStories (the fallback before the migration)', () => {
  const many = buildPosts(
    Array.from({ length: 60 }, (_, i) => row(`m${i}`, 1, { postedAt: new Date(Date.UTC(2026, 8, 1) + i * 3_600_000).toISOString(), reach: i })),
    [],
    { format: null, tag: null, from: null, to: null },
    'UTC',
  );
  it('cuts the sorted list by the view’s page size; a page past the end is page 1', () => {
    expect(pagePosts(many, { sort: 'newest', page: 1, view: null })).toMatchObject({ total: 60, page: 1 });
    expect(pagePosts(many, { sort: 'newest', page: 2, view: null }).posts.map((p) => p.id)).toEqual(Array.from({ length: 10 }, (_, i) => `m${9 - i}`));
    expect(pagePosts(many, { sort: 'reach_asc', page: 3, view: 'grid' }).posts.map((p) => p.id)).toEqual(Array.from({ length: 12 }, (_, i) => `m${48 + i}`));
    expect(pagePosts(many, { sort: 'newest', page: 4, view: 'grid' })).toMatchObject({ page: 1, total: 60 });
  });

  it('Stories by newest: whole days, 7 per page, never split; other sorts: 48 Stories per page', () => {
    // 9 days, one Story on each, a second Story on the newest day
    const rows: StoryRow[] = Array.from({ length: 9 }, (_, i) => ({ id: `d${i}`, postedAt: `2026-10-${String(10 + i).padStart(2, '0')}T04:00:00Z`, expiresAt: null, permalink: null, snapshots: [] }));
    rows.push({ id: 'd8b', postedAt: '2026-10-18T06:00:00Z', expiresAt: null, permalink: null, snapshots: [] });
    const list = buildStories(rows, new Date('2026-10-20T00:00:00Z'));
    const first = pageStories(list, STORIES, KL);
    expect(first).toMatchObject({ items: 10, days: 9, page: 1 });
    expect(storyDays(first.stories, KL).map((d) => [d.day, d.stories.length])).toEqual([['2026-10-18', 2], ['2026-10-17', 1], ['2026-10-16', 1], ['2026-10-15', 1], ['2026-10-14', 1], ['2026-10-13', 1], ['2026-10-12', 1]]);
    expect(storyDays(pageStories(list, { ...STORIES, page: 2 }, KL).stories, KL).map((d) => d.day)).toEqual(['2026-10-11', '2026-10-10']);
    expect(pageStories(list, { ...STORIES, page: 3 }, KL).page).toBe(1);
    expect(pageStories(list, { ...STORIES, sort: 'views' }, KL).stories).toHaveLength(10);
  });
});
