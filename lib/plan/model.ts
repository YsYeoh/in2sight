// The Plan page models (Plan 17d). Pure: today / now / tz / weekStart are inputs.
// Digest = the Overview's numbers (buildOverview: KPIs with the comparison and its 80 % coverage rule, groups, healthy-only
// totals) for ONE calendar week or month, compared with the one before, plus per account the top 3 / bottom 3 feed posts
// by reach and the goals' current progress. Weeks follow the week-start setting; days are owner-timezone days.
import { avgReachProgress, followersProgress, postsPerWeekProgress, YOUNG_DAYS, type Goal, type GoalProgress } from '@/lib/analysis/goals';
import { INSIGHTS, visibleFindings, type Dismissal, type Finding } from '@/lib/analysis/insights';
import type { Post } from '@/lib/analysis/types';
import { buildOverview, type OverviewModel } from '@/lib/dashboard/overview';
import type { OverviewInput } from '@/lib/dashboard/read';
import type { WeekStart } from '@/lib/prefs';
import { addDays, localDay } from '@/lib/sync/time';
import { daysBetween, isDay, minDay, monthOf, weekOf, type DayRange } from '@/lib/time-scope/range';
import { earliestDay, readFrom, resolveScope, type TimeScope } from '@/lib/time-scope/scope';

export type PeriodKind = 'week' | 'month';
export interface DigestPeriod {
  kind: PeriodKind;
  range: DayRange;
  prev: string; // href of the period before
  next: string | null; // href of the period after; null when it would start after today
  running: boolean; // the period has not ended yet (today is inside it)
}
export const TOP_POSTS = 3;

type Params = Record<string, string | string[] | undefined>;
const one = (sp: Params, k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : null);

/** `/plan/digest?week=<first day>` or `?month=YYYY-MM`. */
export const digestHref = (kind: PeriodKind, r: DayRange): string => (kind === 'week' ? `/plan/digest?week=${r.from}` : `/plan/digest?month=${r.from.slice(0, 7)}`);

/** The last COMPLETE week or month before today (the Monday review). */
export function lastComplete(kind: PeriodKind, today: string, weekStart: WeekStart): DayRange {
  return kind === 'week' ? weekOf(addDays(weekOf(today, weekStart).from, -1), weekStart) : monthOf(addDays(`${today.slice(0, 7)}-01`, -1));
}

/** ?month=YYYY-MM wins over ?week=<any day of it>; junk, or a period that starts after today, = the last complete week. */
export function parseDigestPeriod(sp: Params, today: string, weekStart: WeekStart): DigestPeriod {
  const m = one(sp, 'month')?.match(/^(20\d\d)-(0[1-9]|1[0-2])$/);
  const w = one(sp, 'week');
  let kind: PeriodKind = 'week';
  let range = lastComplete('week', today, weekStart);
  if (m && `${m[0]}-01` <= today) [kind, range] = ['month', monthOf(`${m[0]}-01`)];
  else if (!m && isDay(w) && weekOf(w, weekStart).from <= today) range = weekOf(w, weekStart);
  const after = kind === 'week' ? weekOf(addDays(range.to, 1), weekStart) : monthOf(addDays(range.to, 1));
  const before = kind === 'week' ? weekOf(addDays(range.from, -1), weekStart) : monthOf(addDays(range.from, -1));
  return { kind, range, prev: digestHref(kind, before), next: after.from <= today ? digestHref(kind, after) : null, running: range.to >= today };
}

/** The Time Scope of a period: those days, compared with the period before (cut to the same days while it runs). */
export const periodScope = (p: DigestPeriod): TimeScope => ({ range: p.range, cmp: 'prev', gran: 'day' });

export interface DigestPost {
  id: string;
  mediaType: Post['mediaType'];
  postedAt: string;
  reach: number;
  young: boolean; // posted fewer than YOUNG_DAYS days before today: its reach is still growing
}
export interface DigestAccount {
  top: DigestPost[];
  bottom: DigestPost[]; // only when there are more than 2 x TOP_POSTS measured posts (no overlap with top)
  measured: number; // feed posts of the period with reach
  goals: GoalProgress[];
}
export interface DigestModel {
  period: DigestPeriod;
  overview: OverviewModel;
  accounts: Record<string, DigestAccount>;
}

const byReach = (a: DigestPost, b: DigestPost) => b.reach - a.reach || (a.postedAt < b.postedAt ? 1 : -1);

