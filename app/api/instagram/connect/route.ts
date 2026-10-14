import { NextResponse, type NextRequest } from 'next/server';
import { normalizeGroup } from '@/lib/accounts/group';
import { assertOwner } from '@/lib/auth/assert-owner';
import { EnvError, getInstagramEnv } from '@/lib/env';
import { buildAuthorizeUrl } from '@/lib/instagram/oauth';
import { STATE_COOKIE, STATE_MAX_AGE_SECONDS, newOAuthState } from '@/lib/instagram/state';

export async function GET(request: NextRequest) {
  // the no-store headers Supabase hands over land in h and must reach whatever we return (see createServerSupabase)
  const h = new Headers();
  const done = (res: NextResponse) => {
    h.forEach((v, k) => res.headers.set(k, v));
    return res;
  };
  if (!(await assertOwner(h))) return done(NextResponse.json({ error: 'unauthorized' }, { status: 401 }));
  let cfg;
  try {
    cfg = getInstagramEnv();
  } catch (e) {
    if (e instanceof EnvError) return done(NextResponse.redirect(new URL('/accounts?error=not_configured', request.url)));
    throw e;
  }
  const g = normalizeGroup(request.nextUrl.searchParams.get('group'));
  const { state, cookie } = newOAuthState(g.ok ? g.value : null);
  const res = NextResponse.redirect(buildAuthorizeUrl(cfg, state));
  res.cookies.set(STATE_COOKIE, cookie, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/api/instagram', maxAge: STATE_MAX_AGE_SECONDS });
  return done(res);
}
