import type { SupabaseClient } from '@supabase/supabase-js';

export interface SessionInfo {
  signedIn: boolean;
  userId: string | null;
  email: string | null;
  aal: 'aal1' | 'aal2' | null;
  mfaRequired: boolean;
}

const SIGNED_OUT: SessionInfo = { signedIn: false, userId: null, email: null, aal: null, mfaRequired: false };

/** Fails closed: any error means "signed out" / "MFA required". */
export async function getSessionInfo(supabase: SupabaseClient): Promise<SessionInfo> {
  try {
    const { data, error } = await supabase.auth.getClaims();
    const claims = data?.claims as { sub?: string; email?: string; aal?: string } | undefined;
    if (error || !claims?.sub) return SIGNED_OUT;

    const aal = claims.aal === 'aal2' ? 'aal2' : 'aal1';
    let mfaRequired = true;
    if (aal !== 'aal2') {
      // getUser() validates the token server-side. mfa.getAuthenticatorAssuranceLevel() with no argument would read
      // factors from the cookie session, which the JWT signature does not cover (a stripped cookie would skip 2FA).
      const { data: userData, error: userError } = await supabase.auth.getUser();
      mfaRequired = userError || !userData?.user ? true : (userData.user.factors ?? []).some((f) => f.status === 'verified');
    }
    return { signedIn: true, userId: claims.sub, email: claims.email ?? null, aal, mfaRequired };
  } catch {
    return SIGNED_OUT;
  }
}
