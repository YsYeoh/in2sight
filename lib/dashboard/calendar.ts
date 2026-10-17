// Calendar model: whole weeks around the Time Scope's days, with the published posts and Stories binned by the
// OWNER-timezone day (SPEC section 7 "Daily boundaries ... displayed in the user's timezone"). Pure: today and tz are inputs.
import { snippet } from '@/lib/dashboard/content';
import type { MonthMedia } from '@/lib/dashboard/detail-read';
import type { WeekStart } from '@/lib/prefs';
import { addDays, daysToIso, localDay } from '@/lib/sync/time';
import { daysIn, weekOf, type DayRange } from '@/lib/time-scope/range';

export interface CalendarItem {
  id: string;
  accountId: string;
  mediaType: MonthMedia['mediaType'];
  postedAt: string;
  permalink: string | null;
  caption: string | null; // snippet
}
export interface CalendarDay {
  day: string;
  inRange: boolean; // inside the scope's days (the rest of the first and last week is dimmed)
  isToday: boolean;
  posts: number; // feed posts + reels
  stories: number;
  items: CalendarItem[]; // oldest first
}
export interface CalendarModel {
  range: DayRange;
  weeks: CalendarDay[][]; // whole weeks starting on the user's week start
}

/** The grid's days (whole weeks around the range) and the [fromIso, toIso) instants that bound them in the owner's timezone. */
export function calendarRange(range: DayRange, weekStart: WeekStart, tz: string): { days: string[]; fromIso: string; toIso: string } {
  const start = weekOf(range.from, weekStart).from;
  const end = weekOf(range.to, weekStart).to;
  const days = Array.from({ length: daysIn({ from: start, to: end }) }, (_, i) => addDays(start, i));
  return { days, ...daysToIso(start, end, tz) };
}

export function buildCalendar(range: DayRange, media: MonthMedia[], o: { weekStart: WeekStart; tz: string; today: string }): CalendarModel {
  const { days } = calendarRange(range, o.weekStart, o.tz);
  const byDay = new Map<string, CalendarItem[]>();
  const sorted = [...media].sort((a, b) => (a.postedAt === b.postedAt ? (a.id < b.id ? -1 : 1) : a.postedAt < b.postedAt ? -1 : 1));
  for (const m of sorted) {
    const at = new Date(m.postedAt);
    if (Number.isNaN(at.getTime())) continue;
    const day = localDay(at, o.tz);
    byDay.set(day, [...(byDay.get(day) ?? []), { id: m.id, accountId: m.accountId, mediaType: m.mediaType, postedAt: m.postedAt, permalink: m.permalink, caption: snippet(m.caption) }]);
  }
  const cells = days.map((day) => {
    const items = byDay.get(day) ?? [];
    const stories = items.filter((i) => i.mediaType === 'STORY').length;
    return { day, inRange: day >= range.from && day <= range.to, isToday: day === o.today, posts: items.length - stories, stories, items };
  });
  return { range, weeks: Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7)) };
}
