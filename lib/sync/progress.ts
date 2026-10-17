// Sync progress as the panel and badges show it. Pure: `now` and `today` (owner-timezone day) are inputs.
// Persistent truth (sync_state coverage + counts) drives the stage checklist and the percentage; the live sync_progress
// row (written by the running sync, docs/RUNBOOK_SYNC.md) adds the current activity, start time and fresh day counts.
import { backoffMs, BACKFILL_DAYS, isBackfilling, type SyncState } from '@/lib/sync/schedule';
import { daysBetween } from '@/lib/time-scope/range';

/** Panel order. Reserved stages (later plans: cover images, comments) are valid in the table but not shown yet. */
export const STAGES = ['profile', 'stories', 'account_days', 'posts_list', 'post_metrics', 'audience'] as const;
type ReservedStage = 'covers' | 'comments';
export type ShownStage = (typeof STAGES)[number];
export type Stage = ShownStage | ReservedStage;
export type LiveState = 'waiting' | 'running' | 'failed' | 'done';

/** One sync_progress row: the live activity of the current run. Counts and keys only, never ids of media or tokens. */
export interface LiveProgress {
  stage: Stage | null;
  state: LiveState;
  done: number;
  total: number | null;
  detailDay: string | null;
  errorKey: string | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export type ProgressState = Pick<SyncState, 'lastRun' | 'dailyDoneThrough' | 'backfilledFrom' | 'leaseUntil' | 'lastAttemptAt' | 'lastSuccessAt' | 'lastErrorKey' | 'consecutiveFailures'>;

export interface ProgressInput {
  accountId: string;
  needsReconnect: boolean;
  state: ProgressState;
  live: LiveProgress | null;
  posts: { total: number; measured: number }; // feed + Reels not gone; measured = has a metrics snapshot (or was skipped for good)
  followers: number | null; // latest follower snapshot
}

export type StageState = 'pending' | 'running' | 'done' | 'skipped' | 'failed';
export interface StageView {
  stage: ShownStage;
  state: StageState;
  done: number | null;
  total: number | null;
  reason: string | null; // i18n key: skip reason or sync error key
}
export type Phase = 'running' | 'waiting' | 'rate_limited' | 'needs_reconnect' | 'failed' | 'stalled' | 'done';

export interface AccountProgress {
  accountId: string;
  phase: Phase;
  percent: number; // 0-100, 100 only when done
  stages: StageView[];
  current: { stage: Stage; day: string | null; done: number; total: number | null } | null;
  startedAt: string | null;
  elapsedMs: number | null;
  etaMs: number | null; // null = "estimating"
  resumeInMs: number | null; // rate limited: time until the back-off ends
  errorKey: string | null;
  summary: { days: number; posts: number };
}

const WEIGHTS: Record<ShownStage, number> = { profile: 2, stories: 3, account_days: 50, posts_list: 5, post_metrics: 35, audience: 5 };
/** The sync writes at least every few seconds while working: an older row is not "running now". */
const ACTIVE_MS = 90_000;
/** A tick comes every 30 minutes; no activity for longer than this while work is left = stalled. */
const STALL_MS = 35 * 60_000;
/** Show a finished run's summary for this long after it ends. */
const RECENT_MS = 10 * 60_000;
/** Measured live 2026-10-16 (docs/RUNBOOK_SYNC.md): ~5 calls per day = 1.5 s, one insights call per post = 0.4 s. */
const MS_PER_DAY = 1_500;
const MS_PER_POST = 400;

/** Insight days of the BACKFILL_DAYS window handled so far (backfilledFrom ... dailyDoneThrough). */
export function coveredDays(s: Pick<SyncState, 'dailyDoneThrough' | 'backfilledFrom'>): number {
  if (!s.dailyDoneThrough) return 0;
  if (!s.backfilledFrom) return BACKFILL_DAYS; // synced before Plan 11a: the old backfill finished
  return Math.max(0, Math.min(BACKFILL_DAYS, daysBetween(s.backfilledFrom, s.dailyDoneThrough) + 1));
}

/**
 * When the live session ended: its own finish stamp or, for a complete account whose run another tick did (a "Sync now"
 * that found the account leased), the last success after the session started. A row left "running" by a run that died
 * counts too once it is stale and a success came after its last write. null = still going.
 */
function sessionEnd({ state: s, live }: Pick<ProgressInput, 'state' | 'live'>, now: Date): string | null {
  if (!live) return null;
  if (live.finishedAt) return live.finishedAt;
  const ok = s.lastSuccessAt ? Date.parse(s.lastSuccessAt) : NaN;
  const leftRunning = live.state === 'running' && now.getTime() - Date.parse(live.updatedAt) > ACTIVE_MS && ok > Date.parse(live.updatedAt);
  const doneElsewhere = !isBackfilling(s) && ok >= Date.parse(live.startedAt) && (live.state !== 'running' || leftRunning);
  return doneElsewhere ? s.lastSuccessAt : null;
}

/** Worth showing: history still importing, a run not finished, or a run that finished a few minutes ago. */
export function isTracked(i: Pick<ProgressInput, 'state' | 'live'>, now: Date): boolean {
  if (isBackfilling(i.state)) return true;
  if (!i.live) return false;
  const end = sessionEnd(i, now);
  return end === null || now.getTime() - Date.parse(end) < RECENT_MS;
}

export function buildProgress(i: ProgressInput, now: Date): AccountProgress {
  const t = now.getTime();
  const { state: s, live } = i;
  const backfilling = isBackfilling(s);
  const covered = Math.max(coveredDays(s), live?.stage === 'account_days' && live.state === 'running' ? Math.min(live.done, BACKFILL_DAYS) : 0);
  const lastActivity = Math.max(live ? Date.parse(live.updatedAt) : 0, s.lastAttemptAt ? Date.parse(s.lastAttemptAt) : 0);
  const failing = s.consecutiveFailures > 0 && !!s.lastErrorKey;

  let phase: Phase;
  if (i.needsReconnect) phase = 'needs_reconnect';
  else if (!backfilling && (!live || live.state === 'done' || sessionEnd(i, now) !== null)) phase = 'done';
  else if (failing && s.lastErrorKey === 'rate_limited') phase = 'rate_limited';
  else if (failing) phase = 'failed';
  else if ((s.leaseUntil && Date.parse(s.leaseUntil) > t) || (live?.state === 'running' && t - Date.parse(live.updatedAt) < ACTIVE_MS)) phase = 'running';
  else if (lastActivity === 0 || t - lastActivity < STALL_MS) phase = 'waiting';
  else phase = 'stalled';

  const runningStage = phase === 'running' ? (live?.stage ?? null) : null;
  const failedStage = phase === 'failed' || phase === 'needs_reconnect' ? (live?.stage ?? null) : null;
  const errorKey = phase === 'needs_reconnect' ? 'token_invalid' : failing ? s.lastErrorKey : (live?.errorKey ?? null);
  const pending = (done: number | null = null, total: number | null = null) => ({ state: 'pending' as const, done, total, reason: null });
  const done = (d: number | null = null, total: number | null = null) => ({ state: 'done' as const, done: d, total, reason: null });
  const skipped = (reason: string) => ({ state: 'skipped' as const, done: null, total: null, reason });

  const base: Record<ShownStage, Omit<StageView, 'stage'>> = {
    profile: i.followers !== null || s.lastRun.stories ? done() : pending(),
    stories: s.lastRun.stories ? done() : pending(),
    account_days: !backfilling || covered >= BACKFILL_DAYS ? done(covered, BACKFILL_DAYS) : pending(covered, BACKFILL_DAYS),
    posts_list: s.lastRun.mediaList ? done() : pending(),
    post_metrics:
      s.lastRun.mediaList && i.posts.total === 0
        ? skipped('no_posts')
        : !backfilling || (i.posts.total > 0 && i.posts.measured >= i.posts.total)
          ? done(i.posts.measured, i.posts.total)
          : pending(i.posts.measured, i.posts.total || null),
    audience: s.lastRun.audience ? (i.followers !== null && i.followers < 100 ? skipped('needs_100_followers') : done()) : pending(),
  };
  const stages: StageView[] = STAGES.map((stage) => {
    const b = base[stage];
    if (b.state !== 'pending') return { stage, ...b };
    if (stage === failedStage) return { stage, ...b, state: 'failed', reason: errorKey };
    if (stage === runningStage) return { stage, ...b, state: 'running' };
    return { stage, ...b };
  });

  const frac = (v: StageView) => (v.state === 'done' || v.state === 'skipped' ? 1 : v.total ? Math.min(1, (v.done ?? 0) / v.total) : 0);
  const sumW = STAGES.reduce((n, st) => n + WEIGHTS[st], 0);
  const percent = phase === 'done' ? 100 : Math.min(99, Math.floor((stages.reduce((n, v) => n + WEIGHTS[v.stage] * frac(v), 0) / sumW) * 100));

  const startedAt = live?.startedAt ?? null;
  const active = phase === 'running' || phase === 'waiting';
  const remaining = (BACKFILL_DAYS - covered) * MS_PER_DAY + Math.max(0, i.posts.total - i.posts.measured) * MS_PER_POST;
  return {
    accountId: i.accountId,
    phase,
    percent,
    stages,
    current: phase === 'running' && live?.stage ? { stage: live.stage, day: live.detailDay, done: live.done, total: live.total } : null,
    startedAt,
    elapsedMs: startedAt ? Math.max(0, t - Date.parse(startedAt)) : null,
    // ponytail: estimate from measured per-call costs; switch to the observed rate once runs record their start counts
    etaMs: active && backfilling && s.lastRun.mediaList ? remaining : null,
    resumeInMs: phase === 'rate_limited' && s.lastAttemptAt ? Math.max(0, Date.parse(s.lastAttemptAt) + backoffMs(s.consecutiveFailures) - t) : null,
    errorKey,
    summary: { days: covered, posts: i.posts.measured },
  };
}
