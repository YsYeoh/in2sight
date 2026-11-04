'use server';

import { revalidatePath } from 'next/cache';
import { requireOwner } from '@/lib/auth/require-owner';
import { parseGoalInput, saveGoals, type GoalError } from '@/lib/plan/goals';
import { getPrefs } from '@/lib/prefs.server';
import { createServerSupabase } from '@/lib/supabase/server';
import { localDay } from '@/lib/sync/time';

/** Saves one account's goals (Plan 17d). Owner session only (RLS goals_owner_all); errors are keys, never Supabase text. */
export async function saveGoalsAction(accountId: unknown, raw: unknown): Promise<{ ok: true } | { ok: false; error: GoalError }> {
  await requireOwner(); // server actions are public endpoints: authorize here, not only in the page
  const prefs = await getPrefs();
  const input = parseGoalInput(raw, localDay(new Date(), prefs.timezone));
  if (!input || typeof accountId !== 'string') return { ok: false, error: 'invalid' };
  try {
    const r = await saveGoals(await createServerSupabase(), accountId, input);
    if (r.ok) revalidatePath('/plan', 'layout'); // the digest and the goals section
    return r;
  } catch {
    return { ok: false, error: 'unexpected' };
  }
}
