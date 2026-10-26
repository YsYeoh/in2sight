// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
const jar = vi.hoisted(() => ({ values: new Map<string, string>(), set: vi.fn(), delete: vi.fn() }));
const requireOwner = vi.fn();
const changePassword = vi.fn();
const setNewPassword = vi.fn();
const signOut = vi.fn();
const client = { auth: { signOut: (...a: unknown[]) => signOut(...a) } };
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.values.has(name) ? { name, value: jar.values.get(name) } : undefined),
    set: (...a: unknown[]) => jar.set(...a),
    delete: (...a: unknown[]) => jar.delete(...a),
  }),
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock('@/lib/auth/require-owner', () => ({ requireOwner: () => requireOwner() }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: async () => (calls.push('client'), client) }));
vi.mock('@/lib/auth/password', () => ({
  changePassword: (...a: unknown[]) => changePassword(...a),
  setNewPassword: (...a: unknown[]) => setNewPassword(...a),
}));

import { changePasswordAction, signOutOthersAction } from '@/app/(app)/settings/security-actions';
import { resetPasswordAction } from '@/app/login/reset/actions';
import { PASSWORD_COOKIE } from '@/lib/auth/attempts';

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const fields = { current: 'old password long', password: 'Correct horse battery 9', confirm: 'Correct horse battery 9', email: 'attacker@evil.test' };

beforeEach(() => {
  calls.length = 0;
  jar.values.clear();
  jar.set.mockReset();
  jar.delete.mockReset();
  requireOwner.mockReset().mockImplementation(async () => (calls.push('requireOwner'), { userId: 'owner-1', email: 'owner@example.com' }));
  changePassword.mockReset().mockImplementation(async () => (calls.push('change'), { ok: true, othersSignedOut: true }));
  setNewPassword.mockReset().mockImplementation(async () => (calls.push('set'), { ok: true, othersSignedOut: true }));
  signOut.mockReset().mockImplementation(async () => (calls.push('signOut'), { error: null }));
});

const actions = {
  changePasswordAction: () => changePasswordAction({}, form(fields)),
  signOutOthersAction: () => signOutOthersAction(),
  resetPasswordAction: () => resetPasswordAction({}, form(fields)),
};

describe.each(Object.entries(actions))('%s', (_name, run) => {
  it('does nothing when requireOwner redirects (signed out, aal1 recovery session, not the owner)', async () => {
    for (const to of ['/login', '/login/verify', '/auth/signout']) {
      requireOwner.mockRejectedValueOnce(new Error(`REDIRECT:${to}`));
      await expect(run()).rejects.toThrow(`REDIRECT:${to}`);
    }
    expect(calls).toEqual([]);
    expect(changePassword).not.toHaveBeenCalled();
    expect(setNewPassword).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });
});

describe('changePasswordAction', () => {
  it("passes the SESSION's user id and email (never the form's) and the three fields", async () => {
    expect(await changePasswordAction({}, form(fields))).toEqual({ ok: true, othersSignedOut: true });
    const [session, checkClient, input] = changePassword.mock.calls[0] as [unknown, unknown, unknown];
    expect(session).toBe(client);
    expect(typeof checkClient).toBe('function');
    expect(input).toEqual({ userId: 'owner-1', email: 'owner@example.com', current: 'old password long', next: 'Correct horse battery 9', confirm: 'Correct horse battery 9' });
    expect(jar.delete).toHaveBeenCalledWith(PASSWORD_COOKIE);
  });

  it('counts a wrong current password in the cookie; other errors do not count', async () => {
    changePassword.mockResolvedValueOnce({ ok: false, error: 'wrong_password' });
    expect(await changePasswordAction({}, form(fields))).toEqual({ error: 'wrong_password' });
    expect(jar.set).toHaveBeenCalledWith(PASSWORD_COOKIE, expect.stringMatching(/^1\.\d+$/), expect.objectContaining({ httpOnly: true, maxAge: 900 }));
    jar.set.mockReset();
    changePassword.mockResolvedValueOnce({ ok: false, error: 'mismatch' });
    expect(await changePasswordAction({}, form(fields))).toEqual({ error: 'mismatch' });
    expect(jar.set).not.toHaveBeenCalled();
  });

  it('after 5 wrong passwords in 15 minutes: rate_limited without calling Supabase', async () => {
    jar.values.set(PASSWORD_COOKIE, `5.${Date.now() - 60_000}`);
    expect(await changePasswordAction({}, form(fields))).toEqual({ error: 'rate_limited' });
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('the result never contains a password', async () => {
    changePassword.mockResolvedValueOnce({ ok: false, error: 'unexpected' });
    expect(JSON.stringify(await changePasswordAction({}, form(fields)))).not.toMatch(/horse|old password/);
  });
});

describe('signOutOthersAction', () => {
  it('signs out the OTHER sessions only', async () => {
    expect(await signOutOthersAction()).toEqual({ ok: true });
    expect(signOut).toHaveBeenCalledWith({ scope: 'others' });
  });
  it('an error or a throw is ok: false', async () => {
    signOut.mockResolvedValueOnce({ error: { message: 'x' } });
    expect(await signOutOthersAction()).toEqual({ ok: false });
    signOut.mockRejectedValueOnce(new Error('x'));
    expect(await signOutOthersAction()).toEqual({ ok: false });
  });
});

describe('resetPasswordAction', () => {
  it('sets the new password with the SESSION email, then redirects to /login?reset=done', async () => {
    await expect(resetPasswordAction({}, form(fields))).rejects.toThrow('REDIRECT:/login?reset=done');
    expect(setNewPassword).toHaveBeenCalledWith(client, { email: 'owner@example.com', next: 'Correct horse battery 9', confirm: 'Correct horse battery 9' });
  });
  it('returns the error key and stays on the page', async () => {
    setNewPassword.mockResolvedValueOnce({ ok: false, error: 'link_expired' });
    expect(await resetPasswordAction({}, form(fields))).toEqual({ error: 'link_expired' });
  });
  it('a failed sign-out of the other sessions is reported, not hidden behind the success redirect', async () => {
    setNewPassword.mockResolvedValueOnce({ ok: true, othersSignedOut: false });
    expect(await resetPasswordAction({}, form(fields))).toEqual({ error: 'signout_failed' });
  });
});
