import { describe, expect, it } from 'vitest';
import { bucketize } from '@/lib/analysis/buckets';
import { addDays } from '@/lib/sync/time';

type R = { day: string; reach: number | null; followers: number | null };
/** n consecutive days from `start`, values from f(i). */
const days = (start: string, n: number, f: (i: number) => Partial<R> = () => ({})): R[] => Array.from({ length: n }, (_, i) => ({ day: addDays(start, i), reach: null, followers: null, ...f(i) }));
const AGG = { reach: 'sum', followers: 'last' } as const;

describe('bucketize', () => {
  it('day granularity keeps every day, nothing partial', () => {
    const rows = days('2026-10-01', 3, (i) => ({ reach: i, followers: 10 + i }));
    expect(bucketize(rows, 'day', 'mon', AGG)).toEqual({ rows, partial: [] });
  });

  it('weeks start on the week-start preference; sums skip missing days; the first and last weeks are partial', () => {
    // Thu 1 Oct 2026 .. Wed 14 Oct 2026 (Mon weeks: 28 Sep, 5 Oct, 12 Oct)
    const rows = days('2026-10-01', 14, (i) => ({ reach: i === 5 ? null : 10, followers: i === 13 ? null : 100 + i }));
    const out = bucketize(rows, 'week', 'mon', AGG);
    expect(out.rows).toEqual([
      { day: '2026-09-28', reach: 40, followers: 103 },
      { day: '2026-10-05', reach: 60, followers: 110 }, // 6 Oct had no reach: 6 × 10, not 7 × 10 or a zero
      { day: '2026-10-12', reach: 30, followers: 112 }, // followers: the last value the bucket has
    ]);
    expect(out.partial).toEqual(['2026-09-28', '2026-10-12']);
    expect(bucketize(rows, 'week', 'sun', AGG).rows.map((r) => r.day)).toEqual(['2026-09-27', '2026-10-04', '2026-10-11']);
  });

  it('a bucket with no value at all stays null, never 0', () => {
    const out = bucketize(days('2026-10-05', 14, (i) => ({ reach: i < 7 ? null : 5 })), 'week', 'mon', AGG);
    expect(out.rows).toEqual([
      { day: '2026-10-05', reach: null, followers: null },
      { day: '2026-10-12', reach: 35, followers: null },
    ]);
    expect(out.partial).toEqual([]);
  });

  it('months: whole months are not partial, cut ones are; leap February', () => {
    const rows = days('2028-01-15', 60, () => ({ reach: 1 })); // 15 Jan .. 14 Mar 2028
    const out = bucketize(rows, 'month', 'mon', AGG);
    expect(out.rows.map((r) => [r.day, r.reach])).toEqual([
      ['2028-01-01', 17],
      ['2028-02-01', 29],
      ['2028-03-01', 14],
    ]);
    expect(out.partial).toEqual(['2028-01-01', '2028-03-01']);
  });

  it('no rows: no buckets', () => {
    expect(bucketize([], 'month', 'mon', AGG)).toEqual({ rows: [], partial: [] });
  });
});
