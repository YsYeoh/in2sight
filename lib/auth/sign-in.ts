import type { SupabaseClient } from '@supabase/supabase-js';

export type SignInError = 'missing_fields' | 'invalid_credentials' | 'not_owner' | 'unexpected';
export type FormState = { error?: SignInError | 'invalid_code' };
export type SignInResult = { ok: true } | { ok: false; error: SignInError };

// best-effort: a failed sign-out must never change the error the user sees
async function safeSignOut(supabase: SupabaseClient) {
  try {
    await supabase.auth.signOut();
  } catch {}
}

export async function signInWithPassword(supabase: SupabaseClient, input: { email: string; password: string }): Promise<SignInResult> {
  const email = input.email.trim();
  if (!email || !input.password) return { ok: false, error: 'missing_fields' };
  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password: input.password });
    if (error) return { ok: false, error: 'invalid_credentials' }; // same answer for every failure: no user enumeration

    const { data: isOwner, error: rpcError } = await supabase.rpc('claim_ownership');
    if (rpcError) {
      await safeSignOut(supabase);
      return { ok: false, error: 'unexpected' };
    }
    if (isOwner !== true) {
      await safeSignOut(supabase);
      return { ok: false, error: 'not_owner' };
    }
    return { ok: true };
  } catch {
    await safeSignOut(supabase);
    return { ok: false, error: 'unexpected' };
  }
}
