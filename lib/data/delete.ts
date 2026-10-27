import type { SupabaseClient } from '@supabase/supabase-js';
import { COVERS_BUCKET } from '@/lib/sync/covers';
import { removeAccountCovers } from '@/lib/sync/store';

// "Delete all data permanently" (Plan 16c; SPEC §7c). The caller (deleteAllDataAction) has already run requireOwner()
// and re-checked the password; `admin` is the service-role client, the only role allowed to run delete_all_data().
// Order: the database first, in ONE transaction (public.delete_all_data: all or nothing), then the cover images with
// the Storage API (SQL cannot delete Storage objects). Idempotent and resumable: run it again and it finishes the job.
// ponytail: no sync pause flag; a tick that is mid-run can still upload one cover after the wipe (Storage has no foreign
// keys): it shows as "Not linked to an account" in Storage used and the next run removes it. Add a flag if that is ever seen.

/** What the owner types to confirm; the same in every language (checked again on the server). */
export const DELETE_PHRASE = 'DELETE';

export type DeleteError = 'phrase' | 'missing_password' | 'wrong_password' | 'rate_limited' | 'needs_update' | 'unexpected';
export type DeleteState = { ok: true; accounts: number; coversDone: boolean } | { error: DeleteError } | null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The account folders of the covers bucket (every one, also of accounts already deleted); null = could not list. */
async function coverFolders(admin: SupabaseClient): Promise<string[] | null> {
  try {
    const { data, error } = await admin.storage.from(COVERS_BUCKET).list('', { limit: 1000 });
    if (error || !Array.isArray(data)) return null;
    return data.map((f) => f.name).filter((n) => UUID.test(n));
  } catch {
    return null;
  }
}

/**
 * Removes every cover image, folder by folder (the bucket, not the accounts table, is the list: a folder left behind
 * by an earlier, interrupted run or by a sync tick that was mid-upload is found too). true = the bucket is empty now.
 */
export async function removeAllCovers(admin: SupabaseClient): Promise<boolean> {
  const folders = await coverFolders(admin);
  if (!folders) return false;
  for (const f of folders) await removeAccountCovers(admin, f); // never throws
  return (await coverFolders(admin))?.length === 0;
}

export async function deleteAllData(admin: SupabaseClient): Promise<{ ok: true; accounts: number; coversDone: boolean } | { ok: false; error: 'needs_update' | 'unexpected' }> {
  try {
    const { data, error } = await admin.rpc('delete_all_data');
    if (error) return { ok: false, error: error.code === 'PGRST202' ? 'needs_update' : 'unexpected' }; // the transaction rolled back: nothing deleted
    const n = Number((data as { accounts?: unknown } | null)?.accounts);
    return { ok: true, accounts: Number.isFinite(n) ? n : 0, coversDone: await removeAllCovers(admin) };
  } catch {
    return { ok: false, error: 'unexpected' };
  }
}
