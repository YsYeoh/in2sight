'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { normalizeGroup } from '@/lib/accounts/group';
import { archiveAccount, deleteAccountPermanently, restoreAccount, setAccountGroup } from '@/lib/accounts/service';
import { supabaseAccountsStore } from '@/lib/accounts/supabase-store';
import type { AccountsStore } from '@/lib/accounts/types';
import { requireOwner } from '@/lib/auth/require-owner';
import { continueIfMore } from '@/lib/sync/connect-sync';
import { createSyncDeps } from '@/lib/sync/deps';
import { removeAccountCovers, resetSyncProgress } from '@/lib/sync/store';
import { runTick, TICK_BUDGET_MS } from '@/lib/sync/tick';
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
  const result = await guarded((s) => deleteAccountPermanently(s, id));
  // rows are gone (FK cascade: media, comments, snapshots…); now the cover images in Storage. Archive keeps them.
  if (result.ok) await removeAccountCovers(createAdminSupabase(), id);
  return result;
}

export async function setGroupAction(id: string, group: string | null): Promise<Result> {
  await requireOwner();
  if (typeof id !== 'string' || !UUID.test(id)) return { ok: false, error: 'not_found' };
  const g = normalizeGroup(group);
  if (!g.ok) return { ok: false, error: 'invalid_group' };
  return guarded((s) => setAccountGroup(s, id, g.value));
}

// Runs the same per-account runner as the cron tick, now, for one account. Forces Stories + media list; daily and
// audience still follow their once-a-day rule. Bounded by the page's maxDuration (accounts/(list)/page.tsx).
// Starts a fresh progress session (the panel shows it) and, if the run stopped on its time budget (an import still
// going), a continuation pass after the response. Coverage is never reset.
export async function syncNowAction(id: string): Promise<Result> {
  await requireOwner();
  if (typeof id !== 'string' || !UUID.test(id)) return { ok: false, error: 'not_found' };
  try {
    await resetSyncProgress(createAdminSupabase(), id, new Date().toISOString());
    const summary = await runTick(createSyncDeps(), { trigger: 'manual', budgetMs: TICK_BUDGET_MS, accountId: id });
    revalidatePath('/accounts');
    after(() => continueIfMore(summary.more === true));
    const r = summary.accounts[0];
    if (!r) return { ok: false, error: 'not_active' };
    if (r.outcome === 'locked') return { ok: false, error: 'busy' };
    if (r.outcome === 'failed' || r.outcome === 'needs_reconnect') return { ok: false, error: r.errorKey ?? 'unexpected' };
    return { ok: true };
  } catch {
    return { ok: false, error: 'unexpected' };
  }
}
