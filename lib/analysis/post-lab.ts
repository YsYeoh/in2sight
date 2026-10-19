// Post Lab (creator-toolkit design §5): one post, Reel, carousel or Story against the account's own normal. Pure and
// null-safe: now/tz are inputs, a missing number carries a reason (never 0), and there is no comparison or verdict
// below the sample guard. Input rows come from lib/post-lab/read.ts; the page model goes to components/post-lab/*.
import { captionLab, type CaptionLab } from '@/lib/analysis/caption';
import { MIN_AGE_HOURS, MIN_PRIOR_POSTS, TAKING_OFF_RATIO } from '@/lib/analysis/flags';
import { median } from '@/lib/analysis/posts';
import type { MediaKind } from '@/lib/instagram/parse';
import type { CoverStatus } from '@/lib/sync/covers';
import { CHECKPOINT_DAYS } from '@/lib/sync/schedule';
import { localDay } from '@/lib/sync/time';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Velocity checkpoints: minutes after posting and the tolerance window (± minutes) a snapshot must fall into. The
 *  reader passes this table to SQL (post_lab_points), so it exists once. The sync takes hourly snapshots under 48 h,
 *  daily ones to day 30 and one right after day 7 (lib/sync/schedule.ts), so every window normally holds one. */
export const CHECKPOINTS = [
  { id: '1h', min: 60, tol: 30 },
  { id: '6h', min: 360, tol: 60 },
  { id: '24h', min: 1440, tol: 120 },
  { id: '48h', min: 2880, tol: 180 },
  { id: '7d', min: CHECKPOINT_DAYS * 1440, tol: 720 },
] as const;
export type CheckpointId = (typeof CHECKPOINTS)[number]['id'];
/** A Story lives 24 hours. */
export const STORY_CHECKPOINTS: readonly CheckpointId[] = ['1h', '6h', '24h'];

export const PEER_COUNTS = [30, 90] as const;
export type PeerCount = (typeof PEER_COUNTS)[number];
export const PEER_MAX = 90; // the reader always reads this many; the scorecard uses the first 30 or 90
export const SIMILAR_MAX = 6;
export type ErBasis = 'reach' | 'followers';

/** The latest known value of every metric of one media item (post_lab_latest). Null = Instagram did not report it. */
export interface LabValues {
  reach: number | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
  shares: number | null;
  interactions: number | null; // Instagram's total_interactions
  replies: number | null;
  tapsForward: number | null;
  tapsBack: number | null;
  exits: number | null;
  swipeForward: number | null;
  follows: number | null;
  profileVisits: number | null;
  linkTaps: number | null;
  avgWatchMs: number | null;
  totalWatchMs: number | null;
  skipRate: number | null; // 0–1 (Meta reports a percent; the reader divides)
}

export interface LabPoint {
  reach: number | null;
  views: number | null;
}

export interface LabItem {
  id: string;
  accountId: string;
  mediaType: MediaKind;
  postedAt: string; // ISO
  expiresAt: string | null; // Stories
  goneAt: string | null; // Instagram no longer has it; the numbers are the last ones captured
  permalink: string | null;
  caption: string | null;
  tagIds: string[];
  cover: CoverStatus; // media.cover_status: the cover route serves an image only for 'ok'
  slides: number | null; // carousels: media.children_count
  measuredAt: string | null; // when the newest snapshot was taken
  latest: LabValues | null; // null = never measured (a Story under 5 viewers, a post not reached yet)
  points: Partial<Record<CheckpointId, LabPoint>>; // only checkpoints that have a snapshot in their window
}

export interface LabInput {
  item: LabItem;
  peers: LabItem[]; // same account and format, published before the item, newest first (≤ PEER_MAX)
  day: LabItem[]; // Stories only: the account's Stories of the item's owner-timezone day
  followers: Record<string, number>; // the account's follower count per owner-timezone day (account_daily)
}

