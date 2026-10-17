// Sync persistence. supabaseSyncStore takes the ADMIN client (writes bypass RLS); listSyncStatus takes the owner session.
// Errors never include Supabase's message (it can echo values).
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AccountDayValues, BreakdownRow, MediaExtras, MediaMetricValues } from '@/lib/instagram/data';
import type { AudienceKind } from '@/lib/instagram/metrics';
import type { IgComment, IgMediaItem } from '@/lib/instagram/parse';
import { DEFAULT_PREFS, isValidTimeZone } from '@/lib/prefs';
import { parseCapabilities, type Capabilities } from '@/lib/sync/capabilities';
import { COVERS_BUCKET, type CoverRef, type CoverStatus } from '@/lib/sync/covers';
import type { LiveState, Stage } from '@/lib/sync/progress';
import { emptyState, isBackfilling, type JobKind, type MediaRef, type SyncState } from '@/lib/sync/schedule';

export interface StatePatch {
  lastAttemptAt: string;
  lastSuccessAt?: string;
  consecutiveFailures: number;
  lastErrorKey: string | null;
  dailyDoneThrough: string | null;
  backfilledFrom: string | null;
  lastRun: Partial<Record<JobKind, string>>;
  capabilities?: Capabilities; // omitted = keep the stored map
}

/** One live progress write (sync_progress row). started_at comes from resetSyncProgress or the insert default. */
export interface ProgressWrite {
  stage: Stage | null;
  state: LiveState;
  done: number;
  total: number | null;
  detailDay: string | null;
  errorKey: string | null;
  updatedAt: string;
  finishedAt?: string | null; // omitted = keep the stored value
}

export interface SyncRun {
  startedAt: string;
  finishedAt: string;
  trigger: 'cron' | 'manual';
  summary: unknown;
}

