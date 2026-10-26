// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { changePassword, setNewPassword } from '@/lib/auth/password';

const NOW = 1_800_000_000;
const GOOD = 'Correct horse battery 9';
const calls: string[] = [];

function fakes(o: { checkError?: unknown; checkUserId?: string; checkThrows?: boolean; updateError?: unknown; othersError?: unknown; amr?: unknown } = {}) {
  const check = {
    auth: {
      signInWithPassword: vi.fn(async (credentials: unknown) => {
        calls.push('check.signIn');
        void credentials;
        if (o.checkThrows) throw new Error('network');
        return o.checkError ? { data: { user: null, session: null }, error: o.checkError } : { data: { user: { id: o.checkUserId ?? 'owner-1' }, session: {} }, error: null };
      }),
      signOut: vi.fn(async (a: { scope: string }) => (calls.push(`check.signOut:${a.scope}`), { error: null })),
    },
  };
  const session = {
    auth: {
      updateUser: vi.fn(async (attrs: unknown) => (calls.push('updateUser'), void attrs, { data: { user: {} }, error: o.updateError ?? null })),
      signOut: vi.fn(async (a: { scope: string }) => (calls.push(`signOut:${a.scope}`), { error: o.othersError ?? null })),
      getClaims: vi.fn(async () => ({ data: { claims: { amr: 'amr' in o ? o.amr : [{ method: 'recovery', timestamp: NOW - 60 }] } }, error: null })),
    },
  };
  const checkClient = vi.fn(() => check as never);
  return { check, session, checkClient };
}

const input = (o: Partial<{ current: string; next: string; confirm: string; email: string | null; userId: string }> = {}) => ({
  userId: 'owner-1',
  email: 'owner@example.com',
  current: 'old password that is long',
  next: GOOD,
  confirm: GOOD,
  ...o,
});

beforeEach(() => {
  calls.length = 0;
});

describe('changePassword', () => {
  it('checks the current password on the separate client with the SESSION email, revokes it, updates, then signs out the others', async () => {
    const f = fakes();
    expect(await changePassword(f.session as never, f.checkClient, input())).toEqual({ ok: true, othersSignedOut: true });
    expect(f.check.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'owner@example.com', password: 'old password that is long' });
    expect(f.session.auth.updateUser).toHaveBeenCalledWith({ password: GOOD });
    expect(calls).toEqual(['check.signIn', 'check.signOut:local', 'updateUser', 'signOut:others']);
  });

  it('validates before any network call', async () => {
    const cases: [Parameters<typeof input>[0], string][] = [
      [{ current: '' }, 'missing_fields'],
      [{ next: '' }, 'missing_fields'],
      [{ confirm: '' }, 'missing_fields'],
      [{ confirm: GOOD + 'x' }, 'mismatch'],
      [{ next: 'short', confirm: 'short' }, 'weak'],
      [{ next: 'owner-is-me-forever', confirm: 'owner-is-me-forever' }, 'weak'], // contains the email name
      [{ current: GOOD }, 'same_password'],
      [{ email: null }, 'unexpected'],
    ];
    for (const [o, error] of cases) {
      const f = fakes();
      expect(await changePassword(f.session as never, f.checkClient, input(o)), error).toEqual({ ok: false, error });
      expect(f.checkClient).not.toHaveBeenCalled();
    }
    expect(calls).toEqual([]);
  });

  it('every failed check is wrong_password (except a rate limit), and nothing is updated', async () => {
    for (const checkError of [{ code: 'invalid_credentials', message: 'Invalid login credentials' }, { code: 'email_not_confirmed' }, { status: 400 }]) {
      const f = fakes({ checkError });
      expect(await changePassword(f.session as never, f.checkClient, input())).toEqual({ ok: false, error: 'wrong_password' });
      expect(f.session.auth.updateUser).not.toHaveBeenCalled();
    }
    for (const checkError of [{ status: 429 }, { code: 'over_request_rate_limit' }]) {
      const f = fakes({ checkError });
      expect(await changePassword(f.session as never, f.checkClient, input())).toEqual({ ok: false, error: 'rate_limited' });
    }
  });

  it('a check session for a different user is revoked and refused', async () => {
    const f = fakes({ checkUserId: 'someone-else' });
    expect(await changePassword(f.session as never, f.checkClient, input())).toEqual({ ok: false, error: 'unexpected' });
    expect(calls).toEqual(['check.signIn', 'check.signOut:local']);
  });

  it('maps update errors to keys and never forwards Supabase text', async () => {
    const cases: [unknown, string][] = [
      [{ code: 'same_password', message: 'New password should be different from the old password.' }, 'same_password'],
      [{ code: 'weak_password', message: 'Password should be at least 12 characters.' }, 'weak'],
      [{ status: 429, code: 'over_request_rate_limit' }, 'rate_limited'],
      [{ code: 'reauthentication_needed', message: 'reauth' }, 'unexpected'],
      [{ message: 'boom' }, 'unexpected'],
    ];
    for (const [updateError, error] of cases) {
      const f = fakes({ updateError });
      const r = await changePassword(f.session as never, f.checkClient, input());
      expect(r).toEqual({ ok: false, error });
      expect(JSON.stringify(r)).not.toMatch(/password should|different from|reauth|boom/i);
      expect(f.session.auth.signOut).not.toHaveBeenCalled();
    }
  });

  it('a failed sign-out of the others still reports the change, with othersSignedOut false', async () => {
    const f = fakes({ othersError: { message: 'x' } });
    expect(await changePassword(f.session as never, f.checkClient, input())).toEqual({ ok: true, othersSignedOut: false });
  });

  it('a throw anywhere is unexpected', async () => {
    const f = fakes({ checkThrows: true });
    expect(await changePassword(f.session as never, f.checkClient, input())).toEqual({ ok: false, error: 'unexpected' });
    expect(f.session.auth.updateUser).not.toHaveBeenCalled();
  });
});

