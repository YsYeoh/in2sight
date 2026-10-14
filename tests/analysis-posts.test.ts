import { describe, expect, it } from 'vitest';
import { engagementRate, formatComparison, median, tagPerformance, topPosts } from '@/lib/analysis/posts';
import type { Post } from '@/lib/analysis/types';

const post = (id: string, o: Partial<Post> = {}): Post => ({ id, accountId: 'a1', mediaType: 'IMAGE', postedAt: '2026-10-01T10:00:00Z', permalink: null, reach: null, views: null, likes: null, comments: null, shares: null, saves: null, ...o });

describe('engagementRate', () => {
  it('(likes + comments + saves + shares) ÷ reach', () => {
    expect(engagementRate(post('p', { reach: 200, likes: 10, comments: 4, saves: 3, shares: 3 }))).toBe(0.1);
  });
  it('missing parts count as 0, but all missing or no reach is null (never NaN/Infinity)', () => {
    expect(engagementRate(post('p', { reach: 100, likes: 5 }))).toBe(0.05);
    expect(engagementRate(post('p', { reach: 100 }))).toBeNull();
    expect(engagementRate(post('p', { reach: 0, likes: 5 }))).toBeNull();
    expect(engagementRate(post('p', { likes: 5 }))).toBeNull();
  });
});

describe('median', () => {
  it('odd, even, empty', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe('topPosts', () => {
  const posts = [
    post('a', { reach: 100, likes: 1 }),
    post('b', { reach: 500, likes: 4 }),
    post('c', { reach: null, likes: 50 }),
    post('d', { reach: 500, likes: 100, postedAt: '2026-10-02T10:00:00Z' }),
    post('s', { reach: 9999, mediaType: 'STORY' }),
  ];
  it('ranks by reach, ties newest first, skips stories and missing values', () => {
    expect(topPosts(posts, 'reach').map((x) => x.post.id)).toEqual(['d', 'b', 'a']);
  });
  it('bottom and by engagement rate', () => {
    expect(topPosts(posts, 'engagementRate', { order: 'bottom', limit: 2 }).map((x) => x.post.id)).toEqual(['b', 'a']);
    expect(topPosts(posts, 'engagementRate')[0]).toEqual({ post: posts[3], value: 0.2 });
  });
  it('a single post and identical timestamps stay deterministic', () => {
    expect(topPosts([post('x', { reach: 1 })], 'reach')).toHaveLength(1);
    const same = [post('z', { reach: 5 }), post('y', { reach: 5 })];
    expect(topPosts(same, 'reach').map((x) => x.post.id)).toEqual(['y', 'z']);
    expect(topPosts([...same].reverse(), 'reach').map((x) => x.post.id)).toEqual(['y', 'z']);
  });
});

describe('formatComparison', () => {
  it('avg reach and pooled engagement per format, fixed order, empty formats omitted', () => {
    const rows = formatComparison([
      post('i1', { reach: 100, likes: 10 }),
      post('i2', { reach: 300, likes: 10 }),
      post('i3', { reach: null }),
      post('r1', { mediaType: 'REELS', reach: 1000, likes: 50, shares: 50 }),
      post('s1', { mediaType: 'STORY', reach: 10 }),
    ]);
    expect(rows.map((r) => r.mediaType)).toEqual(['REELS', 'IMAGE']);
    expect(rows[1]).toEqual({ mediaType: 'IMAGE', posts: 3, measured: 2, avgReach: 200, engagementRate: 20 / 400 });
    expect(rows[0].engagementRate).toBe(0.1);
  });
  it('a format whose posts all lack reach has null averages', () => {
    expect(formatComparison([post('c', { mediaType: 'CAROUSEL_ALBUM' })])[0]).toMatchObject({ posts: 1, measured: 0, avgReach: null, engagementRate: null });
  });
});

describe('tagPerformance', () => {
  it('per tag stats; multi-tagged posts count for each tag; unused tags kept and listed last', () => {
    const posts = [post('p1', { reach: 100, likes: 10 }), post('p2', { reach: 300 }), post('s', { reach: 50, mediaType: 'STORY' })];
    const tags = [
      { id: 't1', name: 'Tips', color: 'chart-1' },
      { id: 't2', name: 'Promo', color: 'chart-2' },
      { id: 't3', name: 'Unused', color: 'chart-3' },
    ];
    const out = tagPerformance(posts, [{ mediaId: 'p1', tagId: 't1' }, { mediaId: 'p2', tagId: 't1' }, { mediaId: 'p2', tagId: 't2' }, { mediaId: 's', tagId: 't2' }, { mediaId: 'gone', tagId: 't2' }], tags);
    expect(out.map((r) => r.tag.name)).toEqual(['Promo', 'Tips', 'Unused']);
    expect(out[0]).toMatchObject({ posts: 1, avgReach: 300 });
    expect(out[1]).toMatchObject({ posts: 2, avgReach: 200, engagementRate: 10 / 400 });
    expect(out[2]).toMatchObject({ posts: 0, avgReach: null });
  });
});
