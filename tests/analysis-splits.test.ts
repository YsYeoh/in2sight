import { describe, expect, it } from 'vitest';
import { bandOf, daypartAt, splitBy, SPLIT_MIN } from '@/lib/analysis/splits';

describe('daypartAt', () => {
  it('owner-timezone hour bands: night 0-5, morning 6-11, afternoon 12-17, evening 18-23', () => {
    const KL = 'Asia/Kuala_Lumpur'; // UTC+8
    expect(daypartAt('2026-10-01T21:59:00Z', KL)).toBe('night'); // 05:59
    expect(daypartAt('2026-10-01T22:00:00Z', KL)).toBe('morning'); // 06:00
    expect(daypartAt('2026-10-01T04:00:00Z', KL)).toBe('afternoon'); // 12:00
    expect(daypartAt('2026-10-01T10:00:00Z', KL)).toBe('evening'); // 18:00
    expect(daypartAt('2026-10-01T15:59:00Z', KL)).toBe('evening'); // 23:59
  });

  it('follows daylight saving time (Europe/London)', () => {
    expect(daypartAt('2026-03-28T05:30:00Z', 'Europe/London')).toBe('night'); // 05:30 GMT
    expect(daypartAt('2026-03-29T05:30:00Z', 'Europe/London')).toBe('morning'); // 06:30 BST (clocks went forward at 01:00 UTC)
    expect(daypartAt('2026-10-24T05:30:00Z', 'Europe/London')).toBe('morning'); // 06:30 BST
    expect(daypartAt('2026-10-25T05:30:00Z', 'Europe/London')).toBe('night'); // 05:30 GMT (clocks went back at 01:00 UTC)
  });
});

describe('bandOf', () => {
  it('none, short up to 125, medium up to 500, long', () => {
    expect([0, 1, 125, 126, 500, 501].map(bandOf)).toEqual(['none', 'short', 'short', 'medium', 'medium', 'long']);
  });
});

describe('splitBy', () => {
  const p = (k: string, reach: number | null) => ({ k, reach });

  it('rows in key order, empty keys left out, median only from SPLIT_MIN measured posts (reach 0 or missing is not measured)', () => {
    const posts = [...Array.from({ length: SPLIT_MIN }, (_, i) => p('b', 10 * (i + 1))), p('b', 0), p('b', null), p('a', 7)];
    expect(splitBy(posts, ['a', 'b', 'c'] as const, (x) => x.k as 'a' | 'b' | 'c')).toEqual([
      { key: 'a', posts: 1, n: 1, medianReach: null },
      { key: 'b', posts: 7, n: 5, medianReach: 30 },
    ]);
    expect(splitBy([], ['a'] as const, () => 'a')).toEqual([]);
  });
});
