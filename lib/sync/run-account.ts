// Runs the due jobs for ONE account. Never throws: every failure becomes an outcome + error key, so the tick can move
// on to the next account. Tokens are only passed to the Instagram client, never logged or returned.
import { COMMENTS_SCOPE, hasScope } from '@/lib/accounts/scopes';
import { markNeedsReconnect } from '@/lib/accounts/service';
import type { AccountsStore, StoredAccount } from '@/lib/accounts/types';
import { classifyIgError, isFatalIgError as fatal, isUnsupported, type Archive, type IgData } from '@/lib/instagram/data';
import { InstagramApiError } from '@/lib/instagram/oauth';
import { DEMOGRAPHIC_BREAKDOWNS, type AudienceKind } from '@/lib/instagram/metrics';
import type { IgComment, IgMediaItem } from '@/lib/instagram/parse';
import { learn, shouldAsk, type Capabilities } from '@/lib/sync/capabilities';
import { afterFailure, captureCover, coverUrl, pickCoverDue } from '@/lib/sync/covers';
import { EXTRA_CALLS_PER_RUN, fetchExtras, scopeOf } from '@/lib/sync/extras';
import { coveredDays } from '@/lib/sync/progress';
import type { ProgressSink } from '@/lib/sync/progress-sink';
import { BACKFILL_DAYS, FIRST_DAYS, firstWeekPending, MEDIA_BACKFILL_MAX, MEDIA_DAILY_UNDER_DAYS, MEDIA_RECENT_MAX, SETTLE_DAYS, pickDueMedia, storyExtrasDue, type JobKind, type MediaRef, type SyncState } from '@/lib/sync/schedule';
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
  /** Live progress (only while the account is importing or on a manual run); best-effort, never throws. */
  progress?: ProgressSink;
  /** fetch for the Instagram CDN (cover images); default: global fetch. */
  cdnFetch?: typeof fetch;
  /** Raw-response archive for account insights + audience calls; set by runAccount (best-effort). */
  archive?: Archive;
}

/**
 * What must survive a job failing half-way: the coverage edges (e.g. 40 history days written, then a 5xx) and the
 * capability memory learned so far (saved with the state patch).
 */
interface Progress {
  dailyDoneThrough: string | null;
  backfilledFrom: string | null;
  capabilities: Capabilities;
  extraCalls: number; // budget for optional extra calls left in this run (not persisted)
}

/** done=false: stopped for the time budget; the job stays due and continues next tick. */
type Job = (c: RunContext, p: Progress) => Promise<{ done: boolean }>;
const DAY_MS = 86_400_000;
const outOfTime = (c: RunContext) => c.clock() >= c.deadline;

/** One insight day: account totals + the follower-type x format split. Nothing Instagram did not send is written as 0. */
async function fetchDay(c: RunContext, day: string): Promise<void> {
  const { since, until } = dayRangeSec(day, c.tz);
  try {
    await c.store.upsertDaily(c.account.id, day, await c.ig.accountDay(c.token, since, until, c.archive));
  } catch (e) {
    // ponytail: Meta does not document how far back each metric goes; an "other" error on a day older than 30 days is
    // treated as "no data that far back" and skipped so the backfill cannot wedge. Tighten once the runbook confirms.
    if (!(classifyIgError(e) === 'other' && day < addDays(localDay(c.now, c.tz), -30))) throw e;
  }
  try {
    await c.store.upsertDailyBreakdown(c.account.id, day, await c.ig.accountDayBreakdown(c.token, since, until, c.archive));
  } catch (e) {
    if (fatal(e)) throw e; // the follower/non-follower split is an extra; an unsupported day must not wedge the backfill
  }
}

/**
 * Newest-first walk from the day before the backward edge (or yesterday) down to `floor`. Both edges move after every
 * day, so a stop (time budget, error) resumes exactly where it left off and no day is fetched twice.
 */
async function walkBack(c: RunContext, p: Progress, floor: string): Promise<{ done: boolean }> {
  const yesterday = addDays(localDay(c.now, c.tz), -1);
  for (let day = p.backfilledFrom ? addDays(p.backfilledFrom, -1) : yesterday; day >= floor; day = addDays(day, -1)) {
    if (outOfTime(c)) return { done: false };
    await c.progress?.report('account_days', coveredDays(p), BACKFILL_DAYS, day);
    await fetchDay(c, day);
    p.dailyDoneThrough ??= day;
    p.backfilledFrom = day;
  }
  return { done: true };
}

