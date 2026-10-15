'use server';

// Mark read. OWNER-SESSION client: RLS (notifications_owner_update) plus the column grant (read_at only) apply to
// every write. Never the admin client here.
import { revalidatePath } from 'next/cache';
import { requireOwner } from '@/lib/auth/require-owner';
import { createServerSupabase } from '@/lib/supabase/server';

export type NotificationResult = { ok: true } | { ok: false; error: 'not_found' | 'unexpected' };

async function markRead(id?: number): Promise<NotificationResult> {
  try {
    const db = await createServerSupabase();
    let q = db.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null);
    if (id !== undefined) q = q.eq('id', id);
    const { error } = await q;
    if (error) return { ok: false, error: 'unexpected' };
    revalidatePath('/', 'layout'); // the bell lives in the (app) layout
    return { ok: true };
  } catch {
    return { ok: false, error: 'unexpected' };
  }
}

// Server actions are public endpoints: authorize first (outside try/catch: it redirects by throwing), then validate.
export async function markReadAction(id: number): Promise<NotificationResult> {
  await requireOwner();
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return { ok: false, error: 'not_found' };
  return markRead(id);
}

export async function markAllReadAction(): Promise<NotificationResult> {
  await requireOwner();
  return markRead();
}
