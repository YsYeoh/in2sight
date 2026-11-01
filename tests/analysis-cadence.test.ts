import { describe, expect, it } from 'vitest';
import { cadence, frequency, FREQ_MIN_WEEKS } from '@/lib/analysis/cadence';
import { addDays } from '@/lib/sync/time';

const RANGE = { from: '2026-10-01', to: '2026-10-28' }; // Thursday to Wednesday: 4 weeks
const base = { postDays: [] as string[], lastPostDay: null as string | null, storyDays: {} as Record<string, number>, storiesFrom: '2026-10-01', range: RANGE, today: '2026-10-28', weekStart: 'mon' as const };

describe('cadence', () => {
  it('posts per week, longest and usual gap, the "no post for N days" warning, streaks', () => {
    const c = cadence({ ...base, postDays: ['2026-10-12', '2026-10-02', '2026-10-02', '2026-10-05', '2026-10-09', '2026-10-20', '2026-09-20'], lastPostDay: '2026-10-20' });
    expect(c.posts).toBe(6); // 2026-09-20 is outside the range
    expect(c.perWeek).toBeCloseTo(1.5);
    expect(c.longestGap).toEqual({ days: 8, from: '2026-10-12', to: '2026-10-20' });
    expect(c.usualGap).toBe(3.5); // gaps 3, 4, 3, 8 between posting days (two posts on one day are one day)
    expect(c.sinceLast).toBe(8);
    expect(c.warn).toBe(true); // 8 > 2 × 3.5
    expect(c.streak).toEqual({ current: 4, best: 4 }); // the running week (from 2026-10-26) has no post yet and does not break it
  });

  it('a post in the running week counts; a range that does not end today has no current streak', () => {
    const days = ['2026-10-02', '2026-10-27'];
    expect(cadence({ ...base, postDays: days, lastPostDay: '2026-10-27' }).streak).toEqual({ current: 1, best: 1 });
    expect(cadence({ ...base, postDays: days, lastPostDay: '2026-10-27', range: { from: '2026-10-01', to: '2026-10-27' } }).streak.current).toBeNull();
  });

  it('no posts: nothing to measure, never a fake zero gap', () => {
    const c = cadence(base);
    expect([c.posts, c.perWeek, c.longestGap, c.usualGap, c.sinceLast, c.warn]).toEqual([0, 0, null, null, null, false]);
    expect(c.streak).toEqual({ current: 0, best: 0 });
  });

  it('under 5 posting days there is no usual gap and no warning', () => {
    const c = cadence({ ...base, postDays: ['2026-10-01', '2026-10-03', '2026-10-05', '2026-10-07'], lastPostDay: '2026-10-07' });
    expect(c.usualGap).toBeNull();
    expect(c.warn).toBe(false);
    expect(c.sinceLast).toBe(21);
  });

  it('Story days count only from the first day Stories are known', () => {
    const c = cadence({ ...base, storyDays: { '2026-09-30': 3, '2026-10-05': 1, '2026-10-10': 2, '2026-10-11': 0, '2026-10-20': 1 }, storiesFrom: '2026-10-08' });
    expect(c.stories).toEqual({ range: { from: '2026-10-08', to: '2026-10-28' }, days: 2, perWeek: 2 / 3 });
    expect(cadence({ ...base, storiesFrom: '2026-10-29' }).stories).toBeNull();
    expect(cadence({ ...base, storiesFrom: '2020-01-01' }).stories?.range.from).toBe('2026-10-01');
  });
});

describe('frequency', () => {
  const MON = '2026-08-03'; // a Monday: 9 complete weeks to 2026-10-04
  const range = { from: MON, to: '2026-10-04' };
  const week = (i: number, n: number, reach: number | null) => Array.from({ length: n }, () => ({ day: addDays(MON, i * 7 + 1), reach }));

  it('complete weeks grouped by posts per week (5 or more is one row), median reach per post from 5 measured posts', () => {
    const posts = [0, 1, 2].flatMap((i) => week(i, 1, 100)).concat([3, 4, 5].flatMap((i) => week(i, 2, 200)), [6, 7, 8].flatMap((i) => week(i, 6, 50)));
    expect(frequency(posts, range, 'mon')).toEqual({
      weeks: 9,
      rows: [
        { perWeek: 1, weeks: 3, measured: 3, medianReach: null },
        { perWeek: 2, weeks: 3, measured: 6, medianReach: 200 },
        { perWeek: 5, weeks: 3, measured: 18, medianReach: 50 },
      ],
    });
  });

  it(`null below ${FREQ_MIN_WEEKS} complete weeks with a post; a partial week at either end is left out`, () => {
    const posts = [0, 1, 2, 3, 4, 5, 6, 7, 8].flatMap((i) => week(i, 1, 100));
    expect(frequency(posts, { from: addDays(MON, 2), to: '2026-10-04' }, 'mon')?.weeks).toBe(8); // the range starts on a Wednesday: that week is left out
    expect(frequency(posts, { from: addDays(MON, 2), to: '2026-10-03' }, 'mon')).toBeNull(); // and ends on a Saturday: 7 complete weeks
    expect(frequency(posts.slice(1), range, 'mon')?.weeks).toBe(8);
  });
});