/**
 * Account insights by day. New account: the newest FIRST_DAYS days, newest first (KPIs within the first pass). After
 * that: missed days, and a re-fetch of the last SETTLE_DAYS (data lags up to 48h), then today's follower count.
 */
const daily: Job = async (c, p) => {
  const today = localDay(c.now, c.tz);
  const yesterday = addDays(today, -1);
  let day: string;
  if (firstWeekPending({ ...p, lastRun: c.state.lastRun }, today)) {
    if (!(await walkBack(c, p, addDays(today, -FIRST_DAYS))).done) return { done: false };
    day = addDays(p.dailyDoneThrough!, 1); // the week was just fetched: no settle re-fetch, only a day that began meanwhile
  } else {
    const settleFrom = addDays(yesterday, -(SETTLE_DAYS - 1));
    const next = addDays(p.dailyDoneThrough!, 1);
    day = next < settleFrom ? next : settleFrom;
  }
  for (; day <= yesterday; day = addDays(day, 1)) {
    if (outOfTime(c)) return { done: false };
    await c.progress?.report('account_days', coveredDays(p), BACKFILL_DAYS, day);
    await fetchDay(c, day);
    if (day > p.dailyDoneThrough!) p.dailyDoneThrough = day;
  }
  const { followersCount } = await c.ig.profile(c.token);
  if (followersCount !== null) await c.store.upsertFollowers(c.account.id, today, followersCount);
  return { done: true };
};

/** Follower / following / media counts, once per tick (intraday follower curve). A failure here must not cost the Stories capture. */
async function followerSnapshot(c: RunContext) {
  try {
    const p = await c.ig.profile(c.token);
    await c.store.insertFollowerSnapshot(c.account.id, c.now.toISOString(), { followers: p.followersCount, following: p.followingCount, mediaCount: p.mediaCount });
  } catch (e) {
    if (fatal(e)) throw e;
  }
}

/**
 * Optional extras for media whose core snapshot (taken at `at`) is already stored. Best-effort: stops on the time
 * budget or the per-run call budget; only auth / rate-limit errors propagate (a DB hiccup here costs only the extras).
 */
async function captureExtras(c: RunContext, p: Progress, items: { id: string; kind: string }[], at: string): Promise<void> {
  for (const { id, kind } of items) {
    if (outOfTime(c) || p.extraCalls <= 0) return;
    try {
      const e = await fetchExtras(c.ig, c.token, id, scopeOf(kind), p, () => outOfTime(c));
      if (Object.keys(e).length > 0) await c.store.updateMetricExtras(id, at, e);
    } catch (e) {
      if (fatal(e)) throw e;
    }
  }
}

/**
 * Story covers on FIRST SIGHT (the CDN link dies with the Story): every live Story whose cover is not stored yet, with
 * the URL from the listing; retried on every pass while it is live (up to COVER_MAX_ATTEMPTS), then expired ones are
 * marked unavailable. Entirely best-effort: nothing here can cost the Story capture.
 */
async function captureStoryCovers(c: RunContext, items: IgMediaItem[]): Promise<void> {
  try {
    if (items.length > 0) {
      const byId = new Map(items.map((i) => [i.id, i]));
      for (const ref of await c.store.coverRefs(c.account.id, { ids: [...byId.keys()], limit: items.length })) {
        if (outOfTime(c)) break;
        const url = coverUrl(byId.get(ref.id)?.details);
        if (url) await captureCover(c.store, c.account.id, ref, url, c.now.toISOString(), c.cdnFetch);
        // no URL (fields not offered on Stories, or none for this Story): no attempt counted; expiry ends it
      }
    }
    await c.store.expireStoryCovers(c.account.id, c.now.toISOString());
  } catch {
    // covers are optional; the Story snapshot is already stored
  }
}

/**
 * Live Stories with their image URLs (for the first-sight cover). Story support for the URL fields is unverified: on
 * an "unsupported field" answer the list is fetched again with the base fields and that is remembered.
 */
async function listLiveStories(c: RunContext, p: Progress) {
  const key = 'stories:url_fields';
  if (shouldAsk(p.capabilities, key)) {
    try {
      const items = await c.ig.listStories(c.token, true);
      p.capabilities = learn(p.capabilities, key, { ok: true });
      return items;
    } catch (e) {
      if (!isUnsupported(e)) throw e;
      p.capabilities = learn(p.capabilities, key, { error: e });
    }
  }
  return c.ig.listStories(c.token, false);
}

