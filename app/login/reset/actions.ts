'use server';

import { redirect } from 'next/navigation';
import { requireOwner } from '@/lib/auth/require-owner';
import { setNewPassword } from '@/lib/auth/password';
import type { PasswordFormState } from '@/lib/auth/password-rules';
import { createServerSupabase } from '@/lib/supabase/server';

/** Owner at aal2 (requireOwner) AND a fresh recovery claim (setNewPassword checks it again). Signs out everywhere. */
export async function resetPasswordAction(_prev: PasswordFormState, formData: FormData): Promise<PasswordFormState> {
  const { email } = await requireOwner();
  const r = await setNewPassword(await createServerSupabase(), {
    email,
    next: String(formData.get('password') ?? ''),
    confirm: String(formData.get('confirm') ?? ''),
  });
  if (!r.ok) return { error: r.error };
  redirect('/login?reset=done');
}
