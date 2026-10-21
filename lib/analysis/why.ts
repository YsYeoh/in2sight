// "Why did this change?": rule-based patterns, not causes. Every reason carries its evidence,
// its sample size and a confidence word, never "high". Pure: no clock, no I/O.
import { median } from '@/lib/analysis/posts';
import type { MediaKind } from '@/lib/instagram/parse';
import { addDays } from '@/lib/sync/time';
import { daysBetween } from '@/lib/time-scope/range';

export type FeedKind = Exclude<MediaKind, 'STORY'>;
/** A feed post or Reel published on an owner-timezone day, with its latest reach. */
export interface DayPost { id: string; mediaType: FeedKind; postedAt: string; hour: number; reach: number | null; permalink: string | null }
/** Everything known about one owner-timezone day of one account (null = not known, never 0). */
export interface GrowthDay {
  day: string;
  followers: number | null; // the day's last follower count
  follows: number | null;
  unfollows: number | null;
  net: number | null; // follows − unfollows, else the change of the follower count from the day before
  netSource: 'instagram' | 'derived' | null;
  reach: number | null; // account_daily.reach
  reachFollower: number | null; // breakdown reach of FOLLOWER, summed over formats
  reachNonFollower: number | null;
  storyReach: number | null; // breakdown reach of STORY, every follow type
  posts: DayPost[]; // feed posts and Reels published that day
  stories: number | null; // Stories published that day; null = not counted
  comments: number | null; // comments received that day; null = not counted
}
export type WhyMetric = 'net' | 'reach';
export const WHY_METRICS: readonly WhyMetric[] = ['net', 'reach'];
export type ReasonId = 'posted' | 'no_posts' | 'stories' | 'non_followers' | 'time_of_day' | 'comments';
export const REASON_ORDER: readonly ReasonId[] = ['posted', 'no_posts', 'stories', 'non_followers', 'time_of_day', 'comments'];
export interface Reason { id: ReasonId; direction: 'up' | 'down'; weight: number; confidence: 'low' | 'medium'; n: number; values: Record<string, number | string | boolean | null> }
/** A post gathers reach for days: younger than this (at the settled end day) it is not compared with posts that had their full life. */
export const POST_MATURE_DAYS = 7;
export interface Why { day: string; metric: WhyMetric; value: number | null; typical: number | null; n: number; direction: 'up' | 'down' | 'flat' | null; reasons: Reason[]; posts: (DayPost & { when: 'same_day' | 'day_before' })[] }
/** A day of the range that weekdayAnomaly (Task 2) flagged; built by Task 6, listed by Task 7. */
export interface UnusualDay { day: string; metric: WhyMetric; value: number; typical: number; z: number | null; direction: 'up' | 'down' | 'flat' }
export const WHY = { baselineDays: 28, minBaseline: 7, mediumBaseline: 14, postDays: 90, minFormatPosts: 5, mediumFormatPosts: 10, maxReasons: 4, postEvery: 4, storyShift: 0.3, nfShift: 0.05, hourShift: 0.2, minHourPosts: 3, mediumHourPosts: 5, minComments: 5, commentsRatio: 2 } as const;

const nums = (xs: (number | null)[]): number[] => xs.filter((x): x is number => x !== null);
const med = (xs: (number | null)[]): number | null => median(nums(xs));
const sign = (x: number): 'up' | 'down' => (x > 0 ? 'up' : 'down');

