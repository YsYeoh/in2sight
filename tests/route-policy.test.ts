import { describe, expect, it } from 'vitest';
import { decideRoute, type RouteInput } from '@/lib/auth/route-policy';

const base: RouteInput = { pathname: '/overview', configured: true, signedIn: false, aal: null, mfaRequired: false };
const d = (o: Partial<RouteInput>) => decideRoute({ ...base, ...o });
const next = { type: 'next' };
const to = (to: string) => ({ type: 'redirect', to });

describe('not configured (no Supabase env)', () => {
  it('serves only /setup and /styleguide, sends everything else to /setup', () => {
    expect(d({ configured: false, pathname: '/setup' })).toEqual(next);
    expect(d({ configured: false, pathname: '/styleguide' })).toEqual(next);
    expect(d({ configured: false, pathname: '/overview' })).toEqual(to('/setup'));
    expect(d({ configured: false, pathname: '/login' })).toEqual(to('/setup'));
    expect(d({ configured: false, pathname: '/' })).toEqual(to('/setup'));
  });
});

describe('anonymous visitor', () => {
  it('can only see /login', () => {
    expect(d({ pathname: '/login' })).toEqual(next);
    for (const p of ['/', '/overview', '/accounts', '/accounts/3', '/settings', '/tags', '/styleguide', '/setup', '/login/verify', '/api/export/xlsx']) {
      expect(d({ pathname: p }), p).toEqual(to('/login'));
    }
  });

  it('endpoints that authenticate themselves stay reachable', () => {
    for (const p of ['/api/cron/sync', '/api/cron/stories', '/api/instagram/deauthorize', '/api/instagram/delete']) {
      expect(d({ pathname: p }), p).toEqual(next);
    }
  });

  it('look-alike paths are NOT public', () => {
    expect(d({ pathname: '/api/cronjobs' })).toEqual(to('/login'));
    expect(d({ pathname: '/api/instagram/callback' })).toEqual(to('/login'));
    expect(d({ pathname: '/login-help' })).toEqual(to('/login'));
  });
});

describe('signed in, no 2FA enrolled', () => {
  const s = { signedIn: true, aal: 'aal1' as const, mfaRequired: false };
  it('reaches the app', () => {
    for (const p of ['/overview', '/accounts', '/settings', '/styleguide', '/api/export/xlsx']) expect(d({ ...s, pathname: p }), p).toEqual(next);
  });
  it('is bounced off the entry pages to /overview', () => {
    for (const p of ['/', '/login', '/login/verify', '/setup']) expect(d({ ...s, pathname: p }), p).toEqual(to('/overview'));
  });
});

describe('signed in, 2FA enrolled but not yet verified (aal1)', () => {
  const s = { signedIn: true, aal: 'aal1' as const, mfaRequired: true };
  it('can only reach /login/verify — everything else goes there', () => {
    expect(d({ ...s, pathname: '/login/verify' })).toEqual(next);
    for (const p of ['/', '/overview', '/accounts', '/settings', '/login', '/api/export/xlsx', '/styleguide']) {
      expect(d({ ...s, pathname: p }), p).toEqual(to('/login/verify'));
    }
  });
  it('a null assurance level is treated as not verified', () => {
    expect(d({ signedIn: true, aal: null, mfaRequired: true, pathname: '/overview' })).toEqual(to('/login/verify'));
  });
});

describe('signed in, 2FA verified (aal2)', () => {
  const s = { signedIn: true, aal: 'aal2' as const, mfaRequired: true };
  it('reaches the app and is bounced off /login and /login/verify', () => {
    expect(d({ ...s, pathname: '/overview' })).toEqual(next);
    expect(d({ ...s, pathname: '/login' })).toEqual(to('/overview'));
    expect(d({ ...s, pathname: '/login/verify' })).toEqual(to('/overview'));
  });
});

describe('/auth/signout (the way out for a signed-in non-owner)', () => {
  it('is reachable for every signed-in state, including a pending 2FA code', () => {
    for (const aal of ['aal1', 'aal2', null] as const)
      for (const mfaRequired of [true, false]) expect(d({ pathname: '/auth/signout', signedIn: true, aal, mfaRequired })).toEqual(next);
  });
  it('sends a signed-out visitor to /login and an unconfigured app to /setup', () => {
    expect(d({ pathname: '/auth/signout' })).toEqual(to('/login'));
    expect(d({ pathname: '/auth/signout', configured: false })).toEqual(to('/setup'));
  });
});

describe('invariants', () => {
  it('never redirects to the page it is already on (no loops) and only to known destinations', () => {
    const paths = ['/', '/login', '/login/verify', '/setup', '/styleguide', '/overview', '/accounts', '/settings', '/tags', '/api/cron/sync', '/auth/signout'];
    for (const configured of [true, false])
      for (const signedIn of [true, false])
        for (const aal of ['aal1', 'aal2', null] as const)
          for (const mfaRequired of [true, false])
            for (const pathname of paths) {
              const r = decideRoute({ pathname, configured, signedIn, aal, mfaRequired });
              if (r.type === 'redirect') {
                expect(r.to, JSON.stringify({ pathname, configured, signedIn, aal, mfaRequired })).not.toBe(pathname);
                expect(['/login', '/login/verify', '/overview', '/setup']).toContain(r.to);
              }
            }
  });

  it('every redirect target is itself allowed for that visitor (one hop settles)', () => {
    const paths = ['/', '/login', '/login/verify', '/setup', '/styleguide', '/overview', '/accounts', '/settings', '/tags', '/auth/signout'];
    for (const configured of [true, false])
      for (const signedIn of [true, false])
        for (const aal of ['aal1', 'aal2', null] as const)
          for (const mfaRequired of [true, false])
            for (const pathname of paths) {
              const r = decideRoute({ pathname, configured, signedIn, aal, mfaRequired });
              if (r.type === 'redirect') {
                const again = decideRoute({ pathname: r.to, configured, signedIn, aal, mfaRequired });
                expect(again.type, JSON.stringify({ from: pathname, to: r.to, configured, signedIn, aal, mfaRequired })).toBe('next');
              }
            }
  });
});
