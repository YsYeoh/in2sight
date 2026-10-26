'use server';

import { redirect } from 'next/navigation';
import { verifyLogin } from '@/lib/auth/mfa';
import { hasRecoveryProof } from '@/lib/auth/recovery';
import type { FormState } from '@/lib/auth/sign-in';
import { syncPrefsFromProfile } from '@/lib/prefs.sync.server';
import { createServerSupabase } from '@/lib/supabase/server';

export async function verifyMfaAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const supabase = await createServerSupabase();
  const r = await verifyLogin(supabase, String(formData.get('code') ?? ''));
  if (!r.ok) return { error: r.error === 'no_factor' ? 'unexpected' : r.error };
  await syncPrefsFromProfile(supabase); // at aal2 now, so RLS lets us read the profile (signInAction ran at aal1)
  // a session that came from a recovery link continues to the new-password page (fixed path, never a parameter)
  redirect((await hasRecoveryProof(supabase)) ? '/login/reset' : '/overview');
}