/**
 * Live stories: upsert, then one metrics snapshot each. Under 5 viewers Instagram refuses (no_data): skip that story.
 * Then, only once every live Story's core snapshot is stored, the Story extras on their own cadence (storyExtrasDue).
 */
const stories: Job = async (c, p) => {
  await c.progress?.report('profile', 0, 1);
  await followerSnapshot(c);
  const items = await listLiveStories(c, p);
  await c.store.upsertMedia(c.account.id, items);
  await c.progress?.report('stories', 0, items.length);
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
  await captureStoryCovers(c, items);
  const extrasDue = items.filter((s) => captured.includes(s.id) && storyExtrasDue(s.postedAt, c.now));
  await captureExtras(c, p, extrasDue.map((s) => ({ id: s.id, kind: 'STORY' })), at);
  return { done: true };
};

/** Feed + Reels list. First run: up to MEDIA_BACKFILL_MAX posts; afterwards: until posts older than 30 days. */
const mediaList: Job = async (c) => {
  await c.progress?.report('posts_list', 0, null);
  const first = !c.state.lastRun.mediaList;
  const since = new Date(c.now.getTime() - MEDIA_DAILY_UNDER_DAYS * DAY_MS).toISOString();
  const items = await c.ig.listMedia(c.token, first ? MEDIA_BACKFILL_MAX : MEDIA_RECENT_MAX, first ? undefined : since, () => outOfTime(c));
  await c.store.upsertMedia(c.account.id, items);
  return { done: !outOfTime(c) }; // out of time mid-paging: keep what we got, stay due (the first run's backfill must finish)
};

/** After this many failed posts in a row the loop gives up: Instagram is down or our metric request is broken. */
const MEDIA_FAIL_STREAK = 3;

/**
 * Snapshots for the given media (newest first). Per-post outcomes of the insights call:
 *  - gone: marked gone. no_data (under-5 viewers, pre-Creator post 2108006): marked captured, retried at the next interval.
 *  - other (unclassified IG error): marked attempted (last_metrics_at) so ONE post can never sit at the head of the queue and
 *    starve older ones; its error key is still reported. Posts older than 30 days then drop out of pickDueMedia for good.
 *  - transient: not marked (a 5xx may pass), loop carries on; it stays due.
 *  - auth / rate limits: abort the job like before. MEDIA_FAIL_STREAK failures in a row also abort.
 * The first per-post error is rethrown at the end so the account shows it; the loop itself never stops for one bad post.
 * Extras (feed: follows/profile visits/activity; Reels: watch time/skip rate) come after the whole core loop, for the
 * posts that got a snapshot, within the per-run extras budget: they can never starve the core capture.
 */
async function captureMedia(c: RunContext, p: Progress, refs: MediaRef[], due: string[]): Promise<{ done: boolean }> {
  const at = c.now.toISOString();
  const captured: string[] = [];
  const measured: string[] = [];
  let firstError: unknown;
  let streak = 0;
  try {
    for (const [i, id] of due.entries()) {
      if (outOfTime(c)) {
        if (firstError) throw firstError;
        return { done: false };
      }
      await c.progress?.report('post_metrics', i, due.length);
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
      measured.push(id);
      streak = 0;
    }
    if (firstError) throw firstError;
  } finally {
    await c.store.markCaptured(captured, at);
  }
  const kinds = new Map(refs.map((r) => [r.id, r.kind ?? 'IMAGE']));
  await captureExtras(c, p, measured.map((id) => ({ id, kind: kinds.get(id)! })), at);
  return { done: true };
}

/** Recent posts on their cadence plus the newest NEWEST_POSTS never-measured older posts (onboarding step 3). */
const mediaMetrics: Job = async (c, p) => {
  const since = new Date(c.now.getTime() - MEDIA_DAILY_UNDER_DAYS * DAY_MS).toISOString();
  const refs = await c.store.mediaForMetrics(c.account.id, since);
  return captureMedia(c, p, refs, pickDueMedia(refs, c.now));
};

/**
 * History import (lane 2), newest first: insight days down to BACKFILL_DAYS back, then every never-measured older post.
 * Done once both are through. Extension point: later plans append cover capture and comments here.
 */
