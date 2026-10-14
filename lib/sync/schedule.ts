// Pure scheduling decisions: which jobs are due for an account on this tick, and which media need a new snapshot.
// The tick runs every 30 minutes from any HTTP scheduler (docs/RUNBOOK_SYNC.md); intervals here are independent of it.
import type { AccountStatus } from '@/lib/accounts/types';
import { addDays, localDay, localHour } from '@/lib/sync/time';

const STORIES_EVERY_MIN = 30; // every tick: a story lives 24h, a missed window is lost data
export const MEDIA_LIST_EVERY_MIN = 60;
export const SLACK_MIN = 5; // a scheduler firing a few minutes early (or a slow previous tick) still counts as on time
export const DAILY_HOUR = 6; // owner-local hour after which the daily account + audience jobs run
export const BACKFILL_DAYS = 90; // first connect: account insights this far back (Meta keeps ~90 days)
export const SETTLE_DAYS = 3; // Instagram data can lag up to 48h: re-fetch the last 3 days every day
export const TOKEN_REFRESH_WITHIN_DAYS = 14;
export const TOKEN_RETRY_HOURS = 24;
export const MEDIA_HOURLY_UNDER_HOURS = 48;
export const MEDIA_DAILY_UNDER_DAYS = 30;
export const MEDIA_BACKFILL_MAX = 500;
export const MEDIA_RECENT_MAX = 100;
const BACKOFF_BASE_MIN = 30;
const BACKOFF_MAX_MIN = 240;

const MIN = 60_000;
const HOUR = 60 * MIN;

/** Run order inside one account: time-critical first, token refresh last (the current token stays valid). */
export const JOBS = ['stories', 'daily', 'mediaList', 'mediaMetrics', 'audience', 'tokenRefresh'] as const;
export type JobKind = (typeof JOBS)[number];

export interface SyncState {
  accountId: string;
  leaseUntil: string | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  consecutiveFailures: number;
  lastErrorKey: string | null;
  dailyDoneThrough: string | null;
  lastRun: Partial<Record<JobKind, string>>; // ISO time of each job's last success
}

export const emptyState = (accountId: string): SyncState => ({
  accountId,
  leaseUntil: null,
  lastAttemptAt: null,
  lastSuccessAt: null,
  consecutiveFailures: 0,
  lastErrorKey: null,
  dailyDoneThrough: null,
  lastRun: {},
});

/** Rate-limit back-off: 30, 60, 120, 240, 240… minutes after the last attempt. */
export function backoffMs(failures: number): number {
  return failures <= 0 ? 0 : Math.min(BACKOFF_BASE_MIN * 2 ** (failures - 1), BACKOFF_MAX_MIN) * MIN;
}

export interface ScheduleInput {
  status: AccountStatus;
  tokenExpiresAt: string | null;
  state: SyncState;
}

export function dueJobs({ status, tokenExpiresAt, state: s }: ScheduleInput, now: Date, tz: string, opts: { manual?: boolean } = {}): JobKind[] {
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
  // behind = never ran (first-connect backfill) or a day was missed: catch up now, whatever the hour
  const behind = !s.dailyDoneThrough || s.dailyDoneThrough < addDays(today, -2);
  if (behind || (afterDailyHour && !ranToday(s.lastRun.daily))) due.add('daily');
  if (opts.manual || atLeast(s.lastRun.mediaList, MEDIA_LIST_EVERY_MIN * MIN)) due.add('mediaList');
  due.add('mediaMetrics'); // cheap when nothing is due: pickDueMedia decides per post
  if (!s.lastRun.audience || (afterDailyHour && !ranToday(s.lastRun.audience))) due.add('audience');
  const expires = tokenExpiresAt ? Date.parse(tokenExpiresAt) : NaN;
  if (!Number.isNaN(expires) && expires - t <= TOKEN_REFRESH_WITHIN_DAYS * 24 * HOUR && atLeast(s.lastRun.tokenRefresh, TOKEN_RETRY_HOURS * HOUR)) due.add('tokenRefresh');

  return JOBS.filter((j) => due.has(j));
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
}

/** Feed/Reels media needing a snapshot now, newest first: never captured (backfill), hourly under 48h, daily under 30d. */
export function pickDueMedia(refs: MediaRef[], now: Date): string[] {
  const t = now.getTime();
  const slack = SLACK_MIN * MIN;
  return refs
    .filter((r) => {
      if (!r.lastMetricsAt) return true;
      const age = t - Date.parse(r.postedAt);
      const since = t - Date.parse(r.lastMetricsAt);
      if (age < MEDIA_HOURLY_UNDER_HOURS * HOUR) return since >= HOUR - slack;
      if (age < MEDIA_DAILY_UNDER_DAYS * 24 * HOUR) return since >= 24 * HOUR - slack;
      return false;
    })
    .sort((a, b) => (a.postedAt < b.postedAt ? 1 : a.postedAt > b.postedAt ? -1 : 0))
    .map((r) => r.id);
}
