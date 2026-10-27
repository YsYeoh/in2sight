import { createClient } from '@supabase/supabase-js';
import { getSupabasePublic } from '@/lib/env';

/**
 * A memory-only client for re-checking the owner's password (change password, delete all data): no cookies, no
 * refresh, nothing written to the browser, never the owner's session. Callers sign it out at once (checkPassword).
 */
export function checkClient() {
  const { url, publishableKey } = getSupabasePublic();
  return createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}
