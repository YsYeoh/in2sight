// Reads and row mapping of planner_items (Plan 17f, migration 20261105000001). OWNER SESSION client only (RLS:
// planner_items_owner_all, is_owner()); never the admin client. Errors become keys, never Supabase text.
import type { SupabaseClient } from '@supabase/supabase-js';
import { MAX_ITEMS, PLANNER_FORMATS, PLANNER_STATUSES, type PlannerError, type PlannerInput, type PlannerItem } from '@/lib/planner/items';

export const PLANNER_TABLE = 'planner_items';
const COLUMNS = 'id,account_id,title,notes,status,format,planned_day,planned_hour,tag_ids,media_id,created_at';

type Row = Record<string, unknown>;
type DbError = { code?: string } | null;

/** PostgREST / Postgres "table not found" = migration 20261105000001 not applied; 23503 = the account or post is gone;
 *  23514 = a check refused the row (the app validates first, so this means a stale page). */
export function plannerError(e: DbError): PlannerError {
  const code = e?.code;
  return code === 'PGRST205' || code === '42P01' ? 'needs_update' : code === '23503' ? 'not_found' : code === '23514' ? 'invalid' : 'unexpected';
}

const str = (v: unknown) => (typeof v === 'string' ? v : null);

export function rowToItem(r: Row): PlannerItem {
  const format = str(r.format);
  const status = str(r.status);
  return {
    id: String(r.id),
    accountId: String(r.account_id),
    title: String(r.title),
    notes: str(r.notes) ?? '',
    status: PLANNER_STATUSES.find((s) => s === status) ?? 'idea',
    format: PLANNER_FORMATS.find((f) => f === format) ?? null,
    plannedDay: str(r.planned_day),
    plannedHour: typeof r.planned_hour === 'number' ? r.planned_hour : null,
    tagIds: Array.isArray(r.tag_ids) ? r.tag_ids.map(String) : [],
    mediaId: str(r.media_id),
    createdAt: String(r.created_at),
  };
}

export const itemToRow = (v: PlannerInput) => ({
  account_id: v.accountId,
  title: v.title,
  notes: v.notes,
  status: v.status,
  format: v.format,
  planned_day: v.plannedDay,
  planned_hour: v.plannedHour,
  tag_ids: v.tagIds,
  media_id: v.mediaId,
});

/** Every item, newest first (at most MAX_ITEMS, which the actions enforce). null = the migration is not applied yet. */
export async function loadPlannerItems(db: SupabaseClient): Promise<PlannerItem[] | null> {
  const { data, error } = await db.from(PLANNER_TABLE).select(COLUMNS).order('created_at', { ascending: false }).limit(MAX_ITEMS);
  if (error) {
    if (plannerError(error) === 'needs_update') return null;
    throw new Error('planner read failed');
  }
  return ((data ?? []) as Row[]).map(rowToItem);
}
