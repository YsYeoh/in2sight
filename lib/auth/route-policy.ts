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

// Endpoints that authenticate themselves (cron secret / Meta signed_request) and must work without a browser session.
const SELF_AUTHENTICATED = [/^\/api\/cron\/[\w-]+$/, /^\/api\/instagram\/(deauthorize|delete)$/];
const ENTRY = new Set(['/', '/login', '/login/verify', '/setup']);

export function decideRoute({ pathname, configured, signedIn, aal, mfaRequired }: RouteInput): RouteDecision {
  if (!configured) return pathname === '/setup' || pathname === '/styleguide' ? NEXT : go('/setup');
  if (SELF_AUTHENTICATED.some((re) => re.test(pathname))) return NEXT;
  if (!signedIn) return pathname === '/login' ? NEXT : go('/login');
  if (pathname === '/auth/signout') return NEXT; // ends the session of a signed-in non-owner, whatever their 2FA state

  const needsMfa = mfaRequired && aal !== 'aal2';
  if (needsMfa) return pathname === '/login/verify' ? NEXT : go('/login/verify');
  return ENTRY.has(pathname) ? go('/overview') : NEXT;
}
