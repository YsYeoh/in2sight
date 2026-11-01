import { describe, expect, it } from 'vitest';
import { BOARD_MIN, boardValue, leaderboard, repeatIds, type BoardPost } from '@/lib/analysis/leaderboard';
import { LAB_METRICS, type LabValues } from '@/lib/analysis/post-lab';

const KL = 'Asia/Kuala_Lumpur';
const V = (o: Partial<LabValues> = {}): LabValues => ({ reach: null, views: null, likes: null, comments: null, saves: null, shares: null, interactions: null, replies: null, tapsForward: null, tapsBack: null, exits: null, swipeForward: null, follows: null, profileVisits: null, linkTaps: null, avgWatchMs: null, totalWatchMs: null, skipRate: null, ...o });
const P = (id: string, day: string, v: Partial<LabValues> | null, o: Partial<BoardPost> = {}): BoardPost => ({ id, mediaType: 'IMAGE', postedAt: `${day}T04:00:00Z`, tagIds: [], values: v === null ? null : V(v), ...o });
const base = { metric: 'reach' as const, format: null, group: 'none' as const, tz: KL, weekStart: 'mon' as const };

describe('boardValue', () => {
  it('uses the Post Lab formulas (same number as the scorecard)', () => {
    const v = V({ reach: 200, saves: 10, shares: 4, follows: 3, profileVisits: 7 });
    const ctx = { er: 'reach' as const, followers: null, story: false };
    expect(boardValue('reach', 'IMAGE', v)).toBe(200);
    expect(boardValue('saves', 'IMAGE', v)).toBe(10);
    expect(boardValue('shares', 'IMAGE', v)).toBe(4);
    expect(boardValue('saveRate', 'IMAGE', v)).toBe(LAB_METRICS.saveRate.value(v, ctx));
    expect(boardValue('saveRate', 'IMAGE', v)).toBeCloseTo(0.05);
    expect(boardValue('shareRate', 'IMAGE', v)).toBeCloseTo(0.02);
    expect(boardValue('followsPer1k', 'IMAGE', v)).toBeCloseTo(15);
    expect(boardValue('profileVisits', 'CAROUSEL_ALBUM', v)).toBe(7);
  });

  it('missing stays missing: never measured, no reach for a rate, not reported for Reels', () => {
    expect(boardValue('reach', 'IMAGE', null)).toBeNull();
    expect(boardValue('saveRate', 'IMAGE', V({ reach: 0, saves: 3 }))).toBeNull();
    expect(boardValue('followsPer1k', 'REELS', V({ reach: 100, follows: 2 }))).toBeNull();
    expect(boardValue('profileVisits', 'REELS', V({ profileVisits: 9 }))).toBeNull();
    expect(boardValue('profileVisits', 'IMAGE', V({ reach: 100 }))).toBeNull(); // extras not captured: null, never 0
  });
});

