// Runs the due jobs for ONE account. Never throws: every failure becomes an outcome + error key, so the tick can move
// on to the next account. Tokens are only passed to the Instagram client, never logged or returned.
import { markNeedsReconnect } from '@/lib/accounts/service';
import type { AccountsStore, StoredAccount } from '@/lib/accounts/types';
import { classifyIgError, type IgData } from '@/lib/instagram/data';
import { InstagramApiError } from '@/lib/instagram/oauth';
import { DEMOGRAPHIC_BREAKDOWNS, type AudienceKind } from '@/lib/instagram/metrics';
import { BACKFILL_DAYS, MEDIA_BACKFILL_MAX, MEDIA_DAILY_UNDER_DAYS, MEDIA_RECENT_MAX, SETTLE_DAYS, pickDueMedia, type JobKind, type SyncState } from '@/lib/sync/schedule';
import type { StatePatch, SyncStore } from '@/lib/sync/store';
import { addDays, dayRangeSec, localDay } from '@/lib/sync/time';

export type SyncErrorKey = 'token_invalid' | 'rate_limited' | 'instagram_unavailable' | 'instagram_error' | 'unexpected';
export type AccountOutcome = 'ok' | 'partial' | 'failed' | 'needs_reconnect';

export interface AccountResult {
  accountId: string;
  outcome: AccountOutcome;
  jobs: JobKind[]; // jobs that completed
  errorKey?: SyncErrorKey;
  appRateLimited?: boolean; // app-wide throttle (code 4): the tick stops starting new accounts
}

export interface RunContext {
  ig: IgData;
  store: SyncStore;
  accounts: AccountsStore;
  account: StoredAccount;
  token: string;
  state: SyncState;
  tz: string;
  now: Date;
  /** ms epoch; jobs stop between API calls once clock() passes it and report "not done" */
  deadline: number;
  clock: () => number;
}

/** Progress that must survive a job failing half-way (e.g. 40 backfill days written, then a 5xx). */
interface Progress {
  dailyDoneThrough: string | null;
}

/** done=false: stopped for the time budget; the job stays due and continues next tick. */
type Job = (c: RunContext, p: Progress) => Promise<{ done: boolean }>;
const DAY_MS = 86_400_000;
const outOfTime = (c: RunContext) => c.clock() >= c.deadline;

/** Account insights day by day: first-connect backfill, missed days, and a re-fetch of the last SETTLE_DAYS (data lags up to 48h). */
const daily: Job = async (c, p) => {
  const today = localDay(c.now, c.tz);
  const yesterday = addDays(today, -1);
  const done = p.dailyDoneThrough;
  const settleFrom = addDays(yesterday, -(SETTLE_DAYS - 1));
  let day = done ? (addDays(done, 1) < settleFrom ? addDays(done, 1) : settleFrom) : addDays(today, -BACKFILL_DAYS);
  const oldest = addDays(today, -30);
  for (; day <= yesterday; day = addDays(day, 1)) {
    if (outOfTime(c)) return { done: false };
    const { since, until } = dayRangeSec(day, c.tz);
    try {
      await c.store.upsertDaily(c.account.id, day, await c.ig.accountDay(c.token, since, until));
    } catch (e) {
      // ponytail: Meta does not document how far back each metric goes; an "other" error on a day older than 30 days is
      // treated as "no data that far back" and skipped so the backfill cannot wedge. Tighten once the runbook confirms.
      if (!(classifyIgError(e) === 'other' && day < oldest)) throw e;
    }
    try {
      await c.store.upsertDailyBreakdown(c.account.id, day, await c.ig.accountDayBreakdown(c.token, since, until));
    } catch (e) {
      if (fatal(e)) throw e; // the follower/non-follower split is an extra; an unsupported day must not wedge the backfill
    }
    if (!p.dailyDoneThrough || day > p.dailyDoneThrough) p.dailyDoneThrough = day;
  }
  const { followersCount } = await c.ig.profile(c.token);
  if (followersCount !== null) await c.store.upsertFollowers(c.account.id, today, followersCount);
  return { done: true };
};

/** Only auth and rate-limit problems may stop a job; everything else in an optional extra capture is skipped. */
const fatal = (e: unknown) => ['auth', 'app_rate_limit', 'rate_limit'].includes(classifyIgError(e));

