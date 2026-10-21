import { describe, expect, it } from 'vitest';
import { ANOMALY, PROJECTION, projectFollowers, robustZ, weekdayAnomaly, type Anomaly, type Projection } from '@/lib/analysis/trend';
import { addDays } from '@/lib/sync/time';

const WED = '2026-10-14'; // a Wednesday
/** The same weekday 1, 2, 3 … weeks before WED get vals[0], vals[1], vals[2] …; `extra` sets any other day. */
const weekly = (vals: (number | null)[], extra: Record<string, number | null> = {}) => ({ ...Object.fromEntries(vals.map((v, i) => [addDays(WED, -7 * (i + 1)), v])), ...extra });
const series = (start: string, vals: number[]) => vals.map((value, i) => ({ day: addDays(start, i), value }));
const NORMAL = [10, 12, 11, 13, 9, 10, 12, 11]; // median 11, MAD 1

describe('robustZ', () => {
  it('is the modified z-score: (v − median) / (1.4826 × MAD)', () => {
    expect(robustZ(30, NORMAL)).toBeCloseTo(12.815, 3);
    expect(robustZ(11, NORMAL)).toBe(0);
  });

  it('a MAD of 0 falls back to 1.2533 × the mean absolute deviation; an identical or empty history has no z', () => {
    expect(robustZ(9, [5, 5, 5, 5, 9])).toBeCloseTo(3.989, 3);
    expect(robustZ(9, [5, 5, 5, 5])).toBeNull();
    expect(robustZ(5, [])).toBeNull();
  });
});

describe('weekdayAnomaly', () => {
  it('a value far above the same weekday of the 8 weeks before is unusual; other weekdays and older weeks are ignored', () => {
    const r = weekdayAnomaly(weekly(NORMAL, { [WED]: 30, [addDays(WED, -1)]: 1000, [addDays(WED, -63)]: 500 }), WED) as Anomaly;
    expect(r).toMatchObject({ value: 30, median: 11, n: 8, unusual: true, direction: 'up' });
    expect(r.z).toBeCloseTo(12.815, 3);
  });

  it('far below is unusual too (direction down); a usual value is not', () => {
    expect(weekdayAnomaly(weekly(NORMAL, { [WED]: 0 }), WED)).toMatchObject({ unusual: true, direction: 'down' });
    const r = weekdayAnomaly(weekly(NORMAL, { [WED]: 12 }), WED) as Anomaly;
    expect(r).toMatchObject({ unusual: false, direction: 'up' });
    expect(r.z).toBeCloseTo(0.674, 3);
  });

  it('no value on the day → null; fewer than 4 same-weekday values (nulls skipped) → few_samples', () => {
    expect(weekdayAnomaly(weekly(NORMAL), WED)).toBeNull();
    expect(weekdayAnomaly(weekly(NORMAL, { [WED]: null }), WED)).toBeNull();
    expect(weekdayAnomaly(weekly([10, null, 12, null, 11], { [WED]: 50 }), WED)).toEqual({ reason: 'few_samples', n: 3 });
    expect(ANOMALY.minSamples).toBe(4);
  });

  it('tiny or relatively small changes are never unusual: |v − median| must reach max(3, 10 % of the median)', () => {
    expect(weekdayAnomaly(weekly([0, 0, 0, 0, 1, 0, 0, 0], { [WED]: 2 }), WED)).toMatchObject({ unusual: false }); // z ≈ 12.8 but only +2
    expect(weekdayAnomaly(weekly([0, 0, 0, 0], { [WED]: 3 }), WED)).toMatchObject({ z: null, unusual: true, direction: 'up' }); // identical history, +3
    expect(weekdayAnomaly(weekly([1000, 1000, 1010, 990, 1000, 1005, 995, 1000], { [WED]: 1080 }), WED)).toMatchObject({ median: 1000, unusual: false }); // z ≈ 21.6 but +80 < 100
  });
});

describe('projectFollowers', () => {
  it('a steady line: the exact numbers, no band, medium confidence', () => {
    expect(projectFollowers(series('2026-09-17', Array.from({ length: 28 }, (_, i) => 1000 + 10 * i)))).toEqual({
      method: 'median_slope',
      n: 28,
      from: '2026-09-17',
      to: '2026-10-14',
      last: 1270,
      perDay: 10,
      confidence: 'medium',
      horizons: [
        { days: 7, value: 1340, low: 1340, high: 1340 },
        { days: 30, value: 1570, low: 1570, high: 1570 },
        { days: 90, value: 2170, low: 2170, high: 2170 },
      ],
    });
  });

  it('noisy growth: the band is the 25th–75th percentile of the pair slopes, rounded to the band’s precision', () => {
    const noise = [0, 4, -3, 6, -5, 2, 0, -4, 7, -1, 3, -6, 5, 0, -2, 4, -3, 1, 6, -4, 0];
    const p = projectFollowers(series('2026-09-24', noise.map((x, i) => 1000 + 10 * i + x))) as Projection;
    expect(p).toMatchObject({ n: 21, from: '2026-09-24', to: '2026-10-14', last: 1200, perDay: 10, confidence: 'medium' });
    expect(p.horizons).toEqual([
      { days: 7, value: 1270, low: 1265, high: 1275 },
      { days: 30, value: 1500, low: 1480, high: 1520 },
      { days: 90, value: 2100, low: 2000, high: 2200 },
    ]);
  });

  it('no clear direction (the middle half of the slopes spans zero) → low confidence', () => {
    const p = projectFollowers(series('2026-09-24', Array.from({ length: 21 }, (_, i) => 1000 + (i % 2 ? 8 : -8)))) as Projection;
    expect(p).toMatchObject({ n: 21, last: 992, perDay: 0, confidence: 'low' });
    expect(p.horizons).toEqual([
      { days: 7, value: 990, low: 980, high: 1000 },
      { days: 30, value: 990, low: 960, high: 1030 },
      { days: 90, value: 1000, low: 900, high: 1100 },
    ]);
  });

  it('uses only the 28 days ending on the latest count (any order); under 14 counts → not enough history', () => {
    const steady = series('2026-09-17', Array.from({ length: 28 }, (_, i) => 1000 + 10 * i));
    const withOld = [...steady, { day: '2026-09-15', value: 0 }, { day: '2026-09-16', value: 5000 }].reverse();
    expect(projectFollowers(withOld)).toMatchObject({ n: 28, from: '2026-09-17', perDay: 10 });
    expect(projectFollowers(steady.slice(0, 13))).toEqual({ reason: 'not_enough_history', n: 13 });
    expect(projectFollowers([])).toEqual({ reason: 'not_enough_history', n: 0 });
    expect(PROJECTION.minPoints).toBe(14);
  });

  it('never projects below zero; 14–20 counts are low confidence', () => {
    const p = projectFollowers(series('2026-10-01', Array.from({ length: 14 }, (_, i) => 100 - 7 * i))) as Projection;
    expect(p).toMatchObject({ n: 14, last: 9, perDay: -7, confidence: 'low' });
    expect(p.horizons.map((h) => [h.value, h.low, h.high])).toEqual([[0, 0, 0], [0, 0, 0], [0, 0, 0]]);
  });
});
