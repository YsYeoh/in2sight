import type { SupabaseClient } from '@supabase/supabase-js';

type VerifyError = 'invalid_code' | 'rate_limited' | 'unexpected';

export function normalizeCode(raw: string): string | null {
  const digits = raw.replace(/[\s-]/g, '');
  return /^[0-9]{6}$/.test(digits) ? digits : null;
}

// Supabase throttles repeated attempts with a 429 / *rate_limit code; show that, not "wrong code"
function isRateLimited(e: { status?: number; code?: string }): boolean {
  return e.status === 429 || (e.code ?? '').includes('rate_limit');
}

// aal from the signed JWT claims (validated), not the cookie session; any error means "not aal2" (fail closed)
async function isAal2(supabase: SupabaseClient): Promise<boolean> {
  try {
    const { data, error } = await supabase.auth.getClaims();
    return !error && (data?.claims as { aal?: string } | undefined)?.aal === 'aal2';
  } catch {
    return false;
  }
}

async function verifyCode(supabase: SupabaseClient, factorId: string, code: string): Promise<{ ok: true } | { ok: false; error: VerifyError }> {
  try {
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    if (!error) return { ok: true };
    return { ok: false, error: isRateLimited(error) ? 'rate_limited' : 'invalid_code' };
  } catch {
    return { ok: false, error: 'unexpected' };
  }
}

export async function startEnroll(
  supabase: SupabaseClient,
): Promise<{ ok: true; factorId: string; qrSvg: string; secret: string } | { ok: false; error: 'unexpected' | 'needs_aal2' }> {
  try {
    const { data: existing, error: listError } = await supabase.auth.mfa.listFactors();
    if (listError || !existing) return { ok: false, error: 'unexpected' };
    // a password-only session must not add a factor to an account that already has 2FA: it could then reach aal2 itself
    if (existing.totp.length > 0 && !(await isAal2(supabase))) return { ok: false, error: 'needs_aal2' };
    // an abandoned, never-verified enrolment would block a new one with the same name
    for (const f of existing.all) {
      if (f.status === 'unverified') await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'in2sight' });
    if (error || !data) return { ok: false, error: 'unexpected' };
    return { ok: true, factorId: data.id, qrSvg: data.totp.qr_code, secret: data.totp.secret };
  } catch {
    return { ok: false, error: 'unexpected' };
  }
}

export async function confirmEnroll(supabase: SupabaseClient, input: { factorId: string; code: string }): Promise<{ ok: true } | { ok: false; error: VerifyError }> {
  const code = normalizeCode(input.code);
  if (!code) return { ok: false, error: 'invalid_code' };
  return verifyCode(supabase, input.factorId, code);
}

export async function verifyLogin(supabase: SupabaseClient, rawCode: string): Promise<{ ok: true } | { ok: false; error: VerifyError | 'no_factor' }> {
  const code = normalizeCode(rawCode);
  let factorId: string | undefined;
  try {
    const { data } = await supabase.auth.mfa.listFactors();
    factorId = data?.totp?.[0]?.id;
  } catch {
    return { ok: false, error: 'unexpected' };
  }
  if (!factorId) return { ok: false, error: 'no_factor' };
  if (!code) return { ok: false, error: 'invalid_code' };
  return verifyCode(supabase, factorId, code);
}

export async function getMfaStatus(supabase: SupabaseClient): Promise<{ enrolled: boolean; factorId: string | null }> {
  try {
    const { data } = await supabase.auth.mfa.listFactors();
    const factor = data?.totp?.[0];
    return factor ? { enrolled: true, factorId: factor.id } : { enrolled: false, factorId: null };
  } catch {
    return { enrolled: false, factorId: null };
  }
}

export async function disableFactor(supabase: SupabaseClient, factorId: string): Promise<{ ok: true } | { ok: false; error: 'needs_aal2' | 'unexpected' }> {
  try {
    if (!(await isAal2(supabase))) return { ok: false, error: 'needs_aal2' };
    const { error } = await supabase.auth.mfa.unenroll({ factorId });
    return error ? { ok: false, error: 'unexpected' } : { ok: true };
  } catch {
    return { ok: false, error: 'unexpected' };
  }
}
