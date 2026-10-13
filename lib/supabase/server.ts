import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getSupabasePublic } from '@/lib/env';

/**
 * One client per request: it needs that request's cookies.
 * Route handlers that return their own Response should pass its headers so a session cookie is never cached.
 */
export async function createServerSupabase({ responseHeaders }: { responseHeaders?: Headers } = {}) {
  const { url, publishableKey } = getSupabasePublic();
  const store = await cookies();
  return createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(list, headers) {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
          // a response carrying a session cookie must never be cached
          Object.entries(headers ?? {}).forEach(([key, value]) => responseHeaders?.set(key, value));
        } catch {
          // called from a Server Component: the proxy refreshes the session instead
        }
      },
    },
  });
}
