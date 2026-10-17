// Calendar arithmetic on owner-timezone days ('YYYY-MM-DD' strings, exactly what the sync writes). Pure and
// timezone-free: a day string has no clock, so DST can never shift it. The ONLY place a day becomes an instant is
// dayStart() in lib/sync/time.ts (used by the loaders for posted_at bounds).
import { weekdayOf } from '@/lib/analysis/best-time';
import type { WeekStart } from '@/lib/prefs';
import { addDays } from '@/lib/sync/time';

/** Inclusive owner-timezone days. */
export interface DayRange {
  from: string;
  to: string;
}

/** A KPI window: the last `last` days up to the account's latest settled day (rolling presets), or fixed days. */
export type Window = { last: number } | DayRange;
/** What the current window is compared with: nothing, the previous period, the same period a year earlier, or fixed days. */
export type Compare = 'none' | 'prev' | 'yoy' | DayRange;
export type Granularity = 'day' | 'week' | 'month';

const pad = (n: number) => String(n).padStart(2, '0');
const DAY = /^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** A real calendar day of the years 2000-2099 ('2026-02-30' does not round-trip and is rejected). */
export function isDay(v: unknown): v is string {
  return typeof v === 'string' && DAY.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
}

/** b − a in days. */
export const daysBetween = (a: string, b: string): number => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
export const daysIn = (r: DayRange): number => daysBetween(r.from, r.to) + 1;
export const minDay = (a: string, b: string): string => (a < b ? a : b);

const lastOfMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-based
const monthEnd = (day: string) => `${day.slice(0, 8)}${pad(lastOfMonth(Number(day.slice(0, 4)), Number(day.slice(5, 7))))}`;

/** Month arithmetic that keeps the day of the month where it can (31 Mar − 1 month = 28/29 Feb). */
export function addMonths(day: string, n: number): string {
  const i = Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7)) - 1 + n;
  const y = Math.floor(i / 12);
  const m = (i % 12) + 1;
  return `${y}-${pad(m)}-${pad(Math.min(Number(day.slice(8)), lastOfMonth(y, m)))}`;
}

export function weekOf(day: string, weekStart: WeekStart): DayRange {
  const from = addDays(day, -((weekdayOf(day) - (weekStart === 'sun' ? 0 : 1) + 7) % 7));
  return { from, to: addDays(from, 6) };
}

export function monthOf(day: string): DayRange {
  return { from: `${day.slice(0, 8)}01`, to: monthEnd(day) };
}

export function quarterOf(day: string): DayRange {
  const first = (Math.floor((Number(day.slice(5, 7)) - 1) / 3) * 3) + 1;
  const from = `${day.slice(0, 5)}${pad(first)}-01`;
  return { from, to: monthEnd(addMonths(from, 2)) };
}

/** How many whole calendar months the range spans (1 = a month, 3 = a quarter, 12 = a year), 0 when it is not whole months. */
export function wholeMonths(r: DayRange): number {
  if (!r.from.endsWith('-01') || r.to !== monthEnd(r.to) || r.to < r.from) return 0;
  return (Number(r.to.slice(0, 4)) - Number(r.from.slice(0, 4))) * 12 + Number(r.to.slice(5, 7)) - Number(r.from.slice(5, 7)) + 1;
}

/**
 * The range one step back (dir −1) or forward (+1). Whole months move by whole months (September → August, Q3 →
 * Q2, a year → the year before); anything else moves by its own length in days. `byMonths: false` always moves by days.
 */
export function stepRange(r: DayRange, dir: 1 | -1, byMonths = true): DayRange {
  const k = byMonths ? wholeMonths(r) : 0;
  if (k) return { from: addMonths(r.from, dir * k), to: monthEnd(addMonths(`${r.to.slice(0, 8)}01`, dir * k)) };
  const n = daysIn(r);
  return { from: addDays(r.from, dir * n), to: addDays(r.to, dir * n) };
}

/** The same days a year earlier (29 Feb → 28 Feb); a month end stays a month end. */
export function lastYear(r: DayRange): DayRange {
  return { from: addMonths(r.from, -12), to: r.to === monthEnd(r.to) ? monthEnd(addMonths(r.to, -12)) : addMonths(r.to, -12) };
}

/**
 * The comparison days for the current window `cur` (the days really measured). `asked` is what the URL asked for: a
 * fixed range keeps its calendar meaning (October compares with September, aligned from the 1st), a rolling window
 * moves by days. The result is cut to the current window's length from its start, so a month that is still running
 * (1–15 Oct) compares with the same days of the previous month (1–15 Sep), never with a whole month.
 */
export function compareRange(asked: Window, cur: DayRange, cmp: Compare): DayRange | null {
  if (cmp === 'none') return null;
  const rolling = 'last' in asked;
  const base = rolling ? cur : asked;
  const full = typeof cmp === 'object' ? cmp : cmp === 'prev' ? stepRange(base, -1, !rolling) : lastYear(base);
  const end = addDays(full.from, daysIn(cur) - 1);
  return { from: full.from, to: minDay(full.to, end) };
}

/** Chart buckets for a range length when the owner did not pick one: days up to ~3 months, weeks up to ~13 months, then months. */
export function autoGranularity(days: number): Granularity {
  return days <= 92 ? 'day' : days <= 400 ? 'week' : 'month';
}

/** First day of the bucket a day falls in. */
export function bucketStart(day: string, gran: Granularity, weekStart: WeekStart): string {
  return gran === 'day' ? day : gran === 'week' ? weekOf(day, weekStart).from : `${day.slice(0, 8)}01`;
}

/** All days of a bucket that starts on `start`. */
export function bucketRange(start: string, gran: Granularity): DayRange {
  return gran === 'day' ? { from: start, to: start } : gran === 'week' ? { from: start, to: addDays(start, 6) } : monthOf(start);
}
