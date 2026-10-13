import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getPublicEnv } from '@/lib/env';

/** One client per request: it needs that request's cookies. */
export async function createServerSupabase() {
  const { supabaseUrl, publishableKey } = getPublicEnv();
  const store = await cookies();
  return createServerClient(supabaseUrl, publishableKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(list) {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // called from a Server Component: the proxy refreshes the session instead
        }
      },
    },
  });
}
