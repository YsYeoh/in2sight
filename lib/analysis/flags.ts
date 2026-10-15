// Flags are computed on read, never stored (SPEC §5). Definitions: SPEC §7 "Post taking off" and §7c "reach drop".
// The alert rules (lib/alerts/rules.ts) reuse these with the owner's Settings thresholds as parameters.
import { kpis, summarize } from '@/lib/analysis/growth';
import { median } from '@/lib/analysis/posts';
import type { DailyRow, Post } from '@/lib/analysis/types';

export const TAKING_OFF_RATIO = 2;
export const PRIOR_POSTS = 20;
export const MIN_PRIOR_POSTS = 5;
export const MIN_AGE_HOURS = 24;
export const REACH_DROP = -0.2;

export type Flag =
  | { kind: 'taking_off'; postId: string; permalink: string | null; postedAt: string; ratio: number }
  | { kind: 'reach_drop'; change: number };

const HOUR = 3_600_000;

/**
 * Feed posts (one account) whose reach is ≥ `ratio` (default 2×) the median reach of that account's previous 20 feed posts, evaluated
 * ≥ 24 h after posting, with ≥ 5 prior posts that have reach. Only posts from the last `withinDays` days are reported.
 * Newest first.
 */
export function takingOff(posts: Post[], now: Date, withinDays = 7, ratio = TAKING_OFF_RATIO):Extract<Flag, { kind: 'taking_off' }>[] {
  const feed = posts
    .filter((p) => p.mediaType !== 'STORY' && !Number.isNaN(Date.parse(p.postedAt)))
    .sort((a, b) => (a.postedAt === b.postedAt ? (a.id < b.id ? -1 : 1) : a.postedAt < b.postedAt ? -1 : 1));
  const out: Extract<Flag, { kind: 'taking_off' }>[] = [];
  feed.forEach((p, i) => {
    const age = now.getTime() - Date.parse(p.postedAt);
    if (age < MIN_AGE_HOURS * HOUR || age > withinDays * 24 * HOUR || p.reach === null) return;
    const prior = feed.slice(Math.max(0, i - PRIOR_POSTS), i).map((x) => x.reach).filter((r): r is number => r !== null);
    const m = prior.length >= MIN_PRIOR_POSTS ? median(prior) : null;
    if (m !== null && m > 0 && p.reach >= ratio * m) out.push({ kind: 'taking_off', postId: p.id, permalink: p.permalink, postedAt: p.postedAt, ratio: p.reach / m });
  });
  return out.reverse();
}

/** 7-day reach ≤ `threshold` (default −20%) vs the previous 7 days (only when both weeks have enough data to compare). */
export function reachDrop(rows: DailyRow[], today: string, tz: string, threshold = REACH_DROP): Extract<Flag, { kind: 'reach_drop' }> | null {
  const change = kpis(summarize(rows, [], 7, today, tz)).reach.change;
  return change !== null && change <= threshold ?{ kind: 'reach_drop', change } : null;
}
