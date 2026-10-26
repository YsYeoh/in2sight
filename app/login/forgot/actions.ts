'use server';

import { cookies } from 'next/headers';
import { FORGOT_COOKIE, FORGOT_LIMIT, attemptCookieOptions, bumpAttempts, isLimited, readAttempts } from '@/lib/auth/attempts';
import { isValidEmail, requestPasswordReset, type ForgotState } from '@/lib/auth/recovery';
import { createServerSupabase } from '@/lib/supabase/server';

/** Public (signed out). Same answer for every valid email: the account's existence is never revealed. */
export async function requestResetAction(_prev: ForgotState, formData: FormData): Promise<ForgotState> {
  const store = await cookies();
  const attempts = readAttempts(store.get(FORGOT_COOKIE)?.value, Date.now(), FORGOT_LIMIT);
  if (isLimited(attempts, FORGOT_LIMIT)) return { status: 'cooldown' };
  const email = String(formData.get('email') ?? '');
  if (!isValidEmail(email)) return { error: 'invalid_email' };
  store.set(FORGOT_COOKIE, bumpAttempts(attempts), attemptCookieOptions(FORGOT_LIMIT));
  await requestPasswordReset(await createServerSupabase(), email);
  return { status: 'sent' };
}
