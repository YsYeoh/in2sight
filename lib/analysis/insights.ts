// Insights feed (Plan 17b, SPEC §7m): rule-based findings over ONE account's synced data. Pure: today, now and the
// timezone are inputs, never the clock. Every finding carries its evidence (params), its sample (n) and a confidence
// word, Low or Medium, never High: a rule finds a pattern, not a cause. Keys are stable across reads, so a dismissal or
// a snooze keeps hiding the same finding. Params hold numbers and fixed ids only (formats, weekdays, day parts, metric
// ids) and, for the hashtag rule, the owner's own hashtag; never usernames, comment text or captions.
// ponytail: eight rules; a rule nobody acts on in a month is deleted, not tuned (roadmap §5).
import { weekdayOf } from '@/lib/analysis/best-time';
import { CAPTION_MIN_POSTS, captionFeatures } from '@/lib/analysis/caption';
import { reachDrop, takingOff } from '@/lib/analysis/flags';
import { summarize } from '@/lib/analysis/growth';
import { median } from '@/lib/analysis/posts';
import { weekdayAnomaly, type AnomalyResult } from '@/lib/analysis/trend';
import type { DailyRow, Post } from '@/lib/analysis/types';
import { postLabHref } from '@/lib/post-lab/params';
import { addDays, localDay, localHour } from '@/lib/sync/time';
import { daysBetween, weekOf } from '@/lib/time-scope/range';

export const INSIGHTS = {
  readDays: 64, // daily rows a caller reads: 8 weeks of same-weekday history, Instagram's lag and the day before (follower change)
  lookbackDays: 180, // posts the post rules look at
  matureDays: 7, // a post younger than this is still gathering reach: left out of the slot, format and hashtag comparisons (a breakout is compared with the previous 20 posts, whatever their age)
  minPosts: CAPTION_MIN_POSTS, // measured, mature posts a post rule needs at all (20)
  minGroup: 5, // posts in a slot / format / with a hashtag, and on the other side
  mediumGroup: 10, // ... for Medium instead of Low
  slotRatio: 1.5,
  formatRatio: 1.3,
  hashtagRatio: 1.3,
  minGaps: 5, // gaps between posting days the gap rule needs
  mediumGaps: 10,
  gapFactor: 2, // "no post for N days" = N ≥ 2 × the median gap ...
  minGapDays: 3, // ... and at least 3 days
  mediumSamples: 6, // same-weekday values for a Medium unusual day (weekdayAnomaly needs 4)
  breakoutDays: 7, // breakouts of the last 7 days
  maxHashtag: 60, // code points of a hashtag kept in a key
  snoozeDays: 7,
  maxKey: 200, // characters of a key (the table checks it too)
} as const;

export const FINDING_KINDS = ['reach_drop', 'posting_gap', 'unanswered', 'unusual_day', 'breakout', 'best_slot', 'format_winner', 'hashtag_winner'] as const;
export type FindingKind = (typeof FINDING_KINDS)[number];
export type Tone = 'bad' | 'good' | 'tip';
const TONES: readonly Tone[] = ['bad', 'good', 'tip'];

export interface Finding {
  key: string; // `<kind>:<account id>:<id>`, stable across reads: the dismissal id
  accountId: string;
  kind: FindingKind;
  tone: Tone;
  params: Record<string, string | number>; // i18n parameters, formatted by the UI
  n: number; // the sample behind it
  confidence: 'low' | 'medium';
  day: string; // the owner-timezone day it is about
  postId: string | null;
  href: string; // same-origin path with the evidence
}

export const DAYPARTS = ['night', 'morning', 'afternoon', 'evening'] as const;
export type Daypart = (typeof DAYPARTS)[number];
/** Owner-timezone day parts: night 0:00-5:59, morning 6:00-11:59, afternoon 12:00-17:59, evening 18:00-23:59. */
export const daypartOf = (hour: number): Daypart => DAYPARTS[Math.min(3, Math.max(0, Math.floor(hour / 6)))];

export type DayMetric = 'followers' | 'reach' | 'views' | 'interactions';
export const DAY_METRICS: readonly DayMetric[] = ['followers', 'reach', 'views', 'interactions'];

/** A post with its caption when the caller read it (the hashtag rule skips posts without one). */
export interface InsightPost extends Post {
  caption?: string | null;
}
export interface InsightInput {
  accountId: string;
  daily: DailyRow[]; // at least INSIGHTS.readDays back
  posts: InsightPost[]; // feed posts, newest first (Stories are ignored)
  unanswered: number | null; // questions without a reply seen, last 7 days; null = not read (no comments scope, no migration)
  stale?: boolean; // the account needs a reconnect or its sync is failing (lib/dashboard/overview.ts isStale): no finding at all
}

