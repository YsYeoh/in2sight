// Notification centre reads. OWNER SESSION client only (RLS: owner select). Never throws: the app shell must render
// even when this fails, it then shows an empty bell.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AlertPayload, Severity } from '@/lib/alerts/rules';
import { ALERT_KINDS, type AlertKind } from '@/lib/alerts/settings';

export const NOTIFICATION_LIMIT = 20;

export interface NotificationItem {
  id: number;
  kind: AlertKind;
  accountId: string | null;
  severity: Severity;
  payload: AlertPayload;
  createdAt: string;
  readAt: string | null;
}

type Row = Record<string, unknown>;
const SEVERITIES: readonly string[] = ['info', 'warning', 'critical'];
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Validates a stored row: unknown kinds are dropped, payload fields are type-checked one by one. */
export function rowToNotification(r: Row): NotificationItem | null {
  if (!(ALERT_KINDS as readonly unknown[]).includes(r.kind) || typeof r.id !== 'number' || typeof r.created_at !== 'string') return null;
  const p = (r.payload !== null && typeof r.payload === 'object' ? r.payload : {}) as Row;
  const payload: AlertPayload = { username: typeof p.username === 'string' ? p.username : '' };
  for (const k of ['days', 'runs', 'pct', 'ratio'] as const) {
    const v = num(p[k]);
    if (v !== undefined) payload[k] = v;
  }
  if (typeof p.postId === 'string') payload.postId = p.postId;
  return {
    id: r.id,
    kind: r.kind as AlertKind,
    accountId: typeof r.account_id === 'string' ? r.account_id : null,
    severity: SEVERITIES.includes(r.severity as string) ? (r.severity as Severity) : 'info',
    payload,
    createdAt: r.created_at,
    readAt: typeof r.read_at === 'string' ? r.read_at : null,
  };
}

/** Newest 20 + the unread count (a head-only count query, no rows transferred). */
export async function loadNotifications(db: SupabaseClient): Promise<{ items: NotificationItem[]; unread: number }> {
  try {
    const [list, count] = await Promise.all([
      db.from('notifications').select('id,kind,account_id,severity,payload,created_at,read_at').order('created_at', { ascending: false }).limit(NOTIFICATION_LIMIT),
      db.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null),
    ]);
    if (list.error || count.error) return { items: [], unread: 0 };
    return { items: ((list.data ?? []) as Row[]).map(rowToNotification).filter((n): n is NotificationItem => n !== null), unread: count.count ?? 0 };
  } catch {
    return { items: [], unread: 0 };
  }
}
