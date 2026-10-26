// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { classifyModerationError, igModeration, MODERATION_TIMEOUT_MS } from '@/lib/instagram/moderation';
import { InstagramApiError } from '@/lib/instagram/oauth';

const TOKEN = 'IGAAsecret-token';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const setup = (res: () => Response | Promise<Response>) => {
  const fetchFn = vi.fn<typeof fetch>(async () => res());
  return { fetchFn, ig: igModeration('v25.0', fetchFn) };
};
const req = (f: ReturnType<typeof setup>['fetchFn'], i = 0) => ({ url: new URL(String(f.mock.calls[i][0])), init: f.mock.calls[i][1]! });

describe('igModeration: the three writes (graph.instagram.com, Instagram Login)', () => {
  it('hide: POST /{comment-id}?hide=true with the token in the query, a 5 s timeout and no redirects', async () => {
    const { fetchFn, ig } = setup(() => json({ success: true }));
    await ig.hide(TOKEN, '17881770991003328', true);
    const { url, init } = req(fetchFn);
    expect(`${url.origin}${url.pathname}`).toBe('https://graph.instagram.com/v25.0/17881770991003328');
    expect(url.searchParams.get('hide')).toBe('true');
    expect(url.searchParams.get('access_token')).toBe(TOKEN);
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(MODERATION_TIMEOUT_MS).toBe(5_000);
  });

  it('unhide: hide=false', async () => {
    const { fetchFn, ig } = setup(() => json({ success: true }));
    await ig.hide(TOKEN, '1789', false);
    expect(req(fetchFn).url.searchParams.get('hide')).toBe('false');
  });

  it('reply: POST /{comment-id}/replies with a form-encoded message; returns the new id (null when Meta sends none)', async () => {
    const { fetchFn, ig } = setup(() => json({ id: '17873440459141029' }));
    expect(await ig.reply(TOKEN, '1789', 'Thank you 🙏 & see you')).toBe('17873440459141029');
    const { url, init } = req(fetchFn);
    expect(url.pathname).toBe('/v25.0/1789/replies');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('content-type')).toBe('application/x-www-form-urlencoded');
    expect(new URLSearchParams(String(init.body)).get('message')).toBe('Thank you 🙏 & see you');
    expect(String(init.body)).not.toContain(TOKEN);
    const odd = setup(() => json({ ok: 1 }));
    expect(await odd.ig.reply(TOKEN, '1789', 'hi')).toBeNull();
  });

  it('remove: DELETE /{comment-id}', async () => {
    const { fetchFn, ig } = setup(() => json({ success: true }));
    await ig.remove(TOKEN, '1789');
    expect(req(fetchFn).init.method).toBe('DELETE');
    expect(req(fetchFn).url.pathname).toBe('/v25.0/1789');
  });

  it('a 200 without success:true is a failure (never assumed done)', async () => {
    const { ig } = setup(() => json({ success: false }));
    await expect(ig.hide(TOKEN, '1789', true)).rejects.toBeInstanceOf(InstagramApiError);
    await expect(ig.remove(TOKEN, '1789')).rejects.toBeInstanceOf(InstagramApiError);
  });

  it('an id that is not an Instagram id is refused before any request', async () => {
    const { fetchFn, ig } = setup(() => json({ success: true }));
    await expect(ig.hide(TOKEN, '../me', true)).rejects.toBeInstanceOf(InstagramApiError);
    await expect(ig.remove(TOKEN, '1789?x=1')).rejects.toBeInstanceOf(InstagramApiError);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('errors carry no token, URL, body or Meta message', async () => {
    const { ig } = setup(() => json({ error: { code: 100, error_subcode: 33, message: `secret ${TOKEN}` } }, 400));
    const e = await ig.hide(TOKEN, '1789', true).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(InstagramApiError);
    expect(`${String((e as Error).message)} ${JSON.stringify(e)} ${String((e as Error).stack)}`).not.toMatch(/IGAAsecret|graph\.instagram|secret/);
  });
});

describe('classifyModerationError', () => {
  const err = (status: number, code?: number, subcode?: number) => new InstagramApiError('data', status, code, subcode);
  it.each([
    ['token invalid (190)', err(400, 190), 'reconnect'],
    ['permission range (200)', err(403, 200), 'reconnect'],
    ['permission denied for the action (10)', err(400, 10), 'reconnect'],
    ['HTTP 401', err(401), 'reconnect'],
    ['HTTP 403 without a code', err(403), 'reconnect'],
    ['app rate limit (4)', err(400, 4), 'rate_limited'],
    ['user rate limit (17)', err(400, 17), 'rate_limited'],
    ['BUC throttle (80002)', err(400, 80002), 'rate_limited'],
    ['HTTP 429', err(429), 'rate_limited'],
    ['100/33 on a write is ambiguous (does not exist OR refused/missing permission): never "gone"', err(400, 100, 33), 'not_allowed'],
    ['other invalid parameter (100)', err(400, 100), 'not_allowed'],
    ['HTTP 500', err(500), 'instagram_unavailable'],
    ['network / timeout', new InstagramApiError('network'), 'instagram_unavailable'],
    ['not an Instagram error', new Error('boom'), 'unexpected'],
  ])('%s', (_n, e, key) => {
    expect(classifyModerationError(e)).toBe(key);
  });

  it('a reply whose outcome Instagram did not confirm is unknown_outcome, never "try again"', () => {
    expect(classifyModerationError(new InstagramApiError('network'), 'reply')).toBe('unknown_outcome');
    expect(classifyModerationError(err(502), 'reply')).toBe('unknown_outcome');
    expect(classifyModerationError(err(400, 100), 'reply')).toBe('not_allowed');
    expect(classifyModerationError(err(400, 100, 33), 'reply')).toBe('not_allowed');
  });
});
