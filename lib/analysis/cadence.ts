// Cadence & consistency of the Content tab (Plan 17a; creator-toolkit design §6): how regularly the account posts, and
// how many posts a week went with what reach. Pure; every day is an owner-timezone 'YYYY-MM-DD'.
import { median } from '@/lib/analysis/posts';
import type { WeekStart } from '@/lib/prefs';
import { addDays } from '@/lib/sync/time';
import { daysBetween, daysIn, weekOf, type DayRange } from '@/lib/time-scope/range';

export const GAP_WARN_FACTOR = 2; // "no post for N days" once the gap since the newest post passes 2 x the usual gap
export const GAP_MIN = 4; // gaps (5 posting days) a usual gap needs
export const FREQ_MIN_WEEKS = 8; // complete weeks with a post before "posts per week vs reach" shows (a pattern, not proof)
export const FREQ_CAP = 5; // 5 or more posts in a week are one row
export const FREQ_MIN_POSTS = 5; // measured posts a row's median needs

export interface Gap {
  days: number;
  from: string; // posting day before the gap
  to: string; // posting day after it
}
export interface Cadence {
  range: DayRange;
  posts: number;
  perWeek: number; // posts ÷ (days in the range ÷ 7)
  longestGap: Gap | null; // between two posting days of the range; null below 2 posting days
  usualGap: number | null; // median gap; null below GAP_MIN gaps
  sinceLast: number | null; // days from the newest post (any, also before the range) to today; null = never posted
  warn: boolean; // sinceLast > GAP_WARN_FACTOR × usualGap
  streak: { current: number | null; best: number }; // weeks in a row with a post; current = null when the range does not end today
  stories: { range: DayRange; days: number; perWeek: number } | null; // days with a Story, from the first day Stories are known; null = none of the range is known
}

/** Week starts covering the range, oldest first. */
function weeksOf(range: DayRange, weekStart: WeekStart): string[] {
  const out: string[] = [];
  for (let w = weekOf(range.from, weekStart).from; w <= range.to; w = addDays(w, 7)) out.push(w);
  return out;
}

/**
 * `postDays` = the owner-timezone day of every feed post in the range (any order, repeats for several posts a day);
 * `lastPostDay` = the newest feed post overall; `storyDays` = Stories per day; `storiesFrom` = the first day whose
 * Stories are known (Stories are only captured since the account was connected, and a capped read starts later).
 */
export function cadence(o: { postDays: string[]; lastPostDay: string | null; storyDays: Record<string, number>; storiesFrom: string; range: DayRange; today: string; weekStart: WeekStart }): Cadence {
  const { range } = o;
  const inRange = o.postDays.filter((d) => d >= range.from && d <= range.to);
  const days = [...new Set(inRange)].sort();
  const gaps: Gap[] = days.slice(1).map((to, i) => ({ days: daysBetween(days[i], to), from: days[i], to }));
  const longestGap = gaps.reduce<Gap | null>((m, g) => (m === null || g.days > m.days ? g : m), null);
  const usualGap = gaps.length >= GAP_MIN ? median(gaps.map((g) => g.days)) : null;
  const sinceLast = o.lastPostDay === null ? null : daysBetween(o.lastPostDay, o.today);
  const posted = new Set(days.map((d) => weekOf(d, o.weekStart).from));
  const weeks = weeksOf(range, o.weekStart);
  let best = 0;
  let run = 0;
  for (const w of weeks) {
    run = posted.has(w) ? run + 1 : 0;
    best = Math.max(best, run);
  }
  let current: number | null = null;
  if (range.to === o.today) {
    let i = weeks.length - 1;
    if (i >= 0 && !posted.has(weeks[i])) i--; // the running week does not break a streak before it has ended
    current = 0;
    while (i >= 0 && posted.has(weeks[i])) {
      current++;
      i--;
    }
  }
  const storyFrom = o.storiesFrom > range.from ? o.storiesFrom : range.from;
  const storyRange = storyFrom <= range.to ? { from: storyFrom, to: range.to } : null;
  const storyCount = storyRange ? Object.entries(o.storyDays).filter(([d, n]) => n > 0 && d >= storyRange.from && d <= storyRange.to).length : 0;
  return {
    range,
    posts: inRange.length,
    perWeek: inRange.length / (daysIn(range) / 7),
    longestGap,
    usualGap,
    sinceLast,
    warn: usualGap !== null && sinceLast !== null && sinceLast > GAP_WARN_FACTOR * usualGap,
    streak: { current, best },
    stories: storyRange ? { range: storyRange, days: storyCount, perWeek: storyCount / (daysIn(storyRange) / 7) } : null,
  };
}

export interface FrequencyRow {
  perWeek: number; // posts in the week; FREQ_CAP means "FREQ_CAP or more"
  weeks: number;
  measured: number; // posts of those weeks with reach > 0
  medianReach: number | null; // null below FREQ_MIN_POSTS
}

/** Complete weeks of the range with at least one post, grouped by how many posts they had, with the median reach per post. null below FREQ_MIN_WEEKS such weeks. */
export function frequency(posts: { day: string; reach: number | null }[], range: DayRange, weekStart: WeekStart): { weeks: number; rows: FrequencyRow[] } | null {
  const full = new Set(weeksOf(range, weekStart).filter((w) => w >= range.from && addDays(w, 6) <= range.to));
  const byWeek = new Map<string, { day: string; reach: number | null }[]>();
  for (const p of posts) {
    const w = weekOf(p.day, weekStart).from;
    if (full.has(w)) byWeek.set(w, [...(byWeek.get(w) ?? []), p]);
  }
  if (byWeek.size < FREQ_MIN_WEEKS) return null;
  const rows = new Map<number, { weeks: number; reach: number[] }>();
  for (const list of byWeek.values()) {
    const k = Math.min(list.length, FREQ_CAP);
    const row = rows.get(k) ?? { weeks: 0, reach: [] };
    row.weeks++;
    row.reach.push(...list.flatMap((p) => (typeof p.reach === 'number' && p.reach > 0 ? [p.reach] : [])));
    rows.set(k, row);
  }
  return {
    weeks: byWeek.size,
    rows: [...rows]
      .sort(([a], [b]) => a - b)
      .map(([perWeek, r]) => ({ perWeek, weeks: r.weeks, measured: r.reach.length, medianReach: r.reach.length >= FREQ_MIN_POSTS ? median(r.reach) : null })),
  };
}