const backfill: Job = async (c, p) => {
  if (p.dailyDoneThrough !== null && p.backfilledFrom === null) return { done: true }; // synced before Plan 11a: complete
  if (!(await walkBack(c, p, addDays(localDay(c.now, c.tz), -BACKFILL_DAYS))).done) return { done: false };
  const refs = await c.store.mediaForMetrics(c.account.id, c.now.toISOString()); // since = now: only never-measured media
  return captureMedia(c, p, refs, pickDueMedia(refs, c.now, Infinity));
};

/** Post covers copied per run (one Instagram call + one CDN download each, ~0.5 s). */
export const COVERS_PER_RUN = 25;
/** Unfinished covers looked at per run (newest first); the back-off filter then picks COVERS_PER_RUN of them. */
const COVER_SCAN = 200; // ponytail: a block of >200 newer covers all waiting on back-off hides older pending ones until it clears

/**
 * Feed/Reels covers (lane 2, after the history import), newest first. Fresh URLs per item (they expire within days):
 * gone on Instagram -> marked gone; no image offered (copyrighted media) -> unavailable; fetch/upload problems ->
 * back-off, then unavailable. Out of time -> resumes next pass. Reports the reserved progress stage "covers".
 */
const covers: Job = async (c) => {
  const nowIso = c.now.toISOString();
  const due = pickCoverDue(await c.store.coverRefs(c.account.id, { limit: COVER_SCAN }), c.now, COVERS_PER_RUN);
  for (const [i, ref] of due.entries()) {
    if (outOfTime(c)) return { done: false };
    await c.progress?.report('covers', i, due.length);
    let details;
    try {
      details = await c.ig.mediaCover(c.token, ref.id);
    } catch (e) {
      if (fatal(e)) throw e;
      if (classifyIgError(e) === 'gone') await c.store.markGone(ref.id, nowIso);
      else await c.store.markCover(ref.id, { ...afterFailure(ref.attempts), triedAt: nowIso });
      continue;
    }
    const url = coverUrl(details);
    if (url) await captureCover(c.store, c.account.id, ref, url, nowIso, c.cdnFetch);
    else await c.store.markCover(ref.id, { status: 'unavailable', attempts: ref.attempts + 1, triedAt: nowIso });
  }
  return { done: true };
};

/** Comment pages read per run (all posts together) and per post (50 comments a page). */
export const COMMENT_CALLS_PER_RUN = 20;
const COMMENT_PAGES_PER_MEDIA = 4;

/**
 * Comments (read only, lane 2, after the import) for posts of the last 30 days whose comments_count changed since the
 * last ingest, newest first. Only with the granted scope: without it Meta answers an empty list with no error. An empty
 * answer for a post that HAS comments is never taken as "no comments": nothing is written or marked, it is asked again.
 * Upserts by comment id. Comment texts and usernames are never logged or put into progress/summary rows.
 */
const comments: Job = async (c) => {
  if (!hasScope(c.account, COMMENTS_SCOPE)) return { done: true }; // belt and braces: dueJobs already requires it
  const since = new Date(c.now.getTime() - MEDIA_DAILY_UNDER_DAYS * DAY_MS).toISOString();
  const due = (await c.store.mediaForComments(c.account.id, since)).filter((m) => m.commentsCount !== m.syncedCount);
  let calls = COMMENT_CALLS_PER_RUN;
  for (const [i, m] of due.entries()) {
    if (outOfTime(c)) return { done: false };
    if (calls <= 0) break; // the rest next time (stamped done: the cadence brings it back within the hour)
    await c.progress?.report('comments', i, due.length);
    const items: IgComment[] = [];
    try {
      let next: string | undefined;
      for (let page = 0; page < COMMENT_PAGES_PER_MEDIA && calls > 0; page++) {
        calls -= 1;
        const r = await c.ig.commentsPage(c.token, m.id, next);
        items.push(...r.items);
        if (!r.next || outOfTime(c)) break;
        next = r.next;
      }
    } catch (e) {
      if (fatal(e)) throw e;
      if (classifyIgError(e) === 'gone') await c.store.markGone(m.id, c.now.toISOString());
      continue; // one post's problem never stops the others
    }
    if (items.length === 0) continue;
    await c.store.upsertComments(c.account.id, m.id, items, c.now.toISOString());
    await c.store.markCommentsSynced(m.id, m.commentsCount);
  }
  return { done: true };
};

/**
 * Optional lane-2 work (covers, comments): only auth / rate-limit errors surface (needs_reconnect / back-off); any
 * other failure ends the job quietly — it is due again next time and must never mark the account as failing.
 */