/** Follower / following / media counts, once per tick (intraday follower curve). A failure here must not cost the Stories capture. */
async function followerSnapshot(c: RunContext) {
  try {
    const p = await c.ig.profile(c.token);
    await c.store.insertFollowerSnapshot(c.account.id, c.now.toISOString(), { followers: p.followersCount, following: p.followingCount, mediaCount: p.mediaCount });
  } catch (e) {
    if (fatal(e)) throw e;
  }
}

/** Live stories: upsert, then one metrics snapshot each. Under 5 viewers Instagram refuses (no_data): skip that story. */
const stories: Job = async (c) => {
  await followerSnapshot(c);
  const items = await c.ig.listStories(c.token);
  await c.store.upsertMedia(c.account.id, items);
  const at = c.now.toISOString();
  const captured: string[] = [];
  try {
    for (const s of items) {
      if (outOfTime(c)) return { done: false };
      try {
        await c.store.insertMetrics(s.id, at, await c.ig.storyInsights(c.token, s.id));
        captured.push(s.id);
      } catch (e) {
        const k = classifyIgError(e);
        if (k === 'gone') await c.store.markGone(s.id, at);
        else if (k !== 'no_data') throw e;
      }
    }
  } finally {
    await c.store.markCaptured(captured, at);
  }
  return { done: true };
};

/** Feed + Reels list. First run: up to MEDIA_BACKFILL_MAX posts; afterwards: until posts older than 30 days. */
const mediaList: Job = async (c) => {
  const first = !c.state.lastRun.mediaList;
  const since = new Date(c.now.getTime() - MEDIA_DAILY_UNDER_DAYS * DAY_MS).toISOString();
  const items = await c.ig.listMedia(c.token, first ? MEDIA_BACKFILL_MAX : MEDIA_RECENT_MAX, first ? undefined : since, () => outOfTime(c));
  await c.store.upsertMedia(c.account.id, items);
  return { done: !outOfTime(c) }; // out of time mid-paging: keep what we got, stay due (the first run's backfill must finish)
};

/** After this many failed posts in a row the loop gives up: Instagram is down or our metric request is broken. */
const MEDIA_FAIL_STREAK = 3;

/**
 * Snapshots for media that are due (pickDueMedia, newest first). Per-post outcomes of the insights call:
 *  - gone: marked gone. no_data (under-5 viewers, pre-Creator post 2108006): marked captured, retried at the next interval.
 *  - other (unclassified IG error): marked attempted (last_metrics_at) so ONE post can never sit at the head of the queue and
 *    starve older ones; its error key is still reported. Posts older than 30 days then drop out of pickDueMedia for good.
 *  - transient: not marked (a 5xx may pass), loop carries on; it stays due.
 *  - auth / rate limits: abort the job like before. MEDIA_FAIL_STREAK failures in a row also abort.
 * The first per-post error is rethrown at the end so the account shows it; the loop itself never stops for one bad post.
 */
const mediaMetrics: Job = async (c) => {
  const since = new Date(c.now.getTime() - MEDIA_DAILY_UNDER_DAYS * DAY_MS).toISOString();
  const due = pickDueMedia(await c.store.mediaForMetrics(c.account.id, since), c.now);
  const at = c.now.toISOString();
  const captured: string[] = [];
  let firstError: unknown;
  let streak = 0;
  try {
    for (const id of due) {
      if (outOfTime(c)) {
        if (firstError) throw firstError;
        return { done: false };
      }
      let values;
      try {
        values = await c.ig.feedInsights(c.token, id);
      } catch (e) {
        const k = classifyIgError(e);
        if (k === 'other' || k === 'transient') {
          firstError ??= e;
          if (k === 'other') captured.push(id);
          if (++streak >= MEDIA_FAIL_STREAK) throw firstError;
          continue;
        }
        if (k !== 'gone' && k !== 'no_data') throw e; // auth, rate limits
        if (k === 'gone') await c.store.markGone(id, at);
        else captured.push(id);
        streak = 0;
        continue;
      }
      await c.store.insertMetrics(id, at, values);
      captured.push(id);
      streak = 0;
    }
    if (firstError) throw firstError;
  } finally {
    await c.store.markCaptured(captured, at);
  }
  return { done: true };
};

