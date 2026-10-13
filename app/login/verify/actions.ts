'use server';

import { redirect } from 'next/navigation';
import { verifyLogin } from '@/lib/auth/mfa';
import type { FormState } from '@/lib/auth/sign-in';
import { createServerSupabase } from '@/lib/supabase/server';

export async function verifyMfaAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const supabase = await createServerSupabase();
  const r = await verifyLogin(supabase, String(formData.get('code') ?? ''));
  if (!r.ok) return { error: r.error === 'no_factor' ? 'unexpected' : r.error };
  redirect('/overview');
}
