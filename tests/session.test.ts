import { describe, expect, it } from 'vitest';
import { getSessionInfo } from '@/lib/auth/session';

type Claims = { sub?: string; email?: string; aal?: 'aal1' | 'aal2' } | null;

type Factors = { status: 'verified' | 'unverified' }[];

// getUser() is the server-validated source of factors. The cookie-derived getAuthenticatorAssuranceLevel() (which
// trusts session.user.factors from the unsigned cookie) always reports 'no factors' here, to prove it is not relied on.
function fake(opts: { claims?: Claims; claimsError?: unknown; factors?: Factors; userError?: unknown; userNull?: boolean; throws?: boolean }) {
  const calls = { getUser: 0, cookieAal: 0 };
  const supabase = {
    auth: {
      getClaims: async () => {
        if (opts.throws) throw new Error('network');
        return { data: opts.claims ? { claims: opts.claims } : null, error: opts.claimsError ?? null };
      },
      getUser: async () => {
        calls.getUser++;
        if (opts.userError) return { data: { user: null }, error: opts.userError };
        if (opts.userNull) return { data: null, error: null };
        return { data: { user: { id: 'u1', factors: opts.factors } }, error: null };
      },
      mfa: {
        getAuthenticatorAssuranceLevel: async () => {
          calls.cookieAal++;
          return { data: { currentLevel: 'aal1', nextLevel: 'aal1' }, error: null };
        },
      },
    },
  };
  return { supabase: supabase as never, calls };
}

describe('getSessionInfo', () => {
  it('no claims -> signed out', async () => {
    const { supabase } = fake({ claims: null });
    expect(await getSessionInfo(supabase)).toEqual({ signedIn: false, userId: null, email: null, aal: null, mfaRequired: false });
  });

  it('claims without a subject are not a session', async () => {
    const { supabase } = fake({ claims: { email: 'a@b.c' } });
    expect((await getSessionInfo(supabase)).signedIn).toBe(false);
  });

  it('aal1 session, no factor enrolled -> mfaRequired false', async () => {
    const { supabase, calls } = fake({ claims: { sub: 'u1', email: 'o@x.y', aal: 'aal1' }, factors: [] });
    expect(await getSessionInfo(supabase)).toEqual({ signedIn: true, userId: 'u1', email: 'o@x.y', aal: 'aal1', mfaRequired: false });
    expect(calls.getUser).toBe(1);
  });

  it('aal1 session with a verified factor -> mfaRequired true', async () => {
    const { supabase } = fake({ claims: { sub: 'u1', aal: 'aal1' }, factors: [{ status: 'verified' }] });
    expect(await getSessionInfo(supabase)).toMatchObject({ signedIn: true, aal: 'aal1', mfaRequired: true });
  });

  it('aal2 session -> mfaRequired true without an extra network call', async () => {
    const { supabase, calls } = fake({ claims: { sub: 'u1', aal: 'aal2' } });
    expect(await getSessionInfo(supabase)).toMatchObject({ signedIn: true, aal: 'aal2', mfaRequired: true });
    expect(calls.getUser).toBe(0);
  });

  it('fails closed: a claims error or a thrown error means signed out', async () => {
    expect((await getSessionInfo(fake({ claims: null, claimsError: { message: 'bad jwt' } }).supabase)).signedIn).toBe(false);
    expect((await getSessionInfo(fake({ throws: true }).supabase)).signedIn).toBe(false);
  });

  it('an unverified factor does not require MFA', async () => {
    const { supabase } = fake({ claims: { sub: 'u1', aal: 'aal1' }, factors: [{ status: 'unverified' }] });
    expect(await getSessionInfo(supabase)).toMatchObject({ signedIn: true, mfaRequired: false });
  });

  it('never relies on cookie-derived factors: the server-validated user decides', async () => {
    const { supabase, calls } = fake({ claims: { sub: 'u1', aal: 'aal1' }, factors: [{ status: 'verified' }] });
    expect(await getSessionInfo(supabase)).toMatchObject({ mfaRequired: true });
    expect(calls.cookieAal).toBe(0);
  });

  it('fails closed on a user lookup error: treat as MFA required so an aal1 session cannot slip through', async () => {
    const { supabase } = fake({ claims: { sub: 'u1', aal: 'aal1' }, userError: { message: 'boom' } });
    expect(await getSessionInfo(supabase)).toMatchObject({ signedIn: true, mfaRequired: true });
  });

  it('fails closed when the user lookup returns no data and no error', async () => {
    const { supabase } = fake({ claims: { sub: 'u1', aal: 'aal1' }, userNull: true });
    expect(await getSessionInfo(supabase)).toMatchObject({ signedIn: true, mfaRequired: true });
  });

  it('a missing aal claim is treated as aal1', async () => {
    const { supabase } = fake({ claims: { sub: 'u1' }, factors: [{ status: 'verified' }] });
    expect(await getSessionInfo(supabase)).toMatchObject({ aal: 'aal1', mfaRequired: true });
  });
});
