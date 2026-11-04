// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { AVG_MIN_POSTS, avgReachProgress, followersProgress, postsPerWeekProgress, type Goal } from '@/lib/analysis/goals';
import { projectFollowers } from '@/lib/analysis/trend';
import type { DailyRow, Post } from '@/lib/analysis/types';
import { addDays } from '@/lib/sync/time';

const row = (day: string, followers: number | null): DailyRow => ({ day, followers, reach: null, views: null, accountsEngaged: null, interactions: null, follows: null, unfollows: null, linkTaps: null });
const goal = (metric: Goal['metric'], target: number, extra: Partial<Goal> = {}): Goal => ({ id: 'g1', accountId: 'a1', metric, target, dueDay: null, startDay: '2026-10-01', ...extra });
const post = (id: string, postedAt: string, reach: number | null, mediaType: Post['mediaType'] = 'IMAGE'): Post => ({ id, accountId: 'a1', mediaType, postedAt, permalink: null, reach, views: null, likes: null, comments: null, shares: null, saves: null });
/** n days of followers from `from`, +perDay each day. */
const series = (from: string, n: number, start: number, perDay: number) => Array.from({ length: n }, (_, i) => row(addDays(from, i), start + i * perDay));

describe('projectFollowers horizons (Plan 17d)', () => {
  it('defaults to 7 / 30 / 90 days and accepts other horizons', () => {
    const pts = Array.from({ length: 28 }, (_, i) => ({ day: addDays('2026-09-01', i), value: 1000 + 10 * i }));
    const def = projectFollowers(pts);
    expect('horizons' in def && def.horizons.map((h) => h.days)).toEqual([7, 30, 90]);
    const one = projectFollowers(pts, [45]);
    expect('horizons' in one && one.horizons).toEqual([{ days: 45, value: 1720, low: 1720, high: 1720 }]);
  });
});

describe('followersProgress', () => {
  const g = goal('followers', 2000, { dueDay: '2026-12-31', startDay: '2026-10-01' }) as Goal & { dueDay: string };

  it('pace = the straight line from the start-day count to the target; ahead when at or above it', () => {
    const daily = series('2026-10-01', 31, 1000, 20); // 1000 on 1 Oct, 1600 on 31 Oct
    const p = followersProgress(g, daily, '2026-10-31');
    expect(p.baseline).toBe(1000);
    expect(p.actual).toBe(1600);
    expect(p.expected).toBe(1330); // 1000 + 1000 x 30 / 91, rounded
    expect(p.status).toBe('ahead');
  });

  it('forecast = the Theil-Sen line at the due day, without today’s part-day count; Medium with 21+ clear days', () => {
    const daily = [...series('2026-10-01', 30, 1000, 10), row('2026-10-31', 5000)]; // today's odd count is ignored
    const p = followersProgress(g, daily, '2026-10-31');
    expect(p.actual).toBe(5000);
    expect(p.status).toBe('done');
    expect(p.forecast).toBeNull(); // nothing to forecast once reached
    const q = followersProgress(g, series('2026-10-01', 30, 1000, 10), '2026-10-31');
    // last complete day 30 Oct (1290), 62 days to 31 Dec at +10 a day = 1910 < 2000; 28 clear days -> Medium
    expect(q.forecast).toEqual({ value: 1910, low: 1910, high: 1910, n: 28, confidence: 'medium', verdict: 'unlikely' });
  });

  it('a due day further than 90 days is always Low; under 14 days of history says so', () => {
    const near = goal('followers', 1500, { dueDay: '2026-11-20', startDay: '2026-10-01' }) as Goal & { dueDay: string };
    const p = followersProgress(near, series('2026-10-01', 30, 1000, 10), '2026-10-31');
    expect(p.forecast).toMatchObject({ value: 1500, confidence: 'medium', verdict: 'likely' }); // 1290 + 10 x 21
    const far = goal('followers', 5000, { dueDay: '2027-06-30', startDay: '2026-10-01' }) as Goal & { dueDay: string };
    expect(followersProgress(far, series('2026-10-01', 30, 1000, 10), '2026-10-31').forecast).toMatchObject({ confidence: 'low' });
    expect(followersProgress(near, series('2026-10-20', 10, 1000, 10), '2026-10-31').forecast).toEqual({ reason: 'not_enough_history', n: 10 });
  });

  it('missed after the due day; no count at all = no status, never 0', () => {
    const past = goal('followers', 2000, { dueDay: '2026-10-15', startDay: '2026-10-01' }) as Goal & { dueDay: string };
    const p = followersProgress(past, series('2026-10-01', 20, 1000, 10), '2026-10-25');
    expect(p.status).toBe('missed');
    expect(p.forecast).toBeNull();
    const none = followersProgress(g, [row('2026-10-02', null)], '2026-10-31');
    expect(none).toMatchObject({ actual: null, baseline: null, expected: null, status: null });
  });

  it('a goal set before the first count starts from the first count after it', () => {
    const p = followersProgress({ ...g, startDay: '2026-09-01' }, series('2026-10-01', 5, 1000, 0), '2026-10-05');
    expect(p.baseline).toBe(1000);
  });
});