/** `settled` = the settled end day (what the KPIs end on); without it no post is treated as too recent. */
export function explainDay(days: GrowthDay[], day: string, metric: WhyMetric, settled?: string): Why {
  const byDay = new Map(days.map((d) => [d.day, d]));
  const today = byDay.get(day);
  const empty: Why = { day, metric, value: null, typical: null, n: 0, direction: null, reasons: [], posts: [] };
  if (!today) return empty;

  const base = Array.from({ length: WHY.baselineDays }, (_, i) => byDay.get(addDays(day, -(i + 1)))).filter((d): d is GrowthDay => !!d);
  const value = today[metric];
  const vals = nums(base.map((d) => d[metric]));
  const n = vals.length;
  const typical = n >= WHY.minBaseline ? median(vals) : null;
  const direction = value === null || typical === null ? null : value > typical ? 'up' : value < typical ? 'down' : 'flat';

  const eve = byDay.get(addDays(day, -1));
  const P = [
    ...today.posts.map((p) => ({ ...p, when: 'same_day' as const })),
    ...(eve?.posts ?? []).map((p) => ({ ...p, when: 'day_before' as const })),
  ];
  const out: Why = { day, metric, value, typical, n, direction, reasons: [], posts: P };
  if (value === null) return out;

  const earlierDays = Array.from({ length: WHY.postDays - 1 }, (_, i) => byDay.get(addDays(day, -(i + 2)))).filter((d): d is GrowthDay => !!d);
  const earlier = earlierDays.flatMap((d) => d.posts).filter((p) => p.reach !== null);
  const reasons: Reason[] = [];

  // posted / no_posts
  let top: (typeof P)[number] | undefined;
  let immature = false;
  if (P.length > 0) {
    top = P.reduce((best, p) => ((p.reach ?? -1) > (best.reach ?? -1) ? p : best));
    immature = settled !== undefined && daysBetween(top.when === 'same_day' ? day : addDays(day, -1), settled) < POST_MATURE_DAYS;
    const fmt = nums(earlier.filter((p) => p.mediaType === top!.mediaType).map((p) => p.reach));
    const m = med(fmt);
    const ratio = !immature && fmt.length >= WHY.minFormatPosts && m !== null && m > 0 && top.reach !== null ? top.reach / m : null;
    reasons.push({
      // too recent: evidence only; it takes the day's own direction so the direction filter below never drops it
      id: 'posted', direction: immature ? (direction === 'up' || direction === 'down' ? direction : 'up') : ratio !== null && ratio < 1 ? 'down' : 'up', weight: ratio === null ? 1 : Math.min(3, Math.max(ratio, 1 / ratio)),
      confidence: !immature && fmt.length >= WHY.mediumFormatPosts ? 'medium' : 'low', n: fmt.length,
      values: { postId: top.id, format: top.mediaType, when: top.when, hour: top.hour, reach: top.reach, ratio, posts: P.length, ...(immature ? { immature: true } : {}) },
    });
  } else {
    const postingDays = base.filter((d) => d.posts.length > 0).length;
    if (base.length > 0 && postingDays / base.length >= 1 / WHY.postEvery) {
      reasons.push({ id: 'no_posts', direction: 'down', weight: 1.5, confidence: base.length >= WHY.mediumBaseline ? 'medium' : 'low', n: base.length, values: { every: base.length / postingDays } });
    }
  }

  // stories
  const sr = nums(base.map((d) => d.storyReach));
  const sm = median(sr);
  if (today.storyReach !== null && sr.length >= WHY.minBaseline && sm !== null && sm > 0) {
    const change = (today.storyReach - sm) / sm;
    if (Math.abs(change) >= WHY.storyShift) {
      reasons.push({ id: 'stories', direction: sign(change), weight: Math.min(3, Math.abs(change) * 2), confidence: sr.length >= WHY.mediumBaseline ? 'medium' : 'low', n: sr.length, values: { reach: today.storyReach, typical: sm, change, stories: today.stories } });
    }
  }

  // non_followers
  const share = (d: GrowthDay): number | null => {
    if (d.reachFollower === null || d.reachNonFollower === null) return null;
    const sum = d.reachFollower + d.reachNonFollower;
    return sum > 0 ? d.reachNonFollower / sum : null;
  };
  const shares = nums(base.map(share));
  const nm = median(shares);
  const ns = share(today);
  if (ns !== null && nm !== null && shares.length >= WHY.minBaseline && Math.abs(ns - nm) >= WHY.nfShift) {
    const change = ns - nm;
    reasons.push({ id: 'non_followers', direction: sign(change), weight: Math.min(3, Math.abs(change) / WHY.nfShift), confidence: shares.length >= WHY.mediumBaseline ? 'medium' : 'low', n: shares.length, values: { share: ns, typical: nm, change } });
  }

  // time_of_day
  if (top && !immature) {
    const near = earlier.filter((p) => {
      const d = Math.abs(p.hour - top.hour);
      return Math.min(d, 24 - d) <= 1;
    });
    const all = med(earlier.map((p) => p.reach));
    const nearMed = med(near.map((p) => p.reach));
    if (near.length >= WHY.minHourPosts && all !== null && all > 0 && nearMed !== null) {
      const ratio = nearMed / all;
      if (Math.abs(ratio - 1) >= WHY.hourShift) {
        reasons.push({ id: 'time_of_day', direction: ratio > 1 ? 'up' : 'down', weight: Math.min(1.5, Math.abs(ratio - 1) * 2), confidence: near.length >= WHY.mediumHourPosts ? 'medium' : 'low', n: near.length, values: { hour: top.hour, ratio, posts: near.length } });
      }
    }
  }

  // comments
  const cs = nums(base.map((d) => d.comments));
  const cm = median(cs);
  if (today.comments !== null && cm !== null && cs.length >= WHY.minBaseline && today.comments >= WHY.minComments && today.comments >= WHY.commentsRatio * Math.max(cm, 1)) {
    reasons.push({ id: 'comments', direction: 'up', weight: Math.min(2, today.comments / Math.max(cm, 1) / 2), confidence: cs.length >= WHY.mediumBaseline ? 'medium' : 'low', n: cs.length, values: { comments: today.comments, typical: cm } });
  }

  // with no direction (too little baseline) reasons may point both ways: list them in rule order, never ranked by weight
  const ranked = direction === 'up' || direction === 'down';
  out.reasons = reasons
    .filter((r) => !ranked || r.direction === direction)
    .sort((a, b) => (ranked ? b.weight - a.weight : 0) || REASON_ORDER.indexOf(a.id) - REASON_ORDER.indexOf(b.id))
    .slice(0, WHY.maxReasons);
  return out;
}