/** The goals of one account, computed for today (never for a past period: a goal's pace is a "now" answer). */
function goalsNow(goals: Goal[], input: OverviewInput, accountId: string, o: { today: string; now: Date; tz: string; weekStart: WeekStart }): GoalProgress[] {
  const daily = input.daily[accountId] ?? [];
  const posts = input.posts[accountId] ?? [];
  return goals
    .filter((g) => g.accountId === accountId)
    .flatMap((g): GoalProgress[] => {
      if (g.metric === 'followers') return g.dueDay !== null ? [followersProgress({ ...g, dueDay: g.dueDay }, daily, o.today)] : []; // the migration requires a due day for followers
      if (g.metric === 'avg_reach') return [avgReachProgress(g, posts, monthOf(o.today), o.now, o.tz)];
      return [postsPerWeekProgress(g, posts, weekOf(o.today, o.weekStart), o.today, o.tz)];
    });
}

/** The first day the Plan page reads: the period and its comparison (readFrom), this month and last week, INSIGHTS.readDays before today (the findings compare the latest day with the same weekday of the 8 weeks before; it also covers the 28 days of follower history), and each followers goal's start day. */
export function planReadFrom(time: TimeScope, today: string, weekStart: WeekStart, goals: Goal[]): string {
  let from = minDay(readFrom(time, today), minDay(`${today.slice(0, 7)}-01`, addDays(weekOf(today, weekStart).from, -7)));
  from = minDay(from, addDays(today, -INSIGHTS.readDays));
  for (const g of goals) if (g.metric === 'followers') from = minDay(from, g.startDay);
  return from;
}

export function buildDigest(input: OverviewInput, goals: Goal[], o: { period: DigestPeriod; today: string; now: Date; tz: string; locale: string; weekStart: WeekStart }): DigestModel {
  const scope = resolveScope(periodScope(o.period), o.today, earliestDay(Object.values(input.daily)));
  const overview = buildOverview(input, { scope, today: o.today, now: o.now, tz: o.tz, locale: o.locale, weekStart: o.weekStart });
  const accounts: Record<string, DigestAccount> = {};
  for (const a of input.accounts) {
    const measured = (input.posts[a.id] ?? [])
      .filter((p) => {
        if (p.mediaType === 'STORY' || p.reach === null) return false;
        const d = localDay(new Date(p.postedAt), o.tz);
        return d >= o.period.range.from && d <= o.period.range.to;
      })
      .map((p): DigestPost => ({ id: p.id, mediaType: p.mediaType, postedAt: p.postedAt, reach: p.reach!, young: daysBetween(localDay(new Date(p.postedAt), o.tz), o.today) < YOUNG_DAYS }))
      .sort(byReach);
    accounts[a.id] = {
      top: measured.slice(0, TOP_POSTS),
      bottom: measured.length > 2 * TOP_POSTS ? measured.slice(-TOP_POSTS).reverse() : [],
      measured: measured.length,
      goals: goalsNow(goals, input, a.id, o),
    };
  }
  return { period: o.period, overview, accounts };
}

/** Findings shown per account in the digest before the link to the account page (Plan 17d follow-up). */
export const DIGEST_FINDINGS = 3;
export interface DigestFindings {
  byAccount: Record<string, Finding[]>; // the account's findings that are not dismissed or snoozed, in the feed's order
  canDismiss: boolean; // false = the dismissals table could not be read (no buttons)
}

/** The digest's findings per account: the insights feed of Plan 17b, "now" (like the goals, not tied to the period shown). */
export function digestFindings(accountIds: string[], found: Record<string, Finding[]>, dismissals: Dismissal[] | null, now: Date): DigestFindings {
  return { byAccount: Object.fromEntries(accountIds.map((id) => [id, visibleFindings(found[id] ?? [], dismissals, now)])), canDismiss: dismissals !== null };
}

export interface GoalsAccount {
  id: string;
  username: string;
  goals: Goal[];
  progress: GoalProgress[];
}

/** The Goals section: every live account (Overview order: by username), its stored goals and their progress now. */
export function buildGoals(input: OverviewInput, goals: Goal[], o: { today: string; now: Date; tz: string; locale: string; weekStart: WeekStart }): GoalsAccount[] {
  return [...input.accounts]
    .sort((x, y) => x.username.localeCompare(y.username, o.locale))
    .map((a) => ({ id: a.id, username: a.username, goals: goals.filter((g) => g.accountId === a.id), progress: goalsNow(goals, input, a.id, o) }));
}