export type LabMetricId = 'reach' | 'views' | 'interactions' | 'engagementRate' | 'saveRate' | 'shareRate' | 'followsPer1k' | 'profileVisits' | 'linkTaps' | 'replies' | 'avgWatch' | 'totalWatch' | 'skipRate';
export type LabKind = 'count' | 'percent' | 'per1k' | 'duration';
/** Why a number is missing. i18n: `postLab.reason.<key>`. */
export type LabReason = 'unsupported' | 'not_captured' | 'not_measured' | 'needs_5_viewers' | 'no_reach' | 'no_followers';

interface Ctx {
  er: ErBasis;
  followers: number | null; // the account's followers on the posting day
  story: boolean;
}
interface LabMetricDef {
  kind: LabKind;
  lowerIsBetter?: true;
  extra?: true; // an optional metric (Plan 11b extras): missing = not captured for this post
  perReach?: true; // a rate over reach: missing reach explains a missing value
  formats: readonly MediaKind[]; // where the row is shown
  unsupported?: readonly MediaKind[]; // shown, but Instagram does not report it there (verified, docs/META_PROBE_RESULTS.md)
  value: (v: LabValues, c: Ctx) => number | null;
}

const FEED: readonly MediaKind[] = ['IMAGE', 'CAROUSEL_ALBUM', 'REELS'];
const ALL: readonly MediaKind[] = [...FEED, 'STORY'];
const num = (v: number | null): v is number => typeof v === 'number' && Number.isFinite(v);
const ratio = (a: number | null, b: number | null) => (num(a) && num(b) && b > 0 ? a / b : null);
const per1k = (r: number | null) => (r === null ? null : r * 1000);
/** Feed: likes + comments + saves + shares (the engagement-rate numerator, SPEC §7); Stories: Instagram's total. */
const interactionsOf = (v: LabValues, story: boolean): number | null => {
  if (story) return v.interactions;
  const parts = [v.likes, v.comments, v.saves, v.shares];
  return parts.some(num) ? parts.reduce<number>((a, x) => a + (num(x) ? x : 0), 0) : null;
};

/** Post Lab numbers (a new one = one entry + its `postLab.metric.<id>` label). Per-item snapshot values, not Explorer
 *  rollups: the registry in lib/metrics.ts computes those from SQL parts. */
export const LAB_METRICS: Record<LabMetricId, LabMetricDef> = {
  reach: { kind: 'count', formats: ALL, value: (v) => v.reach },
  views: { kind: 'count', formats: ALL, value: (v) => v.views },
  interactions: { kind: 'count', formats: ALL, value: (v, c) => interactionsOf(v, c.story) },
  engagementRate: { kind: 'percent', formats: FEED, value: (v, c) => ratio(interactionsOf(v, false), c.er === 'followers' ? c.followers : v.reach) },
  saveRate: { kind: 'percent', perReach: true, formats: FEED, value: (v) => ratio(v.saves, v.reach) },
  shareRate: { kind: 'percent', perReach: true, formats: ALL, value: (v) => ratio(v.shares, v.reach) },
  followsPer1k: { kind: 'per1k', extra: true, perReach: true, formats: ALL, unsupported: ['REELS'], value: (v) => per1k(ratio(v.follows, v.reach)) },
  profileVisits: { kind: 'count', extra: true, formats: ALL, unsupported: ['REELS'], value: (v) => v.profileVisits },
  linkTaps: { kind: 'count', extra: true, formats: ['IMAGE', 'CAROUSEL_ALBUM', 'STORY'], value: (v) => v.linkTaps },
  replies: { kind: 'count', formats: ['STORY'], value: (v) => v.replies },
  avgWatch: { kind: 'duration', extra: true, formats: ['REELS'], value: (v) => v.avgWatchMs },
  totalWatch: { kind: 'duration', extra: true, formats: ['REELS'], value: (v) => v.totalWatchMs },
  skipRate: { kind: 'percent', extra: true, lowerIsBetter: true, formats: ['REELS'], value: (v) => v.skipRate },
};
export const SCORECARD: readonly LabMetricId[] = ['reach', 'views', 'interactions', 'engagementRate', 'saveRate', 'shareRate', 'followsPer1k', 'profileVisits', 'linkTaps', 'replies'];
export const WATCH: readonly LabMetricId[] = ['avgWatch', 'totalWatch', 'skipRate'];

