'use server';

import { redirect } from 'next/navigation';
import { signInWithPassword, type FormState } from '@/lib/auth/sign-in';
import { syncPrefsFromProfile } from '@/lib/prefs.sync.server';
import { createServerSupabase } from '@/lib/supabase/server';

export async function signInAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const supabase = await createServerSupabase();
  const result = await signInWithPassword(supabase, {
    email: String(formData.get('email') ?? ''),
    password: String(formData.get('password') ?? ''),
  });
  if (!result.ok) return { error: result.error };
  await syncPrefsFromProfile(supabase);
  redirect('/overview'); // the proxy sends 2FA accounts on to /login/verify
}

export async function signOutAction(): Promise<void> {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();
  redirect('/login');
}