/** Demographics + online followers. Under 100 followers Instagram returns empty data: nothing is written, not an error. */
const audience: Job = async (c) => {
  const today = localDay(c.now, c.tz);
  for (const kind of Object.keys(DEMOGRAPHIC_BREAKDOWNS) as AudienceKind[]) {
    if (outOfTime(c)) return { done: false };
    const data = await c.ig.audience(c.token, kind);
    if (Object.keys(data).length > 0) await c.store.upsertAudience(c.account.id, today, kind, data);
  }
  const { since } = dayRangeSec(addDays(today, -1), c.tz);
  const { since: until } = dayRangeSec(today, c.tz);
  for (const d of await c.ig.onlineFollowers(c.token, since, until)) await c.store.upsertOnlineFollowers(c.account.id, d.day, d.hourly);
  return { done: true };
};

/** Long-lived token refresh (another 60 days). An auth error here flips the account to needs_reconnect like any other. */
const tokenRefresh: Job = async (c) => {
  const t = await c.ig.refresh(c.token);
  await c.accounts.saveToken(c.account.id, t);
  await c.accounts.update(c.account.id, { tokenExpiresAt: t.expiresAt });
  return { done: true };
};

const JOB_RUNNERS: Record<JobKind, Job> = { stories, daily, mediaList, mediaMetrics, audience, backfill: async () => ({ done: true }), tokenRefresh };

function errorKeyFor(kind: ReturnType<typeof classifyIgError>, e: unknown): SyncErrorKey {
  if (kind === 'rate_limit' || kind === 'app_rate_limit') return 'rate_limited';
  if (kind === 'transient') return 'instagram_unavailable';
  return e instanceof InstagramApiError ? 'instagram_error' : 'unexpected';
}

/**
 * Runs `jobs` in order. auth -> needs_reconnect, stop. rate limit -> stop (back-off). Any other error -> record it and
 * continue with the next job (one broken metric must not starve Stories capture). Returns the result and the state
 * patch to persist.
 */
export async function runAccount(c: RunContext, jobs: JobKind[]): Promise<{ result: AccountResult; patch: StatePatch }> {
  const nowIso = c.now.toISOString();
  const lastRun = { ...c.state.lastRun };
  const progress: Progress = { dailyDoneThrough: c.state.dailyDoneThrough };
  const completed: JobKind[] = [];
  let partial = false;
  let errorKey: SyncErrorKey | undefined;
  let outcome: AccountOutcome = 'ok';
  let appRateLimited = false;

  for (const job of jobs) {
    if (outOfTime(c)) {
      partial = true;
      break;
    }
    try {
      const r = await JOB_RUNNERS[job](c, progress);
      if (!r.done) {
        partial = true;
        break;
      }
      lastRun[job] = nowIso;
      completed.push(job);
    } catch (e) {
      const kind = classifyIgError(e);
      if (kind === 'auth') {
        errorKey = 'token_invalid';
        outcome = 'needs_reconnect';
        await markNeedsReconnect(c.accounts, c.account.igUserId, 'token_invalid').catch(() => {});
        break;
      }
      errorKey = errorKeyFor(kind, e);
      outcome = 'failed';
      if (kind === 'rate_limit' || kind === 'app_rate_limit') {
        appRateLimited = kind === 'app_rate_limit';
        break;
      }
    }
  }
  if (outcome === 'ok' && partial) outcome = 'partial';

  const ok = outcome === 'ok' || outcome === 'partial';
  const patch: StatePatch = {
    lastAttemptAt: nowIso,
    ...(ok ? { lastSuccessAt: nowIso } : {}),
    consecutiveFailures: ok ? 0 : c.state.consecutiveFailures + 1,
    lastErrorKey: ok ? null : (errorKey ?? 'unexpected'),
    dailyDoneThrough: progress.dailyDoneThrough,
    backfilledFrom: c.state.backfilledFrom,
    lastRun,
  };
  return { result: { accountId: c.account.id, outcome, jobs: completed, ...(errorKey ? { errorKey } : {}), ...(appRateLimited ? { appRateLimited } : {}) }, patch };
}
