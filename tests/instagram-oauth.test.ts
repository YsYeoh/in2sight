import { describe, expect, it, vi } from 'vitest';
import { IG_SCOPES, InstagramApiError, buildAuthorizeUrl, exchangeCode, exchangeLongLived, fetchProfile, isProfessional, refreshLongLived, type IgConfig } from '@/lib/instagram/oauth';

const cfg: IgConfig = { appId: '1234567890', appSecret: 'sekrit-app-secret', redirectUri: 'https://app.test/api/instagram/callback', apiVersion: 'v25.0' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const fetchReturning = (res: Response | (() => Response)) => vi.fn(async () => (typeof res === 'function' ? res() : res)) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

describe('buildAuthorizeUrl', () => {
  it('points at the Instagram authorization window with exactly the required parameters', () => {
    const u = new URL(buildAuthorizeUrl(cfg, 'state123'));
    expect(u.origin + u.pathname).toBe('https://www.instagram.com/oauth/authorize');
    expect(u.searchParams.get('client_id')).toBe('1234567890');
    expect(u.searchParams.get('redirect_uri')).toBe(cfg.redirectUri);
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('state')).toBe('state123');
    expect(u.searchParams.get('force_reauth')).toBe('true');
    expect(u.searchParams.get('scope')).toBe('instagram_business_basic,instagram_business_manage_insights,instagram_business_manage_comments');
  });
  it('asks for read-only scopes only', () => {
    expect([...IG_SCOPES]).toEqual(['instagram_business_basic', 'instagram_business_manage_insights', 'instagram_business_manage_comments']);
    expect(buildAuthorizeUrl(cfg, 's')).not.toMatch(/manage_messages|manage_comments|content_publish/);
  });
  it('never contains the app secret', () => {
    expect(buildAuthorizeUrl(cfg, 's')).not.toContain('sekrit');
  });
});

describe('exchangeCode', () => {
  it('POSTs form-encoded credentials to the token endpoint', async () => {
    const f = fetchReturning(json({ access_token: 'short1', user_id: 1784, permissions: 'instagram_business_basic' }));
    expect(await exchangeCode(cfg, 'CODE', f)).toEqual({ accessToken: 'short1', userId: '1784' });
    const [url, init] = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(url).toBe('https://api.instagram.com/oauth/access_token');
    expect(init.method).toBe('POST');
    const body = new URLSearchParams(String(init.body));
    expect(Object.fromEntries(body)).toMatchObject({ client_id: '1234567890', client_secret: 'sekrit-app-secret', grant_type: 'authorization_code', redirect_uri: cfg.redirectUri, code: 'CODE' });
  });
  it('understands the { data: [ ... ] } response shape too', async () => {
    const f = fetchReturning(json({ data: [{ access_token: 'short2', user_id: '99', permissions: 'x' }] }));
    expect(await exchangeCode(cfg, 'C', f)).toEqual({ accessToken: 'short2', userId: '99' });
  });
  it('rejects a response without a token or user id', async () => {
    await expect(exchangeCode(cfg, 'C', fetchReturning(json({ access_token: 'only' })))).rejects.toBeInstanceOf(InstagramApiError);
    await expect(exchangeCode(cfg, 'C', fetchReturning(json({})))).rejects.toBeInstanceOf(InstagramApiError);
  });
});

describe('exchangeLongLived / refreshLongLived', () => {
  it('exchange sends grant_type=ig_exchange_token and converts expires_in to an ISO date', async () => {
    const f = fetchReturning(json({ access_token: 'long1', token_type: 'bearer', expires_in: 5184000 }));
    const r = await exchangeLongLived(cfg, 'short1', f);
    expect(r.accessToken).toBe('long1');
    const u = new URL((f as unknown as { mock: { calls: [string][] } }).mock.calls[0][0]);
    expect(u.origin + u.pathname).toBe('https://graph.instagram.com/access_token');
    expect(u.searchParams.get('grant_type')).toBe('ig_exchange_token');
    expect(u.searchParams.get('client_secret')).toBe('sekrit-app-secret');
    expect(u.searchParams.get('access_token')).toBe('short1');
    expect(Date.parse(r.expiresAt) - Date.now()).toBeGreaterThan(59 * 86_400_000);
    expect(Date.parse(r.expiresAt) - Date.now()).toBeLessThan(61 * 86_400_000);
  });
  it('refresh has a request timeout and refuses redirects (the token is in the query string)', async () => {
    const f = fetchReturning(json({ access_token: 'long2', expires_in: 5184000 }));
    await refreshLongLived('long1', f);
    const init = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0][1];
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.redirect).toBe('error');
  });
  it('refresh uses ig_refresh_token and the now parameter', async () => {
    const f = fetchReturning(json({ access_token: 'long2', expires_in: 5184000 }));
    const now = new Date('2026-10-14T00:00:00Z');
    const r = await refreshLongLived('long1', f, now);
    expect(r).toEqual({ accessToken: 'long2', expiresAt: '2026-12-13T00:00:00.000Z' });
    const u = new URL((f as unknown as { mock: { calls: [string][] } }).mock.calls[0][0]);
    expect(u.pathname).toBe('/refresh_access_token');
    expect(u.searchParams.get('grant_type')).toBe('ig_refresh_token');
    expect(u.searchParams.has('client_secret')).toBe(false);
  });
  it('a missing expires_in is an error, not a token that never expires', async () => {
    await expect(exchangeLongLived(cfg, 's', fetchReturning(json({ access_token: 'x' })))).rejects.toBeInstanceOf(InstagramApiError);
  });
});

