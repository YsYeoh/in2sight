import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { decideRoute } from '@/lib/auth/route-policy';
import { getSessionInfo } from '@/lib/auth/session';
import { getSupabasePublic, isSupabaseConfigured } from '@/lib/env';
import { serverTiming, timed, type Span } from '@/lib/server-timing';

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  let cacheHeaders: Record<string, string> = {};

  const redirectTo = (to: string, from?: NextResponse) => {
    const res = NextResponse.redirect(new URL(to, request.url));
    // keep refreshed session cookies and their no-store headers on the redirect
    from?.cookies.getAll().forEach((c) => res.cookies.set(c));
    Object.entries(cacheHeaders).forEach(([key, value]) => res.headers.set(key, value));
    return res;
  };

  if (!isSupabaseConfigured()) {
    const d = decideRoute({ pathname, configured: false, signedIn: false, aal: null, mfaRequired: false });
    return d.type === 'redirect' ? redirectTo(d.to) : NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });
  const { url, publishableKey } = getSupabasePublic();
  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(list, headers) {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        // a response carrying a session cookie must never be cached
        cacheHeaders = { ...cacheHeaders, ...headers };
        Object.entries(cacheHeaders).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  // Server-Timing: how long the proxy's session check took (names + durations only; docs/RUNBOOK_PERF.md)
  const started = performance.now();
  const spans: Span[] = [];
  const info = await timed(spans, 'auth', () => getSessionInfo(supabase));
  const d = decideRoute({ pathname, configured: true, signedIn: info.signedIn, aal: info.aal, mfaRequired: info.mfaRequired });
  const res = d.type === 'redirect' ? redirectTo(d.to, response) : response;
  res.headers.set('Server-Timing', serverTiming([...spans, { name: 'proxy', dur: performance.now() - started }]));
  return res;
}