const optional =
  (job: Job): Job =>
  async (c, p) => {
    try {
      return await job(c, p);
    } catch (e) {
      if (fatal(e)) throw e;
      return { done: true };
    }
  };

/** Demographics + online followers. Under 100 followers Instagram returns empty data: nothing is written, not an error. */
const audience: Job = async (c) => {
  await c.progress?.report('audience', 0, 1);
  const today = localDay(c.now, c.tz);
  for (const kind of Object.keys(DEMOGRAPHIC_BREAKDOWNS) as AudienceKind[]) {
    if (outOfTime(c)) return { done: false };
    const data = await c.ig.audience(c.token, kind, c.archive);
    if (Object.keys(data).length > 0) await c.store.upsertAudience(c.account.id, today, kind, data);
  }
  const { since } = dayRangeSec(addDays(today, -1), c.tz);
  const { since: until } = dayRangeSec(today, c.tz);
  for (const d of await c.ig.onlineFollowers(c.token, since, until, c.archive)) await c.store.upsertOnlineFollowers(c.account.id, d.day, d.hourly);
  return { done: true };
};

/** Long-lived token refresh (another 60 days). An auth error here flips the account to needs_reconnect like any other. */
const tokenRefresh: Job = async (c) => {
  const t = await c.ig.refresh(c.token);
  await c.accounts.saveToken(c.account.id, t);
  await c.accounts.update(c.account.id, { tokenExpiresAt: t.expiresAt });
  return { done: true };
};

const JOB_RUNNERS: Record<JobKind, Job> = { stories, daily, mediaList, mediaMetrics, audience, backfill, covers: optional(covers), comments: optional(comments), tokenRefresh };

function errorKeyFor(kind: ReturnType<typeof classifyIgError>, e: unknown): SyncErrorKey {
  if (kind === 'rate_limit' || kind === 'app_rate_limit') return 'rate_limited';
  if (kind === 'transient') return 'instagram_unavailable';
  return e instanceof InstagramApiError ? 'instagram_error' : 'unexpected';
}

/** The archive never holds up a run: pending writes get this long after the last job, then they are left behind. */
export const ARCHIVE_WAIT_MS = 2_000;

async function settle(pending: Promise<void>[]): Promise<void> {
  if (pending.length === 0) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([Promise.allSettled(pending), new Promise<void>((resolve) => (timer = setTimeout(resolve, ARCHIVE_WAIT_MS)))]);
  clearTimeout(timer);
}

/**
 * Runs `jobs` in order. auth -> needs_reconnect, stop. rate limit -> stop (back-off). Any other error -> record it and
 * continue with the next job (one broken metric must not starve Stories capture). Returns the result and the state
 * patch to persist.
 */
export async function runAccount(c: RunContext, jobs: JobKind[]): Promise<{ result: AccountResult; patch: StatePatch }> {
  const nowIso = c.now.toISOString();
  const lastRun = { ...c.state.lastRun };
  const progress: Progress = { dailyDoneThrough: c.state.dailyDoneThrough, backfilledFrom: c.state.backfilledFrom, capabilities: { ...(c.state.capabilities ?? {}) }, extraCalls: EXTRA_CALLS_PER_RUN };
  const completed: JobKind[] = [];
  // raw insights/audience bodies -> api_snapshots; fire-and-forget per call, settled (time-capped) before returning
  const archived: Promise<void>[] = [];
  const archive: Archive = (endpoint, body) => void archived.push(c.store.archiveSnapshot(c.account.id, endpoint, body, nowIso).catch(() => {}));
  const ctx: RunContext = { ...c, archive };
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
      const r = await JOB_RUNNERS[job](ctx, progress);
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
  await settle(archived);

  const ok = outcome === 'ok' || outcome === 'partial';
  const patch: StatePatch = {
    lastAttemptAt: nowIso,
    ...(ok ? { lastSuccessAt: nowIso } : {}),
    consecutiveFailures: ok ? 0 : c.state.consecutiveFailures + 1,
    lastErrorKey: ok ? null : (errorKey ?? 'unexpected'),
    dailyDoneThrough: progress.dailyDoneThrough,
    backfilledFrom: progress.backfilledFrom,
    lastRun,
    capabilities: progress.capabilities,
  };
  return { result: { accountId: c.account.id, outcome, jobs: completed, ...(errorKey ? { errorKey } : {}), ...(appRateLimited ? { appRateLimited } : {}) }, patch };
}
