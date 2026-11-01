import { describe, expect, it } from 'vitest';
import { captionFeatures, CAPTION_MIN_POSTS } from '@/lib/analysis/caption';
import { hashtagLab, HASHTAG_ROWS } from '@/lib/analysis/hashtags';

const post = (caption: string, reach: number | null, saves: number | null = null, postedAt = '2026-10-01T04:00:00Z') => ({ hashtags: captionFeatures(caption).hashtags, postedAt, reach, saves });

describe('hashtagLab', () => {
  it(`below ${CAPTION_MIN_POSTS} measured posts: counts and the baseline only, no per-hashtag rows`, () => {
    const lab = hashtagLab([post('#a', 100), post('#a #b', 300), post('no tags', null), post('#c', 0)]);
    expect(lab).toEqual({ posts: 4, measured: 2, withHashtags: 3, baseline: 200, rows: null, more: 0 });
  });

  it('per hashtag: posts, measured, median reach and saves from 5 posts, last used; best median first, then most used', () => {
    const posts = [
      ...Array.from({ length: 6 }, (_, i) => post('Sunset #Travel #travel', 200, 10, `2026-10-0${i + 1}T04:00:00Z`)), // one hashtag counted once per post
      ...Array.from({ length: 5 }, () => post('#food', 50, null)),
      ...Array.from({ length: 3 }, () => post('#穿搭', 400, 40)),
      ...Array.from({ length: 6 }, () => post('plain', 100, 5)),
    ];
    const lab = hashtagLab(posts);
    expect([lab.measured, lab.withHashtags, lab.baseline]).toEqual([20, 14, 100]);
    expect(lab.rows).toEqual([
      { tag: 'travel', posts: 6, n: 6, medianReach: 200, medianSaves: 10, lastUsed: '2026-10-06T04:00:00Z' },
      { tag: 'food', posts: 5, n: 5, medianReach: 50, medianSaves: null, lastUsed: '2026-10-01T04:00:00Z' },
      { tag: '穿搭', posts: 3, n: 3, medianReach: null, medianSaves: null, lastUsed: '2026-10-01T04:00:00Z' },
    ]);
  });

  it(`at most ${HASHTAG_ROWS} rows; the rest is counted`, () => {
    const posts = Array.from({ length: 52 }, (_, i) => post(`#tag${i}`, 100));
    const lab = hashtagLab(posts);
    expect(lab.rows).toHaveLength(HASHTAG_ROWS);
    expect(lab.more).toBe(2);
  });
});
