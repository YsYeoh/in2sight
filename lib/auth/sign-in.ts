import type { SupabaseClient } from '@supabase/supabase-js';

export type SignInError = 'missing_fields' | 'invalid_credentials' | 'not_owner' | 'unexpected';
export type FormState = { error?: SignInError | 'invalid_code' };
export type SignInResult = { ok: true } | { ok: false; error: SignInError };

export async function signInWithPassword(supabase: SupabaseClient, input: { email: string; password: string }): Promise<SignInResult> {
  const email = input.email.trim();
  if (!email || !input.password) return { ok: false, error: 'missing_fields' };
  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password: input.password });
    if (error) return { ok: false, error: 'invalid_credentials' }; // same answer for every failure: no user enumeration

    const { data: isOwner, error: rpcError } = await supabase.rpc('claim_ownership');
    if (rpcError) {
      await supabase.auth.signOut();
      return { ok: false, error: 'unexpected' };
    }
    if (isOwner !== true) {
      await supabase.auth.signOut();
      return { ok: false, error: 'not_owner' };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'unexpected' };
  }
}
