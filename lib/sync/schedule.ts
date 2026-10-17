// Pure scheduling decisions: which jobs are due for an account on this tick, and which media need a new snapshot.
// The tick runs every 30 minutes from any HTTP scheduler (docs/RUNBOOK_SYNC.md); intervals here are independent of it.
import type { AccountStatus } from '@/lib/accounts/types';
import type { Capabilities } from '@/lib/sync/capabilities';
import { addDays, localDay, localHour } from '@/lib/sync/time';

const STORIES_EVERY_MIN = 30; // every tick: a story lives 24h, a missed window is lost data
export const MEDIA_LIST_EVERY_MIN = 60;
export const COVERS_EVERY_MIN = 60; // new posts appear with the hourly media list; their CDN links live ~1.4–4.5 days
export const SLACK_MIN = 5; // a scheduler firing a few minutes early (or a slow previous tick) still counts as on time
export const DAILY_HOUR = 6; // owner-local hour after which the daily account + audience jobs run
export const BACKFILL_DAYS = 90; // first connect: account insights this far back (Meta keeps ~90 days)
export const FIRST_DAYS = 7; // onboarding: the newest week first (KPIs + sparkline), before posts and older history
export const NEWEST_POSTS = 10; // never-measured posts older than 30 days the regular media job takes per run (newest first)
export const SETTLE_DAYS = 3; // Instagram data can lag up to 48h: re-fetch the last 3 days every day
export const TOKEN_REFRESH_WITHIN_DAYS = 14;
export const TOKEN_RETRY_HOURS = 24;
export const MEDIA_HOURLY_UNDER_HOURS = 48;
export const MEDIA_DAILY_UNDER_DAYS = 30;
export const CHECKPOINT_DAYS = 7; // Post Lab velocity curve: one snapshot as close to day 7 as the ticks allow
export const MEDIA_BACKFILL_MAX = 500;
export const MEDIA_RECENT_MAX = 100;
const BACKOFF_BASE_MIN = 30;
const BACKOFF_MAX_MIN = 240;

const MIN = 60_000;
const HOUR = 60 * MIN;

/** Story extras every STORY_EXTRAS_EVERY_MIN of a Story's life, and on every pass in its last hour (final values). */
export const STORY_EXTRAS_EVERY_MIN = 120;

/**
 * Stateless cadence for Story extras (3 calls per Story when all are supported): the pass that lands in the first
 * half hour of each 2-hour window of the Story's age, plus every pass after 23 h. ~13 extra snapshots per Story.
 */
export function storyExtrasDue(postedAt: string, now: Date): boolean {
  const ageMin = (now.getTime() - Date.parse(postedAt)) / MIN;
  return ageMin >= 23 * 60 || ageMin % STORY_EXTRAS_EVERY_MIN < STORIES_EVERY_MIN;
}

/**
 * Run order inside one account: time-critical first, token refresh last (the current token stays valid). It is also the
 * onboarding order of a new account: newest week (daily) -> post list -> newest posts' metrics -> audience -> older
 * history (backfill: days 8–90 newest first, then older posts' metrics) -> post covers (lane 2 only, once the history
 * import is through).
 */
export const JOBS = ['stories', 'daily', 'mediaList', 'mediaMetrics', 'audience', 'backfill', 'covers', 'tokenRefresh'] as const;
export type JobKind = (typeof JOBS)[number];

/** Optional catch-up work that only lane 2 runs (never inside lane 1's small per-account slice). */
export const LANE2_ONLY: readonly JobKind[] = ['covers'];

/** regular = lane 1 (every account, small slice, never the history import); all = lane 2 / single-lane callers. */
export type Lane = 'regular' | 'all';

export interface SyncState {
  accountId: string;
  leaseUntil: string | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  consecutiveFailures: number;
  lastErrorKey: string | null;
  /** Newest insight day handled (forward edge). Every day from backfilledFrom to here is handled. */
  dailyDoneThrough: string | null;
  /** Oldest insight day handled by the newest-first import (backward edge); null = not started. */
  backfilledFrom: string | null;
  lastRun: Partial<Record<JobKind, string>>; // ISO time of each job's last success
  /** Optional metrics/fields Meta answered "unsupported" (false) or served (true); see lib/sync/capabilities.ts. */
  capabilities?: Capabilities;
}

export const emptyState = (accountId: string): SyncState => ({
  accountId,
  leaseUntil: null,
  lastAttemptAt: null,
  lastSuccessAt: null,
  consecutiveFailures: 0,
  lastErrorKey: null,
  dailyDoneThrough: null,
  backfilledFrom: null,
  lastRun: {},
  capabilities: {},
});

/**
 * The history import (days 8–90, older posts) still has work. A row synced before Plan 11a (daily_done_through set,
 * backfilled_from never written) finished the old oldest-first backfill: it counts as complete and is never re-fetched.
 */
export function isBackfilling(s: Pick<SyncState, 'lastRun' | 'dailyDoneThrough' | 'backfilledFrom'>): boolean {
  return !s.lastRun.backfill && !(s.dailyDoneThrough !== null && s.backfilledFrom === null);
}

/** The newest FIRST_DAYS days are not all in yet (new account, or its first pass stopped half-way). */
export function firstWeekPending(s: Pick<SyncState, 'dailyDoneThrough' | 'backfilledFrom' | 'lastRun'>, today: string): boolean {
  return !s.dailyDoneThrough || (!s.lastRun.backfill && s.backfilledFrom !== null && s.backfilledFrom > addDays(today, -FIRST_DAYS));
}

