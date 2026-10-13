import { redirect } from 'next/navigation';
import { getSessionInfo } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase/server';

/** Server guard for the (app) area: the proxy is the first gate, this is the second. */
export async function requireOwner(): Promise<{ userId: string; email: string | null }> {
  const supabase = await createServerSupabase();
  const info = await getSessionInfo(supabase);
  if (!info.signedIn || !info.userId) redirect('/login');
  if (info.mfaRequired && info.aal !== 'aal2') redirect('/login/verify');
  // one extra RPC per render; fails closed (error, throw or anything but true -> /login)
  const isOwner = await supabase.rpc('is_owner').then(({ data, error }) => !error && data === true, () => false);
  if (!isOwner) redirect('/login');
  return { userId: info.userId, email: info.email };
}
