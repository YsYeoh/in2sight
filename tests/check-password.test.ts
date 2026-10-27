// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { checkPassword } from '@/lib/auth/password';

function client(o: { error?: { status?: number; code?: string } | null; userId?: string; throws?: boolean } = {}) {
  const calls: string[] = [];
  const c = {
    auth: {
      signInWithPassword: vi.fn(async () => {
        calls.push('signIn');
        if (o.throws) throw new Error('network');
        return o.error ? { data: { user: null }, error: o.error } : { data: { user: { id: o.userId ?? 'owner-1' } }, error: null };
      }),
      signOut: vi.fn(async (a: { scope: string }) => (calls.push(`signOut:${a.scope}`), { error: null })),
    },
  };
  return { c, calls };
}
const input = { userId: 'owner-1', email: 'owner@example.com', password: 'the owner password' };

describe('checkPassword', () => {
  it('ok: signs in on the separate client, then revokes that session locally', async () => {
    const { c, calls } = client();
    expect(await checkPassword(() => c as never, input)).toBe('ok');
    expect(c.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'owner@example.com', password: 'the owner password' });
    expect(calls).toEqual(['signIn', 'signOut:local']);
  });

  it('wrong password, rate limit, another user, no email, a throw', async () => {
    expect(await checkPassword(() => client({ error: { status: 400, code: 'invalid_credentials' } }).c as never, input)).toBe('wrong_password');
    expect(await checkPassword(() => client({ error: { status: 429 } }).c as never, input)).toBe('rate_limited');
    const other = client({ userId: 'someone-else' });
    expect(await checkPassword(() => other.c as never, input)).toBe('unexpected');
    expect(other.calls).toEqual(['signIn', 'signOut:local']); // revoked even then
    const none = client();
    expect(await checkPassword(() => none.c as never, { ...input, email: null })).toBe('unexpected');
    expect(none.calls).toEqual([]);
    expect(await checkPassword(() => client({ throws: true }).c as never, input)).toBe('unexpected');
  });
});