export interface ScoreRow {
  id: LabMetricId;
  kind: LabKind;
  lowerIsBetter: boolean;
  value: number | null;
  reason: LabReason | null; // why value is null
  n: number; // peers that have this number
  median: number | null; // null below the sample guard (n < MIN_PRIOR_POSTS)
  percentile: number | null; // 0–100, mid-rank
  delta: number | null; // percent kinds: value − median (a ratio difference, shown as points); else value ÷ median − 1
}

/** Share of `values` below `v` plus half of those equal to it, × 100 (mid-rank percentile). */
export function percentile(v: number, values: number[]): number | null {
  if (values.length === 0) return null;
  const below = values.filter((x) => x < v).length;
  const equal = values.filter((x) => x === v).length;
  return Math.round(((below + equal / 2) / values.length) * 100);
}

const followersOn = (followers: Record<string, number>, postedAt: string, tz: string): number | null => {
  const f = followers[localDay(new Date(postedAt), tz)];
  return num(f) ? f : null;
};

function reasonOf(id: LabMetricId, item: LabItem, c: Ctx): LabReason {
  const d = LAB_METRICS[id];
  if (d.unsupported?.includes(item.mediaType)) return 'unsupported';
  if (!item.latest) return item.mediaType === 'STORY' ? 'needs_5_viewers' : 'not_measured';
  if (id === 'engagementRate' && c.er === 'followers') return c.followers === null ? 'no_followers' : 'not_captured';
  if ((d.perReach || id === 'engagementRate') && !(num(item.latest.reach) && item.latest.reach > 0)) return 'no_reach';
  return 'not_captured';
}

/** One row per metric shown for the item's format, each against the same metric of the peers. */
export function scoreRows(ids: readonly LabMetricId[], item: LabItem, peers: LabItem[], o: { er: ErBasis; followers: Record<string, number>; tz: string }): ScoreRow[] {
  const story = item.mediaType === 'STORY';
  const ctxOf = (x: LabItem): Ctx => ({ er: o.er, followers: followersOn(o.followers, x.postedAt, o.tz), story });
  return ids
    .filter((id) => LAB_METRICS[id].formats.includes(item.mediaType))
    .map((id) => {
      const d = LAB_METRICS[id];
      const c = ctxOf(item);
      const unsupported = d.unsupported?.includes(item.mediaType) ?? false;
      const value = !unsupported && item.latest ? d.value(item.latest, c) : null;
      const values = unsupported ? [] : peers.flatMap((p) => (p.latest ? [d.value(p.latest, ctxOf(p))] : [])).filter(num);
      const med = values.length >= MIN_PRIOR_POSTS ? median(values) : null;
      const compare = value !== null && med !== null;
      return {
        id,
        kind: d.kind,
        lowerIsBetter: d.lowerIsBetter ?? false,
        value,
        reason: value === null ? reasonOf(id, item, c) : null,
        n: values.length,
        median: med,
        percentile: compare ? percentile(value, values) : null,
        delta: compare ? (d.kind === 'percent' ? value - med : med > 0 ? value / med - 1 : null) : null,
      };
    });
}

export type Verdict = 'breakout' | 'above' | 'typical' | 'below' | 'too_early';

const expiryOf = (i: LabItem) => (i.expiresAt ? Date.parse(i.expiresAt) : Date.parse(i.postedAt) + DAY);

/**
 * The verdict chip, from reach vs the peers' reach. Null (the UI says why) without reach or below the sample guard.
 * Reach only grows, so a lead counts early: a feed post / Reel gets Breakout (≥ 2× median, the "taking off" rule) or
 * Above typical (≥ 75th percentile) from 24 h on, the full scale only from day 7; a Story the lead while live, the full
 * scale once expired (final numbers). Anything else before that is Too early.
 */
