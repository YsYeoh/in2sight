import type { SupabaseClient } from '@supabase/supabase-js';

// Forgot / reset password (Plan 16b). Nothing here ever tells the caller whether an account exists.
export const RESET_MIN_MS = 2000; // every reset request takes at least this long (no timing oracle)
export const RECOVERY_WINDOW_SEC = 900; // how long after opening the link the new password may be set
const EMAIL_PROOF = new Set(['recovery', 'otp', 'magiclink']); // amr methods that mean "proved access to the inbox"

export type ForgotState = { status?: 'sent' | 'cooldown'; error?: 'invalid_email' };
export type ConfirmState = { error?: 'link_invalid' };

export function isValidEmail(raw: string): boolean {
  const email = raw.trim();
  return email.length >= 3 && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export const isTokenHash = (raw: string): boolean => /^[A-Za-z0-9_-]{16,256}$/.test(raw);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Always resolves, never reveals the outcome, never takes less than RESET_MIN_MS. */
export async function requestPasswordReset(supabase: SupabaseClient, email: string, wait: (ms: number) => Promise<void> = sleep, now: () => number = Date.now): Promise<void> {
  const started = now();
  try {
    // no redirect option: the email template builds the link from the Site URL (docs/RUNBOOK_SECURITY.md §0)
    await supabase.auth.resetPasswordForEmail(email.trim());
  } catch {
    // swallowed on purpose: the answer must not depend on the outcome
  }
  const left = RESET_MIN_MS - (now() - started);
  if (left > 0) await wait(left);
}

/** Exchanges the emailed token hash for a (aal1) recovery session in the cookies. */
export async function confirmRecovery(supabase: SupabaseClient, tokenHash: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.auth.verifyOtp({ type: 'recovery', token_hash: tokenHash });
    return !error && !!data?.session;
  } catch {
    return false;
  }
}

/** True when the verified JWT says this session proved access to the owner's inbox in the last RECOVERY_WINDOW_SEC. */
export function hasRecentEmailProof(claims: unknown, nowSec: number): boolean {
  const amr = (claims as { amr?: unknown } | null | undefined)?.amr;
  if (!Array.isArray(amr)) return false;
  return amr.some((entry) => {
    const e = entry as { method?: unknown; timestamp?: unknown } | null;
    if (!e || typeof e !== 'object' || typeof e.method !== 'string' || typeof e.timestamp !== 'number') return false;
    const age = nowSec - e.timestamp;
    return EMAIL_PROOF.has(e.method) && age >= -60 && age <= RECOVERY_WINDOW_SEC; // 60 s of clock skew allowed
  });
}

/** Reads the claims through getClaims (signature-checked); any error means "no proof" (fail closed). */
export async function hasRecoveryProof(supabase: SupabaseClient, nowSec: number = Math.floor(Date.now() / 1000)): Promise<boolean> {
  try {
    const { data, error } = await supabase.auth.getClaims();
    return !error && hasRecentEmailProof(data?.claims, nowSec);
  } catch {
    return false;
  }
}
