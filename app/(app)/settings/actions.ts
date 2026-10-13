'use server';

import { revalidatePath } from 'next/cache';
import { confirmEnroll, disableFactor, startEnroll } from '@/lib/auth/mfa';
import { requireOwner } from '@/lib/auth/require-owner';
import { createServerSupabase } from '@/lib/supabase/server';

export async function startEnrollAction() {
  await requireOwner(); // server actions are public endpoints: authorize here, not only in the page
  const r = await startEnroll(await createServerSupabase());
  return r.ok ? r : ({ ok: false, error: r.error } as const);
}

export async function confirmEnrollAction(factorId: string, code: string) {
  await requireOwner(); // server actions are public endpoints: authorize here, not only in the page
  const r = await confirmEnroll(await createServerSupabase(), { factorId: String(factorId), code: String(code) });
  if (r.ok) revalidatePath('/settings');
  return r.ok ? ({ ok: true } as const) : ({ ok: false, error: r.error } as const);
}

export async function disableAction(factorId: string) {
  await requireOwner(); // server actions are public endpoints: authorize here, not only in the page
  const r = await disableFactor(await createServerSupabase(), String(factorId));
  if (r.ok) revalidatePath('/settings');
  return r.ok ? ({ ok: true } as const) : ({ ok: false, error: r.error } as const);
}
