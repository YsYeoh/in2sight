// Calendar model: a month grid of published posts and Stories, binned by the OWNER-timezone day (SPEC section 7
// "Daily boundaries ... displayed in the user's timezone"). Pure: today and tz are inputs.
import { snippet } from '@/lib/dashboard/content';
import type { MonthMedia } from '@/lib/dashboard/detail-read';
import type { WeekStart } from '@/lib/prefs';
import { addDays, dayStart, localDay } from '@/lib/sync/time';

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
  inMonth: boolean;
  isToday: boolean;
  posts: number; // feed posts + reels
  stories: number;
  items: CalendarItem[]; // oldest first
}
export interface MonthModel {
  month: string; // 'YYYY-MM'
  prev: string;
  next: string;
  weeks: CalendarDay[][]; // whole weeks starting on the user's week start
}

/** ?month=YYYY-MM; anything else (2026-13, arrays, junk) falls back to the month of `today`. */
export function parseMonth(v: unknown, today: string): string {
  return typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : today.slice(0, 7);
}

function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

/** The grid's days (whole weeks) and the [fromIso, toIso) instants that bound them in the owner's timezone. */
export function monthRange(month: string, weekStart: WeekStart, tz: string): { days: string[]; fromIso: string; toIso: string } {
  const first = `${month}-01`;
  const last = addDays(`${shiftMonth(month, 1)}-01`, -1);
  const offset = (new Date(`${first}T00:00:00Z`).getUTCDay() - (weekStart === 'sun' ? 0 : 1) + 7) % 7;
  const start = addDays(first, -offset);
  const span = Math.ceil((offset + Number(last.slice(8))) / 7) * 7;
  const days = Array.from({ length: span }, (_, i) => addDays(start, i));
  return { days, fromIso: dayStart(days[0], tz).toISOString(), toIso: dayStart(addDays(days[days.length - 1], 1), tz).toISOString() };
}

export function buildMonth(month: string, media: MonthMedia[], o: { weekStart: WeekStart; tz: string; today: string }): MonthModel {
  const { days } = monthRange(month, o.weekStart, o.tz);
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
    return { day, inMonth: day.startsWith(month), isToday: day === o.today, posts: items.length - stories, stories, items };
  });
  return { month, prev: shiftMonth(month, -1), next: shiftMonth(month, 1), weeks: Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7)) };
}
