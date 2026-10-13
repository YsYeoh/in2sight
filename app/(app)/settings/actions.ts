'use server';

import { revalidatePath } from 'next/cache';
import { confirmEnroll, disableFactor, startEnroll } from '@/lib/auth/mfa';
import { createServerSupabase } from '@/lib/supabase/server';

export async function startEnrollAction() {
  const r = await startEnroll(await createServerSupabase());
  return r.ok ? r : ({ ok: false, error: r.error } as const);
}

export async function confirmEnrollAction(factorId: string, code: string) {
  const r = await confirmEnroll(await createServerSupabase(), { factorId: String(factorId), code: String(code) });
  if (r.ok) revalidatePath('/settings');
  return r.ok ? ({ ok: true } as const) : ({ ok: false, error: r.error } as const);
}

export async function disableAction(factorId: string) {
  const r = await disableFactor(await createServerSupabase(), String(factorId));
  if (r.ok) revalidatePath('/settings');
  return r.ok ? ({ ok: true } as const) : ({ ok: false, error: r.error } as const);
}
