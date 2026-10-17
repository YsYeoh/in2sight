import { describe, expect, it } from 'vitest';
import { addDays, dayRangeSec, dayStart, daysToIso, localDay, localHour } from '@/lib/sync/time';

const KL = 'Asia/Kuala_Lumpur'; // UTC+8, no DST
const NY = 'America/New_York'; // DST: 2026-03-08 starts, 2026-11-01 ends

describe('localDay / localHour', () => {
  it('uses the owner timezone, not UTC', () => {
    const at = new Date('2026-10-13T16:30:00Z');
    expect(localDay(at, KL)).toBe('2026-10-14');
    expect(localHour(at, KL)).toBe(0);
    expect(localDay(at, 'UTC')).toBe('2026-10-13');
  });
  it('midnight is hour 0, never 24', () => {
    expect(localHour(new Date('2026-10-14T04:00:00Z'), NY)).toBe(0);
  });
});

describe('addDays', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    expect(addDays('2026-10-14', -89)).toBe('2026-07-17');
  });
});

describe('dayStart', () => {
  it('fixed-offset zone', () => {
    expect(dayStart('2026-10-14', KL).toISOString()).toBe('2026-10-13T16:00:00.000Z');
  });
  it('handles the spring-forward day (23h) and the day after', () => {
    expect(dayStart('2026-03-08', NY).toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(dayStart('2026-03-09', NY).toISOString()).toBe('2026-03-09T04:00:00.000Z');
    const r = dayRangeSec('2026-03-08', NY);
    expect(r.until - r.since).toBe(23 * 3600);
  });
  it('handles the fall-back day (25h)', () => {
    expect(dayStart('2026-11-01', NY).toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(dayStart('2026-11-02', NY).toISOString()).toBe('2026-11-02T05:00:00.000Z');
    const r = dayRangeSec('2026-11-01', NY);
    expect(r.until - r.since).toBe(25 * 3600);
  });
  it('daysToIso: posted_at bounds of a range across the DST changes cover whole owner days (47 h and 49 h)', () => {
    const spring = daysToIso('2026-03-07', '2026-03-08', NY);
    expect(spring).toEqual({ fromIso: '2026-03-07T05:00:00.000Z', toIso: '2026-03-09T04:00:00.000Z' });
    expect(Date.parse(spring.toIso) - Date.parse(spring.fromIso)).toBe(47 * 3600_000);
    const fall = daysToIso('2026-10-31', '2026-11-01', NY);
    expect(fall).toEqual({ fromIso: '2026-10-31T04:00:00.000Z', toIso: '2026-11-02T05:00:00.000Z' });
    expect(Date.parse(fall.toIso) - Date.parse(fall.fromIso)).toBe(49 * 3600_000);
    expect(daysToIso('2026-10-14', '2026-10-14', KL)).toEqual({ fromIso: '2026-10-13T16:00:00.000Z', toIso: '2026-10-14T16:00:00.000Z' });
  });
  it('round-trips with localDay', () => {
    for (const tz of [KL, NY, 'Europe/London', 'Australia/Sydney', 'Asia/Kolkata']) {
      for (const day of ['2026-01-15', '2026-03-29', '2026-04-05', '2026-10-04', '2026-10-25', '2026-11-01']) {
        expect(localDay(dayStart(day, tz), tz), `${tz} ${day}`).toBe(day);
        expect(localDay(new Date(dayStart(day, tz).getTime() - 1000), tz), `${tz} ${day} -1s`).toBe(addDays(day, -1));
      }
    }
  });
});