describe('setNewPassword', () => {
  const reset = (o: Partial<{ email: string | null; next: string; confirm: string }> = {}) => ({ email: 'owner@example.com', next: GOOD, confirm: GOOD, ...o });

  it('with a fresh recovery claim: updates, then signs out EVERY session', async () => {
    const f = fakes();
    expect(await setNewPassword(f.session as never, reset(), NOW)).toEqual({ ok: true, othersSignedOut: true });
    expect(calls).toEqual(['updateUser', 'signOut:global']);
  });

  it('without a fresh email proof: link_expired, nothing updated', async () => {
    for (const amr of [[{ method: 'password', timestamp: NOW }], [{ method: 'recovery', timestamp: NOW - 901 }], ['recovery'], undefined]) {
      const f = fakes({ amr });
      expect(await setNewPassword(f.session as never, reset(), NOW)).toEqual({ ok: false, error: 'link_expired' });
      expect(f.session.auth.updateUser).not.toHaveBeenCalled();
    }
  });

  it('validates the new password, and maps update errors', async () => {
    const f = fakes();
    expect(await setNewPassword(f.session as never, reset({ confirm: 'other' }), NOW)).toEqual({ ok: false, error: 'mismatch' });
    expect(await setNewPassword(f.session as never, reset({ next: 'aaaaaaaaaaaa', confirm: 'aaaaaaaaaaaa' }), NOW)).toEqual({ ok: false, error: 'weak' });
    expect(await setNewPassword(f.session as never, reset({ next: '' }), NOW)).toEqual({ ok: false, error: 'missing_fields' });
    expect(f.session.auth.updateUser).not.toHaveBeenCalled();
    const g = fakes({ updateError: { code: 'same_password' } });
    expect(await setNewPassword(g.session as never, reset(), NOW)).toEqual({ ok: false, error: 'same_password' });
    expect(g.session.auth.signOut).not.toHaveBeenCalled();
  });
});
