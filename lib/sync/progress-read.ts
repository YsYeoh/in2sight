// Owner-session read for the progress panel and badges (RLS: owner select; never the admin client). Only accounts
// worth showing (isTracked) get the extra count queries. Output is counts, keys and days: no tokens, no media ids.
// Never throws: on any read error the panel simply shows nothing new.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { StoredAccount } from '@/lib/accounts/types';
import { buildProgress, isTracked, type AccountProgress, type LiveProgress, type Stage } from '@/lib/sync/progress';
import { emptyState } from '@/lib/sync/schedule';
import { rowToState } from '@/lib/sync/store';

type Row = Record<string, unknown>;
const STATE_COLUMNS = 'account_id,lease_until,last_attempt_at,last_success_at,last_error_key,consecutive_failures,daily_done_through,backfilled_from,last_run';
const PROGRESS_COLUMNS = 'account_id,stage,state,done,total,detail_day,error_key,started_at,updated_at,finished_at';
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === 'string' ? v : null);

export function rowToLive(r: Row): LiveProgress {
  const state = r.state === 'running' || r.state === 'failed' || r.state === 'done' ? r.state : 'waiting';
  return {
    stage: (str(r.stage) as Stage | null) ?? null,
    state,
    done: num(r.done) ?? 0,
    total: num(r.total),
    detailDay: str(r.detail_day),
    errorKey: str(r.error_key),
    startedAt: str(r.started_at) ?? new Date(0).toISOString(),
    updatedAt: str(r.updated_at) ?? new Date(0).toISOString(),
    finishedAt: str(r.finished_at),
  };
}

async function counts(db: SupabaseClient, accountId: string) {
  const posts = () => db.from('media').select('id', { count: 'exact', head: true }).eq('account_id', accountId).neq('media_type', 'STORY').is('gone_at', null);
  const [total, measured, snap] = await Promise.all([
    posts(),
    posts().not('last_metrics_at', 'is', null),
    db.from('follower_snapshots').select('followers').eq('account_id', accountId).order('captured_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  return {
    posts: { total: total.error ? 0 : (total.count ?? 0), measured: measured.error ? 0 : (measured.count ?? 0) },
    followers: snap.error ? null : num((snap.data as Row | null)?.followers),
  };
}

export async function loadSyncProgress(db: SupabaseClient, accounts: StoredAccount[], now: Date): Promise<AccountProgress[]> {
  const shown = accounts.filter((a) => a.status !== 'archived');
  if (shown.length === 0) return [];
  try {
    const ids = shown.map((a) => a.id);
    const [st, pr] = await Promise.all([db.from('sync_state').select(STATE_COLUMNS).in('account_id', ids), db.from('sync_progress').select(PROGRESS_COLUMNS).in('account_id', ids)]);
    if (st.error) return [];
    const states = new Map(((st.data ?? []) as Row[]).map((r) => [r.account_id as string, rowToState(r)]));
    const live = new Map((pr.error ? [] : ((pr.data ?? []) as Row[])).map((r) => [r.account_id as string, rowToLive(r)])); // table missing: no live rows
    const tracked = shown.map((a) => ({ a, state: states.get(a.id) ?? emptyState(a.id), live: live.get(a.id) ?? null })).filter((x) => isTracked(x, now));
    return await Promise.all(tracked.map(async ({ a, state, live: l }) => buildProgress({ accountId: a.id, needsReconnect: a.status === 'needs_reconnect', state, live: l, ...(await counts(db, a.id)) }, now)));
  } catch {
    return [];
  }
}
