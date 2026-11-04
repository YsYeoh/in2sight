// Goal progress (Plan 17d). Pure: today / now / tz come in, never the clock. Three goals per account (roadmap §4 Q2 (a)):
//  - followers: reach a count by a date. Pace = the straight line from the count on the day the goal was set to the
//    target on the due day; forecast = the Growth projection (Theil-Sen, lib/analysis/trend.ts) at the due day.
//  - avg_reach: average reach per feed post published this calendar month (owner timezone). No forecast: the average
//    of the posts so far IS the run rate; posts younger than 7 days are still gaining reach (said, never hidden).
//  - posts_per_week: feed posts this week (week-start setting). Pace = the target spread evenly over the 7 days.
// Honest labels: a forecast is Low or Medium only, "not enough history" under 14 days; a missing number is null with a
// reason, never 0. Today's part-day follower count is left out of the projection (lesson: no partial days in trends).
import type { DailyRow, Post } from '@/lib/analysis/types';
import { PROJECTION, projectFollowers } from '@/lib/analysis/trend';
import { addDays, localDay } from '@/lib/sync/time';
import { daysBetween, type DayRange } from '@/lib/time-scope/range';

export const GOAL_METRICS = ['followers', 'avg_reach', 'posts_per_week'] as const;
export type GoalMetric = (typeof GOAL_METRICS)[number];
/** = the migration's checks (20261103000001_goals.sql). */
export const TARGET_MAX: Record<GoalMetric, number> = { followers: 1_000_000_000, avg_reach: 1_000_000_000, posts_per_week: 50 };
/** A due day at most this far ahead (= MAX_DAYS of the Time Scope, about 5 years). */
export const DUE_MAX_DAYS = 1830;
/** The average reach needs this many posts with reach before it says ahead / behind. */
export const AVG_MIN_POSTS = 3;
/** A post younger than this still gains reach (the Post Lab "too early" window). */
export const YOUNG_DAYS = 7;

export interface Goal {
  id: string;
  accountId: string;
  metric: GoalMetric;
  target: number;
  dueDay: string | null; // followers only
  startDay: string; // owner-timezone day the goal was set (created_at)
}

export type Status = 'done' | 'ahead' | 'behind' | 'missed';
export interface Forecast {
  value: number;
  low: number;
  high: number;
  confidence: 'low' | 'medium';
  n: number;
  verdict: 'likely' | 'unlikely' | 'uncertain';
}
export interface FollowersProgress {
  metric: 'followers';
  target: number;
  dueDay: string;
  actual: number | null;
  baseline: number | null;
  expected: number | null; // where the straight line is today
  status: Status | null;
  forecast: Forecast | { reason: 'not_enough_history'; n: number } | null; // null = due day already passed
}
export interface AvgReachProgress {
  metric: 'avg_reach';
  target: number;
  month: DayRange;
  actual: number | null;
  n: number; // posts of the month with reach
  young: number; // of those, posted within YOUNG_DAYS of now
  status: Status | null; // null below AVG_MIN_POSTS
}
export interface PostsPerWeekProgress {
  metric: 'posts_per_week';
  target: number;
  week: DayRange;
  actual: number;
  expected: number; // posts the even pace asks for by today
  status: Status;
  lastWeek: { actual: number; met: boolean };
}
export type GoalProgress = FollowersProgress | AvgReachProgress | PostsPerWeekProgress;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const feedDay = (p: Post, tz: string) => (p.mediaType === 'STORY' ? null : localDay(new Date(p.postedAt), tz));

export function followersProgress(g: Goal & { dueDay: string }, daily: DailyRow[], today: string): FollowersProgress {
  const known = daily.filter((r) => r.followers !== null).sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  const actual = known.at(-1)?.followers ?? null;
  // the count on the start day, else the first one after it (a goal set before the first sync)
  const base = known.filter((r) => r.day <= g.startDay).at(-1) ?? known.find((r) => r.day > g.startDay);
  const baseline = base?.followers ?? null;
  const span = daysBetween(g.startDay, g.dueDay);
  const expected = baseline === null ? null : Math.round(baseline + (g.target - baseline) * (span > 0 ? clamp01(daysBetween(g.startDay, today) / span) : 1));
  const status: Status | null = actual === null ? null : actual >= g.target ? 'done' : today > g.dueDay ? 'missed' : expected !== null && actual >= expected ? 'ahead' : 'behind';
  let forecast: FollowersProgress['forecast'] = null;
  if (today <= g.dueDay && status !== 'done') {
    const points = known.filter((r) => r.day < today).map((r) => ({ day: r.day, value: r.followers! }));
    const last = points.at(-1)?.day ?? today;
    const p = projectFollowers(points, [Math.max(1, daysBetween(last, g.dueDay))]);
    if ('reason' in p) forecast = p;
    else {
      const h = p.horizons[0];
      const far = h.days > PROJECTION.horizons[PROJECTION.horizons.length - 1];
      forecast = { value: h.value, low: h.low, high: h.high, n: p.n, confidence: far ? 'low' : p.confidence, verdict: h.low >= g.target ? 'likely' : h.high < g.target ? 'unlikely' : 'uncertain' };
    }
  }
  return { metric: 'followers', target: g.target, dueDay: g.dueDay, actual, baseline, expected, status, forecast };
}

export function avgReachProgress(g: Goal, posts: Post[], month: DayRange, now: Date, tz: string): AvgReachProgress {
  const inMonth = posts.filter((p) => {
    const d = feedDay(p, tz);
    return d !== null && d >= month.from && d <= month.to && p.reach !== null;
  });
  const n = inMonth.length;
  const actual = n ? Math.round(inMonth.reduce((a, p) => a + p.reach!, 0) / n) : null;
  const young = inMonth.filter((p) => now.getTime() - Date.parse(p.postedAt) < YOUNG_DAYS * 86_400_000).length;
  const status: Status | null = actual === null || n < AVG_MIN_POSTS ? null : actual >= g.target ? 'ahead' : 'behind';
  return { metric: 'avg_reach', target: g.target, month, actual, n, young, status };
}

export function postsPerWeekProgress(g: Goal, posts: Post[], week: DayRange, today: string, tz: string): PostsPerWeekProgress {
  const count = (r: DayRange) =>
    posts.filter((p) => {
      const d = feedDay(p, tz);
      return d !== null && d >= r.from && d <= r.to;
    }).length;
  const actual = count(week);
  const elapsed = Math.min(7, Math.max(1, daysBetween(week.from, today) + 1));
  const expected = Math.floor((g.target * elapsed) / 7);
  const last = count({ from: addDays(week.from, -7), to: addDays(week.from, -1) });
  return { metric: 'posts_per_week', target: g.target, week, actual, expected, status: actual >= g.target ? 'done' : actual >= expected ? 'ahead' : 'behind', lastWeek: { actual: last, met: last >= g.target } };
}
