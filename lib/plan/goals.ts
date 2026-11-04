// Goals storage (Plan 17d): the owner session only (RLS: goals_owner_all under is_owner()), never the admin client.
// One goal per (account, metric) (unique index), so a save is: set metrics upserted, cleared metrics deleted.
// Errors are keys (`invalid`, `needs_update`, `unexpected`), never Supabase text. Nothing here logs.
import type { SupabaseClient } from '@supabase/supabase-js';
import { DUE_MAX_DAYS, GOAL_METRICS, TARGET_MAX, type Goal, type GoalMetric } from '@/lib/analysis/goals';
import { addDays, localDay } from '@/lib/sync/time';
import { isDay } from '@/lib/time-scope/range';

/** PostgREST / Postgres "table does not exist": the 17d migration is not applied yet. */
const MISSING_TABLE: readonly string[] = ['PGRST205', '42P01'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type GoalInput = Record<GoalMetric, { target: number; dueDay: string | null } | null>;
export type GoalError = 'invalid' | 'needs_update' | 'unexpected';

type Row = Record<string, unknown>;
const isMetric = (v: unknown): v is GoalMetric => typeof v === 'string' && (GOAL_METRICS as readonly string[]).includes(v);

/** Every goal of the live accounts, oldest first; null = the migration 20261103000001 is not applied yet. */
export async function loadGoals(db: SupabaseClient, tz: string): Promise<Goal[] | null> {
  const { data, error } = await db.from('goals').select('id,account_id,metric,target,due_day,created_at').order('created_at', { ascending: true }).limit(500);
  if (error) {
    if (MISSING_TABLE.includes(String((error as { code?: unknown }).code))) return null;
    throw new Error('goals read failed');
  }
  return ((data ?? []) as Row[]).flatMap((r) =>
    isMetric(r.metric) && typeof r.target === 'number' && typeof r.created_at === 'string'
      ? [{ id: String(r.id), accountId: String(r.account_id), metric: r.metric, target: r.target, dueDay: isDay(r.due_day) ? r.due_day : null, startDay: localDay(new Date(r.created_at), tz) }]
      : [],
  );
}

/**
 * The form's raw values -> what to store. Per metric: '' (or missing) = no goal; else a whole number 1..TARGET_MAX;
 * followers also needs a due day after today and at most DUE_MAX_DAYS ahead. null = anything invalid (the form
 * validates the same rules first, so this only refuses hostile or stale input).
 */
export function parseGoalInput(raw: unknown, today: string): GoalInput | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const out = {} as GoalInput;
  for (const m of GOAL_METRICS) {
    const t = r[m];
    if (t === undefined || t === null || t === '') {
      out[m] = null;
      continue;
    }
    const n = typeof t === 'number' ? t : typeof t === 'string' && /^\d{1,10}$/.test(t.trim()) ? Number(t.trim()) : NaN;
    if (!Number.isInteger(n) || n < 1 || n > TARGET_MAX[m]) return null;
    if (m !== 'followers') {
      out[m] = { target: n, dueDay: null };
      continue;
    }
    const due = r.followersDue;
    if (!isDay(due) || due <= today || due > addDays(today, DUE_MAX_DAYS)) return null;
    out[m] = { target: n, dueDay: due };
  }
  return out;
}

/** Applies one account's goals. The start day of a kept goal stays (an edit keeps its pace line); clearing a goal deletes it. */
export async function saveGoals(db: SupabaseClient, accountId: string, input: GoalInput): Promise<{ ok: true } | { ok: false; error: GoalError }> {
  if (!UUID.test(accountId)) return { ok: false, error: 'invalid' };
  const code = (e: unknown) => String((e as { code?: unknown } | null)?.code);
  const failed = (e: unknown): { ok: false; error: GoalError } => ({ ok: false, error: MISSING_TABLE.includes(code(e)) ? 'needs_update' : code(e) === '23503' ? 'invalid' : 'unexpected' });
  const set = GOAL_METRICS.filter((m) => input[m] !== null);
  const cleared = GOAL_METRICS.filter((m) => input[m] === null);
  if (set.length) {
    const rows = set.map((m) => ({ account_id: accountId, metric: m, target: input[m]!.target, due_day: input[m]!.dueDay, updated_at: new Date().toISOString() }));
    const { error } = await db.from('goals').upsert(rows, { onConflict: 'account_id,metric' });
    if (error) return failed(error);
  }
  if (cleared.length) {
    const { error } = await db.from('goals').delete().eq('account_id', accountId).in('metric', cleared);
    if (error) return failed(error);
  }
  return { ok: true };
}
