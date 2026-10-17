import { describe, expect, it, vi } from 'vitest';
import { COMMENTS_SCOPE, hasScope } from '@/lib/accounts/scopes';
import { connectAccount } from '@/lib/accounts/service';
import { newToRow, patchToRow, rowToAccount } from '@/lib/accounts/supabase-store';
import type { AccountsStore, StoredAccount } from '@/lib/accounts/types';
import { processCallback } from '@/lib/instagram/connect-flow';
import { exchangeCode, parseScopes, type IgConfig } from '@/lib/instagram/oauth';
import { newOAuthState } from '@/lib/instagram/state';

const cfg: IgConfig = { appId: '123', appSecret: 'sekrit', redirectUri: 'https://app.test/api/instagram/callback', apiVersion: 'v25.0' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
const ALL = 'instagram_business_basic,instagram_business_manage_insights,instagram_business_manage_comments';

function memAccounts() {
  const rows: StoredAccount[] = [];
  const store: AccountsStore = {
    list: async () => rows,
    getById: async (id) => rows.find((r) => r.id === id) ?? null,
    findByIgUserId: async (ig) => rows.find((r) => r.igUserId === ig) ?? null,
    insert: async (a) => {
      const r: StoredAccount = { id: `a${rows.length + 1}`, ...a, status: 'active', archivedAt: null, lastError: null, connectedAt: 'now' };
      rows.push(r);
      return r;
    },
    update: async (id, p) => Object.assign(rows.find((r) => r.id === id)!, p),
    saveToken: async () => undefined,
    remove: async () => undefined,
  };
  return { store, rows };
}

const fetchWith = (permissions: unknown) =>
  vi.fn(async (url: string | URL | Request) => {
    const u = String(url);
    if (u.includes('api.instagram.com/oauth/access_token')) return json({ data: [{ access_token: 'short', user_id: '1784', ...(permissions === undefined ? {} : { permissions }) }] });
    if (u.includes('/access_token')) return json({ access_token: 'long', expires_in: 5184000 });
    return json({ user_id: '1784', username: 'brandx', account_type: 'MEDIA_CREATOR' });
  }) as unknown as typeof fetch;

describe('parseScopes', () => {
  it('reads the documented comma-separated string, trims and dedupes', () => {
    expect(parseScopes(' instagram_business_basic, instagram_business_manage_comments ,instagram_business_basic')).toEqual(['instagram_business_basic', 'instagram_business_manage_comments']);
  });
  it('accepts an array; anything else (or nothing) is unknown = null', () => {
    expect(parseScopes(['a', 2, 'b'])).toEqual(['a', 'b']);
    expect(parseScopes(undefined)).toBeNull();
    expect(parseScopes(42)).toBeNull();
    expect(parseScopes('')).toEqual([]);
  });
});

describe('exchangeCode', () => {
  it('returns the granted scopes next to the short token', async () => {
    expect(await exchangeCode(cfg, 'C', fetchWith(ALL))).toEqual({ accessToken: 'short', userId: '1784', grantedScopes: ALL.split(',') });
    expect((await exchangeCode(cfg, 'C', fetchWith(undefined))).grantedScopes).toBeNull();
  });
});

describe('connect / reconnect stores what Meta granted', () => {
  it('a connect with the comments scope stores it; a reconnect without it overwrites it', async () => {
    const { store, rows } = memAccounts();
    const go = async (permissions: unknown) => {
      const s = newOAuthState(null);
      return processCallback({ code: 'C', state: s.state, error: null, cookie: s.cookie }, { cfg, store, fetchFn: fetchWith(permissions) });
    };
    expect(await go(ALL)).toEqual({ redirect: '/accounts?connected=brandx' });
    expect(hasScope(rows[0], COMMENTS_SCOPE)).toBe(true);
    await go('instagram_business_basic,instagram_business_manage_insights');
    expect(rows).toHaveLength(1);
    expect(hasScope(rows[0], COMMENTS_SCOPE)).toBe(false);
    await go(undefined); // Meta stopped reporting: unknown, not "still granted"
    expect(rows[0].grantedScopes).toBeNull();
  });

  it('connectAccount writes grantedScopes on insert and update', async () => {
    const { store, rows } = memAccounts();
    await connectAccount(store, { igUserId: '1', username: 'u', accessToken: 't', expiresAt: 'e', grantedScopes: ['x'] });
    expect(rows[0].grantedScopes).toEqual(['x']);
    await connectAccount(store, { igUserId: '1', username: 'u', accessToken: 't', expiresAt: 'e' });
    expect(rows[0].grantedScopes).toBeNull();
  });
});

describe('hasScope and the accounts row mapping', () => {
  it('unknown or missing scopes are never "granted"', () => {
    expect(hasScope({ grantedScopes: null }, COMMENTS_SCOPE)).toBe(false);
    expect(hasScope({}, COMMENTS_SCOPE)).toBe(false);
    expect(hasScope({ grantedScopes: ['instagram_business_basic'] }, COMMENTS_SCOPE)).toBe(false);
    expect(hasScope({ grantedScopes: [COMMENTS_SCOPE] }, COMMENTS_SCOPE)).toBe(true);
  });
  it('maps granted_scopes both ways', () => {
    expect(rowToAccount({ id: 'a', granted_scopes: ['x', 3] }).grantedScopes).toEqual(['x']);
    expect(rowToAccount({ id: 'a', granted_scopes: null }).grantedScopes).toBeNull();
    expect(patchToRow({ grantedScopes: ['x'] })).toEqual({ granted_scopes: ['x'] });
    expect(newToRow({ igUserId: '1', username: 'u', displayName: null, accountType: null, profilePictureUrl: null, groupName: null, tokenExpiresAt: 't', grantedScopes: ['y'] })).toMatchObject({ granted_scopes: ['y'] });
  });
});
