// The Overview's "Today" briefing (Plan 17b, SPEC §7m; creator-toolkit design §0b): four answers in ten seconds. Pure:
// built from the Overview's own reads, the account cards and the findings; today / now / tz are inputs. It ignores the
// range bar on purpose (it is always "the latest settled day" and "the last 7 days").
import { weekdayOf } from '@/lib/analysis/best-time';
import {
  bestSlot,
  compareFindings,
  DAY_METRICS,
  DAYPARTS,
  findInsights,
  INSIGHTS,
  latestDay,
  measuredPosts,
  visibleFindings,
  type DayMetric,
  type Daypart,
  type Dismissal,
  type Finding,
  type Measured,
} from '@/lib/analysis/insights';
import { median } from '@/lib/analysis/posts';
import { isStale, type AccountCard } from '@/lib/dashboard/overview';
import type { OverviewInput } from '@/lib/dashboard/read';
import type { MediaKind } from '@/lib/instagram/parse';
import { addDays, localDay, localHour } from '@/lib/sync/time';
import { daysBetween } from '@/lib/time-scope/range';

export const TODAY = { topDays: 7, attentionMax: 8 } as const;

export interface TodayMetric {
  id: DayMetric;
  value: number | null;
  typical: number | null; // median of the same weekday; null = fewer than 4 of them
  n: number;
  unusual: boolean;
}
export interface TodayTop {
  id: string;
  mediaType: Exclude<MediaKind, 'STORY'>;
  postedAt: string;
  reach: number;
  typical: number | null; // median reach of the account's mature posts of that format; null under 5
  n: number;
}
export interface TodaySlot {
  weekday: number;
  daypart: Daypart;
  day: string; // the next such day (today while the day part has not passed)
  n: number;
  confidence: 'low' | 'medium';
}
export interface TodayAccount {
  id: string;
  username: string;
  day: string; // the settled day the metrics are for
  metrics: TodayMetric[];
  top: TodayTop | null; // best post of the last 7 days
  lastPostDays: number | null; // days since the newest feed post; null = none read
  slot: TodaySlot | null;
  noSlot: 'few_posts' | 'no_clear_slot' | null; // why slot is null; null while there is one
}
export type Attention =
  | { kind: 'problem'; accountId: string; username: string; problem: 'needs_reconnect' | 'sync_error'; errorKey: string | null }
  | { kind: 'finding'; username: string; finding: Finding };
export interface TodayModel {
  accounts: TodayAccount[]; // healthy accounts only (state ok), in card order
  attention: Attention[];
  canDismiss: boolean;
}

/** The next day (from today) with this weekday whose day part has not ended yet. */
export function nextSlotDay(weekday: number, daypart: Daypart, now: Date, tz: string): string {
  const today = localDay(now, tz);
  const end = (DAYPARTS.indexOf(daypart) + 1) * 6;
  for (let i = 0; i < 7; i++) {
    const d = addDays(today, i);
    if (weekdayOf(d) === weekday && (i > 0 || localHour(now, tz) < end)) return d;
  }
  return addDays(today, 7);
}

/** Every rule for every account of the Overview (no captions there, so no hashtag finding). An account that needs a reconnect
 *  or is failing to sync gets none (isStale): its problem line is under "Needs attention" instead. */
export function todayFindings(input: OverviewInput, cards: AccountCard[], unanswered: Record<string, number | null>, o: { today: string; now: Date; tz: string }): Record<string, Finding[]> {
  return Object.fromEntries(cards.map((c) => [c.id, findInsights({ accountId: c.id, daily: input.daily[c.id] ?? [], posts: input.posts[c.id] ?? [], unanswered: unanswered[c.id] ?? null, stale: isStale(c) }, o)]));
}

function topPost(input: OverviewInput, id: string, measured: Measured[], o: { today: string; tz: string }): TodayTop | null {
  const posts = (input.posts[id] ?? []).filter((p) => p.mediaType !== 'STORY' && p.reach !== null && p.reach > 0 && localDay(new Date(p.postedAt), o.tz) >= addDays(o.today, -(TODAY.topDays - 1)));
  const best = posts.reduce<(typeof posts)[number] | null>((b, p) => (!b || p.reach! > b.reach! || (p.reach === b.reach && p.postedAt > b.postedAt) ? p : b), null);
  if (!best) return null;
  const same = measured.filter((m) => m.p.mediaType === best.mediaType).map((m) => m.reach);
  return { id: best.id, mediaType: best.mediaType as TodayTop['mediaType'], postedAt: best.postedAt, reach: best.reach!, typical: same.length >= INSIGHTS.minGroup ? median(same) : null, n: same.length };
}

export function buildToday(input: OverviewInput, cards: AccountCard[], found: Record<string, Finding[]>, dismissals: Dismissal[] | null, o: { today: string; now: Date; tz: string }): TodayModel {
  const problems: Attention[] = cards.flatMap((c): Attention[] =>
    c.state === 'needs_reconnect'
      ? [{ kind: 'problem', accountId: c.id, username: c.username, problem: 'needs_reconnect', errorKey: null }]
      : c.syncErrorKey
        ? [{ kind: 'problem', accountId: c.id, username: c.username, problem: 'sync_error', errorKey: c.syncErrorKey }]
        : [],
  );
  const name = new Map(cards.map((c) => [c.id, c.username]));
  const findings = cards
    .flatMap((c) => visibleFindings(found[c.id] ?? [], dismissals, o.now))
    .filter((f) => f.tone === 'bad' || f.kind === 'breakout')
    .sort(compareFindings)
    .map((f): Attention => ({ kind: 'finding', username: name.get(f.accountId) ?? '', finding: f }));
  const accounts = cards
    .filter((c) => c.state === 'ok')
    .map((c): TodayAccount => {
      const daily = input.daily[c.id] ?? [];
      const posts = input.posts[c.id] ?? [];
      const latest = latestDay(daily, o.today, o.tz);
      const newest = posts.filter((p) => p.mediaType !== 'STORY').reduce<string | null>((m, p) => (m === null || p.postedAt > m ? p.postedAt : m), null);
      const measured = measuredPosts(posts, o.today, o.tz); // once: the slot and the typical reach of the top post share it
      const slot = bestSlot(posts, c.id, o.today, o.tz, measured);
      return {
        id: c.id,
        username: c.username,
        day: latest.day,
        metrics: DAY_METRICS.map((id) => {
          const a = latest.metrics[id];
          const known = a && !('reason' in a) ? a : null;
          return { id, value: latest.values[id], typical: known?.median ?? null, n: a?.n ?? 0, unusual: known?.unusual ?? false };
        }),
        top: topPost(input, c.id, measured, o),
        lastPostDays: newest === null ? null : daysBetween(localDay(new Date(newest), o.tz), o.today),
        slot: slot ? { weekday: Number(slot.params.weekday), daypart: slot.params.daypart as Daypart, day: nextSlotDay(Number(slot.params.weekday), slot.params.daypart as Daypart, o.now, o.tz), n: slot.n, confidence: slot.confidence } : null,
        // why there is none: under the rules' minimum of posts, or enough posts and no slot reaches 1.5× (or has 5 posts)
        noSlot: slot ? null : measured.length < INSIGHTS.minPosts ? 'few_posts' : 'no_clear_slot',
      };
    });
  return { accounts, attention: [...problems, ...findings].slice(0, TODAY.attentionMax), canDismiss: dismissals !== null };
}
