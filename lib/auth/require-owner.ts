import { redirect } from 'next/navigation';
import { getSessionInfo } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase/server';

/** Server guard for the (app) area: the proxy is the first gate, this is the second. */
export async function requireOwner(): Promise<{ userId: string; email: string | null }> {
  const supabase = await createServerSupabase();
  const info = await getSessionInfo(supabase);
  if (!info.signedIn || !info.userId) redirect('/login');
  if (info.mfaRequired && info.aal !== 'aal2') redirect('/login/verify');
  // one extra RPC per render. A failed check throws (error boundary): redirecting to /login would loop, the proxy
  // bounces signed-in users back to /overview. A definite "not the owner" signs the session out first.
  const { data, error } = await supabase.rpc('is_owner').then((r) => r, () => ({ data: null, error: true }));
  if (error) throw new Error('Owner check failed');
  if (data !== true) redirect('/auth/signout');
  return { userId: info.userId, email: info.email };
}
