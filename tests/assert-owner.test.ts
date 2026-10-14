import { beforeEach, describe, expect, it, vi } from 'vitest';

const getSessionInfo = vi.fn();
const rpc = vi.fn();
const createServerSupabase = vi.fn();
vi.mock('@/lib/auth/session', () => ({ getSessionInfo: (...a: unknown[]) => getSessionInfo(...a) }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: (...a: unknown[]) => createServerSupabase(...a) }));

import { assertOwner } from '@/lib/auth/assert-owner';

const base = { signedIn: true, userId: 'u1', email: 'a@b.c', aal: 'aal1', mfaRequired: false };

beforeEach(() => {
  getSessionInfo.mockReset();
  rpc.mockReset().mockResolvedValue({ data: true, error: null });
  createServerSupabase.mockReset().mockResolvedValue({ rpc: (...a: unknown[]) => rpc(...a) });
});

describe('assertOwner (route handlers: never redirects, fails closed)', () => {
  it('is true for a signed-in session without 2FA that the database calls the owner', async () => {
    getSessionInfo.mockResolvedValue(base);
    expect(await assertOwner()).toBe(true);
    expect(rpc).toHaveBeenCalledWith('is_owner');
  });

  it('is true once 2FA is satisfied (aal2)', async () => {
    getSessionInfo.mockResolvedValue({ ...base, aal: 'aal2', mfaRequired: true });
    expect(await assertOwner()).toBe(true);
  });

  it('is false for a signed-out visitor and does not ask the database', async () => {
    getSessionInfo.mockResolvedValue({ signedIn: false, userId: null, email: null, aal: null, mfaRequired: false });
    expect(await assertOwner()).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('is false for a password-only session that still owes a code, without asking the database', async () => {
    getSessionInfo.mockResolvedValue({ ...base, mfaRequired: true });
    expect(await assertOwner()).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['not the owner', { data: false, error: null }],
    ['a null answer', { data: null, error: null }],
    ['an rpc error', { data: null, error: { message: 'x' } }],
    ['an error alongside true', { data: true, error: { message: 'x' } }],
  ])('is false (a signed-in non-owner must not pass) on %s', async (_n, result) => {
    getSessionInfo.mockResolvedValue(base);
    rpc.mockResolvedValue(result);
    expect(await assertOwner()).toBe(false);
  });

  it('is false when the rpc throws', async () => {
    getSessionInfo.mockResolvedValue(base);
    rpc.mockRejectedValue(new Error('network down'));
    expect(await assertOwner()).toBe(false);
  });

  it('is false when the session lookup or client creation throws', async () => {
    createServerSupabase.mockRejectedValue(new Error('no env'));
    expect(await assertOwner()).toBe(false);
  });

  it('hands the response headers to the Supabase client', async () => {
    getSessionInfo.mockResolvedValue(base);
    const h = new Headers();
    await assertOwner(h);
    expect(createServerSupabase).toHaveBeenCalledWith({ responseHeaders: h });
  });
});