describe('avgReachProgress', () => {
  const month = { from: '2026-10-01', to: '2026-10-31' };
  const now = new Date('2026-10-30T12:00:00Z');

  it('average of the month’s feed posts with reach (owner timezone), Stories and unmeasured posts left out', () => {
    const posts = [post('1', '2026-10-02T03:00:00Z', 100), post('2', '2026-10-10T03:00:00Z', 200), post('3', '2026-10-29T03:00:00Z', 600), post('4', '2026-10-12T03:00:00Z', null), post('5', '2026-10-12T03:00:00Z', 9999, 'STORY'), post('6', '2026-09-30T16:30:00Z', 9999)];
    // post 6 is 1 Oct 00:30 in Kuala Lumpur (+8): it counts there, not in UTC
    expect(avgReachProgress(goal('avg_reach', 300), posts, month, now, 'UTC')).toMatchObject({ actual: 300, n: 3, young: 1, status: 'ahead' });
    expect(avgReachProgress(goal('avg_reach', 3000), posts, month, now, 'Asia/Kuala_Lumpur')).toMatchObject({ actual: 2725, n: 4, status: 'behind' });
  });

  it('no status below AVG_MIN_POSTS posts; no posts = null, never 0', () => {
    expect(AVG_MIN_POSTS).toBe(3);
    expect(avgReachProgress(goal('avg_reach', 10), [post('1', '2026-10-02T03:00:00Z', 100)], month, now, 'UTC')).toMatchObject({ actual: 100, n: 1, status: null });
    expect(avgReachProgress(goal('avg_reach', 10), [], month, now, 'UTC')).toMatchObject({ actual: null, n: 0, status: null });
  });
});

describe('postsPerWeekProgress', () => {
  const week = { from: '2026-10-26', to: '2026-11-01' }; // Monday start
  const posts = [post('1', '2026-10-26T09:00:00Z', 1), post('2', '2026-10-27T09:00:00Z', 1), post('s', '2026-10-27T10:00:00Z', 1, 'STORY'), post('3', '2026-10-20T09:00:00Z', 1), post('4', '2026-10-21T09:00:00Z', 1), post('5', '2026-10-22T09:00:00Z', 1)];

  it('counts feed posts of the week; even pace = floor(target x days so far / 7); last week met or not', () => {
    const p = postsPerWeekProgress(goal('posts_per_week', 4), posts, week, '2026-10-29', 'UTC');
    expect(p).toMatchObject({ actual: 2, expected: 2, status: 'ahead', lastWeek: { actual: 3, met: false } }); // day 4 of 7: floor(4 x 4 / 7) = 2
    expect(postsPerWeekProgress(goal('posts_per_week', 4), posts, week, '2026-11-01', 'UTC').status).toBe('behind'); // 2 < 4 on the last day
    expect(postsPerWeekProgress(goal('posts_per_week', 2), posts, week, '2026-10-27', 'UTC').status).toBe('done');
  });

  it('a week across the DST change keeps owner-timezone days', () => {
    const w = { from: '2026-10-19', to: '2026-10-25' };
    // 25 Oct 2026 23:30 in London (BST ended at 01:00 UTC that day) = 23:30 UTC; 26 Oct 00:30 London = 00:30 UTC
    const p = postsPerWeekProgress(goal('posts_per_week', 1), [post('a', '2026-10-25T23:30:00Z', 1), post('b', '2026-10-26T00:30:00Z', 1)], w, '2026-10-25', 'Europe/London');
    expect(p.actual).toBe(1);
  });
});
