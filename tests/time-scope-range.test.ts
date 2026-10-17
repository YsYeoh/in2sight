import { describe, expect, it } from 'vitest';
import { addMonths, autoGranularity, bucketRange, bucketStart, compareRange, daysBetween, daysIn, isDay, lastYear, monthOf, quarterOf, stepRange, weekOf, wholeMonths } from '@/lib/time-scope/range';

describe('isDay', () => {
  it('accepts real days of 2000-2099 only', () => {
    for (const ok of ['2026-10-17', '2028-02-29', '2000-01-01', '2099-12-31']) expect(isDay(ok), ok).toBe(true);
    for (const bad of ['2026-02-29', '2026-13-01', '2026-00-10', '2026-1-1', '1999-12-31', '2100-01-01', '20261017', ' 2026-10-17', '2026-10-17T00:00', 20261017, null, undefined, ['2026-10-17']])
      expect(isDay(bad), String(bad)).toBe(false);
  });
});

describe('day arithmetic', () => {
  it('counts inclusive days across months, leap days and years', () => {
    expect(daysBetween('2026-10-01', '2026-10-31')).toBe(30);
    expect(daysIn({ from: '2026-10-01', to: '2026-10-31' })).toBe(31);
    expect(daysIn({ from: '2028-02-01', to: '2028-03-01' })).toBe(30);
    expect(daysIn({ from: '2025-10-18', to: '2026-10-17' })).toBe(365);
  });
  it('moves by months and clamps the day of the month', () => {
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonths('2028-03-31', -1)).toBe('2028-02-29');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
    expect(addMonths('2026-12-31', 2)).toBe('2027-02-28');
    expect(addMonths('2028-02-29', -12)).toBe('2027-02-28');
  });
});

