// Leaderboards of the Content tab (Plan 17a; creator-toolkit design §6 "Leaderboards"): the account's own feed posts of
// a range ranked by one number, optionally grouped by tag or week, with "repeat this" (top quartile in 2+ kinds of
// number) and "retire this" (a format or tag whose median sits below the range's 25th percentile, n >= 5). Pure.
// Values are the latest KNOWN numbers of each post (post_lab_latest), computed with the Post Lab's own formulas, so a
// post shows the same number here as on its scorecard. A missing number is left out, never ranked as 0.
import { MIN_PRIOR_POSTS } from '@/lib/analysis/flags';
import { LAB_METRICS, percentile, type LabValues } from '@/lib/analysis/post-lab';
import { median } from '@/lib/analysis/posts';
import { rank } from '@/lib/analysis/trend';
import type { MediaKind } from '@/lib/instagram/parse';
import type { WeekStart } from '@/lib/prefs';
import { localDay } from '@/lib/sync/time';
import { bucketStart } from '@/lib/time-scope/range';

export const BOARD_METRICS = ['reach', 'saves', 'shares', 'saveRate', 'shareRate', 'followsPer1k', 'profileVisits'] as const;
export type BoardMetric = (typeof BOARD_METRICS)[number];
export const BOARD_GROUPS = ['none', 'tag', 'week'] as const;
export type BoardGroupBy = (typeof BOARD_GROUPS)[number];
export type BoardKind = 'count' | 'percent' | 'per1k';
export const BOARD_KIND: Record<BoardMetric, BoardKind> = { reach: 'count', saves: 'count', shares: 'count', saveRate: 'percent', shareRate: 'percent', followsPer1k: 'per1k', profileVisits: 'count' };
/** Numbers Instagram does not report for Reels (Post Lab: "not reported for this format"); the UI says so. */
export const NOT_FOR_REELS: readonly BoardMetric[] = ['followsPer1k', 'profileVisits'];
/** Kinds of number for "repeat this": a count and its rate are one kind, so saves + save rate is not "two numbers". */
const FAMILY: Record<BoardMetric, string> = { reach: 'reach', saves: 'saves', saveRate: 'saves', shares: 'shares', shareRate: 'shares', followsPer1k: 'follows', profileVisits: 'visits' };

export const BOARD_TOP = 10;
/** Values a percentile, a quartile or a median needs: the Post Lab peer guard (MIN_PRIOR_POSTS). */
export const BOARD_MIN = MIN_PRIOR_POSTS;
export const REPEAT_KINDS = 2;
export const TOP_QUARTILE = 75; // mid-rank percentile from which a post is in the top quartile

export interface BoardPost {
  id: string;
  mediaType: MediaKind;
  postedAt: string; // ISO
  tagIds: string[];
  values: LabValues | null; // post_lab_latest; null = never measured
}
export interface Ranked<P> {
  post: P;
  value: number;
  repeat: boolean;
}
export interface BoardGroup<P> {
  key: string; // tag id, 'untagged', or the first day of the week
  posts: number; // posts in the group
  n: number; // posts that have the number
  median: number | null; // null below BOARD_MIN
  best: Ranked<P> | null;
  retire: boolean;
}
export interface Retire {
  kind: 'format' | 'tag';
  key: string; // MediaKind or tag id
  n: number;
  median: number;
}
export interface Board<P> {
  metric: BoardMetric;
  posts: number; // feed posts after the format filter
  n: number; // of them with the number
  q25: number | null; // the range's 25th percentile (nearest rank); null below BOARD_MIN
  top: Ranked<P>[];
  groups: BoardGroup<P>[] | null; // null when not grouped
  retire: Retire[]; // lowest median first
}

const FEED_CTX = { er: 'reach', followers: null, story: false } as const;

/** One number of one post; null when it was never captured or Instagram does not report it for the format. */
export function boardValue(metric: BoardMetric, mediaType: MediaKind, v: LabValues | null): number | null {
  if (!v) return null;
  if (metric === 'saves') return v.saves;
  if (metric === 'shares') return v.shares;
  const d = LAB_METRICS[metric];
  return d.unsupported?.includes(mediaType) ? null : d.value(v, FEED_CTX);
}

