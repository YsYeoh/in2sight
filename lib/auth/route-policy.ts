export interface RouteInput {
  pathname: string;
  configured: boolean;
  signedIn: boolean;
  aal: 'aal1' | 'aal2' | null;
  mfaRequired: boolean;
}
export type RouteDecision = { type: 'next' } | { type: 'redirect'; to: '/login' | '/login/verify' | '/overview' | '/setup' };

const NEXT: RouteDecision = { type: 'next' };
const go = (to: '/login' | '/login/verify' | '/overview' | '/setup'): RouteDecision => ({ type: 'redirect', to });

// Endpoints that authenticate themselves (cron secret / Meta signed_request) and must work without a browser session,
// plus the data-less report shell that headless Chromium prints (it renders only a model injected by the PDF route).
const SELF_AUTHENTICATED = [/^\/api\/cron\/tick$/, /^\/api\/instagram\/(deauthorize|delete)$/, /^\/report\/print$/];
const ENTRY = new Set(['/', '/login', '/login/verify', '/login/forgot', '/setup']);
// Signed-out visitors may see only these exact paths. /auth/confirm turns an emailed recovery token into an aal1
// session (Plan 16b); /login/reset is NOT here: it needs that session AND 2FA (requireOwner + a fresh recovery claim).
const SIGNED_OUT = new Set(['/login', '/login/forgot', '/auth/confirm']);

export function decideRoute({ pathname, configured, signedIn, aal, mfaRequired }: RouteInput): RouteDecision {
  if (!configured) return pathname === '/setup' || pathname === '/styleguide' ? NEXT : go('/setup');
  if (SELF_AUTHENTICATED.some((re) => re.test(pathname))) return NEXT;
  if (!signedIn) return SIGNED_OUT.has(pathname) ? NEXT : go('/login');
  // /auth/signout ends the session of a signed-in non-owner; /auth/confirm may replace any session with a recovery one
  if (pathname === '/auth/signout' || pathname === '/auth/confirm') return NEXT;

  const needsMfa = mfaRequired && aal !== 'aal2';
  if (needsMfa) return pathname === '/login/verify' ? NEXT : go('/login/verify');
  return ENTRY.has(pathname) ? go('/overview') : NEXT;
}