describe('fetchProfile / isProfessional', () => {
  it('requests the profile fields from the versioned /me endpoint', async () => {
    const f = fetchReturning(json({ user_id: '1784', username: 'brandx', name: 'Brand X', account_type: 'Media_Creator', profile_picture_url: 'https://cdn/x.jpg' }));
    expect(await fetchProfile(cfg, 'long1', f)).toEqual({ userId: '1784', username: 'brandx', name: 'Brand X', accountType: 'Media_Creator', profilePictureUrl: 'https://cdn/x.jpg' });
    const u = new URL((f as unknown as { mock: { calls: [string][] } }).mock.calls[0][0]);
    expect(u.origin + u.pathname).toBe('https://graph.instagram.com/v25.0/me');
    expect(u.searchParams.get('fields')).toBe('user_id,username,name,account_type,profile_picture_url');
    expect(u.searchParams.get('access_token')).toBe('long1');
  });
  it('requires a user id and a username', async () => {
    await expect(fetchProfile(cfg, 't', fetchReturning(json({ username: 'x' })))).rejects.toBeInstanceOf(InstagramApiError);
    await expect(fetchProfile(cfg, 't', fetchReturning(json({ user_id: '1' })))).rejects.toBeInstanceOf(InstagramApiError);
  });
  it('isProfessional accepts Business and Media_Creator in any case and nothing else', () => {
    for (const t of ['Business', 'BUSINESS', 'Media_Creator', 'media_creator']) expect(isProfessional(t), t).toBe(true);
    for (const t of ['Personal', 'PERSONAL', '', null, 'Creator', 'Business ']) expect(isProfessional(t as never), String(t)).toBe(false);
  });
});

describe('errors never leak secrets', () => {
  const secrets = ['sekrit-app-secret', 'short1', 'long1', 'THE-CODE'];
  const leak = (e: unknown) => JSON.stringify({ m: (e as Error).message, k: (e as InstagramApiError).kind, s: (e as InstagramApiError).status, c: (e as InstagramApiError).code });
  it('HTTP errors (even when the body echoes secrets) become a fixed message with kind/status/code only', async () => {
    const body = { error: { message: 'Invalid code THE-CODE for sekrit-app-secret token short1', type: 'OAuthException', code: 190 }, error_message: 'bad long1' };
    for (const run of [
      () => exchangeCode(cfg, 'THE-CODE', fetchReturning(json(body, 400))),
      () => exchangeLongLived(cfg, 'short1', fetchReturning(json(body, 400))),
      () => refreshLongLived('long1', fetchReturning(json(body, 400))),
      () => fetchProfile(cfg, 'long1', fetchReturning(json(body, 400))),
    ]) {
      const e = await run().catch((x) => x);
      expect(e).toBeInstanceOf(InstagramApiError);
      for (const s of secrets) expect(leak(e)).not.toContain(s);
      expect((e as InstagramApiError).status).toBe(400);
    }
  });
  it('parses the numeric error code from both Meta error shapes', async () => {
    const a = await exchangeCode(cfg, 'c', fetchReturning(json({ error_type: 'OAuthException', code: 400, error_message: 'x' }, 400))).catch((x) => x);
    const b = await fetchProfile(cfg, 't', fetchReturning(json({ error: { message: 'x', code: 190 } }, 400))).catch((x) => x);
    expect((a as InstagramApiError).code).toBe(400);
    expect((b as InstagramApiError).code).toBe(190);
  });
  it('network failures and non-JSON bodies become InstagramApiError("network"/kind) without details', async () => {
    const boom = vi.fn(async () => { throw new Error('connect ECONNRESET token short1'); }) as unknown as typeof fetch;
    const e = await exchangeCode(cfg, 'c', boom).catch((x) => x);
    expect(e).toBeInstanceOf(InstagramApiError);
    expect((e as InstagramApiError).kind).toBe('network');
    expect(leak(e)).not.toContain('short1');
    const notJson = await exchangeCode(cfg, 'c', fetchReturning(new Response('<html>oops</html>', { status: 502 }))).catch((x) => x);
    expect(notJson).toBeInstanceOf(InstagramApiError);
    expect((notJson as InstagramApiError).status).toBe(502);
  });
});