export interface SyncStore {
  ownerTimezone(): Promise<string>;
  loadStates(accountIds: string[]): Promise<Map<string, SyncState>>;
  /**
   * Atomic: the fresh row if no live lease existed, else null. One UPDATE … WHERE lease free, so two ticks cannot both win.
   * It also stamps last_attempt_at = now, so an account killed mid-run goes to the back of the round-robin, not the front.
   * The returned state carries that stamp and our own lease; plan from it, but not for rate-limit back-off (see tick.ts).
   */
  claimLease(accountId: string, leaseId: string, untilIso: string, nowIso: string): Promise<SyncState | null>;
  /** Writes the state and releases the lease, only if this tick still holds it. */
  saveState(accountId: string, leaseId: string, patch: StatePatch): Promise<void>;
  getToken(accountId: string): Promise<string | null>;
  upsertDaily(accountId: string, day: string, v: AccountDayValues): Promise<void>;
  /** Append-only history row per tick (follower curve). Idempotent on (account, captured_at). */
  insertFollowerSnapshot(accountId: string, capturedAtIso: string, v: { followers: number | null; following: number | null; mediaCount: number | null }): Promise<void>;
  /** Daily reach/views by follower type x product type; upserts each combination (re-fetching a day settles Meta's lag). */
  upsertDailyBreakdown(accountId: string, day: string, rows: BreakdownRow[]): Promise<void>;
  upsertFollowers(accountId: string, day: string, followers: number): Promise<void>;
  /** Media rows (+ listing details when present) and, for carousels, their children rows. */
  upsertMedia(accountId: string, items: IgMediaItem[]): Promise<void>;
  mediaForMetrics(accountId: string, sinceIso: string): Promise<MediaRef[]>;
  insertMetrics(mediaId: string, capturedAt: string, v: MediaMetricValues): Promise<void>;
  /** Adds optional extras to the snapshot inserted for (mediaId, capturedAt). Only the given fields are written. */
  updateMetricExtras(mediaId: string, capturedAt: string, e: Partial<MediaExtras>): Promise<void>;
  markCaptured(mediaIds: string[], atIso: string): Promise<void>;
  markGone(mediaId: string, atIso: string): Promise<void>;
  upsertAudience(accountId: string, day: string, kind: AudienceKind, data: Record<string, number>): Promise<void>;
  /** Media whose cover is still to do (pending/failed, not gone), newest first. ids given: only those (Stories); else feed + Reels. */
  coverRefs(accountId: string, opts: { ids?: string[]; limit: number }): Promise<CoverRef[]>;
  markCover(mediaId: string, r: { status: CoverStatus; attempts: number; triedAt: string; path?: string }): Promise<void>;
  /** Private bucket "covers", never overwriting; an object that already exists counts as stored. */
  uploadCover(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** Stories past expires_at whose cover never landed: 'unavailable' (the CDN link died with them). */
  expireStoryCovers(accountId: string, nowIso: string): Promise<void>;
  /** Feed + Reels posted since sinceIso that have comments (comments_count > 0), newest first, with the count at the last ingest. */
  mediaForComments(accountId: string, sinceIso: string): Promise<{ id: string; commentsCount: number; syncedCount: number | null }[]>;
  /** Upsert by comment id: text/likes/last_seen_at refresh, first_seen_at stays (column default on insert). */
  upsertComments(accountId: string, mediaId: string, items: IgComment[], seenAtIso: string): Promise<void>;
  markCommentsSynced(mediaId: string, commentsCount: number): Promise<void>;
  /** Raw JSON of one insights/audience call, deduped on (account, endpoint, sha256(body)); bodies over 64 KB are skipped. */
  archiveSnapshot(accountId: string, endpoint: string, body: Record<string, unknown>, capturedAtIso: string): Promise<void>;
  upsertOnlineFollowers(accountId: string, day: string, hourly: number[]): Promise<void>;
  recordRun(run: SyncRun): Promise<void>;
  /** Upserts the account's live progress row. Callers treat it as best-effort (lib/sync/progress-sink.ts). */
  writeProgress(accountId: string, p: ProgressWrite): Promise<void>;
}

type Row = Record<string, unknown>;

function fail(op: string): never {
  throw new Error(`sync store: ${op} failed`);
}

export function rowToState(r: Row): SyncState {
  return {
    accountId: r.account_id as string,
    leaseUntil: (r.lease_until as string | null) ?? null,
    lastAttemptAt: (r.last_attempt_at as string | null) ?? null,
    lastSuccessAt: (r.last_success_at as string | null) ?? null,
    consecutiveFailures: typeof r.consecutive_failures === 'number' ? r.consecutive_failures : 0,
    lastErrorKey: (r.last_error_key as string | null) ?? null,
    dailyDoneThrough: (r.daily_done_through as string | null) ?? null,
    backfilledFrom: (r.backfilled_from as string | null) ?? null,
    lastRun: typeof r.last_run === 'object' && r.last_run !== null ? (r.last_run as SyncState['lastRun']) : {},
    capabilities: parseCapabilities(r.capabilities),
  };
}

/** api_snapshots size guard: an insights body is ~1–3 KB; anything this big is not what we meant to keep. */
export const SNAPSHOT_MAX_BYTES = 64 * 1024;

const EXTRA_COLUMNS: Record<keyof MediaExtras, string> = { follows: 'follows', profileVisits: 'profile_visits', profileActivity: 'profile_activity', avgWatchMs: 'avg_watch_ms', totalWatchMs: 'total_watch_ms', skipRate: 'skip_rate' };

const ITEM_TO_ROW = (accountId: string) => (i: IgMediaItem) => ({
  id: i.id,
  account_id: accountId,
  media_type: i.kind,
  permalink: i.permalink,
  caption: i.caption,
  posted_at: i.postedAt,
  expires_at: i.kind === 'STORY' ? new Date(Date.parse(i.postedAt) + 86_400_000).toISOString() : null,
  // listing details (never the CDN URLs); cover_* and comments_synced_count are never in this payload
  ...(i.details
    ? { media_product_type: i.details.productType, like_count: i.details.likeCount, comments_count: i.details.commentsCount, is_shared_to_feed: i.details.isSharedToFeed, children_count: i.details.childrenCount }
    : {}),
});

export function supabaseSyncStore(db: SupabaseClient): SyncStore {
  const check = (op: string) => ({ error }: { error: unknown }) => {
    if (error) fail(op);
  };
  return {
    async ownerTimezone() {
      const owner = await db.from('owners').select('user_id').limit(1).maybeSingle();
      if (owner.error) fail('ownerTimezone');
      if (!owner.data) return DEFAULT_PREFS.timezone;
      const p = await db.from('profiles').select('timezone').eq('user_id', (owner.data as Row).user_id).maybeSingle();
      if (p.error) fail('ownerTimezone');
      const tz = (p.data as Row | null)?.timezone;
      return isValidTimeZone(tz) ? tz : DEFAULT_PREFS.timezone;
    },
    async loadStates(ids) {
      const out = new Map(ids.map((id) => [id, emptyState(id)]));
      if (ids.length === 0) return out;
      const { data, error } = await db.from('sync_state').select('*').in('account_id', ids);
      if (error) fail('loadStates');
      for (const r of (data ?? []) as Row[]) out.set(r.account_id as string, rowToState(r));
      return out;
    },
    async claimLease(accountId, leaseId, untilIso, nowIso) {
      check('claimLease')(await db.from('sync_state').upsert({ account_id: accountId }, { onConflict: 'account_id', ignoreDuplicates: true }));
      const { data, error } = await db
        .from('sync_state')
        .update({ lease_id: leaseId, lease_until: untilIso, last_attempt_at: nowIso })
        .eq('account_id', accountId)
        .or(`lease_until.is.null,lease_until.lt."${nowIso}"`)
        .select('*');
      if (error) fail('claimLease');
      const rows = (data ?? []) as Row[];
      return rows.length === 1 ? rowToState(rows[0]) : null;
    },
    async saveState(accountId, leaseId, p) {
      const row: Row = {
        lease_id: null,
        lease_until: null,
        last_attempt_at: p.lastAttemptAt,
        consecutive_failures: p.consecutiveFailures,
        last_error_key: p.lastErrorKey,
        daily_done_through: p.dailyDoneThrough,
        backfilled_from: p.backfilledFrom,
        last_run: p.lastRun,
      };
      if (p.lastSuccessAt) row.last_success_at = p.lastSuccessAt;
      if (p.capabilities) row.capabilities = p.capabilities;
      check('saveState')(await db.from('sync_state').update(row).eq('account_id', accountId).eq('lease_id', leaseId));
    },
    async getToken(accountId) {
      const { data, error } = await db.from('account_tokens').select('access_token').eq('account_id', accountId).maybeSingle();
      if (error) fail('getToken');
      const t = (data as Row | null)?.access_token;
      return typeof t === 'string' && t !== '' ? t : null;
    },
    async upsertDaily(accountId, day, v) {
      const row = {
        account_id: accountId,
        day,
        reach: v.reach,
        views: v.views,
        accounts_engaged: v.accountsEngaged,
        total_interactions: v.totalInteractions,
        follows: v.follows,
        unfollows: v.unfollows,
        link_taps: v.linkTaps,
        updated_at: new Date().toISOString(),
      };
      check('upsertDaily')(await db.from('account_daily').upsert(row, { onConflict: 'account_id,day' }));
    },
    async upsertFollowers(accountId, day, followers) {
      // separate upsert: only the followers column is written, metrics from other runs are left alone
      check('upsertFollowers')(await db.from('account_daily').upsert({ account_id: accountId, day, followers }, { onConflict: 'account_id,day' }));
    },
    async insertFollowerSnapshot(accountId, capturedAtIso, v) {
      const row = { account_id: accountId, captured_at: capturedAtIso, followers: v.followers, following: v.following, media_count: v.mediaCount };
      check('insertFollowerSnapshot')(await db.from('follower_snapshots').upsert(row, { onConflict: 'account_id,captured_at', ignoreDuplicates: true }));
    },
    async upsertDailyBreakdown(accountId, day, rows) {
      if (rows.length === 0) return;
      const at = new Date().toISOString();
      const data = rows.map((r) => ({ account_id: accountId, day, metric: r.metric, follow_type: r.followType, product_type: r.productType, value: r.value, updated_at: at }));
      check('upsertDailyBreakdown')(await db.from('account_daily_breakdown').upsert(data, { onConflict: 'account_id,day,metric,follow_type,product_type' }));
    },
    async upsertMedia(accountId, items) {
      if (items.length === 0) return;
      // last_metrics_at / gone_at are not in the payload, so re-listing never resets them.
      // Two batches: a PostgREST bulk upsert writes NULL for a key that only some rows carry, which would wipe the stored
      // listing details of the rows that came without any.
      for (const group of [items.filter((i) => i.details), items.filter((i) => !i.details)]) {
        if (group.length > 0) check('upsertMedia')(await db.from('media').upsert(group.map(ITEM_TO_ROW(accountId)), { onConflict: 'id' }));
      }
      const children = items.flatMap((i) => (i.details?.children ?? []).map((ch, position) => ({ media_id: i.id, position, media_type: ch.mediaType })));
      if (children.length > 0) check('upsertMediaChildren')(await db.from('media_children').upsert(children, { onConflict: 'media_id,position' }));
    },
    async mediaForMetrics(accountId, sinceIso) {
      const { data, error } = await db
        .from('media')
        .select('id,posted_at,last_metrics_at,media_type,media_product_type')
        .eq('account_id', accountId)
        .neq('media_type', 'STORY')
        .is('gone_at', null)
        .or(`posted_at.gte."${sinceIso}",last_metrics_at.is.null`);
      if (error) fail('mediaForMetrics');
      return ((data ?? []) as Row[]).map((r) => ({ id: r.id as string, postedAt: r.posted_at as string, lastMetricsAt: (r.last_metrics_at as string | null) ?? null, kind: r.media_type as string | undefined, productType: (r.media_product_type as string | null) ?? null }));
    },
    async insertMetrics(mediaId, capturedAt, v) {
      const row = {
        media_id: mediaId,
        captured_at: capturedAt,
        reach: v.reach,
        views: v.views,
        likes: v.likes,
        comments: v.comments,
        shares: v.shares,
        saves: v.saves,
        total_interactions: v.totalInteractions,
        replies: v.replies,
        taps_forward: v.tapsForward,
        taps_back: v.tapsBack,
        exits: v.exits,
        swipe_forward: v.swipeForward ?? null,
        follows: v.follows ?? null,
        profile_visits: v.profileVisits ?? null,
        profile_activity: v.profileActivity ?? null,
        avg_watch_ms: v.avgWatchMs ?? null,
        total_watch_ms: v.totalWatchMs ?? null,
        skip_rate: v.skipRate ?? null,
      };
      check('insertMetrics')(await db.from('media_metrics').upsert(row, { onConflict: 'media_id,captured_at', ignoreDuplicates: true }));
    },
    async updateMetricExtras(mediaId, capturedAt, e) {
      const row: Row = {};
      for (const [k, col] of Object.entries(EXTRA_COLUMNS)) {
        const v = e[k as keyof MediaExtras];
        if (v !== undefined) row[col] = v;
      }
      if (Object.keys(row).length === 0) return;
      check('updateMetricExtras')(await db.from('media_metrics').update(row).eq('media_id', mediaId).eq('captured_at', capturedAt));
    },
    async markCaptured(mediaIds, atIso) {
      if (mediaIds.length === 0) return;
      check('markCaptured')(await db.from('media').update({ last_metrics_at: atIso }).in('id', mediaIds));
    },
    async markGone(mediaId, atIso) {
      check('markGone')(await db.from('media').update({ gone_at: atIso }).eq('id', mediaId));
    },
    async upsertAudience(accountId, day, kind, data) {
      check('upsertAudience')(await db.from('audience_snapshots').upsert({ account_id: accountId, day, kind, data }, { onConflict: 'account_id,day,kind' }));
    },
    async coverRefs(accountId, opts) {
      let q = db
        .from('media')
        .select('id,media_type,posted_at,cover_status,cover_attempts,cover_tried_at')
        .eq('account_id', accountId)
        .in('cover_status', ['pending', 'failed'])
        .is('gone_at', null);
      q = opts.ids ? q.in('id', opts.ids) : q.neq('media_type', 'STORY');
      const { data, error } = await q.order('posted_at', { ascending: false }).limit(opts.limit);
      if (error) fail('coverRefs');
      return ((data ?? []) as Row[]).map((r) => ({
        id: r.id as string,
        kind: r.media_type as string,
        postedAt: r.posted_at as string,
        status: r.cover_status as CoverStatus,
        attempts: typeof r.cover_attempts === 'number' ? r.cover_attempts : 0,
        triedAt: (r.cover_tried_at as string | null) ?? null,
      }));
    },
    async markCover(mediaId, r) {
      const row: Row = { cover_status: r.status, cover_attempts: r.attempts, cover_tried_at: r.triedAt };
      if (r.status === 'ok') Object.assign(row, { cover_path: r.path ?? null, cover_captured_at: r.triedAt });
      check('markCover')(await db.from('media').update(row).eq('id', mediaId));
    },
    async uploadCover(path, bytes, contentType) {
      const { error } = await db.storage.from(COVERS_BUCKET).upload(path, bytes, { contentType, upsert: false, cacheControl: '31536000' });
      if (!error) return;
      const e = error as { statusCode?: string; status?: number; code?: string };
      if (e.statusCode === '409' || e.status === 409 || e.code === 'ResourceAlreadyExists' || e.code === 'Duplicate') return;
      fail('uploadCover');
    },
    async expireStoryCovers(accountId, nowIso) {
      check('expireStoryCovers')(
        await db.from('media').update({ cover_status: 'unavailable' }).eq('account_id', accountId).eq('media_type', 'STORY').in('cover_status', ['pending', 'failed']).lt('expires_at', nowIso),
      );
    },
    async mediaForComments(accountId, sinceIso) {
      const { data, error } = await db
        .from('media')
        .select('id,comments_count,comments_synced_count')
        .eq('account_id', accountId)
        .neq('media_type', 'STORY')
        .is('gone_at', null)
        .gte('posted_at', sinceIso)
        .gt('comments_count', 0)
        .order('posted_at', { ascending: false });
      if (error) fail('mediaForComments');
      return ((data ?? []) as Row[]).map((r) => ({ id: r.id as string, commentsCount: r.comments_count as number, syncedCount: (r.comments_synced_count as number | null) ?? null }));
    },
    async upsertComments(accountId, mediaId, items, seenAtIso) {
      if (items.length === 0) return;
      const rows = items.map((i) => ({ id: i.id, account_id: accountId, media_id: mediaId, author_username: i.username, text: i.text, like_count: i.likeCount, commented_at: i.commentedAt, last_seen_at: seenAtIso }));
      check('upsertComments')(await db.from('comments').upsert(rows, { onConflict: 'id' }));
    },
    async markCommentsSynced(mediaId, commentsCount) {
      check('markCommentsSynced')(await db.from('media').update({ comments_synced_count: commentsCount }).eq('id', mediaId));
    },
    async archiveSnapshot(accountId, endpoint, body, capturedAtIso) {
      const text = JSON.stringify(body);
      if (Buffer.byteLength(text) > SNAPSHOT_MAX_BYTES) return;
      if (text.includes('access_token') || endpoint.includes('access_token')) return; // belt and braces: a token never lands in the archive
      const row = { account_id: accountId, endpoint, captured_at: capturedAtIso, body, body_hash: createHash('sha256').update(text).digest('hex') };
      check('archiveSnapshot')(await db.from('api_snapshots').upsert(row, { onConflict: 'account_id,endpoint,body_hash', ignoreDuplicates: true }));
    },
    async upsertOnlineFollowers(accountId, day, hourly) {
      check('upsertOnlineFollowers')(await db.from('online_followers').upsert({ account_id: accountId, day, hourly }, { onConflict: 'account_id,day' }));
    },
    async recordRun(run) {
      check('recordRun')(await db.from('sync_runs').insert({ started_at: run.startedAt, finished_at: run.finishedAt, trigger: run.trigger, summary: run.summary }));
    },
    async writeProgress(accountId, p) {
      const row: Row = { account_id: accountId, stage: p.stage, state: p.state, done: p.done, total: p.total, detail_day: p.detailDay, error_key: p.errorKey, updated_at: p.updatedAt };
      if (p.finishedAt !== undefined) row.finished_at = p.finishedAt;
      check('writeProgress')(await db.from('sync_progress').upsert(row, { onConflict: 'account_id' }));
    },
  };
}

/** After a (re)connect the old failure streak and error no longer apply. Admin client; best-effort, never throws. */
export async function clearSyncError(db: SupabaseClient, accountId: string): Promise<void> {
  try {
    await db.from('sync_state').update({ consecutive_failures: 0, last_error_key: null }).eq('account_id', accountId);
  } catch {
    // the next sync run rewrites these fields anyway
  }
}

/**
 * Reconnect / "Sync now": a fresh live progress row (new start time, waiting, nothing finished). Never touches sync_state
 * coverage, so an import resumes where it stopped. Admin client; best-effort, never throws.
 */
export async function resetSyncProgress(db: SupabaseClient, accountId: string, nowIso: string): Promise<void> {
  try {
    const row = { account_id: accountId, stage: null, state: 'waiting', done: 0, total: null, detail_day: null, error_key: null, started_at: nowIso, updated_at: nowIso, finished_at: null };
    await db.from('sync_progress').upsert(row, { onConflict: 'account_id' });
  } catch {
    // the sync writes the row itself on its first progress report
  }
}

/**
 * Permanent account delete: removes the account's cover objects (bucket "covers", prefix "{accountId}/") after the
 * rows are gone. Admin client; best-effort, never throws. A leftover object is unreachable (the cover route needs the
 * media row) and the runbook lists orphans. Returns how many objects were removed.
 */
export async function removeAccountCovers(db: SupabaseClient, accountId: string): Promise<number> {
  let removed = 0;
  try {
    for (let round = 0; round < 50; round++) {
      const { data, error } = await db.storage.from(COVERS_BUCKET).list(accountId, { limit: 1000 });
      if (error || !data || data.length === 0) break;
      const { error: rmError } = await db.storage.from(COVERS_BUCKET).remove(data.map((f) => `${accountId}/${f.name}`));
      if (rmError) break;
      removed += data.length;
    }
  } catch {
    // Storage unreachable: the objects stay private and unreferenced; RUNBOOK_CAPTURE lists them
  }
  return removed;
}

export interface SyncStatus {
  lastSuccessAt: string | null;
  lastErrorKey: string | null;
  consecutiveFailures: number;
  dailyDoneThrough?: string | null; // null until the first insight day is written
  backfilling?: boolean; // history still importing (isBackfilling in lib/sync/schedule.ts); missing = unknown
}

/** Owner-session read for the Accounts page (RLS: owner select). Never throws: the page still renders without it. */
export async function listSyncStatus(db: SupabaseClient): Promise<Record<string, SyncStatus>> {
  const { data, error } = await db.from('sync_state').select('account_id,last_success_at,last_error_key,consecutive_failures,daily_done_through,backfilled_from,last_run');
  if (error || !data) return {};
  return Object.fromEntries(
    (data as Row[]).map((r) => {
      const s = rowToState(r);
      return [s.accountId, { lastSuccessAt: s.lastSuccessAt, lastErrorKey: s.lastErrorKey, consecutiveFailures: s.consecutiveFailures, dailyDoneThrough: s.dailyDoneThrough, backfilling: isBackfilling(s) }];
    }),
  );
}