export function verdictOf(item: LabItem, reach: ScoreRow | undefined, now: Date): Verdict | null {
  if (!reach || reach.value === null || reach.median === null || reach.percentile === null) return null;
  const age = now.getTime() - Date.parse(item.postedAt);
  const story = item.mediaType === 'STORY';
  if (!story && age < MIN_AGE_HOURS * HOUR) return 'too_early';
  if (reach.median > 0 && reach.value >= TAKING_OFF_RATIO * reach.median) return 'breakout';
  if (reach.percentile >= 75) return 'above';
  const final = story ? now.getTime() >= Math.min(expiryOf(item), item.goneAt ? Date.parse(item.goneAt) : Infinity) : age >= CHECKPOINT_DAYS * DAY;
  if (!final) return 'too_early';
  return reach.percentile < 25 ? 'below' : 'typical';
}

export interface VelocityPoint {
  id: CheckpointId;
  due: boolean; // the checkpoint's time has passed (a missing point is then a gap in the snapshots, not "not yet")
  reach: number | null;
  views: number | null;
  medianReach: number | null; // null below the sample guard
  medianViews: number | null;
  nReach: number;
  nViews: number;
}
export interface Velocity {
  points: VelocityPoint[];
  /** The latest checkpoint where the item and the median both exist: "at 24 h, 2.3× the median reach of 12 posts". */
  lead: { at: CheckpointId; metric: 'reach' | 'views'; ratio: number; n: number } | null;
}

export function velocity(item: LabItem, peers: LabItem[], now: Date): Velocity {
  const ids = item.mediaType === 'STORY' ? STORY_CHECKPOINTS : CHECKPOINTS.map((c) => c.id);
  const age = (now.getTime() - Date.parse(item.postedAt)) / MIN;
  const points = ids.map((id): VelocityPoint => {
    const c = CHECKPOINTS.find((x) => x.id === id)!;
    const own = age >= c.min ? item.points[id] : undefined; // a snapshot taken before the mark is not that checkpoint's value
    const of = (k: keyof LabPoint) => peers.map((p) => p.points[id]?.[k] ?? null).filter(num);
    const r = of('reach');
    const w = of('views');
    return {
      id,
      due: age >= c.min,
      reach: own?.reach ?? null,
      views: own?.views ?? null,
      medianReach: r.length >= MIN_PRIOR_POSTS ? median(r) : null,
      medianViews: w.length >= MIN_PRIOR_POSTS ? median(w) : null,
      nReach: r.length,
      nViews: w.length,
    };
  });
  let lead: Velocity['lead'] = null;
  for (const p of [...points].reverse()) {
    if (num(p.reach) && num(p.medianReach) && p.medianReach > 0) lead = { at: p.id, metric: 'reach', ratio: p.reach / p.medianReach, n: p.nReach };
    else if (num(p.views) && num(p.medianViews) && p.medianViews > 0) lead = { at: p.id, metric: 'views', ratio: p.views / p.medianViews, n: p.nViews };
    if (lead) break;
  }
  return { points, lead };
}

export type FunnelStep = 'forward' | 'back' | 'exit' | 'swipe';
export interface Funnel {
  views: number | null;
  replies: number | null;
  steps: { id: FunnelStep; value: number | null; share: number | null }[]; // share = value ÷ views
}

/** A Story's navigation (taps forward/back, exits, swipes to the next account) as counts and shares of its views. */
export function storyFunnel(v: LabValues | null): Funnel | null {
  if (!v) return null;
  const steps: [FunnelStep, number | null][] = [
    ['forward', v.tapsForward],
    ['back', v.tapsBack],
    ['exit', v.exits],
    ['swipe', v.swipeForward],
  ];
  return { views: v.views, replies: v.replies, steps: steps.map(([id, value]) => ({ id, value, share: ratio(value, v.views) })) };
}

