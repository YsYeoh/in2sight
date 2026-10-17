import { describe, expect, it } from 'vitest';
import { buildCalendar, calendarRange } from '@/lib/dashboard/calendar';
import type { MonthMedia } from '@/lib/dashboard/detail-read';
import { formatMonth } from '@/lib/format';

const media = (id: string, postedAt: string, mediaType: MonthMedia['mediaType'] = 'IMAGE'): MonthMedia => ({ id, accountId: 'a1', mediaType, postedAt, permalink: null, caption: null });
const OCT = { from: '2026-10-01', to: '2026-10-31' };

describe('calendarRange', () => {
  it('whole weeks around the range from the user week start; Monday vs Sunday', () => {
    const mon = calendarRange(OCT, 'mon', 'UTC'); // 1 Oct 2026 is a Thursday
    expect(mon.days[0]).toBe('2026-09-28');
    expect(mon.days).toHaveLength(35);
    expect(mon.days[34]).toBe('2026-11-01');
    const sun = calendarRange(OCT, 'sun', 'UTC');
    expect(sun.days[0]).toBe('2026-09-27');
    expect(sun.days.length % 7).toBe(0);
    expect(sun.days.at(-1)).toBe('2026-10-31');
  });

  it('any range: 30 days that start mid-week, a whole year', () => {
    const r = calendarRange({ from: '2026-09-16', to: '2026-10-15' }, 'mon', 'UTC');
    expect([r.days[0], r.days.at(-1), r.days.length]).toEqual(['2026-09-14', '2026-10-18', 35]);
    expect(calendarRange({ from: '2025-10-16', to: '2026-10-15' }, 'mon', 'UTC').days).toHaveLength(53 * 7);
  });

  it('bounds are owner-timezone midnights (Kuala Lumpur is UTC+8)', () => {
    const r = calendarRange(OCT, 'mon', 'Asia/Kuala_Lumpur');
    expect(r.fromIso).toBe('2026-09-27T16:00:00.000Z');
    expect(r.toIso).toBe('2026-11-01T16:00:00.000Z');
  });

  it('DST month in New York: the start is EDT midnight, the end is EST midnight', () => {
    const r = calendarRange({ from: '2026-11-01', to: '2026-11-30' }, 'sun', 'America/New_York'); // DST ends Sun 1 Nov 2026
    expect(r.days[0]).toBe('2026-11-01');
    expect(r.fromIso).toBe('2026-11-01T04:00:00.000Z');
    expect(r.toIso).toBe('2026-12-06T05:00:00.000Z');
  });
});

describe('buildCalendar', () => {
  it('posts bin by owner-timezone day across the range edge; stories counted apart; days outside the range marked', () => {
    const m = buildCalendar(OCT, [media('a', '2026-09-30T16:30:00Z'), media('s', '2026-10-01T02:00:00Z', 'STORY'), media('b', '2026-10-31T15:59:00Z'), media('c', '2026-10-31T16:00:00Z')], { weekStart: 'mon', tz: 'Asia/Kuala_Lumpur', today: '2026-10-15' });
    const cell = (d: string) => m.weeks.flat().find((c) => c.day === d)!;
    expect(cell('2026-10-01')).toMatchObject({ posts: 1, stories: 1, inRange: true });
    expect(cell('2026-10-01').items.map((i) => i.id)).toEqual(['a', 's']);
    expect(cell('2026-09-30')).toMatchObject({ posts: 0, inRange: false });
    expect(cell('2026-10-31').posts).toBe(1);
    expect(cell('2026-11-01')).toMatchObject({ posts: 1, inRange: false });
    expect(cell('2026-10-15').isToday).toBe(true);
    expect(m.range).toEqual(OCT);
    expect(m.weeks.every((w) => w.length === 7)).toBe(true);
  });

  it('DST fall-back in New York: 23:30 local on 1 Nov (EST, 04:30Z next day) stays on 1 Nov', () => {
    const m = buildCalendar({ from: '2026-11-01', to: '2026-11-30' }, [media('early', '2026-11-01T04:30:00Z'), media('late', '2026-11-02T04:30:00Z')], { weekStart: 'sun', tz: 'America/New_York', today: '2026-11-15' });
    expect(m.weeks[0][0]).toMatchObject({ day: '2026-11-01', posts: 2 });
  });

  it('an empty range', () => {
    const m = buildCalendar({ from: '2026-12-01', to: '2026-12-31' }, [], { weekStart: 'mon', tz: 'UTC', today: '2026-10-15' });
    expect(m.weeks.flat().every((c) => c.posts === 0 && c.stories === 0 && !c.isToday)).toBe(true);
  });
});

describe('formatMonth', () => {
  it('formats a month in both languages; junk becomes a dash', () => {
    expect(formatMonth('2026-10', { locale: 'en' })).toBe('October 2026');
    expect(formatMonth('2026-10', { locale: 'zh-CN' })).toBe('2026年10月'); // 2026 nian 10 yue
    expect(formatMonth('2026-13', { locale: 'en' })).toBe('—');
  });
});
