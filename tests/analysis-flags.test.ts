import { describe, expect, it } from 'vitest';
import { reachDrop, takingOff } from '@/lib/analysis/flags';
import type { DailyRow, Post } from '@/lib/analysis/types';
import { addDays } from '@/lib/sync/time';

const NOW = new Date('2026-10-15T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const post = (id: string, postedAt: string, reach: number | null, o: Partial<Post> = {}): Post => ({ id, accountId: 'a1', mediaType: 'IMAGE', postedAt, permalink: `https://instagram.com/p/${id}`, reach, views: null, likes: null, comments: null, shares: null, saves: null, interactions: null, ...o });
/** n older posts with reach 100, one per day, ending 3 days ago. */
const history = (n: number, reach: number | null = 100) => Array.from({ length: n }, (_, i) => post(`h${i}`, hoursAgo(72 + 24 * (n - i)), reach));

describe('takingOff', () => {
  it('flags a post with ≥ 2× the median reach of the previous 20 posts', () => {
    const flags = takingOff([...history(20), post('hit', hoursAgo(30), 200), post('meh', hoursAgo(26), 150)], NOW);
    expect(flags).toEqual([{ kind: 'taking_off', postId: 'hit', permalink: 'https://instagram.com/p/hit', postedAt: hoursAgo(30), ratio: 2 }]);
  });

  it('waits 24 h after posting and ignores posts older than the window', () => {
    expect(takingOff([...history(10), post('young', hoursAgo(23), 1000)], NOW)).toEqual([]);
    expect(takingOff([...history(10), post('old', hoursAgo(24 * 8), 1000)], NOW)).toEqual([]);
    expect(takingOff([...history(10), post('old', hoursAgo(24 * 8), 1000)], NOW, 30)).toHaveLength(1);
  });

  it('needs ≥ 5 prior posts with reach; a single post or all-null history never flags', () => {
    expect(takingOff([...history(4), post('x', hoursAgo(30), 1000)], NOW)).toEqual([]);
    expect(takingOff([post('only', hoursAgo(30), 1000)], NOW)).toEqual([]);
    expect(takingOff([...history(10, null), post('x', hoursAgo(30), 1000)], NOW)).toEqual([]);
    expect(takingOff([...history(10, 0), post('x', hoursAgo(30), 1000)], NOW)).toEqual([]); // median 0: no ratio
  });

  it('only the previous 20 count; stories are ignored; identical timestamps order by id', () => {
    const old = Array.from({ length: 5 }, (_, i) => post(`o${i}`, hoursAgo(24 * 60 + i), 10_000));
    expect(takingOff([...old, ...history(20), post('hit', hoursAgo(30), 250)], NOW).map((f) => f.postId)).toEqual(['hit']);
    expect(takingOff([...history(10), post('s', hoursAgo(30), 9999, { mediaType: 'STORY' })], NOW)).toEqual([]);
    const t = hoursAgo(30);
    expect(takingOff([...history(10), post('b', t, 1000), post('a', t, 1000)], NOW).map((f) => f.postId)).toEqual(['b', 'a']);
  });
});

describe('reachDrop', () => {
  const row = (day: string, reach: number | null): DailyRow => ({ day, followers: null, reach, views: null, accountsEngaged: null, interactions: null, follows: null, unfollows: null, linkTaps: null });
  const weeks = (prev: number, cur: number) => Array.from({ length: 14 }, (_, i) => row(addDays('2026-10-01', i), i < 7 ? prev : cur));
  it('flags a 7-day drop of 20% or more', () => {
    expect(reachDrop(weeks(100, 80), '2026-10-15', 'UTC')).toEqual({ kind: 'reach_drop', change: -0.2 });
    expect(reachDrop(weeks(100, 81), '2026-10-15', 'UTC')).toBeNull();
  });
  it('no flag without two comparable weeks', () => {
    expect(reachDrop(weeks(100, 0).slice(7), '2026-10-15', 'UTC')).toBeNull();
    expect(reachDrop([], '2026-10-15', 'UTC')).toBeNull();
  });
});
