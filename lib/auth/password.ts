import type { SupabaseClient } from '@supabase/supabase-js';
import { isRateLimited } from '@/lib/auth/mfa';
import { passwordStrength, type PasswordError } from '@/lib/auth/password-rules';
import { hasRecoveryProof } from '@/lib/auth/recovery';

// Change password (Settings → Security) and set a new password after a recovery link (Plan 16b).
// Callers have already run requireOwner() (aal2 + owner). Results are error KEYS only: no Supabase text, no password, ever.
export type PasswordResult = { ok: true; othersSignedOut: boolean } | { ok: false; error: PasswordError };

function validate(next: string, confirm: string, email: string | null): PasswordError | null {
  if (!next || !confirm) return 'missing_fields';
  if (next !== confirm) return 'mismatch';
  return passwordStrength(next, email).issue ? 'weak' : null;
}

function updateError(e: { status?: number; code?: string }): PasswordError {
  if (e.code === 'same_password') return 'same_password';
  if (e.code === 'weak_password') return 'weak';
  return isRateLimited(e) ? 'rate_limited' : 'unexpected';
}

async function quietSignOut(client: SupabaseClient, scope: 'local' | 'others' | 'global'): Promise<boolean> {
  try {
    const { error } = await client.auth.signOut({ scope });
    return !error;
  } catch {
    return false;
  }
}

export interface ChangeInput {
  userId: string;
  email: string | null;
  current: string;
  next: string;
  confirm: string;
}

/**
 * Proves the CURRENT password on a separate, memory-only client (`checkClient()`: never the cookie session), revokes
 * that check session at once, then updates the owner session's password and signs every OTHER session out.
 */
export async function changePassword(session: SupabaseClient, checkClient: () => SupabaseClient, input: ChangeInput): Promise<PasswordResult> {
  if (!input.current) return { ok: false, error: 'missing_fields' };
  const invalid = validate(input.next, input.confirm, input.email);
  if (invalid) return { ok: false, error: invalid };
  if (input.next === input.current) return { ok: false, error: 'same_password' };
  if (!input.email) return { ok: false, error: 'unexpected' };
  try {
    const check = checkClient();
    const { data, error } = await check.auth.signInWithPassword({ email: input.email, password: input.current });
    if (error) return { ok: false, error: isRateLimited(error) ? 'rate_limited' : 'wrong_password' };
    const sameUser = data?.user?.id === input.userId;
    await quietSignOut(check, 'local'); // the check session must not linger (`others` below revokes it again)
    if (!sameUser) return { ok: false, error: 'unexpected' };

    const { error: updateErr } = await session.auth.updateUser({ password: input.next });
    if (updateErr) return { ok: false, error: updateError(updateErr) };
    return { ok: true, othersSignedOut: await quietSignOut(session, 'others') };
  } catch {
    return { ok: false, error: 'unexpected' };
  }
}

/**
 * The reset page's save: needs a session that proved the inbox in the last 15 minutes (the recovery claim, checked
 * again here, not only on the page), then signs out EVERY session, this one included: the owner signs in afresh.
 */
export async function setNewPassword(session: SupabaseClient, input: { email: string | null; next: string; confirm: string }, nowSec?: number): Promise<PasswordResult> {
  if (!(await hasRecoveryProof(session, nowSec))) return { ok: false, error: 'link_expired' };
  const invalid = validate(input.next, input.confirm, input.email);
  if (invalid) return { ok: false, error: invalid };
  try {
    const { error } = await session.auth.updateUser({ password: input.next });
    if (error) return { ok: false, error: updateError(error) };
    return { ok: true, othersSignedOut: await quietSignOut(session, 'global') };
  } catch {
    return { ok: false, error: 'unexpected' };
  }
}
