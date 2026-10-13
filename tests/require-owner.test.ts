import { beforeEach, describe, expect, it, vi } from 'vitest';

const getSessionInfo = vi.fn();
const rpc = vi.fn();
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock('@/lib/auth/session', () => ({ getSessionInfo: (...a: unknown[]) => getSessionInfo(...a) }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: async () => ({ rpc: (...a: unknown[]) => rpc(...a) }) }));

import { requireOwner } from '@/lib/auth/require-owner';

const base = { signedIn: true, userId: 'u1', email: 'a@b.c', aal: 'aal1', mfaRequired: false };

beforeEach(() => {
  getSessionInfo.mockReset();
  rpc.mockReset().mockResolvedValue({ data: true, error: null });
});

describe('requireOwner', () => {
  it('returns the user for a signed-in session without 2FA', async () => {
    getSessionInfo.mockResolvedValue(base);
    await expect(requireOwner()).resolves.toEqual({ userId: 'u1', email: 'a@b.c' });
  });

  it('returns the user once 2FA is satisfied (aal2)', async () => {
    getSessionInfo.mockResolvedValue({ ...base, aal: 'aal2', mfaRequired: true });
    await expect(requireOwner()).resolves.toEqual({ userId: 'u1', email: 'a@b.c' });
  });

  it('sends a signed-out visitor to /login', async () => {
    getSessionInfo.mockResolvedValue({ signedIn: false, userId: null, email: null, aal: null, mfaRequired: false });
    await expect(requireOwner()).rejects.toThrow('REDIRECT:/login');
  });

  it('sends a password-only session that still owes a code to /login/verify', async () => {
    getSessionInfo.mockResolvedValue({ ...base, mfaRequired: true });
    await expect(requireOwner()).rejects.toThrow('REDIRECT:/login/verify');
  });

  it('asks the database whether this user is the owner', async () => {
    getSessionInfo.mockResolvedValue(base);
    await requireOwner();
    expect(rpc).toHaveBeenCalledWith('is_owner');
  });

  // /login would bounce a signed-in user straight back to /overview (loop), so a non-owner is signed out first
  it.each([
    ['not the owner', { data: false, error: null }],
    ['a null answer', { data: null, error: null }],
  ])('signs a non-owner out via /auth/signout on %s', async (_n, result) => {
    getSessionInfo.mockResolvedValue(base);
    rpc.mockResolvedValue(result);
    await expect(requireOwner()).rejects.toThrow('REDIRECT:/auth/signout');
  });

  it.each([
    ['an rpc error', { data: null, error: { message: 'secret db detail' } }],
    ['an error alongside true', { data: true, error: { message: 'secret db detail' } }],
  ])('throws (error boundary, no redirect loop) on %s, without the raw Supabase text', async (_n, result) => {
    getSessionInfo.mockResolvedValue(base);
    rpc.mockResolvedValue(result);
    const err = await requireOwner().catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toMatch(/REDIRECT|secret db detail/);
  });

  it('throws when the rpc itself throws', async () => {
    getSessionInfo.mockResolvedValue(base);
    rpc.mockRejectedValue(new Error('network down'));
    const err = await requireOwner().catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toMatch(/REDIRECT|network down/);
  });

  it('does not ask the database for a signed-out or 2FA-pending visitor', async () => {
    getSessionInfo.mockResolvedValue({ ...base, mfaRequired: true });
    await expect(requireOwner()).rejects.toThrow('REDIRECT:/login/verify');
    expect(rpc).not.toHaveBeenCalled();
  });
});
