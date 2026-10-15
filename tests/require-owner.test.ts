import { createRequire } from 'node:module';
import { join } from 'node:path';
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

// React's server `cache` memoises per request and passes through outside one; jsdom loads the client build, where it is
// always a pass-through. This stand-in has the server semantics with a request scope the tests open and close.
const request = vi.hoisted(() => ({ scope: null as Map<unknown, { ok: boolean; v: unknown }> | null }));
vi.mock('react', async (importOriginal) => {
  const React = await importOriginal<typeof import('react')>();
  const cache =
    <A extends unknown[], R>(fn: (...a: A) => R) =>
    (...a: A): R => {
      if (!request.scope) return fn(...a);
      const hit = request.scope.get(fn);
      if (hit) {
        if (hit.ok) return hit.v as R;
        throw hit.v;
      }
      try {
        const v = fn(...a);
        request.scope.set(fn, { ok: true, v });
        return v;
      } catch (e) {
        request.scope.set(fn, { ok: false, v: e });
        throw e;
      }
    };
  return { ...React, cache, default: { ...React, cache } };
});

import { requireOwner } from '@/lib/auth/require-owner';

const base = { signedIn: true, userId: 'u1', email: 'a@b.c', aal: 'aal1', mfaRequired: false };
const SIGNED_OUT = { signedIn: false, userId: null, email: null, aal: null, mfaRequired: false };

beforeEach(() => {
  request.scope = null;
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
    getSessionInfo.mockResolvedValue(SIGNED_OUT);
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

  it('asks for the session and the owner flag in parallel (one round trip, not two)', async () => {
    let release: (v: typeof base) => void = () => {};
    getSessionInfo.mockReturnValue(new Promise((r) => (release = r)));
    const p = requireOwner();
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledWith('is_owner')); // before the session lookup has answered
    release(base);
    await expect(p).resolves.toEqual({ userId: 'u1', email: 'a@b.c' });
  });

  it.each([
    ['signed out', SIGNED_OUT, 'REDIRECT:/login'],
    ['2FA owed', { ...base, mfaRequired: true }, 'REDIRECT:/login/verify'],
  ])('%s still redirects although the parallel owner RPC said true (the session decides first)', async (_n, info, to) => {
    getSessionInfo.mockResolvedValue(info);
    await expect(requireOwner()).rejects.toThrow(to);
  });

  it('a signed-out visitor is redirected even when the parallel RPC fails (no error page for a plain logout)', async () => {
    getSessionInfo.mockResolvedValue(SIGNED_OUT);
    rpc.mockRejectedValue(new Error('JWT missing'));
    await expect(requireOwner()).rejects.toThrow('REDIRECT:/login');
  });
});

describe('requireOwner is one check per request (React.cache)', () => {
  it('the layout and the page in one request share one session lookup and one RPC', async () => {
    getSessionInfo.mockResolvedValue(base);
    request.scope = new Map();
    const [layout, page] = await Promise.all([requireOwner(), requireOwner()]);
    await requireOwner();
    expect(layout).toEqual(page);
    expect(getSessionInfo).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('a new request checks again and never sees the previous user', async () => {
    request.scope = new Map();
    getSessionInfo.mockResolvedValue(base);
    await expect(requireOwner()).resolves.toEqual({ userId: 'u1', email: 'a@b.c' });
    request.scope = new Map(); // next request, another visitor
    getSessionInfo.mockResolvedValue(SIGNED_OUT);
    await expect(requireOwner()).rejects.toThrow('REDIRECT:/login');
    expect(getSessionInfo).toHaveBeenCalledTimes(2);
  });

  it('fails closed for every caller of a failing request, and the failure does not leak into the next request', async () => {
    request.scope = new Map();
    getSessionInfo.mockResolvedValue(base);
    rpc.mockResolvedValue({ data: false, error: null });
    await expect(requireOwner()).rejects.toThrow('REDIRECT:/auth/signout');
    await expect(requireOwner()).rejects.toThrow('REDIRECT:/auth/signout'); // the page after the layout
    expect(rpc).toHaveBeenCalledTimes(1);
    request.scope = new Map();
    rpc.mockResolvedValue({ data: true, error: null });
    await expect(requireOwner()).resolves.toEqual({ userId: 'u1', email: 'a@b.c' });
  });

  it('outside a request scope (server actions) every call checks again', async () => {
    getSessionInfo.mockResolvedValue(base);
    await requireOwner();
    await requireOwner();
    expect(getSessionInfo).toHaveBeenCalledTimes(2);
  });

  it("React's real server build passes through outside a request: nothing can be cached across requests", () => {
    const { cache } = createRequire(import.meta.url)(join(process.cwd(), 'node_modules/react/cjs/react.react-server.development.js')) as typeof import('react'); // not in react's exports map
    let n = 0;
    const counted = cache(() => ++n);
    counted();
    counted();
    expect(n).toBe(2);
  });
});
