import { getSessionInfo } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase/server';

/**
 * Route-handler owner check: true only for the signed-in owner who has completed 2FA when enrolled.
 * Fails closed and never redirects. Pass the headers of the Response you will return (see createServerSupabase).
 */
export async function assertOwner(responseHeaders?: Headers): Promise<boolean> {
  try {
    const supabase = await createServerSupabase({ responseHeaders });
    const info = await getSessionInfo(supabase);
    if (!info.signedIn || (info.mfaRequired && info.aal !== 'aal2')) return false;
    const { data, error } = await supabase.rpc('is_owner');
    return !error && data === true;
  } catch {
    return false;
  }
}