describe('pickers', () => {
  it('week of a day honours the week start (Wed 14 Oct 2026)', () => {
    expect(weekOf('2026-10-14', 'mon')).toEqual({ from: '2026-10-12', to: '2026-10-18' });
    expect(weekOf('2026-10-14', 'sun')).toEqual({ from: '2026-10-11', to: '2026-10-17' });
    expect(weekOf('2026-10-11', 'mon')).toEqual({ from: '2026-10-05', to: '2026-10-11' }); // a Sunday ends a Monday week
    expect(weekOf('2027-01-01', 'mon')).toEqual({ from: '2026-12-28', to: '2027-01-03' }); // across the new year
  });
  it('month and quarter', () => {
    expect(monthOf('2028-02-10')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(quarterOf('2026-08-31')).toEqual({ from: '2026-07-01', to: '2026-09-30' });
    expect(quarterOf('2026-12-31')).toEqual({ from: '2026-10-01', to: '2026-12-31' });
    expect(quarterOf('2026-01-01')).toEqual({ from: '2026-01-01', to: '2026-03-31' });
  });
  it('whole months: a month, a quarter, a year; anything else is 0', () => {
    expect(wholeMonths({ from: '2026-09-01', to: '2026-09-30' })).toBe(1);
    expect(wholeMonths({ from: '2026-07-01', to: '2026-09-30' })).toBe(3);
    expect(wholeMonths({ from: '2025-01-01', to: '2025-12-31' })).toBe(12);
    expect(wholeMonths({ from: '2026-09-01', to: '2026-09-29' })).toBe(0);
    expect(wholeMonths({ from: '2026-09-02', to: '2026-09-30' })).toBe(0);
  });
});

describe('stepRange / lastYear', () => {
  it('whole months step by whole months, other ranges by their own length', () => {
    expect(stepRange({ from: '2026-10-01', to: '2026-10-31' }, -1)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(stepRange({ from: '2026-03-01', to: '2026-03-31' }, -1)).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(stepRange({ from: '2026-07-01', to: '2026-09-30' }, -1)).toEqual({ from: '2026-04-01', to: '2026-06-30' });
    expect(stepRange({ from: '2026-11-01', to: '2026-11-30' }, 1)).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    expect(stepRange({ from: '2026-10-12', to: '2026-10-18' }, -1)).toEqual({ from: '2026-10-05', to: '2026-10-11' });
    expect(stepRange({ from: '2026-10-01', to: '2026-10-31' }, -1, false)).toEqual({ from: '2026-08-31', to: '2026-09-30' });
  });
  it('a year earlier keeps month ends and clamps 29 Feb', () => {
    expect(lastYear({ from: '2026-09-01', to: '2026-09-30' })).toEqual({ from: '2025-09-01', to: '2025-09-30' });
    expect(lastYear({ from: '2029-02-01', to: '2029-02-28' })).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(lastYear({ from: '2028-02-29', to: '2028-03-10' })).toEqual({ from: '2027-02-28', to: '2027-03-10' });
  });
});

describe('compareRange', () => {
  it('rolling windows move by days (the existing "previous N days")', () => {
    expect(compareRange({ last: 30 }, { from: '2026-09-15', to: '2026-10-14' }, 'prev')).toEqual({ from: '2026-08-16', to: '2026-09-14' });
    // even when the rolling window happens to be a whole month
    expect(compareRange({ last: 30 }, { from: '2026-09-01', to: '2026-09-30' }, 'prev')).toEqual({ from: '2026-08-02', to: '2026-08-31' });
    expect(compareRange({ last: 7 }, { from: '2026-10-08', to: '2026-10-14' }, 'yoy')).toEqual({ from: '2025-10-08', to: '2025-10-14' });
  });
  it('a running month compares with the same days of the previous month, a finished one with the whole month', () => {
    const oct = { from: '2026-10-01', to: '2026-10-31' };
    expect(compareRange(oct, { from: '2026-10-01', to: '2026-10-15' }, 'prev')).toEqual({ from: '2026-09-01', to: '2026-09-15' });
    expect(compareRange(oct, { from: '2026-10-01', to: '2026-10-15' }, 'yoy')).toEqual({ from: '2025-10-01', to: '2025-10-15' });
    const sep = { from: '2026-09-01', to: '2026-09-30' };
    expect(compareRange(sep, sep, 'prev')).toEqual({ from: '2026-08-01', to: '2026-08-30' }); // cut to 30 days, aligned on the 1st
    const q = { from: '2026-04-01', to: '2026-06-30' };
    expect(compareRange(q, q, 'prev')).toEqual({ from: '2026-01-01', to: '2026-03-31' }); // Q1 has 90 days, Q2 91: never longer than the current
  });
  it('a running week compares with the same weekdays of the previous week', () => {
    expect(compareRange({ from: '2026-10-12', to: '2026-10-18' }, { from: '2026-10-12', to: '2026-10-15' }, 'prev')).toEqual({ from: '2026-10-05', to: '2026-10-08' });
  });
  it('custom comparison days are used as given, cut to the current length; none gives null', () => {
    const cur = { from: '2026-10-01', to: '2026-10-10' };
    expect(compareRange(cur, cur, { from: '2026-01-01', to: '2026-03-31' })).toEqual({ from: '2026-01-01', to: '2026-01-10' });
    expect(compareRange(cur, cur, { from: '2026-01-01', to: '2026-01-05' })).toEqual({ from: '2026-01-01', to: '2026-01-05' });
    expect(compareRange(cur, cur, 'none')).toBeNull();
  });
});

describe('granularity', () => {
  it('auto: days up to 92, weeks up to 400, then months', () => {
    expect([7, 30, 90, 92, 93, 182, 365, 400, 401, 1830].map(autoGranularity)).toEqual(['day', 'day', 'day', 'day', 'week', 'week', 'week', 'week', 'month', 'month']);
  });
  it('bucket start and span', () => {
    expect(bucketStart('2026-10-14', 'day', 'mon')).toBe('2026-10-14');
    expect(bucketStart('2026-10-14', 'week', 'sun')).toBe('2026-10-11');
    expect(bucketStart('2026-10-14', 'month', 'mon')).toBe('2026-10-01');
    expect(bucketRange('2026-10-12', 'week')).toEqual({ from: '2026-10-12', to: '2026-10-18' });
    expect(bucketRange('2026-02-01', 'month')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });
});
