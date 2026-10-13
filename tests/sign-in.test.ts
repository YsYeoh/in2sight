import { describe, expect, it, vi } from 'vitest';
import { signInWithPassword } from '@/lib/auth/sign-in';

function fake(o: { authError?: unknown; claim?: boolean | null; rpcError?: unknown; throws?: boolean; rpcThrows?: boolean; signOutThrows?: boolean } = {}) {
  const signOut = vi.fn(async () => {
    if (o.signOutThrows) throw new Error('signout failed');
    return { error: null };
  });
  const signIn = vi.fn(async () => {
    if (o.throws) throw new Error('network');
    return o.authError ? { data: { session: null }, error: o.authError } : { data: { session: {} }, error: null };
  });
  const rpc = vi.fn(async () => {
    if (o.rpcThrows) throw new Error('rpc boom');
    return o.rpcError ? { data: null, error: o.rpcError } : { data: o.claim ?? true, error: null };
  });
  return { supabase: { auth: { signInWithPassword: signIn, signOut }, rpc } as never, signIn, signOut, rpc };
}

describe('signInWithPassword', () => {
  it('rejects empty fields without calling Supabase', async () => {
    const f = fake();
    expect(await signInWithPassword(f.supabase, { email: '  ', password: 'x' })).toEqual({ ok: false, error: 'missing_fields' });
    expect(await signInWithPassword(f.supabase, { email: 'a@b.c', password: '' })).toEqual({ ok: false, error: 'missing_fields' });
    expect(f.signIn).not.toHaveBeenCalled();
  });

  it('trims the email and signs in', async () => {
    const f = fake();
    expect(await signInWithPassword(f.supabase, { email: ' o@x.y ', password: 'pw' })).toEqual({ ok: true });
    expect(f.signIn).toHaveBeenCalledWith({ email: 'o@x.y', password: 'pw' });
    expect(f.rpc).toHaveBeenCalledWith('claim_ownership');
  });

  it('any Supabase auth error is the same generic invalid_credentials (no user enumeration)', async () => {
    for (const message of ['Invalid login credentials', 'User not found', 'Email not confirmed']) {
      const f = fake({ authError: { message } });
      expect(await signInWithPassword(f.supabase, { email: 'a@b.c', password: 'pw' })).toEqual({ ok: false, error: 'invalid_credentials' });
      expect(f.rpc).not.toHaveBeenCalled();
    }
  });

  it('a signed-in user who is not the owner is signed out again with not_owner', async () => {
    const f = fake({ claim: false });
    expect(await signInWithPassword(f.supabase, { email: 'a@b.c', password: 'pw' })).toEqual({ ok: false, error: 'not_owner' });
    expect(f.signOut).toHaveBeenCalledTimes(1);
  });

  it('an RPC failure signs the user out and reports unexpected', async () => {
    const f = fake({ rpcError: { message: 'function missing' } });
    expect(await signInWithPassword(f.supabase, { email: 'a@b.c', password: 'pw' })).toEqual({ ok: false, error: 'unexpected' });
    expect(f.signOut).toHaveBeenCalledTimes(1);
  });

  it('a thrown error becomes unexpected and never leaks its message', async () => {
    const f = fake({ throws: true });
    const r = await signInWithPassword(f.supabase, { email: 'a@b.c', password: 'pw' });
    expect(r).toEqual({ ok: false, error: 'unexpected' });
    expect(JSON.stringify(r)).not.toContain('network');
  });

  it('rpc throws => signOut called and result is unexpected', async () => {
    const f = fake({ rpcThrows: true });
    expect(await signInWithPassword(f.supabase, { email: 'a@b.c', password: 'pw' })).toEqual({ ok: false, error: 'unexpected' });
    expect(f.signOut).toHaveBeenCalledTimes(1);
  });

  it('a failing signOut does not change the error key', async () => {
    const a = fake({ claim: false, signOutThrows: true });
    expect(await signInWithPassword(a.supabase, { email: 'a@b.c', password: 'pw' })).toEqual({ ok: false, error: 'not_owner' });
    const b = fake({ rpcError: { message: 'x' }, signOutThrows: true });
    expect(await signInWithPassword(b.supabase, { email: 'a@b.c', password: 'pw' })).toEqual({ ok: false, error: 'unexpected' });
  });
});
