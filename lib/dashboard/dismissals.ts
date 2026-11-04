// Dismissed and snoozed findings (Plan 17b, migration 20261101000001_insight_dismissals). OWNER SESSION client only (RLS:
// is_owner()); never the admin client. Read by the keys on screen, in chunks (PostgREST answers at most 1,000 rows, and
// the table only grows), never by recency. Errors are keys; no Supabase message leaves this file.
import type { SupabaseClient } from '@supabase/supabase-js';
import { INSIGHTS, type Dismissal, type DismissMode, type DismissResult } from '@/lib/analysis/insights';

const TABLE = 'insight_dismissals';
/** PostgREST / Postgres codes for "this table does not exist": the migration is not applied yet. */
export const MISSING_TABLE: readonly string[] = ['PGRST205', '42P01'];
const CHUNK = 50; // keys per request: keeps the URL short
const DAY_MS = 86_400_000;
const codeOf = (e: unknown) => String((e as { code?: unknown } | null)?.code);

/** The dismissals of these keys. null = they cannot be read (the migration is missing, or the read failed): the feed then
 *  shows everything and offers no dismiss button. No keys = nothing to read ([]). */
export async function loadDismissals(db: SupabaseClient, keys: string[]): Promise<Dismissal[] | null> {
  const unique = [...new Set(keys)];
  if (unique.length === 0) return [];
  const chunks = Array.from({ length: Math.ceil(unique.length / CHUNK) }, (_, i) => unique.slice(i * CHUNK, (i + 1) * CHUNK));
  try {
    const results = await Promise.all(chunks.map((c) => db.from(TABLE).select('finding_key,until').in('finding_key', c)));
    if (results.some((r) => r.error)) return null;
    return results.flatMap((r) => ((r.data ?? []) as Record<string, unknown>[]).map((row) => ({ key: String(row.finding_key), until: typeof row.until === 'string' ? row.until : null })));
  } catch {
    return null;
  }
}

/** Dismiss (for good) or snooze (INSIGHTS.snoozeDays) one finding. `accountId` comes from the parsed key. */
export async function saveDismissal(db: SupabaseClient, key: string, accountId: string, mode: DismissMode, now: Date): Promise<DismissResult> {
  const until = mode === 'snooze' ? new Date(now.getTime() + INSIGHTS.snoozeDays * DAY_MS).toISOString() : null;
  const { error } = await db.from(TABLE).upsert({ finding_key: key, account_id: accountId, until }, { onConflict: 'finding_key' });
  if (!error) return { ok: true };
  const code = codeOf(error);
  return { ok: false, error: MISSING_TABLE.includes(code) ? 'needs_update' : code === '23503' ? 'not_found' : 'unexpected' };
}
