'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { PASSWORD_COOKIE, PASSWORD_LIMIT, attemptCookieOptions, bumpAttempts, isLimited, readAttempts } from '@/lib/auth/attempts';
import { checkClient } from '@/lib/auth/check-client';
import { checkPassword } from '@/lib/auth/password';
import { requireOwner } from '@/lib/auth/require-owner';
import { DELETE_PHRASE, deleteAllData, type DeleteState } from '@/lib/data/delete';
import { createAdminSupabase } from '@/lib/supabase/admin';

/**
 * Settings → Data & privacy → "Delete all data" (Plan 16c). A POST-only server action (Next.js checks the Origin), in
 * this order: owner + aal2 (requireOwner), the typed phrase, the wrong-password cookie limit shared with change
 * password, the password re-checked on a memory-only client, and only then the service-role delete. Nothing is logged:
 * Supabase's API log records the delete_all_data call (time, status) out of reach of the browser session.
 */
export async function deleteAllDataAction(_prev: DeleteState, formData: FormData): Promise<DeleteState> {
  const { userId, email } = await requireOwner();
  if (formData.get('phrase') !== DELETE_PHRASE) return { error: 'phrase' };
  const password = formData.get('password');
  if (typeof password !== 'string' || !password) return { error: 'missing_password' };
  const store = await cookies();
  const attempts = readAttempts(store.get(PASSWORD_COOKIE)?.value, Date.now(), PASSWORD_LIMIT);
  if (isLimited(attempts, PASSWORD_LIMIT)) return { error: 'rate_limited' };
  const checked = await checkPassword(checkClient, { userId, email, password });
  if (checked !== 'ok') {
    if (checked === 'wrong_password') store.set(PASSWORD_COOKIE, bumpAttempts(attempts), attemptCookieOptions(PASSWORD_LIMIT));
    return { error: checked };
  }
  store.delete(PASSWORD_COOKIE);
  const r = await deleteAllData(createAdminSupabase());
  if (!r.ok) return { error: r.error };
  revalidatePath('/', 'layout'); // every page showed the deleted accounts
  return { ok: true, accounts: r.accounts, coversDone: r.coversDone };
}
