import { createBrowserClient } from '@supabase/ssr';
import { getPublicEnv } from '@/lib/env';

export function createBrowserSupabase() {
  const { supabaseUrl, publishableKey } = getPublicEnv();
  return createBrowserClient(supabaseUrl, publishableKey);
}
