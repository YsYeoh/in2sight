'use server';

// Planner board (Plan 17f). Owner-authored data: OWNER-SESSION client only, so RLS (planner_items_owner_all,
// is_owner()) applies to every write. Never the admin client, never a call to Instagram, no logging.
import { revalidatePath } from 'next/cache';
import { postHeatmap } from '@/lib/analysis/best-time';
import { requireOwner } from '@/lib/auth/require-owner';
import { loadPostRows } from '@/lib/dashboard/detail-read';
import { MAX_ITEMS, PLANNER_STATUSES, parseItemInput, suggestSlots, type PlannerError, type PlannerResult, type PlannerStatus, type SlotResult } from '@/lib/planner/items';
import { itemToRow, PLANNER_TABLE, plannerError } from '@/lib/planner/read';
import { getPrefs } from '@/lib/prefs.server';
import { createServerSupabase } from '@/lib/supabase/server';
import { addDays, localDay } from '@/lib/sync/time';
import { isUuid } from '@/lib/tags';

const fail = (error: PlannerError) => ({ ok: false, error }) as const;

function done(): PlannerResult {
  revalidatePath('/plan', 'layout'); // /plan itself only redirects; the board is /plan/board (as the goals action does)
  return { ok: true };
}

// Server actions are public endpoints: authorize first (outside try/catch: it redirects by throwing), then validate.

/** Creates (id = null) or replaces an item. A linked post must belong to the item's account. */
export async function savePlannerItemAction(id: string | null, raw: unknown): Promise<PlannerResult> {
  await requireOwner();
  if (id !== null && !isUuid(id)) return fail('not_found');
  const p = parseItemInput(raw);
  if (!p.ok) return fail(p.error);
  try {
    const db = await createServerSupabase();
    if (p.value.mediaId !== null) {
      const { data, error } = await db.from('media').select('id').eq('id', p.value.mediaId).eq('account_id', p.value.accountId).limit(1);
      if (error) return fail('unexpected');
      if (!(data ?? []).length) return fail('not_found');
    }
    if (id === null) {
      const { data, error } = await db.from(PLANNER_TABLE).select('id').limit(MAX_ITEMS);
      if (error) return fail(plannerError(error));
      if ((data ?? []).length >= MAX_ITEMS) return fail('too_many');
      const { error: insertError } = await db.from(PLANNER_TABLE).insert(itemToRow(p.value));
      return insertError ? fail(plannerError(insertError)) : done();
    }
    const { data, error } = await db.from(PLANNER_TABLE).update(itemToRow(p.value)).eq('id', id.toLowerCase()).select('id');
    if (error) return fail(plannerError(error));
    return (data ?? []).length ? done() : fail('not_found');
  } catch {
    return fail('unexpected');
  }
}

/** Moves a card to another column. Leaving "posted" drops the post link (a linked post means it is published). */
export async function movePlannerItemAction(id: string, status: PlannerStatus): Promise<PlannerResult> {
  await requireOwner();
  if (!isUuid(id)) return fail('not_found');
  if (!PLANNER_STATUSES.includes(status)) return fail('invalid');
  try {
    const db = await createServerSupabase();
    const patch = status === 'posted' ? { status } : { status, media_id: null };
    const { data, error } = await db.from(PLANNER_TABLE).update(patch).eq('id', id.toLowerCase()).select('id');
    if (error) return fail(plannerError(error));
    return (data ?? []).length ? done() : fail('not_found');
  } catch {
    return fail('unexpected');
  }
}

export async function deletePlannerItemAction(id: string): Promise<PlannerResult> {
  await requireOwner();
  if (!isUuid(id)) return fail('not_found');
  try {
    const db = await createServerSupabase();
    const { data, error } = await db.from(PLANNER_TABLE).delete().eq('id', id.toLowerCase()).select('id');
    if (error) return fail(plannerError(error));
    return (data ?? []).length ? done() : fail('not_found');
  } catch {
    return fail('unexpected');
  }
}

/** Up to 3 slots in the next 7 days from the account's post performance (the account Overview's heatmap: all stored
 *  feed posts, owner timezone), skipping days that already hold a planned item of this account. Read-only. */
export async function suggestSlotsAction(accountId: string): Promise<SlotResult> {
  await requireOwner();
  if (!isUuid(accountId)) return fail('not_found');
  try {
    const [prefs, db] = await Promise.all([getPrefs(), createServerSupabase()]);
    const today = localDay(new Date(), prefs.timezone);
    const id = accountId.toLowerCase();
    const [posts, taken] = await Promise.all([
      loadPostRows(db, id),
      db.from(PLANNER_TABLE).select('planned_day').eq('account_id', id).gte('planned_day', addDays(today, 1)).limit(MAX_ITEMS),
    ]);
    if (taken.error) return fail(plannerError(taken.error));
    const map = postHeatmap(posts, prefs.timezone, prefs.weekStart);
    const days = ((taken.data ?? []) as { planned_day: unknown }[]).map((r) => String(r.planned_day));
    return { ok: true, slots: suggestSlots(map, days, today), sample: map.sample, reason: map.reason };
  } catch {
    return fail('unexpected');
  }
}
