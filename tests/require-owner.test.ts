import { beforeEach, describe, expect, it, vi } from 'vitest';

const getSessionInfo = vi.fn();
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock('@/lib/auth/session', () => ({ getSessionInfo: (...a: unknown[]) => getSessionInfo(...a) }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: async () => ({}) }));

import { requireOwner } from '@/lib/auth/require-owner';

const base = { signedIn: true, userId: 'u1', email: 'a@b.c', aal: 'aal1', mfaRequired: false };

beforeEach(() => getSessionInfo.mockReset());

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
});
