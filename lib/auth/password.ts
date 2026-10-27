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

export type CheckResult = 'ok' | 'wrong_password' | 'rate_limited' | 'unexpected';

/**
 * Proves `password` is the owner's on a separate, memory-only client (`checkClient()`: never the cookie session) and
 * revokes that check session at once. Never throws. Used by change password and by "Delete all data" (Plan 16c).
 */
export async function checkPassword(checkClient: () => SupabaseClient, input: { userId: string; email: string | null; password: string }): Promise<CheckResult> {
  if (!input.email) return 'unexpected';
  try {
    const check = checkClient();
    const { data, error } = await check.auth.signInWithPassword({ email: input.email, password: input.password });
    if (error) return isRateLimited(error) ? 'rate_limited' : 'wrong_password';
    const sameUser = data?.user?.id === input.userId;
    await quietSignOut(check, 'local'); // the check session must not linger
    return sameUser ? 'ok' : 'unexpected';
  } catch {
    return 'unexpected';
  }
}

/**
 * Proves the CURRENT password (checkPassword), then updates the owner session's password and signs every OTHER
 * session out (`others` revokes the check session again).
 */
export async function changePassword(session: SupabaseClient, checkClient: () => SupabaseClient, input: ChangeInput): Promise<PasswordResult> {
  if (!input.current) return { ok: false, error: 'missing_fields' };
  const invalid = validate(input.next, input.confirm, input.email);
  if (invalid) return { ok: false, error: invalid };
  if (input.next === input.current) return { ok: false, error: 'same_password' };
  const checked = await checkPassword(checkClient, { userId: input.userId, email: input.email, password: input.current });
  if (checked !== 'ok') return { ok: false, error: checked };
  try {
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