describe('leaderboard', () => {
  it('ranks high to low; ties newer first; leaves out posts without the number and Stories; counts both', () => {
    const b = leaderboard([P('a', '2026-10-01', { reach: 50 }), P('b', '2026-10-02', { reach: 80 }), P('c', '2026-10-03', { reach: 80 }), P('d', '2026-10-04', null), P('e', '2026-10-04', { reach: 999 }, { mediaType: 'STORY' })], base);
    expect(b.top.map((r) => [r.post.id, r.value])).toEqual([['c', 80], ['b', 80], ['a', 50]]);
    expect([b.posts, b.n]).toEqual([4, 3]);
    expect(b.groups).toBeNull();
    expect(b.q25).toBeNull(); // below BOARD_MIN values
  });

  it('no posts, all-null extras: an empty board, no quartile, nothing to retire', () => {
    expect(leaderboard([], base)).toEqual({ metric: 'reach', posts: 0, n: 0, q25: null, top: [], groups: null, retire: [] });
    const b = leaderboard(Array.from({ length: 8 }, (_, i) => P(`p${i}`, '2026-10-01', { reach: 100 + i })), { ...base, metric: 'profileVisits' });
    expect([b.posts, b.n, b.top.length, b.q25]).toEqual([8, 0, 0, null]);
  });

  it('format filter and the top-10 limit', () => {
    const posts = [...Array.from({ length: 12 }, (_, i) => P(`r${i}`, '2026-10-01', { reach: i }, { mediaType: 'REELS' })), P('img', '2026-10-01', { reach: 1000 })];
    const b = leaderboard(posts, { ...base, format: 'REELS' });
    expect(b.posts).toBe(12);
    expect(b.top).toHaveLength(10);
    expect(b.top[0].post.id).toBe('r11');
    expect(leaderboard(posts, { ...base, limit: 3 }).top.map((r) => r.post.id)).toEqual(['img', 'r11', 'r10']);
  });

  it('group by tag: untagged is a group, a post counts for each of its tags, median only from BOARD_MIN, best first', () => {
    const posts = [
      ...Array.from({ length: 5 }, (_, i) => P(`a${i}`, '2026-10-01', { reach: 100 + i }, { tagIds: ['tA'] })),
      P('both', '2026-10-02', { reach: 500 }, { tagIds: ['tA', 'tB'] }),
      P('none', '2026-10-02', { reach: 10 }),
    ];
    const g = leaderboard(posts, { ...base, group: 'tag' }).groups!;
    expect(g.map((x) => [x.key, x.posts, x.n, x.median, x.best?.post.id])).toEqual([
      ['tA', 6, 6, 102.5, 'both'],
      ['tB', 1, 1, null, 'both'],
      ['untagged', 1, 1, null, 'none'],
    ]);
  });

  it('group by week: the owner-timezone week (week start setting), newest week first', () => {
    // 2026-10-04T17:00Z is Sunday in UTC but Monday 01:00 in Kuala Lumpur
    const posts = [P('late', '2026-10-04', { reach: 5 }, { postedAt: '2026-10-04T17:00:00Z' }), P('early', '2026-09-30', { reach: 7 })];
    expect(leaderboard(posts, { ...base, group: 'week' }).groups!.map((g) => [g.key, g.best?.post.id])).toEqual([['2026-10-05', 'late'], ['2026-09-28', 'early']]);
    expect(leaderboard(posts, { ...base, group: 'week', tz: 'UTC' }).groups!.map((g) => g.key)).toEqual(['2026-09-28']);
    expect(leaderboard(posts, { ...base, group: 'week', weekStart: 'sun' }).groups!.map((g) => g.key)).toEqual(['2026-10-04', '2026-09-27']);
  });

  it('retire this: a format or tag whose median (n >= 5) sits below the 25th percentile; never "untagged"; no formats under a format filter', () => {
    const low = Array.from({ length: 5 }, (_, i) => P(`i${i}`, '2026-10-01', { reach: 10 + i }, { tagIds: ['tLow'] }));
    const high = Array.from({ length: 10 }, (_, i) => P(`r${i}`, '2026-10-01', { reach: 100 + i }, { mediaType: 'REELS' }));
    const b = leaderboard([...low, ...high], base);
    expect(b.q25).toBe(13); // nearest rank of 15 values
    expect(b.retire).toEqual([
      { kind: 'format', key: 'IMAGE', n: 5, median: 12 },
      { kind: 'tag', key: 'tLow', n: 5, median: 12 },
    ]);
    const untagged = leaderboard([...low.map((p) => ({ ...p, tagIds: [] })), ...high.map((p) => ({ ...p, tagIds: ['tHigh'] }))], base);
    expect(untagged.retire.map((r) => r.key)).toEqual(['IMAGE']);
    expect(leaderboard([...low, ...high], { ...base, format: 'IMAGE' }).retire).toEqual([]); // only the tag is left, and its median (12) is not below its own range's 25th percentile (11)
  });
});

describe('repeatIds', () => {
  const many = (n: number, o: (i: number) => Partial<LabValues>) => Array.from({ length: n }, (_, i) => P(`p${i}`, '2026-10-01', { reach: 100, saves: 1, shares: 1, ...o(i) }));

  it('top quartile in two kinds of number = repeat this', () => {
    const posts = [...many(7, () => ({})), P('star', '2026-10-02', { reach: 900, saves: 1, shares: 9 })];
    expect([...repeatIds(posts)]).toEqual(['star']);
  });

  it('a count and its rate are one kind: top in saves and save rate only is not enough', () => {
    const posts = [...many(7, () => ({})), P('saver', '2026-10-02', { reach: 100, saves: 40, shares: 1 })];
    expect(repeatIds(posts).size).toBe(0);
  });

  it(`below ${BOARD_MIN} posts with a number, that number does not count`, () => {
    expect(repeatIds([P('x', '2026-10-01', { reach: 900, shares: 9 }), P('y', '2026-10-01', { reach: 1, shares: 1 })]).size).toBe(0);
  });

  it('equal values are not a top quartile (mid-rank 50)', () => {
    expect(repeatIds(many(8, () => ({}))).size).toBe(0);
  });
});
