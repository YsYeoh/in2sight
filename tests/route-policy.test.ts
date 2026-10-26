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
  it('can only see /login, /login/forgot and /auth/confirm', () => {
    for (const p of ['/login', '/login/forgot', '/auth/confirm']) expect(d({ pathname: p }), p).toEqual(next);
    for (const p of ['/', '/overview', '/accounts', '/accounts/3', '/settings', '/settings/security', '/tags', '/styleguide', '/setup', '/login/verify', '/login/reset', '/api/export/xlsx']) {
      expect(d({ pathname: p }), p).toEqual(to('/login'));
    }
  });

  it('endpoints that authenticate themselves stay reachable', () => {
    for (const p of ['/api/cron/tick', '/api/instagram/deauthorize', '/api/instagram/delete', '/report/print']) {
      expect(d({ pathname: p }), p).toEqual(next);
    }
  });

  it('look-alike paths are NOT public', () => {
    expect(d({ pathname: '/api/cronjobs' })).toEqual(to('/login'));
    // only the one cron endpoint that exists is exempt, exactly (no suffix, extra segment, slash or case tricks)
    for (const p of ['/api/cron/tick-evil', '/api/cron/tick/x', '/api/cron/ticks', '/api/cron/tick/', '/api/cron/TICK', '/api/cron/sync', '/api/cron', '/api/cron/', '/api/cron/tick%2Fx', '/x/api/cron/tick']) {
      expect(d({ pathname: p }), p).toEqual(to('/login'));
    }
    for (const p of ['/report', '/report/', '/report/print-evil', '/report/print/x', '/report/printx', '/report/print/', '/REPORT/print', '/x/report/print', '/report/print%2Fx']) {
      expect(d({ pathname: p }), p).toEqual(to('/login'));
    }
    expect(d({ pathname: '/api/instagram/callback' })).toEqual(to('/login'));
    expect(d({ pathname: '/login-help' })).toEqual(to('/login'));
    // the Plan 16b exemptions are exact paths too
    for (const p of ['/login/forgot/', '/login/forgot/x', '/login/forgotx', '/login/Forgot', '/auth/confirm/', '/auth/confirm/x', '/auth/confirmed', '/auth/CONFIRM', '/auth', '/auth/', '/x/auth/confirm', '/auth/confirm%2Fx']) {
      expect(d({ pathname: p }), p).toEqual(to('/login'));
    }
    // reset page: never public, plus dot segments, encoded slashes and query-like suffixes
    for (const p of ['/login/reset', '/login/reset/', '/login/resetx', '/login/Reset', '/login/forgot/..', '/login/forgot/.', '/login/./forgot', '/login/forgot%2Fx', '/login%2Fforgot', '/auth/confirm/..', '/auth/confirm/.', '/auth/./confirm', '/auth%2Fconfirm', '/login/forgot?x=1', '/auth/confirm?token_hash=x']) {
      expect(d({ pathname: p }), p).toEqual(to('/login'));
    }
  });
});

describe('signed in, no 2FA enrolled', () => {
  const s = { signedIn: true, aal: 'aal1' as const, mfaRequired: false };
  it('reaches the app', () => {
    for (const p of ['/overview', '/accounts', '/settings', '/styleguide', '/api/export/xlsx']) expect(d({ ...s, pathname: p }), p).toEqual(next);
  });
  it('is bounced off the entry pages to /overview', () => {
    for (const p of ['/', '/login', '/login/verify', '/login/forgot', '/setup']) expect(d({ ...s, pathname: p }), p).toEqual(to('/overview'));
  });
  it('reaches /login/reset and /auth/confirm (the pages check the session themselves)', () => {
    for (const p of ['/login/reset', '/auth/confirm']) expect(d({ ...s, pathname: p }), p).toEqual(next);
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
    expect(d({ ...s, pathname: '/login/forgot' })).toEqual(to('/overview'));
    expect(d({ ...s, pathname: '/login/reset' })).toEqual(next);
    expect(d({ ...s, pathname: '/auth/confirm' })).toEqual(next);
  });
});

describe('recovery session (Plan 16b): aal1 from the emailed link, 2FA enrolled', () => {
  const s = { signedIn: true, aal: 'aal1' as const, mfaRequired: true };
  it('reaches no owner page, API or the reset page: everything goes to /login/verify', () => {
    const owner = ['/', '/overview', '/accounts', '/accounts/3', '/accounts/3/media/1', '/settings', '/settings/security', '/tags', '/calendar', '/explorer', '/report', '/api/export/xlsx', '/api/export/pdf', '/api/accounts/3/followers', '/login', '/login/forgot', '/login/reset', '/setup', '/styleguide'];
    for (const p of owner) expect(d({ ...s, pathname: p }), p).toEqual(to('/login/verify'));
  });
  it('near-miss paths of the exemptions stay behind 2FA', () => {
    for (const p of ['/auth/confirm/x', '/auth/confirm/', '/auth/CONFIRM', '/auth/confirmed', '/login/forgot/x', '/login/resetx', '/login/reset/']) {
      expect(d({ ...s, pathname: p }), p).toEqual(to('/login/verify'));
    }
  });
  it('may only finish 2FA, sign out, or open another recovery link', () => {
    for (const p of ['/login/verify', '/auth/signout', '/auth/confirm']) expect(d({ ...s, pathname: p }), p).toEqual(next);
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
    const paths = ['/', '/login', '/login/verify', '/login/forgot', '/login/reset', '/auth/confirm', '/setup', '/styleguide', '/overview', '/accounts', '/settings', '/tags', '/api/cron/sync', '/auth/signout', '/report', '/report/print'];
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
    const paths = ['/', '/login', '/login/verify', '/login/forgot', '/login/reset', '/auth/confirm', '/setup', '/styleguide', '/overview', '/accounts', '/settings', '/tags', '/auth/signout', '/report', '/report/print'];
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
