import { createClient } from '@supabase/supabase-js';
import { getSupabaseSecretKey, getSupabaseUrl } from '@/lib/env';

/** Secret-key client: bypasses row-level security. SERVER ONLY. */
export function createAdminSupabase() {
  if (typeof window !== 'undefined') throw new Error('createAdminSupabase must never run in the browser');
  return createClient(getSupabaseUrl(), getSupabaseSecretKey(), { auth: { persistSession: false, autoRefreshToken: false } });
}
