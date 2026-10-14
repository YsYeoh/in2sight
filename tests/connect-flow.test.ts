import { describe, expect, it, vi } from 'vitest';
import type { AccountsStore, StoredAccount } from '@/lib/accounts/types';
import { processCallback } from '@/lib/instagram/connect-flow';
import type { IgConfig } from '@/lib/instagram/oauth';
import { newOAuthState } from '@/lib/instagram/state';

const cfg: IgConfig = { appId: '123', appSecret: 'sekrit', redirectUri: 'https://app.test/api/instagram/callback', apiVersion: 'v25.0' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

function storeSpy() {
  const calls: string[] = [];
  const rows: StoredAccount[] = [];
  const store: AccountsStore = {
    list: async () => rows,
    getById: async (id) => rows.find((r) => r.id === id) ?? null,
    findByIgUserId: async (ig) => (calls.push('find'), rows.find((r) => r.igUserId === ig) ?? null),
    insert: async (a) => {
      calls.push('insert');
      const r: StoredAccount = { id: 'a1', ...a, status: 'active', archivedAt: null, lastError: null, connectedAt: 'now' };
      rows.push(r);
      return r;
    },
    update: async (id, p) => (calls.push('update'), Object.assign(rows.find((r) => r.id === id)!, p)),
    saveToken: async () => void calls.push('saveToken'),
    remove: async () => undefined,
  };
  return { store, calls, rows };
}

function happyFetch(profile: Record<string, unknown> = { user_id: '1784', username: 'brandx', account_type: 'Media_Creator' }) {
  return vi.fn(async (url: string | URL | Request) => {
    const u = String(url);
    if (u.includes('api.instagram.com/oauth/access_token')) return json({ access_token: 'short', user_id: 1784 });
    if (u.includes('/access_token')) return json({ access_token: 'long', expires_in: 5184000 });
    if (u.includes('/me')) return json(profile);
    return json({}, 404);
  }) as unknown as typeof fetch & { mock: { calls: unknown[][] } };
}

const start = (group: string | null = null) => newOAuthState(group);
const run = (over: Partial<Parameters<typeof processCallback>[0]>, deps: Partial<Parameters<typeof processCallback>[1]> & { store: AccountsStore }) =>
  processCallback({ code: 'CODE', state: null, error: null, cookie: undefined, ...over }, { cfg, ...deps });

describe('processCallback - success', () => {
  it('exchanges, fetches the profile, saves the account and redirects with the username', async () => {
    const { store, rows } = storeSpy();
    const s = start('Brand X');
    const r = await run({ state: s.state, cookie: s.cookie }, { store, fetchFn: happyFetch() });
    expect(r).toEqual({ redirect: '/accounts?connected=brandx' });
    expect(rows[0]).toMatchObject({ igUserId: '1784', username: 'brandx', groupName: 'Brand X', status: 'active' });
  });

  it('no group chosen -> existing group is untouched (undefined), new account is isolated', async () => {
    const { store, rows } = storeSpy();
    const s = start(null);
    await run({ state: s.state, cookie: s.cookie }, { store, fetchFn: happyFetch() });
    expect(rows[0].groupName).toBeNull();
  });

  it('url-encodes unusual usernames in the redirect', async () => {
    const { store } = storeSpy();
    const s = start();
    const r = await run({ state: s.state, cookie: s.cookie }, { store, fetchFn: happyFetch({ user_id: '1', username: 'a b&c', account_type: 'Business' }) });
    expect(r.redirect).toBe('/accounts?connected=a%20b%26c');
  });
});

describe('processCallback - refusals (nothing saved, no network before state is verified)', () => {
  it.each([
    ['no cookie', (s: ReturnType<typeof start>) => ({ state: s.state, cookie: undefined })],
    ['no state in the query', (s: ReturnType<typeof start>) => ({ state: null, cookie: s.cookie })],
    ['state mismatch', (s: ReturnType<typeof start>) => ({ state: s.state + 'x', cookie: s.cookie })],
    ["someone else's cookie", () => ({ state: start().state, cookie: start().cookie })],
  ])('%s -> state_mismatch without any Instagram or database call', async (_n, make) => {
    const { store, calls } = storeSpy();
    const f = happyFetch();
    const r = await run(make(start()), { store, fetchFn: f });
    expect(r).toEqual({ redirect: '/accounts?error=state_mismatch' });
    expect(f).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it('an expired state is a mismatch', async () => {
    const { store, calls } = storeSpy();
    const old = newOAuthState(null, Date.now() - 20 * 60_000);
    expect(await run({ state: old.state, cookie: old.cookie }, { store, fetchFn: happyFetch() })).toEqual({ redirect: '/accounts?error=state_mismatch' });
    expect(calls).toEqual([]);
  });

  it('the user denying consent -> access_denied, nothing saved, no code exchange', async () => {
    const { store, calls } = storeSpy();
    const s = start();
    const f = happyFetch();
    expect(await run({ state: s.state, cookie: s.cookie, error: 'access_denied', code: null }, { store, fetchFn: f })).toEqual({ redirect: '/accounts?error=access_denied' });
    expect(f).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it('a missing code -> missing_code', async () => {
    const { store } = storeSpy();
    const s = start();
    expect(await run({ state: s.state, cookie: s.cookie, code: null }, { store, fetchFn: happyFetch() })).toEqual({ redirect: '/accounts?error=missing_code' });
  });

  it('a personal (non-professional) account is rejected and not saved', async () => {
    const { store, calls } = storeSpy();
    const s = start();
    const r = await run({ state: s.state, cookie: s.cookie }, { store, fetchFn: happyFetch({ user_id: '5', username: 'me', account_type: 'Personal' }) });
    expect(r).toEqual({ redirect: '/accounts?error=not_professional' });
    expect(calls).toEqual([]);
  });

  it('a profile without an account_type is rejected too', async () => {
    const { store } = storeSpy();
    const s = start();
    const r = await run({ state: s.state, cookie: s.cookie }, { store, fetchFn: happyFetch({ user_id: '5', username: 'me' }) });
    expect(r).toEqual({ redirect: '/accounts?error=not_professional' });
  });

  it('Instagram errors map to exchange_failed / profile_failed without leaking anything', async () => {
    const { store, calls } = storeSpy();
    const s1 = start();
    const bad = vi.fn(async () => json({ error: { message: 'bad CODE sekrit', code: 190 } }, 400)) as unknown as typeof fetch;
    const r1 = await run({ state: s1.state, cookie: s1.cookie }, { store, fetchFn: bad });
    expect(r1).toEqual({ redirect: '/accounts?error=exchange_failed' });

    const s2 = start();
    const f = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes('api.instagram.com')) return json({ access_token: 's', user_id: 1 });
      if (u.includes('/access_token')) return json({ access_token: 'l', expires_in: 100 });
      return json({ error: { message: 'x', code: 100 } }, 400);
    }) as unknown as typeof fetch;
    expect(await run({ state: s2.state, cookie: s2.cookie }, { store, fetchFn: f })).toEqual({ redirect: '/accounts?error=profile_failed' });
    expect(calls).toEqual([]);
  });

  it('a storage failure -> save_failed (and the redirect carries no detail)', async () => {
    const { store } = storeSpy();
    store.findByIgUserId = async () => { throw new Error('db down sekrit'); };
    const s = start();
    const r = await run({ state: s.state, cookie: s.cookie }, { store, fetchFn: happyFetch() });
    expect(r).toEqual({ redirect: '/accounts?error=save_failed' });
    expect(JSON.stringify(r)).not.toContain('sekrit');
  });

  it('every redirect is a same-site relative path under /accounts', async () => {
    const { store } = storeSpy();
    const s = start();
    const r = await run({ state: s.state, cookie: s.cookie }, { store, fetchFn: happyFetch() });
    expect(r.redirect.startsWith('/accounts?')).toBe(true);
  });
});
