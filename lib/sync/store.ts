// Sync persistence. supabaseSyncStore takes the ADMIN client (writes bypass RLS); listSyncStatus takes the owner session.
// Errors never include Supabase's message (it can echo values).
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AccountDayValues, BreakdownRow, MediaMetricValues } from '@/lib/instagram/data';
import type { AudienceKind } from '@/lib/instagram/metrics';
import type { IgMediaItem } from '@/lib/instagram/parse';
import { DEFAULT_PREFS, isValidTimeZone } from '@/lib/prefs';
import { parseCapabilities, type Capabilities } from '@/lib/sync/capabilities';
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
  upsertMedia(accountId: string, items: IgMediaItem[]): Promise<void>;
  mediaForMetrics(accountId: string, sinceIso: string): Promise<MediaRef[]>;
  insertMetrics(mediaId: string, capturedAt: string, v: MediaMetricValues): Promise<void>;
  markCaptured(mediaIds: string[], atIso: string): Promise<void>;
  markGone(mediaId: string, atIso: string): Promise<void>;
  upsertAudience(accountId: string, day: string, kind: AudienceKind, data: Record<string, number>): Promise<void>;
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

const ITEM_TO_ROW = (accountId: string) => (i: IgMediaItem) => ({
  id: i.id,
  account_id: accountId,
  media_type: i.kind,
  permalink: i.permalink,
  caption: i.caption,
  posted_at: i.postedAt,
  expires_at: i.kind === 'STORY' ? new Date(Date.parse(i.postedAt) + 86_400_000).toISOString() : null,
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
      // last_metrics_at / gone_at are not in the payload, so re-listing never resets them
      check('upsertMedia')(await db.from('media').upsert(items.map(ITEM_TO_ROW(accountId)), { onConflict: 'id' }));
    },
    async mediaForMetrics(accountId, sinceIso) {
      const { data, error } = await db
        .from('media')
        .select('id,posted_at,last_metrics_at')
        .eq('account_id', accountId)
        .neq('media_type', 'STORY')
        .is('gone_at', null)
        .or(`posted_at.gte."${sinceIso}",last_metrics_at.is.null`);
      if (error) fail('mediaForMetrics');
      return ((data ?? []) as Row[]).map((r) => ({ id: r.id as string, postedAt: r.posted_at as string, lastMetricsAt: (r.last_metrics_at as string | null) ?? null }));
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
      };
      check('insertMetrics')(await db.from('media_metrics').upsert(row, { onConflict: 'media_id,captured_at', ignoreDuplicates: true }));
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
