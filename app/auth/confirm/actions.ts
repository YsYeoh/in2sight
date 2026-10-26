'use server';

import { redirect } from 'next/navigation';
import { confirmRecovery, isTokenHash, type ConfirmState } from '@/lib/auth/recovery';
import { createServerSupabase } from '@/lib/supabase/server';

/** Public. Turns the emailed token hash into an aal1 recovery session; the target is FIXED (no `next` parameter). */
export async function confirmRecoveryAction(_prev: ConfirmState, formData: FormData): Promise<ConfirmState> {
  const tokenHash = String(formData.get('token_hash') ?? '');
  if (!isTokenHash(tokenHash)) return { error: 'link_invalid' };
  if (!(await confirmRecovery(await createServerSupabase(), tokenHash))) return { error: 'link_invalid' };
  redirect('/login/reset'); // the proxy sends a 2FA account to /login/verify first
}