export type DismissMode = 'dismiss' | 'snooze';
export type DismissError = 'invalid' | 'needs_update' | 'not_found' | 'unexpected';
export type DismissResult = { ok: true } | { ok: false; error: DismissError };
/** A stored dismissal: until = null hides the key for good, a time hides it until then (snooze). */
export interface Dismissal {
  key: string;
  until: string | null;
}

const conf = (n: number, medium: number): 'low' | 'medium' => (n >= medium ? 'medium' : 'low');
const accountHref = (id: string, q = '') => `/accounts/${encodeURIComponent(id)}${q ? `?${q}` : ''}`;
const make = (accountId: string, kind: FindingKind, id: string, f: Omit<Finding, 'key' | 'accountId' | 'kind'>): Finding => ({ key: `${kind}:${accountId}:${id}`, accountId, kind, ...f });

export interface Measured {
  p: InsightPost;
  day: string;
  hour: number;
  reach: number;
}

/** Feed posts with reach > 0, posted between INSIGHTS.lookbackDays and INSIGHTS.matureDays ago (owner-timezone days). */
export function measuredPosts(posts: InsightPost[], today: string, tz: string): Measured[] {
  const from = addDays(today, -INSIGHTS.lookbackDays);
  const to = addDays(today, -INSIGHTS.matureDays);
  return posts.flatMap((p) => {
    const at = new Date(p.postedAt);
    if (p.mediaType === 'STORY' || p.reach === null || !(p.reach > 0) || Number.isNaN(at.getTime())) return [];
    const day = localDay(at, tz);
    return day >= from && day <= to ? [{ p, day, hour: localHour(at, tz), reach: p.reach }] : [];
  });
}

interface Win {
  key: string;
  ratio: number;
  n: number;
  rest: number;
}

/** The group whose median reach is the highest multiple of the median of every other post (≥ minGroup on both sides). */
function winner(m: Measured[], keysOf: (x: Measured) => string[]): Win | null {
  const by = new Map<string, Measured[]>();
  for (const x of m) for (const k of keysOf(x)) by.set(k, [...(by.get(k) ?? []), x]);
  let best: Win | null = null;
  for (const [key, group] of by) {
    const inside = new Set(group);
    const rest = m.filter((x) => !inside.has(x));
    if (group.length < INSIGHTS.minGroup || rest.length < INSIGHTS.minGroup) continue;
    const ratio = median(group.map((x) => x.reach))! / median(rest.map((x) => x.reach))!;
    if (!best || ratio > best.ratio || (ratio === best.ratio && key < best.key)) best = { key, ratio, n: group.length, rest: rest.length };
  }
  return best;
}

const winConf = (w: Win) => (w.n >= INSIGHTS.mediumGroup && w.rest >= INSIGHTS.mediumGroup ? 'medium' : 'low');

/** Feed posts of the last 7 days at ≥ 2× the median reach of the previous 20 (SPEC §7 "Post taking off", lib/analysis/flags.ts). */
export function breakouts(posts: InsightPost[], accountId: string, now: Date, tz: string): Finding[] {
  return takingOff(posts, now, INSIGHTS.breakoutDays).map((f) =>
    make(accountId, 'breakout', f.postId, {
      tone: 'good',
      params: { ratio: f.ratio, format: posts.find((p) => p.id === f.postId)!.mediaType },
      n: f.n,
      confidence: conf(f.n, INSIGHTS.mediumGroup),
      day: localDay(new Date(f.postedAt), tz),
      postId: f.postId,
      href: postLabHref(accountId, f.postId),
    }),
  );
}

/** 7-day reach ≤ −20 % vs the 7 days before (SPEC §7c), keyed by the week of the settled day. */
export function reachDropFinding(daily: DailyRow[], accountId: string, today: string, tz: string): Finding | null {
  const d = reachDrop(daily, today, tz);
  if (!d) return null;
  const end = summarize(daily, [], 7, today, tz).endDay;
  return make(accountId, 'reach_drop', weekOf(end, 'mon').from, { tone: 'bad', params: { change: d.change }, n: 7, confidence: 'low', day: end, postId: null, href: accountHref(accountId, 'tab=growth') });
}

/** The settled day (the KPIs' last day) and each metric on it vs the same weekday of the 8 weeks before (weekdayAnomaly).
 *  followers = the change of the follower count from the day before. */
