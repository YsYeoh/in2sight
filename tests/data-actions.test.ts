// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
const jar = vi.hoisted(() => ({ values: new Map<string, string>(), set: vi.fn(), delete: vi.fn() }));
const requireOwner = vi.fn();
const checkPassword = vi.fn();
const deleteAllData = vi.fn();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.values.has(name) ? { name, value: jar.values.get(name) } : undefined),
    set: (...a: unknown[]) => jar.set(...a),
    delete: (...a: unknown[]) => jar.delete(...a),
  }),
}));
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => calls.push(`revalidate:${a.join(',')}`) }));
vi.mock('@/lib/auth/require-owner', () => ({ requireOwner: () => requireOwner() }));
vi.mock('@/lib/auth/check-client', () => ({ checkClient: () => ({}) }));
vi.mock('@/lib/auth/password', () => ({ checkPassword: (...a: unknown[]) => checkPassword(...a) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabase: () => (calls.push('admin'), { admin: true }) }));
vi.mock('@/lib/data/delete', async (orig) => ({ ...(await orig<object>()), deleteAllData: (...a: unknown[]) => deleteAllData(...a) }));

import { deleteAllDataAction } from '@/app/(app)/settings/data-actions';
import { PASSWORD_COOKIE } from '@/lib/auth/attempts';

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const good = { phrase: 'DELETE', password: 'the owner password', email: 'attacker@evil.test', userId: 'someone-else' };
const run = (o: Record<string, string> = good) => deleteAllDataAction(null, form(o));

beforeEach(() => {
  calls.length = 0;
  jar.values.clear();
  jar.set.mockReset();
  jar.delete.mockReset();
  requireOwner.mockReset().mockImplementation(async () => (calls.push('requireOwner'), { userId: 'owner-1', email: 'owner@example.com' }));
  checkPassword.mockReset().mockImplementation(async () => (calls.push('check'), 'ok'));
  deleteAllData.mockReset().mockImplementation(async () => (calls.push('delete'), { ok: true, accounts: 2, coversDone: true }));
});

describe('deleteAllDataAction', () => {
  it('does nothing when requireOwner redirects (signed out, 2FA owed, not the owner)', async () => {
    for (const to of ['/login', '/login/verify', '/auth/signout']) {
      requireOwner.mockImplementationOnce(async () => {
        throw new Error(`REDIRECT:${to}`);
      });
      await expect(run()).rejects.toThrow(`REDIRECT:${to}`);
    }
    expect(calls).toEqual([]);
  });

  it('order: owner, password check (with the SESSION user and email, never the form values), service-role delete, revalidate', async () => {
    expect(await run()).toEqual({ ok: true, accounts: 2, coversDone: true });
    expect(calls).toEqual(['requireOwner', 'check', 'admin', 'delete', 'revalidate:/,layout']);
    expect(checkPassword.mock.calls[0][1]).toEqual({ userId: 'owner-1', email: 'owner@example.com', password: 'the owner password' });
    expect(deleteAllData).toHaveBeenCalledWith({ admin: true });
    expect(jar.delete).toHaveBeenCalledWith(PASSWORD_COOKIE);
  });

  it.each([
    [{ ...good, phrase: 'delete' }, 'phrase'],
    [{ ...good, phrase: ' DELETE' }, 'phrase'],
    [{ password: 'x' }, 'phrase'],
    [{ ...good, password: '' }, 'missing_password'],
    [{ phrase: 'DELETE' }, 'missing_password'],
  ])('refuses %j with %s before any password check or delete', async (fields, error) => {
    expect(await run(fields as Record<string, string>)).toEqual({ error });
    expect(calls).toEqual(['requireOwner']);
  });

  it('a wrong password counts an attempt and deletes nothing', async () => {
    checkPassword.mockImplementationOnce(async () => (calls.push('check'), 'wrong_password'));
    expect(await run()).toEqual({ error: 'wrong_password' });
    expect(calls).toEqual(['requireOwner', 'check']);
    expect(jar.set).toHaveBeenCalledWith(PASSWORD_COOKIE, expect.stringMatching(/^1\.\d+$/), expect.objectContaining({ httpOnly: true }));
  });

  it.each(['rate_limited', 'unexpected'])('a %s check deletes nothing and counts no attempt', async (r) => {
    checkPassword.mockImplementationOnce(async () => (calls.push('check'), r));
    expect(await run()).toEqual({ error: r });
    expect(calls).toEqual(['requireOwner', 'check']);
    expect(jar.set).not.toHaveBeenCalled();
  });

  it('five wrong passwords in the window: refused without checking (the counter is shared with change password)', async () => {
    jar.values.set(PASSWORD_COOKIE, `5.${Date.now() - 1000}`);
    expect(await run()).toEqual({ error: 'rate_limited' });
    expect(calls).toEqual(['requireOwner']);
  });

  it('a failed delete reports its key and revalidates nothing', async () => {
    deleteAllData.mockImplementationOnce(async () => (calls.push('delete'), { ok: false, error: 'needs_update' }));
    expect(await run()).toEqual({ error: 'needs_update' });
    expect(calls).toEqual(['requireOwner', 'check', 'admin', 'delete']);
  });
});
