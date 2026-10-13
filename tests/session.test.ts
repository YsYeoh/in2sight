import { describe, expect, it } from 'vitest';
import { getSessionInfo } from '@/lib/auth/session';

type Claims = { sub?: string; email?: string; aal?: 'aal1' | 'aal2' } | null;

function fake(opts: { claims?: Claims; claimsError?: unknown; next?: 'aal1' | 'aal2'; mfaError?: unknown; throws?: boolean }) {
  const calls = { mfa: 0 };
  const supabase = {
    auth: {
      getClaims: async () => {
        if (opts.throws) throw new Error('network');
        return { data: opts.claims ? { claims: opts.claims } : null, error: opts.claimsError ?? null };
      },
      mfa: {
        getAuthenticatorAssuranceLevel: async () => {
          calls.mfa++;
          return { data: opts.mfaError ? null : { currentLevel: 'aal1', nextLevel: opts.next ?? 'aal1' }, error: opts.mfaError ?? null };
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
    const { supabase, calls } = fake({ claims: { sub: 'u1', email: 'o@x.y', aal: 'aal1' }, next: 'aal1' });
    expect(await getSessionInfo(supabase)).toEqual({ signedIn: true, userId: 'u1', email: 'o@x.y', aal: 'aal1', mfaRequired: false });
    expect(calls.mfa).toBe(1);
  });

  it('aal1 session with a verified factor -> mfaRequired true', async () => {
    const { supabase } = fake({ claims: { sub: 'u1', aal: 'aal1' }, next: 'aal2' });
    expect(await getSessionInfo(supabase)).toMatchObject({ signedIn: true, aal: 'aal1', mfaRequired: true });
  });

  it('aal2 session -> mfaRequired true without an extra network call', async () => {
    const { supabase, calls } = fake({ claims: { sub: 'u1', aal: 'aal2' } });
    expect(await getSessionInfo(supabase)).toMatchObject({ signedIn: true, aal: 'aal2', mfaRequired: true });
    expect(calls.mfa).toBe(0);
  });

  it('fails closed: a claims error or a thrown error means signed out', async () => {
    expect((await getSessionInfo(fake({ claims: null, claimsError: { message: 'bad jwt' } }).supabase)).signedIn).toBe(false);
    expect((await getSessionInfo(fake({ throws: true }).supabase)).signedIn).toBe(false);
  });

  it('fails closed on an MFA lookup error: treat as MFA required so an aal1 session cannot slip through', async () => {
    const { supabase } = fake({ claims: { sub: 'u1', aal: 'aal1' }, mfaError: { message: 'boom' } });
    expect(await getSessionInfo(supabase)).toMatchObject({ signedIn: true, mfaRequired: true });
  });

  it('a missing aal claim is treated as aal1', async () => {
    const { supabase } = fake({ claims: { sub: 'u1' }, next: 'aal2' });
    expect(await getSessionInfo(supabase)).toMatchObject({ aal: 'aal1', mfaRequired: true });
  });
});