export function latestDay(daily: DailyRow[], today: string, tz: string): { day: string; values: Record<DayMetric, number | null>; metrics: Record<DayMetric, AnomalyResult | null> } {
  const day = summarize(daily, [], 1, today, tz).endDay;
  const byDay = new Map(daily.map((r) => [r.day, r]));
  const change = (d: string): number | null => {
    const a = byDay.get(d)?.followers ?? null;
    const b = byDay.get(addDays(d, -1))?.followers ?? null;
    return a !== null && b !== null ? a - b : null;
  };
  const series = (m: DayMetric): Record<string, number | null> => Object.fromEntries(daily.map((r) => [r.day, m === 'followers' ? change(r.day) : r[m]]));
  const all = Object.fromEntries(DAY_METRICS.map((m) => [m, series(m)])) as Record<DayMetric, Record<string, number | null>>;
  return {
    day,
    values: Object.fromEntries(DAY_METRICS.map((m) => [m, all[m][day] ?? null])) as Record<DayMetric, number | null>,
    metrics: Object.fromEntries(DAY_METRICS.map((m) => [m, weekdayAnomaly(all[m], day)])) as Record<DayMetric, AnomalyResult | null>,
  };
}

/** A metric of the settled day that weekdayAnomaly calls unusual (robust z ≥ 3.5 and a real move). */
export function unusualDays(daily: DailyRow[], accountId: string, today: string, tz: string): Finding[] {
  const { day, metrics } = latestDay(daily, today, tz);
  return DAY_METRICS.flatMap((metric) => {
    const a = metrics[metric];
    if (!a || 'reason' in a || !a.unusual) return [];
    return [
      make(accountId, 'unusual_day', `${metric}:${day}`, {
        tone: a.direction === 'up' ? 'good' : 'bad',
        params: { metric, value: a.value, typical: a.median, weekday: weekdayOf(day) },
        n: a.n,
        confidence: conf(a.n, INSIGHTS.mediumSamples),
        day,
        postId: null,
        href: accountHref(accountId, `tab=growth&day=${day}${metric === 'followers' ? '' : '&why=reach'}`),
      }),
    ];
  });
}

/** The weekday × day part whose posts reach the most vs every other post. `m` = measuredPosts(...) when the caller has it already. */
export function bestSlot(posts: InsightPost[], accountId: string, today: string, tz: string, m: Measured[] = measuredPosts(posts, today, tz)): Finding | null {
  if (m.length < INSIGHTS.minPosts) return null;
  const w = winner(m, (x) => [`${weekdayOf(x.day)}:${daypartOf(x.hour)}`]);
  if (!w || w.ratio < INSIGHTS.slotRatio) return null;
  const [weekday, daypart] = w.key.split(':');
  return make(accountId, 'best_slot', w.key, { tone: 'tip', params: { weekday: Number(weekday), daypart, ratio: w.ratio }, n: w.n, confidence: winConf(w), day: today, postId: null, href: accountHref(accountId) });
}

/** The format whose posts reach the most vs the posts of every other format. */
export function formatWinner(posts: InsightPost[], accountId: string, today: string, tz: string, m: Measured[] = measuredPosts(posts, today, tz)): Finding | null {
  if (m.length < INSIGHTS.minPosts) return null;
  const w = winner(m, (x) => [x.p.mediaType]);
  if (!w || w.ratio < INSIGHTS.formatRatio) return null;
  return make(accountId, 'format_winner', w.key, { tone: 'tip', params: { format: w.key, ratio: w.ratio }, n: w.n, confidence: winConf(w), day: today, postId: null, href: accountHref(accountId, `tab=posts&format=${w.key}`) });
}

/** The hashtag whose posts reach the most vs the posts without it (only posts whose caption was read). */
export function hashtagWinner(posts: InsightPost[], accountId: string, today: string, tz: string, measured?: Measured[]): Finding | null {
  if (!posts.some((p) => p.caption !== undefined)) return null; // the Overview reads no captions: skip the work
  const m = (measured ?? measuredPosts(posts, today, tz)).filter((x) => x.p.caption !== undefined);
  if (m.length < INSIGHTS.minPosts) return null;
  const w = winner(m, (x) => captionFeatures(x.p.caption ?? null).hashtags.map((h) => [...h].slice(0, INSIGHTS.maxHashtag).join('')));
  if (!w || w.ratio < INSIGHTS.hashtagRatio) return null;
  return make(accountId, 'hashtag_winner', w.key, { tone: 'tip', params: { hashtag: w.key, ratio: w.ratio }, n: w.n, confidence: winConf(w), day: today, postId: null, href: accountHref(accountId, 'tab=posts') });
}

