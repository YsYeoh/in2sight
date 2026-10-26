// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const jar = vi.hoisted(() => ({ values: new Map<string, string>(), set: vi.fn(), delete: vi.fn() }));
const requestPasswordReset = vi.fn();
const confirmRecovery = vi.fn();
const client = { tag: 'cookie-client' };
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
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: async () => client }));
vi.mock('@/lib/auth/recovery', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth/recovery')>()),
  requestPasswordReset: (...a: unknown[]) => requestPasswordReset(...a),
  confirmRecovery: (...a: unknown[]) => confirmRecovery(...a),
}));

import { confirmRecoveryAction } from '@/app/auth/confirm/actions';
import { requestResetAction } from '@/app/login/forgot/actions';
import { FORGOT_COOKIE } from '@/lib/auth/attempts';

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

beforeEach(() => {
  jar.values.clear();
  jar.set.mockReset();
  jar.delete.mockReset();
  requestPasswordReset.mockReset().mockResolvedValue(undefined);
  confirmRecovery.mockReset().mockResolvedValue(true);
});

describe('requestResetAction (public)', () => {
  it('answers sent, sets the one-minute cooldown cookie and asks Supabase once', async () => {
    expect(await requestResetAction({}, form({ email: 'owner@example.com' }))).toEqual({ status: 'sent' });
    expect(requestPasswordReset).toHaveBeenCalledWith(client, 'owner@example.com');
    expect(jar.set).toHaveBeenCalledWith(FORGOT_COOKIE, expect.stringMatching(/^1\.\d+$/), expect.objectContaining({ httpOnly: true, maxAge: 60 }));
  });

  it('the answer is identical for an unknown email (the lib swallows every outcome)', async () => {
    const a = await requestResetAction({}, form({ email: 'owner@example.com' }));
    jar.values.clear();
    const b = await requestResetAction({}, form({ email: 'nobody@example.com' }));
    expect(b).toEqual(a);
  });

  it('a malformed email is refused by format alone, before any call', async () => {
    expect(await requestResetAction({}, form({ email: 'not-an-email' }))).toEqual({ error: 'invalid_email' });
    expect(await requestResetAction({}, form({}))).toEqual({ error: 'invalid_email' });
    expect(requestPasswordReset).not.toHaveBeenCalled();
  });

  it('within the cooldown: cooldown, no call, whatever the email', async () => {
    jar.values.set(FORGOT_COOKIE, `1.${Date.now() - 1000}`);
    expect(await requestResetAction({}, form({ email: 'owner@example.com' }))).toEqual({ status: 'cooldown' });
    expect(requestPasswordReset).not.toHaveBeenCalled();
  });
});

describe('confirmRecoveryAction (public)', () => {
  const HASH = 'a'.repeat(56);
  it('verifies the token hash and redirects to the FIXED path /login/reset', async () => {
    await expect(confirmRecoveryAction({}, form({ token_hash: HASH, next: 'https://evil.test' }))).rejects.toThrow('REDIRECT:/login/reset');
    expect(confirmRecovery).toHaveBeenCalledWith(client, HASH);
  });
  it('a malformed token hash is refused without a call', async () => {
    for (const token_hash of ['', 'short', 'x'.repeat(20) + '/../']) {
      expect(await confirmRecoveryAction({}, form({ token_hash }))).toEqual({ error: 'link_invalid' });
    }
    expect(confirmRecovery).not.toHaveBeenCalled();
  });
  it('an expired or used link is link_invalid (no redirect)', async () => {
    confirmRecovery.mockResolvedValue(false);
    expect(await confirmRecoveryAction({}, form({ token_hash: HASH }))).toEqual({ error: 'link_invalid' });
  });
});