/** Rate-limit back-off: 30, 60, 120, 240, 240… minutes after the last attempt. */
export function backoffMs(failures: number): number {
  return failures <= 0 ? 0 : Math.min(BACKOFF_BASE_MIN * 2 ** (failures - 1), BACKOFF_MAX_MIN) * MIN;
}

export interface ScheduleInput {
  status: AccountStatus;
  tokenExpiresAt: string | null;
  state: SyncState;
}

export function dueJobs({ status, tokenExpiresAt, state: s }: ScheduleInput, now: Date, tz: string, opts: { manual?: boolean; lane?: Lane } = {}): JobKind[] {
  if (status !== 'active') return []; // archived and needs_reconnect accounts are never synced
  const t = now.getTime();
  if (s.leaseUntil && Date.parse(s.leaseUntil) > t) return []; // another tick holds this account
  const ago = (iso: string | null | undefined) => (iso ? t - Date.parse(iso) : Infinity);
  const atLeast = (iso: string | null | undefined, ms: number) => ago(iso) >= ms - SLACK_MIN * MIN;
  if (!opts.manual && s.lastErrorKey === 'rate_limited' && !atLeast(s.lastAttemptAt, backoffMs(s.consecutiveFailures))) return [];

  const today = localDay(now, tz);
  const afterDailyHour = localHour(now, tz) >= DAILY_HOUR;
  const ranToday = (iso: string | undefined) => !!iso && localDay(new Date(iso), tz) === today;
  const due = new Set<JobKind>();

  if (opts.manual || atLeast(s.lastRun.stories, STORIES_EVERY_MIN * MIN)) due.add('stories');
  // behind = newest week not in yet (new account) or a day was missed: catch up now, whatever the hour
  const firstWeek = firstWeekPending(s, today);
  const behind = firstWeek || s.dailyDoneThrough! < addDays(today, -2);
  if (behind || (afterDailyHour && !ranToday(s.lastRun.daily))) due.add('daily');
  if (opts.manual || atLeast(s.lastRun.mediaList, MEDIA_LIST_EVERY_MIN * MIN)) due.add('mediaList');
  due.add('mediaMetrics'); // cheap when nothing is due: pickDueMedia decides per post
  if (!s.lastRun.audience || (afterDailyHour && !ranToday(s.lastRun.audience))) due.add('audience');
  if (isBackfilling(s)) due.add('backfill');
  else if (atLeast(s.lastRun.covers, COVERS_EVERY_MIN * MIN)) due.add('covers'); // after the import: Overview numbers first
  const expires = tokenExpiresAt ? Date.parse(tokenExpiresAt) : NaN;
  if (!Number.isNaN(expires) && expires - t <= TOKEN_REFRESH_WITHIN_DAYS * 24 * HOUR && atLeast(s.lastRun.tokenRefresh, TOKEN_RETRY_HOURS * HOUR)) due.add('tokenRefresh');

  const jobs = JOBS.filter((j) => due.has(j));
  if (opts.lane !== 'regular') return jobs;
  // lane 1 never imports history or runs optional catch-up; a new account gets only its time-critical jobs there
  return jobs.filter((j) => j !== 'backfill' && !LANE2_ONLY.includes(j) && (!firstWeek || j === 'stories' || j === 'tokenRefresh'));
}

/** Round-robin: accounts that waited longest go first (never-attempted first of all). */
export function byOldestAttempt(a: SyncState, b: SyncState): number {
  if (a.lastAttemptAt === b.lastAttemptAt) return 0;
  if (a.lastAttemptAt === null) return -1;
  if (b.lastAttemptAt === null) return 1;
  return a.lastAttemptAt < b.lastAttemptAt ? -1 : 1;
}

export interface MediaRef {
  id: string;
  postedAt: string;
  lastMetricsAt: string | null;
  kind?: string; // IMAGE | CAROUSEL_ALBUM | REELS: picks the extra metric group (feed vs Reels)
}

/**
 * Feed/Reels media needing a snapshot now, newest first: never captured, hourly under 48h, daily under 30d, plus the
 * 7-day checkpoint (first tick after day 7 when the last snapshot is from before day 7). Of the never-captured posts
 * older than 30 days only the newest `oldMax` are taken (the rest is the history import's job).
 */
export function pickDueMedia(refs: MediaRef[], now: Date, oldMax = NEWEST_POSTS): string[] {
  const t = now.getTime();
  const slack = SLACK_MIN * MIN;
  let old = 0;
  return refs
    .filter((r) => {
      if (!r.lastMetricsAt) return true;
      const age = t - Date.parse(r.postedAt);
      const since = t - Date.parse(r.lastMetricsAt);
      if (age < MEDIA_HOURLY_UNDER_HOURS * HOUR) return since >= HOUR - slack;
      const mark = Date.parse(r.postedAt) + CHECKPOINT_DAYS * 24 * HOUR;
      if (t >= mark && Date.parse(r.lastMetricsAt) < mark && age < (CHECKPOINT_DAYS + 1) * 24 * HOUR) return true;
      if (age < MEDIA_DAILY_UNDER_DAYS * 24 * HOUR) return since >= 24 * HOUR - slack;
      return false;
    })
    .sort((a, b) => (a.postedAt < b.postedAt ? 1 : a.postedAt > b.postedAt ? -1 : 0))
    .filter((r) => r.lastMetricsAt !== null || t - Date.parse(r.postedAt) < MEDIA_DAILY_UNDER_DAYS * 24 * HOUR || old++ < oldMax)
    .map((r) => r.id);
}