/** No feed post for ≥ 2 × the median gap between posting days (and ≥ 3 days); keyed by the last post, so a new post ends it. */
export function postingGap(posts: InsightPost[], accountId: string, today: string, tz: string): Finding | null {
  const from = addDays(today, -INSIGHTS.lookbackDays);
  const feed = posts
    .filter((p) => p.mediaType !== 'STORY' && !Number.isNaN(Date.parse(p.postedAt)))
    .map((p) => ({ p, day: localDay(new Date(p.postedAt), tz) }))
    .filter((x) => x.day >= from && x.day <= today)
    .sort((a, b) => Date.parse(a.p.postedAt) - Date.parse(b.p.postedAt) || (a.p.id < b.p.id ? -1 : 1));
  const days = [...new Set(feed.map((x) => x.day))];
  const gaps = days.slice(1).map((d, i) => daysBetween(days[i], d));
  if (gaps.length < INSIGHTS.minGaps) return null;
  const typical = median(gaps)!;
  const last = feed[feed.length - 1];
  const since = daysBetween(last.day, today);
  if (since < Math.max(INSIGHTS.gapFactor * typical, INSIGHTS.minGapDays)) return null;
  return make(accountId, 'posting_gap', last.p.id, { tone: 'bad', params: { days: since, typical }, n: gaps.length, confidence: conf(gaps.length, INSIGHTS.mediumGaps), day: today, postId: null, href: accountHref(accountId, 'tab=posts') });
}

/** Questions of the last 7 days without a reply SEEN (thread replies are not read: always Low). Counts only. */
export function unansweredFinding(count: number | null, accountId: string, today: string): Finding | null {
  if (count === null || !(count >= 1)) return null;
  return make(accountId, 'unanswered', weekOf(today, 'mon').from, { tone: 'bad', params: { count }, n: count, confidence: 'low', day: today, postId: null, href: accountHref(accountId, 'tab=comments&section=questions') });
}

/** Problems first, then good news, then tips; inside a tone by FINDING_KINDS order, newest day first, then key. */
export const compareFindings = (a: Finding, b: Finding): number =>
  TONES.indexOf(a.tone) - TONES.indexOf(b.tone) || FINDING_KINDS.indexOf(a.kind) - FINDING_KINDS.indexOf(b.kind) || (a.day < b.day ? 1 : a.day > b.day ? -1 : 0) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/** Every rule over one account, ranked. */
export function findInsights(input: InsightInput, o: { today: string; now: Date; tz: string }): Finding[] {
  // A reconnect-needed or failing account: every rule reads synced data (posts, daily numbers, comments) that stopped
  // arriving, so each would describe the past as now ("no post for 10 days" while the owner kept posting). The Today
  // problem line / the account banner says what is wrong. `unanswered` too: replies made since are not seen either.
  if (input.stale) return [];
  const { accountId: a, daily, posts } = input;
  const m = measuredPosts(posts, o.today, o.tz); // once: the three post rules below share it
  return [
    ...breakouts(posts, a, o.now, o.tz),
    reachDropFinding(daily, a, o.today, o.tz),
    ...unusualDays(daily, a, o.today, o.tz),
    bestSlot(posts, a, o.today, o.tz, m),
    formatWinner(posts, a, o.today, o.tz, m),
    hashtagWinner(posts, a, o.today, o.tz, m),
    postingGap(posts, a, o.today, o.tz),
    unansweredFinding(input.unanswered, a, o.today),
  ]
    .filter((f): f is Finding => f !== null)
    .sort(compareFindings);
}

/** Findings minus the dismissed ones (until = null) and the snoozed ones (until in the future). */
export function visibleFindings(findings: Finding[], dismissals: Dismissal[] | null, now: Date): Finding[] {
  if (!dismissals?.length) return findings;
  const hidden = new Set(dismissals.filter((d) => d.until === null || Date.parse(d.until) > now.getTime()).map((d) => d.key));
  return findings.filter((f) => !hidden.has(f.key));
}

const KEY = /^([a-z_]+):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([\p{L}\p{M}\p{N}_:.-]+)$/u;

/** A key from the browser: `<known kind>:<lower-case uuid>:<id>`, at most INSIGHTS.maxKey characters; anything else is null. */
export function parseFindingKey(v: unknown): { kind: FindingKind; accountId: string } | null {
  if (typeof v !== 'string' || v.length > INSIGHTS.maxKey) return null;
  const m = KEY.exec(v);
  return m && (FINDING_KINDS as readonly string[]).includes(m[1]) ? { kind: m[1] as FindingKind, accountId: m[2] } : null;
}
