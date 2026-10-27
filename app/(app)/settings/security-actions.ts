'use server';

import { cookies } from 'next/headers';
import { PASSWORD_COOKIE, PASSWORD_LIMIT, attemptCookieOptions, bumpAttempts, isLimited, readAttempts } from '@/lib/auth/attempts';
import { checkClient } from '@/lib/auth/check-client';
import { changePassword } from '@/lib/auth/password';
import type { PasswordFormState } from '@/lib/auth/password-rules';
import { requireOwner } from '@/lib/auth/require-owner';
import { createServerSupabase } from '@/lib/supabase/server';

export async function changePasswordAction(_prev: PasswordFormState, formData: FormData): Promise<PasswordFormState> {
  const { userId, email } = await requireOwner(); // server actions are public endpoints: authorize here, not only in the page
  const store = await cookies();
  const attempts = readAttempts(store.get(PASSWORD_COOKIE)?.value, Date.now(), PASSWORD_LIMIT);
  if (isLimited(attempts, PASSWORD_LIMIT)) return { error: 'rate_limited' };
  const r = await changePassword(await createServerSupabase(), checkClient, {
    userId,
    email,
    current: String(formData.get('current') ?? ''),
    next: String(formData.get('password') ?? ''),
    confirm: String(formData.get('confirm') ?? ''),
  });
  if (!r.ok) {
    if (r.error === 'wrong_password') store.set(PASSWORD_COOKIE, bumpAttempts(attempts), attemptCookieOptions(PASSWORD_LIMIT));
    return { error: r.error };
  }
  store.delete(PASSWORD_COOKIE);
  return { ok: true, othersSignedOut: r.othersSignedOut };
}

export async function signOutOthersAction(): Promise<{ ok: boolean }> {
  await requireOwner();
  try {
    const { error } = await (await createServerSupabase()).auth.signOut({ scope: 'others' });
    return { ok: !error };
  } catch {
    return { ok: false };
  }
}
