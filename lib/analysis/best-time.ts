// Best time to post (SPEC §7): weekday × hour grids. Default view = followers online; toggle = your post performance.
// Pass one account's rows for the per-account view, or several accounts' rows concatenated for the pooled view.
import { localDay, localHour } from '@/lib/sync/time';
import type { WeekStart } from '@/lib/prefs';
import { engagementRate } from '@/lib/analysis/posts';
import type { MissingReason, OnlineFollowersRow, Post } from '@/lib/analysis/types';

/** Cells with fewer posts than this are greyed out. */
export const MIN_CELL_POSTS = 2;
/** Below this many measured feed posts the view says "Needs ~30+ posts for a reliable pattern". */
export const RELIABLE_POSTS = 30;

export interface HeatCell {
  value: number | null; // average (engagement rate, or followers online)
  count: number; // posts (or days) behind the value
  lowSample: boolean;
}
export interface Heatmap {
  rows: { weekday: number; cells: HeatCell[] }[]; // weekday 0 = Sunday … 6 = Saturday, ordered by the user's week start; 24 cells each
  sample: number; // measured posts (or days) in total
  reason: MissingReason | null; // set when the whole grid is unreliable or empty
}

/** Weekday of a 'YYYY-MM-DD' calendar day (timezone-free). */
export const weekdayOf = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();
export const weekOrder = (start: WeekStart) => (start === 'sun' ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6, 0]);

function build(points: { weekday: number; hour: number; value: number }[], start: WeekStart, minCount: number): Heatmap['rows'] {
  const acc = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({ total: 0, count: 0 })));
  for (const p of points) {
    acc[p.weekday][p.hour].total += p.value;
    acc[p.weekday][p.hour].count += 1;
  }
  return weekOrder(start).map((weekday) => ({
    weekday,
    cells: acc[weekday].map(({ total, count }) => ({ value: count ? total / count : null, count, lowSample: count < minCount })),
  }));
}

/** Avg engagement rate by the owner-timezone weekday and hour each feed post was published. */
export function postHeatmap(posts: Post[], tz: string, start: WeekStart): Heatmap {
  const points = posts
    .filter((p) => p.mediaType !== 'STORY')
    .map((p) => ({ at: new Date(p.postedAt), value: engagementRate(p) }))
    .filter((x): x is { at: Date; value: number } => x.value !== null && !Number.isNaN(x.at.getTime()))
    .map(({ at, value }) => ({ weekday: weekdayOf(localDay(at, tz)), hour: localHour(at, tz), value }));
  return { rows: build(points, start, MIN_CELL_POSTS), sample: points.length, reason: points.length < RELIABLE_POSTS ? 'not_enough_posts' : null };
}

/**
 * Average followers online by weekday × hour. The hour index is used as Instagram reports it (hour base UNCERTAIN,
 * see lib/instagram/metrics.ts); re-map here once the runbook confirms it. Instagram only reports this from 100 followers.
 */
export function onlineHeatmap(rows: OnlineFollowersRow[], start: WeekStart): Heatmap {
  const points = rows.flatMap((r) =>
    r.hourly.slice(0, 24).flatMap((v, hour) => (typeof v === 'number' && Number.isFinite(v) ? [{ weekday: weekdayOf(r.day), hour, value: v }] : [])),
  );
  return { rows: build(points, start, 1), sample: rows.length, reason: points.length === 0 ? 'needs_100_followers' : null };
}