/** Ids of the posts in the top quartile (percentile >= 75 among at least BOARD_MIN posts with that number) in REPEAT_KINDS or more kinds of number. */
export function repeatIds(posts: BoardPost[]): Set<string> {
  const kinds = new Map<string, Set<string>>();
  for (const m of BOARD_METRICS) {
    const vals = posts.flatMap((p) => {
      const v = boardValue(m, p.mediaType, p.values);
      return v === null ? [] : [{ id: p.id, v }];
    });
    if (vals.length < BOARD_MIN) continue;
    const all = vals.map((x) => x.v);
    for (const x of vals) if ((percentile(x.v, all) ?? 0) >= TOP_QUARTILE) kinds.set(x.id, (kinds.get(x.id) ?? new Set()).add(FAMILY[m]));
  }
  return new Set([...kinds].filter(([, k]) => k.size >= REPEAT_KINDS).map(([id]) => id));
}

/** Higher first; equal values: newer first, then id (deterministic). */
const order = <P extends BoardPost>(a: Ranked<P>, b: Ranked<P>) =>
  b.value - a.value || (a.post.postedAt === b.post.postedAt ? (a.post.id < b.post.id ? -1 : 1) : a.post.postedAt > b.post.postedAt ? -1 : 1);

export function leaderboard<P extends BoardPost>(all: P[], o: { metric: BoardMetric; format: MediaKind | null; group: BoardGroupBy; tz: string; weekStart: WeekStart; limit?: number }): Board<P> {
  const posts = all.filter((p) => p.mediaType !== 'STORY' && (o.format === null || p.mediaType === o.format));
  const repeat = repeatIds(posts);
  const ranked = posts
    .flatMap((post) => {
      const value = boardValue(o.metric, post.mediaType, post.values);
      return value === null ? [] : [{ post, value, repeat: repeat.has(post.id) }];
    })
    .sort(order);
  const q25 = ranked.length >= BOARD_MIN ? rank(ranked.map((r) => r.value).sort((a, b) => a - b), 0.25) : null;
  const groupBy = (keysOf: (p: P) => string[]): BoardGroup<P>[] => {
    const acc = new Map<string, { posts: number; ranked: Ranked<P>[] }>();
    for (const p of posts) for (const k of keysOf(p)) acc.set(k, { posts: (acc.get(k)?.posts ?? 0) + 1, ranked: acc.get(k)?.ranked ?? [] });
    for (const r of ranked) for (const k of keysOf(r.post)) acc.get(k)!.ranked.push(r); // ranked is sorted, so [0] is each group's best
    return [...acc].map(([key, g]) => {
      const med = g.ranked.length >= BOARD_MIN ? median(g.ranked.map((r) => r.value)) : null;
      return { key, posts: g.posts, n: g.ranked.length, median: med, best: g.ranked[0] ?? null, retire: med !== null && q25 !== null && med < q25 };
    });
  };
  const tagsOf = (p: P) => (p.tagIds.length ? p.tagIds : ['untagged']);
  const byMedian = (a: BoardGroup<P>, b: BoardGroup<P>) => (b.median ?? -Infinity) - (a.median ?? -Infinity) || b.n - a.n || (a.key < b.key ? -1 : 1);
  const tagGroups = groupBy(tagsOf);
  const groups =
    o.group === 'tag' ? tagGroups.sort(byMedian) : o.group === 'week' ? groupBy((p) => [bucketStart(localDay(new Date(p.postedAt), o.tz), 'week', o.weekStart)]).sort((a, b) => (a.key < b.key ? 1 : -1)) : null;
  const retire: Retire[] = [
    ...(o.format === null ? groupBy((p) => [p.mediaType]).map((g) => ({ kind: 'format' as const, g })) : []),
    ...tagGroups.filter((g) => g.key !== 'untagged').map((g) => ({ kind: 'tag' as const, g })),
  ]
    .filter(({ g }) => g.retire)
    .map(({ kind, g }) => ({ kind, key: g.key, n: g.n, median: g.median! }))
    .sort((a, b) => a.median - b.median || (a.key < b.key ? -1 : 1));
  return { metric: o.metric, posts: posts.length, n: ranked.length, q25, top: ranked.slice(0, o.limit ?? BOARD_TOP), groups, retire };
}
