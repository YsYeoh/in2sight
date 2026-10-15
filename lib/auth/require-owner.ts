import { cache } from 'react';
import { redirect } from 'next/navigation';
import { getSessionInfo } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase/server';

export interface OwnerContext {
  userId: string;
  email: string | null;
}

/**
 * The owner check itself (uncached; exported for tests). The session lookup and the `is_owner` RPC run in parallel —
 * the RPC needs only the cookie session, and `is_owner()` enforces 2FA in SQL too — but the answers are applied in the
 * fail-closed order: signed out → /login, 2FA owed → /login/verify, RPC failure → throw, not the owner → /auth/signout.
 */
export async function loadOwnerContext(): Promise<OwnerContext> {
  const supabase = await createServerSupabase();
  // A failed check throws (error boundary): redirecting to /login would loop, the proxy bounces signed-in users back
  // to /overview. A definite "not the owner" signs the session out first. A rejected RPC becomes "failed", never "owner".
  const owner = supabase.rpc('is_owner').then(
    (r) => r,
    () => ({ data: null, error: true }),
  );
  const info = await getSessionInfo(supabase);
  if (!info.signedIn || !info.userId) redirect('/login');
  if (info.mfaRequired && info.aal !== 'aal2') redirect('/login/verify');
  const { data, error } = await owner;
  if (error) throw new Error('Owner check failed');
  if (data !== true) redirect('/auth/signout');
  return { userId: info.userId, email: info.email };
}

/**
 * One owner check per request: the (app) layout and the page share it. React.cache is scoped to the current server
 * request (no sharing between requests or users) and caches a rejection too, so every caller in a failing request
 * fails the same way. Outside a render (server actions) there is no cache scope and the check simply runs again.
 */
export const getOwnerContext = cache(loadOwnerContext);

/** Server guard for the (app) area: the proxy is the first gate, this is the second. */
export function requireOwner(): Promise<OwnerContext> {
  return getOwnerContext();
}
