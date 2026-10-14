'use server';

import { revalidatePath } from 'next/cache';
import { normalizeGroup } from '@/lib/accounts/group';
import { archiveAccount, deleteAccountPermanently, restoreAccount, setAccountGroup } from '@/lib/accounts/service';
import { supabaseAccountsStore } from '@/lib/accounts/supabase-store';
import type { AccountsStore } from '@/lib/accounts/types';
import { requireOwner } from '@/lib/auth/require-owner';
import { createAdminSupabase } from '@/lib/supabase/admin';

type Result = { ok: true } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Wraps only the store/service call: requireOwner() redirects by throwing and must never pass through here.
async function guarded(run: (store: AccountsStore) => Promise<Result>): Promise<Result> {
  try {
    const result = await run(supabaseAccountsStore(createAdminSupabase()));
    if (result.ok) revalidatePath('/accounts');
    return result;
  } catch {
    return { ok: false, error: 'unexpected' };
  }
}

// server actions are public endpoints: authorize first, then validate the id at the trust boundary
export async function archiveAccountAction(id: string): Promise<Result> {
  await requireOwner();
  if (typeof id !== 'string' || !UUID.test(id)) return { ok: false, error: 'not_found' };
  return guarded((s) => archiveAccount(s, id));
}

export async function restoreAccountAction(id: string): Promise<Result> {
  await requireOwner();
  if (typeof id !== 'string' || !UUID.test(id)) return { ok: false, error: 'not_found' };
  return guarded((s) => restoreAccount(s, id));
}

export async function deleteAccountAction(id: string): Promise<Result> {
  await requireOwner();
  if (typeof id !== 'string' || !UUID.test(id)) return { ok: false, error: 'not_found' };
  return guarded((s) => deleteAccountPermanently(s, id));
}

export async function setGroupAction(id: string, group: string | null): Promise<Result> {
  await requireOwner();
  if (typeof id !== 'string' || !UUID.test(id)) return { ok: false, error: 'not_found' };
  const g = normalizeGroup(group);
  if (!g.ok) return { ok: false, error: 'invalid_group' };
  return guarded((s) => setAccountGroup(s, id, g.value));
}
