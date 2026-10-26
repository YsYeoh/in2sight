// Alert persistence for the sync tick. Takes the ADMIN client (notifications are inserted only here; subscriptions are
// read and pruned only here). Errors never include Supabase's message (it can echo values).
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DailyRow, Post } from '@/lib/analysis/types';
import type { Alert } from '@/lib/alerts/rules';
import { parseAlertSettings, type AlertSettings } from '@/lib/alerts/settings';
import { loadDaily, loadPosts } from '@/lib/dashboard/read';
import { DEFAULT_PREFS, type Prefs } from '@/lib/prefs';
import { profileRowToPrefs } from '@/lib/prefs.sync';
import type { PushSub } from '@/lib/push/send';

/** takingOff needs the posts of the last 3 days plus the 20 before them; 60 covers busy accounts. */
export const ALERT_POSTS = 60;

export interface AlertStore {
  /** The owner's alert settings and display prefs (push text uses their language and number/date format). */
  context(): Promise<{ settings: AlertSettings; prefs: Prefs }>;
  daily(accountId: string, fromDay: string): Promise<DailyRow[]>;
  posts(accountId: string): Promise<Post[]>;
  lastReachDropAt(accountId: string): Promise<string | null>;
  /** Plan 15d: paused_at when auto-hide is on but paused, else null; null before the moderation migration. Optional for fakes. */
  moderationPausedAt?(accountId: string): Promise<string | null>;
  /** INSERT … ON CONFLICT (dedupe_key) DO NOTHING RETURNING: only the alerts that were really new come back. */
  insertNew(alerts: Alert[]): Promise<Alert[]>;
  subscriptions(): Promise<PushSub[]>;
  deleteSubscription(endpoint: string): Promise<void>;
}

type Row = Record<string, unknown>;

function fail(op: string): never {
  throw new Error(`alert store: ${op} failed`);
}

const isStr = (v: unknown): v is string => typeof v === 'string' && v !== '';

export function supabaseAlertStore(db: SupabaseClient): AlertStore {
  return {
    async context() {
      const owner = await db.from('owners').select('user_id').limit(1).maybeSingle();
      if (owner.error) fail('context');
      if (!owner.data) return { settings: parseAlertSettings(null), prefs: DEFAULT_PREFS };
      const p = await db.from('profiles').select('alert_settings,language,timezone,date_format,time_format,number_format,week_start').eq('user_id', (owner.data as Row).user_id).maybeSingle();
      if (p.error) fail('context');
      const r = (p.data ?? {}) as Row;
      return { settings: parseAlertSettings(r.alert_settings), prefs: profileRowToPrefs(r) ?? DEFAULT_PREFS }; // invalid columns fall back per field
    },
    daily: (accountId, fromDay) => loadDaily(db, accountId, fromDay),
    posts: (accountId) => loadPosts(db, accountId, ALERT_POSTS),
    async lastReachDropAt(accountId) {
      const { data, error } = await db.from('notifications').select('created_at').eq('account_id', accountId).eq('kind', 'reach_drop').order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (error) fail('lastReachDropAt');
      const at = (data as Row | null)?.created_at;
      return isStr(at) ? at : null;
    },
    async moderationPausedAt(accountId) {
      const { data, error } = await db.from('moderation_settings').select('paused_at').eq('account_id', accountId).eq('auto_hide', true).not('paused_at', 'is', null).maybeSingle();
      if (error?.code === 'PGRST205' || error?.code === '42P01') return null; // the moderation migration is not applied yet
      if (error) fail('moderationPausedAt');
      const at = (data as Row | null)?.paused_at;
      return isStr(at) ? at : null;
    },
    async insertNew(alerts) {
      if (alerts.length === 0) return [];
      const rows = alerts.map((a) => ({ account_id: a.accountId, kind: a.kind, severity: a.severity, payload: a.payload, dedupe_key: a.dedupeKey }));
      const { data, error } = await db.from('notifications').upsert(rows, { onConflict: 'dedupe_key', ignoreDuplicates: true }).select('dedupe_key');
      // accepted: if an account is deleted mid-tick the FK violation fails this whole batch; the next tick recovers
      if (error) fail('insertNew');
      const inserted = new Set(((data ?? []) as Row[]).map((r) => r.dedupe_key));
      return alerts.filter((a) => inserted.has(a.dedupeKey));
    },
    async subscriptions() {
      const { data, error } = await db.from('push_subscriptions').select('endpoint,keys').limit(50);
      if (error) fail('subscriptions');
      return ((data ?? []) as Row[]).flatMap((r) => {
        const k = (r.keys ?? {}) as Row;
        return isStr(r.endpoint) && isStr(k.p256dh) && isStr(k.auth) ? [{ endpoint: r.endpoint, keys: { p256dh: k.p256dh, auth: k.auth } }] : [];
      });
    },
    async deleteSubscription(endpoint) {
      const { error } = await db.from('push_subscriptions').delete().eq('endpoint', endpoint);
      if (error) fail('deleteSubscription');
    },
  };
}