export interface Frame {
  id: string;
  postedAt: string;
  cover: CoverStatus;
  reach: number | null;
  views: number | null;
  exitRate: number | null; // exits ÷ views (as the Stories tab)
  retention: number | null; // reach ÷ the reach of the day's first measured Story
  current: boolean;
}
export interface Sequence {
  frames: Frame[]; // oldest first
  best: string | null; // lowest exit rate (needs ≥ 2 measured frames)
  worst: string | null; // highest exit rate
}

export function storySequence(day: LabItem[], currentId: string): Sequence {
  const sorted = [...day].sort((a, b) => (a.postedAt === b.postedAt ? (a.id < b.id ? -1 : 1) : a.postedAt < b.postedAt ? -1 : 1));
  const base = sorted.map((s) => s.latest?.reach ?? null).find((r): r is number => num(r) && r > 0) ?? null;
  const frames = sorted.map((s) => ({
    id: s.id,
    postedAt: s.postedAt,
    cover: s.cover,
    reach: s.latest?.reach ?? null,
    views: s.latest?.views ?? null,
    exitRate: ratio(s.latest?.exits ?? null, s.latest?.views ?? null),
    retention: ratio(s.latest?.reach ?? null, base),
    current: s.id === currentId,
  }));
  const rated = frames.filter((f): f is Frame & { exitRate: number } => f.exitRate !== null);
  if (rated.length < 2) return { frames, best: null, worst: null };
  const best = rated.reduce((a, f) => (f.exitRate < a.exitRate ? f : a));
  const worst = rated.reduce((a, f) => (f.exitRate > a.exitRate ? f : a));
  return { frames, best: best.id, worst: worst.id === best.id ? null : worst.id };
}

/** Up to SIMILAR_MAX peers: those sharing a tag with the item first, then the newest (peers are newest first). */
export function similarPosts(item: LabItem, peers: LabItem[]): LabItem[] {
  const tagged = peers.filter((p) => p.tagIds.some((t) => item.tagIds.includes(t)));
  return [...tagged, ...peers.filter((p) => !tagged.includes(p))].slice(0, SIMILAR_MAX);
}

export interface PostLabModel {
  item: LabItem;
  peers: { asked: PeerCount; used: number; read: number };
  er: ErBasis;
  followers: number | null; // the account's followers on the posting day
  live: boolean; // a Story still up
  verdict: Verdict | null;
  scorecard: ScoreRow[];
  watch: ScoreRow[] | null; // Reels
  velocity: Velocity;
  funnel: Funnel | null; // Stories
  sequence: Sequence | null; // Stories
  caption: CaptionLab | null; // not for Stories
  similar: LabItem[];
}

export function buildPostLab(input: LabInput, o: { now: Date; tz: string; peers: PeerCount; er: ErBasis }): PostLabModel {
  const { item } = input;
  const story = item.mediaType === 'STORY';
  const peers = input.peers.slice(0, o.peers);
  const opts = { er: o.er, followers: input.followers, tz: o.tz };
  const scorecard = scoreRows(SCORECARD, item, peers, opts);
  return {
    item,
    peers: { asked: o.peers, used: peers.length, read: input.peers.length },
    er: o.er,
    followers: followersOn(input.followers, item.postedAt, o.tz),
    live: story && o.now.getTime() < expiryOf(item) && item.goneAt === null,
    verdict: verdictOf(item, scorecard.find((r) => r.id === 'reach'), o.now),
    scorecard,
    watch: item.mediaType === 'REELS' ? scoreRows(WATCH, item, peers, opts) : null,
    velocity: velocity(item, peers, o.now),
    funnel: story ? storyFunnel(item.latest) : null,
    sequence: story ? storySequence(input.day.some((s) => s.id === item.id) ? input.day : [...input.day, item], item.id) : null,
    caption: story ? null : captionLab(item.caption, input.peers.map((p) => ({ caption: p.caption, reach: p.latest?.reach ?? null }))),
    similar: similarPosts(item, input.peers),
  };
}
