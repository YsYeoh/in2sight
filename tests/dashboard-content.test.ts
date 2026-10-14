import { describe, expect, it } from 'vitest';
import type { Tag } from '@/lib/analysis/types';
import { buildPosts, buildStories, buildTagStats, MIN_TAG_POSTS, parsePostFilters, snippet } from '@/lib/dashboard/content';
import type { PostRow, StoryRow, StorySnapshot } from '@/lib/dashboard/detail-read';

const KL = 'Asia/Kuala_Lumpur';
const T1 = '7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e';
const T2 = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';
const TAGS: Tag[] = [
  { id: T1, name: 'Promo', color: 'chart-1' },
  { id: T2, name: 'Behind', color: 'chart-2' },
];
const row = (id: string, o: Partial<PostRow> = {}): PostRow => ({ id, accountId: 'a1', mediaType: 'IMAGE', postedAt: '2026-10-10T02:00:00Z', permalink: null, reach: 100, views: null, likes: 5, comments: null, shares: null, saves: null, caption: null, tagIds: [], ...o });
const snap = (capturedAt: string, o: Partial<StorySnapshot> = {}): StorySnapshot => ({ capturedAt, reach: null, views: null, replies: null, shares: null, interactions: null, tapsForward: null, tapsBack: null, exits: null, ...o });

describe('parsePostFilters', () => {
  it('keeps valid filters', () => {
    expect(parsePostFilters({ format: 'REELS', tag: T1.toUpperCase(), from: '2026-10-01', to: '2026-10-31' })).toEqual({ format: 'REELS', tag: T1, from: '2026-10-01', to: '2026-10-31' });
    expect(parsePostFilters({ tag: 'untagged' }).tag).toBe('untagged');
  });

  it('filters ignore invalid values: unknown format, STORY, non-uuid tag, impossible dates, arrays', () => {
    expect(parsePostFilters({ format: 'STORY', tag: "x' or 1=1", from: '2026-02-31', to: '2026-13-01' })).toEqual({ format: null, tag: null, from: null, to: null });
    expect(parsePostFilters({ format: ['REELS', 'IMAGE'], from: '20261001' })).toEqual({ format: null, tag: null, from: null, to: null });
  });

  it('swaps a reversed date range', () => {
    expect(parsePostFilters({ from: '2026-10-31', to: '2026-10-01' })).toMatchObject({ from: '2026-10-01', to: '2026-10-31' });
  });
});

describe('snippet', () => {
  it('one line, at most 80 code points, never splits an emoji; null/blank gives null', () => {
    const grin = '\u{1F600}';
    expect(snippet('Hello\n\nworld')).toBe('Hello world');
    expect(snippet(grin.repeat(81))).toBe(`${grin.repeat(80)}…`);
    expect(snippet(grin.repeat(80))).toBe(grin.repeat(80));
    expect(snippet(null)).toBeNull();
    expect(snippet('  \n ')).toBeNull();
  });
});

describe('buildPosts', () => {
  const rows = [
    row('a', { mediaType: 'REELS', tagIds: [T1, T2, 'gone'], caption: 'Hi', permalink: 'https://www.instagram.com/reel/a/' }),
    row('b', { postedAt: '2026-09-30T16:30:00Z' }), // 1 Oct 00:30 in Kuala Lumpur
    row('c', { mediaType: 'CAROUSEL_ALBUM', tagIds: [T2], reach: null }),
  ];

  it('maps rows with engagement rate, sorted known tags and a caption snippet; null caption/permalink stay null', () => {
    const out = buildPosts(rows, TAGS, { format: null, tag: null, from: null, to: null }, KL);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ id: 'a', caption: 'Hi', engagementRate: 0.05, tags: [TAGS[1], TAGS[0]] });
    expect(out[1]).toMatchObject({ id: 'b', caption: null, permalink: null });
    expect(out[2].engagementRate).toBeNull();
  });

  it('filters by format, tag, untagged and owner-timezone day', () => {
    const f = { format: null, tag: null, from: null, to: null };
    expect(buildPosts(rows, TAGS, { ...f, format: 'REELS' }, KL).map((p) => p.id)).toEqual(['a']);
    expect(buildPosts(rows, TAGS, { ...f, tag: T2 }, KL).map((p) => p.id)).toEqual(['a', 'c']);
    expect(buildPosts(rows, TAGS, { ...f, tag: 'untagged' }, KL).map((p) => p.id)).toEqual(['b']);
    expect(buildPosts(rows, TAGS, { ...f, from: '2026-10-01', to: '2026-10-01' }, KL).map((p) => p.id)).toEqual(['b']);
    expect(buildPosts(rows, TAGS, { ...f, from: '2026-10-01', to: '2026-10-01' }, 'UTC').map((p) => p.id)).toEqual([]);
  });
});

describe('buildStories', () => {
  const NOW = new Date('2026-10-15T04:00:00Z');
  const story = (id: string, postedAt: string, snapshots: StorySnapshot[], expiresAt: string | null = new Date(Date.parse(postedAt) + 86_400_000).toISOString()): StoryRow => ({ id, postedAt, expiresAt, permalink: null, snapshots });

  it('final = last snapshot before expiry; exit rate = exits / views; progression of views; live vs expired', () => {
    const s = story('s1', '2026-10-13T08:00:00Z', [snap('2026-10-13T08:30:00Z', { views: 10, exits: 1 }), snap('2026-10-14T07:30:00Z', { views: 40, exits: 4 }), snap('2026-10-14T08:30:00Z', { views: 41, exits: 9 })]);
    const [v] = buildStories([s], NOW);
    expect(v).toMatchObject({ live: false, final: { views: 40, exits: 4 }, exitRate: 0.1, progression: [10, 40, 41], snapshots: 3, reason: null });
    const [live] = buildStories([story('s2', '2026-10-15T01:00:00Z', [snap('2026-10-15T01:30:00Z', { views: 0, exits: 0 })])], NOW);
    expect(live).toMatchObject({ live: true, exitRate: null }); // 0 views: no rate, never NaN
  });

  it('no stories gives an empty list; a story without snapshots says it needs 5 viewers', () => {
    expect(buildStories([], NOW)).toEqual([]);
    const [v] = buildStories([story('s3', '2026-10-14T20:00:00Z', [], null)], NOW);
    expect(v).toMatchObject({ final: null, exitRate: null, progression: [], reason: 'needs_5_viewers', live: true });
  });
});

describe('buildTagStats', () => {
  it('per-tag stats, an untagged bucket, and the few-posts guard', () => {
    const posts = [...Array.from({ length: MIN_TAG_POSTS }, (_, i) => row(`p${i}`, { tagIds: [T1], reach: 200 })), row('u1'), row('u2', { tagIds: [] }), row('t2', { tagIds: [T2] })];
    const out = buildTagStats(posts, TAGS);
    expect(out.rows.map((r) => [r.tag.name, r.posts, r.reason])).toEqual([
      ['Promo', 5, null],
      ['Behind', 1, 'few_posts'],
    ]);
    expect(out.untagged).toMatchObject({ posts: 2, avgReach: 100, reason: 'few_posts' });
  });

  it('no tags and no posts: empty rows, untagged with zero posts', () => {
    expect(buildTagStats([], [])).toEqual({ rows: [], untagged: { posts: 0, measured: 0, avgReach: null, engagementRate: null, reason: 'few_posts' } });
  });
});
