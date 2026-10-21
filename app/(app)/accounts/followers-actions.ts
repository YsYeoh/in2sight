'use server';

// Follower snapshots are owner-authored data: this action uses the OWNER-SESSION client, so RLS
// (follower_exports_owner_select / _insert / _delete, gated on is_owner()) applies. Never the admin client here. Uploads go through the route
// handler app/api/accounts/[id]/followers (a server action's 1 MB body limit is too small for big accounts).
import { revalidatePath } from 'next/cache';
import { requireOwner } from '@/lib/auth/require-owner';
import { deleteFollowerSnapshot } from '@/lib/followers/read';
import { createServerSupabase } from '@/lib/supabase/server';
import { isUuid } from '@/lib/tags';

export type SnapshotResult = { ok: true } | { ok: false; error: 'notFound' | 'unexpected' };

// Server actions are public endpoints: authorize first (outside try/catch: it redirects by throwing), then validate.
export async function deleteFollowerSnapshotAction(accountId: string, snapshotId: string): Promise<SnapshotResult> {
  await requireOwner();
  if (!isUuid(accountId) || !isUuid(snapshotId)) return { ok: false, error: 'notFound' };
  try {
    const db = await createServerSupabase();
    if (!(await deleteFollowerSnapshot(db, accountId.toLowerCase(), snapshotId.toLowerCase()))) return { ok: false, error: 'notFound' };
    revalidatePath('/accounts/[id]', 'page');
    return { ok: true };
  } catch {
    return { ok: false, error: 'unexpected' };
  }
}
