// @vitest-environment node
import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const owner = { ok: true };
const marked: [string, string][] = [];
// the real guard writes Supabase's no-store headers into the Headers it is handed (R2): simulate that
vi.mock('@/lib/auth/assert-owner', () => ({
  assertOwner: async (h?: Headers) => {
    h?.set('cache-control', 'private, no-store');
    return owner.ok;
  },
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabase: () => ({}) }));
vi.mock('@/lib/accounts/supabase-store', () => ({ supabaseAccountsStore: () => ({ __fake: true }) }));
vi.mock('@/lib/accounts/service', async (orig) => ({ ...(await orig<object>()), markNeedsReconnect: async (_s: unknown, id: string, why: string) => void marked.push([id, why]) }));

import { GET as connect } from '@/app/api/instagram/connect/route';
import { GET as callback } from '@/app/api/instagram/callback/route';
import { POST as deauthorize } from '@/app/api/instagram/deauthorize/route';
import { POST as del } from '@/app/api/instagram/delete/route';
import { STATE_COOKIE } from '@/lib/instagram/state';

const ORIGIN = 'https://app.test';
beforeEach(() => {
  owner.ok = true;
  marked.length = 0;
  vi.stubEnv('IG_APP_ID', '1234567890');
  vi.stubEnv('IG_APP_SECRET', 'app-secret-123');
  vi.stubEnv('IG_REDIRECT_URI', `${ORIGIN}/api/instagram/callback`);
  vi.stubEnv('NEXT_PUBLIC_APP_URL', ORIGIN);
});
afterEach(() => vi.unstubAllEnvs());

const get = (path: string, cookie?: string) => new NextRequest(new URL(path, ORIGIN), { headers: cookie ? { cookie } : {} });
const b64u = (s: string) => Buffer.from(s).toString('base64url');
const signed = (payload: object, secret = 'app-secret-123') => {
  const p = b64u(JSON.stringify(payload));
  return `${createHmac('sha256', secret).update(p).digest('base64url')}.${p}`;
};
const post = (route: typeof deauthorize, value?: string) => {
  const fd = new FormData();
  if (value !== undefined) fd.set('signed_request', value);
  return route(new NextRequest(new URL('/x', ORIGIN), { method: 'POST', body: fd }));
};

describe('GET /api/instagram/connect', () => {
  it('is 401 for a visitor who is not the owner (and keeps the guard headers)', async () => {
    owner.ok = false;
    const res = await connect(get('/api/instagram/connect'));
    expect(res.status).toBe(401);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });

  it('redirects to Instagram with a state, sets the httpOnly state cookie, and carries the group in the cookie only', async () => {
    const res = await connect(get('/api/instagram/connect?group=Brand%20X'));
    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get('location')!);
    expect(loc.origin + loc.pathname).toBe('https://www.instagram.com/oauth/authorize');
    expect(loc.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(loc.searchParams.get('scope')).toBe('instagram_business_basic,instagram_business_manage_insights');
    expect(loc.toString()).not.toContain('Brand');
    const c = res.cookies.get(STATE_COOKIE)!;
    expect(c.value).toBeTruthy();
    expect(res.headers.get('set-cookie')).toMatch(/HttpOnly/i);
    expect(res.headers.get('set-cookie')).toMatch(/SameSite=lax/i);
    expect(res.headers.get('set-cookie')).toMatch(/Path=\/api\/instagram/i);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });

  it('an invalid group is ignored, not an error', async () => {
    expect((await connect(get('/api/instagram/connect?group=' + 'x'.repeat(80)))).status).toBe(307);
  });

  it('without Instagram configuration it goes back to /accounts with not_configured', async () => {
    vi.stubEnv('IG_APP_ID', '');
    const res = await connect(get('/api/instagram/connect'));
    expect(new URL(res.headers.get('location')!).pathname + new URL(res.headers.get('location')!).search).toBe('/accounts?error=not_configured');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });
});

describe('GET /api/instagram/callback', () => {
  it('is 401 for a visitor who is not the owner (and keeps the guard headers)', async () => {
    owner.ok = false;
    const res = await callback(get('/api/instagram/callback?code=c&state=s'));
    expect(res.status).toBe(401);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });

  it('a callback with no matching state cookie redirects to state_mismatch and clears the cookie', async () => {
    const res = await callback(get('/api/instagram/callback?code=c&state=s', `${STATE_COOKIE}=garbage`));
    const loc = new URL(res.headers.get('location')!);
    expect(loc.pathname + loc.search).toBe('/accounts?error=state_mismatch');
    expect(res.headers.get('set-cookie')).toMatch(new RegExp(`${STATE_COOKIE}=;`));
    expect(res.headers.get('set-cookie')).toMatch(/Max-Age=0/i);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });

  it('redirects stay on our own origin', async () => {
    const res = await callback(get('/api/instagram/callback?error=access_denied&state=x'));
    expect(new URL(res.headers.get('location')!).origin).toBe(ORIGIN);
  });
});

describe('Meta callbacks', () => {
  it('deauthorize: a valid signed_request flags the account', async () => {
    const res = await post(deauthorize, signed({ algorithm: 'HMAC-SHA256', user_id: '1784' }));
    expect(res.status).toBe(200);
    expect(marked).toEqual([['1784', 'deauthorized']]);
  });

  it('delete: a valid signed_request answers with a status url and a confirmation code', async () => {
    const res = await post(del, signed({ algorithm: 'HMAC-SHA256', user_id: '1784' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toBe(`${ORIGIN}/accounts`);
    expect(body.confirmation_code).toMatch(/^[0-9a-f]{16}$/);
    expect(marked).toEqual([['1784', 'deletion requested']]);
  });

  it.each([
    ['missing', undefined],
    ['garbage', 'not.a.signed.request'],
    ['wrong secret', signed({ algorithm: 'HMAC-SHA256', user_id: '1784' }, 'other-secret')],
    ['wrong algorithm', signed({ algorithm: 'HMAC-SHA1', user_id: '1784' })],
    ['no user id', signed({ algorithm: 'HMAC-SHA256' })],
  ])('%s signed_request -> 400 and nothing changes', async (_n, value) => {
    for (const route of [deauthorize, del]) {
      const res = await post(route, value);
      expect(res.status).toBe(400);
    }
    expect(marked).toEqual([]);
  });

  it('a non-form body is a 400, not a crash', async () => {
    const res = await deauthorize(new NextRequest(new URL('/x', ORIGIN), { method: 'POST', body: 'plain text' }));
    expect(res.status).toBe(400);
  });

  it('without the app secret configured the callbacks answer 503 and change nothing', async () => {
    vi.stubEnv('IG_APP_SECRET', '');
    expect((await post(deauthorize, signed({ algorithm: 'HMAC-SHA256', user_id: '1' }))).status).toBe(503);
    expect(marked).toEqual([]);
  });
});
