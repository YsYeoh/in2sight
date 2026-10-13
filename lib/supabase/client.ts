import { createBrowserClient } from '@supabase/ssr';
import { getSupabasePublic } from '@/lib/env';

export function createBrowserSupabase() {
  const { url, publishableKey } = getSupabasePublic();
  return createBrowserClient(url, publishableKey);
}
