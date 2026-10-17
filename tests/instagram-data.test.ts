import { describe, expect, it } from 'vitest';
import { classifyIgError, igData } from '@/lib/instagram/data';
import { InstagramApiError } from '@/lib/instagram/oauth';
import { fixture } from './fixtures/instagram/load';

const TOKEN = 'IGQ-secret-token';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Fake fetch: answers by path (+ metric param) and records every URL and init. */
function fakeFetch(routes: (u: URL) => Response | undefined) {
  const calls: { url: URL; init?: RequestInit }[] = [];
  const fn = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    return routes(url) ?? json({ error: { code: 100, message: 'unrouted' } }, 400);
  }) as typeof fetch;
  return { fn, calls };
}

describe('igData requests', () => {
  it('profile reads followers_count from /me', async () => {
    const f = fakeFetch((u) => (u.pathname === '/v25.0/me' ? json(fixture('me')) : undefined));
    expect(await igData('v25.0', f.fn).profile(TOKEN)).toMatchObject({ followersCount: 1520 });
    expect(f.calls[0].url.searchParams.get('fields')).toBe('followers_count,follows_count,media_count');
    expect(f.calls[0].url.searchParams.get('access_token')).toBe(TOKEN);
    expect(f.calls[0].init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('accountDay makes one totals call and one follows breakdown call for the given day', async () => {
    const f = fakeFetch((u) => {
      if (u.pathname !== '/v25.0/me/insights') return undefined;
      return json(fixture(u.searchParams.get('metric') === 'follows_and_unfollows' ? 'account-follows' : 'account-day'));
    });
    const v = await igData('v25.0', f.fn).accountDay(TOKEN, 1760371200, 1760457600);
    expect(v).toEqual({ reach: 1830, views: 4210, accountsEngaged: 96, totalInteractions: 240, linkTaps: 7, follows: 12, unfollows: 3 });
    const [totals, follows] = f.calls.map((c) => Object.fromEntries(c.url.searchParams));
    expect(totals).toMatchObject({ metric: 'reach,views,accounts_engaged,total_interactions,profile_links_taps', metric_type: 'total_value', period: 'day', since: '1760371200', until: '1760457600' });
    expect(totals.breakdown).toBeUndefined();
    expect(follows).toMatchObject({ metric: 'follows_and_unfollows', breakdown: 'follow_type', since: '1760371200' });
  });

  it('accountDay returns nulls (not zeros) when Instagram has no data, e.g. under 100 followers', async () => {
    const f = fakeFetch(() => json(fixture('empty-insights')));
    expect(Object.values(await igData('v25.0', f.fn).accountDay(TOKEN, 1, 2)).every((v) => v === null)).toBe(true);
  });

  it('listMedia follows paging.next and stops at the last page', async () => {
    const f = fakeFetch((u) => {
      if (u.pathname !== '/v25.0/me/media' && !u.pathname.endsWith('/media')) return undefined;
      return json(fixture(u.searchParams.get('after') ? 'media-page-2' : 'media-page-1'));
    });
    const items = await igData('v25.0', f.fn).listMedia(TOKEN, 500);
    expect(items.map((i) => i.id)).toEqual(['18000000000000003', '18000000000000002', '18000000000000001', '18000000000000000']);
    expect(f.calls).toHaveLength(2);
    expect(f.calls[0].url.searchParams.get('fields')).toBe('id,caption,media_type,media_product_type,permalink,timestamp');
  });

  it('listMedia respects maxItems and stopBefore (no further pages once old media is reached)', async () => {
    const f = fakeFetch((u) => json(fixture(u.searchParams.get('after') ? 'media-page-2' : 'media-page-1')));
    expect((await igData('v25.0', f.fn).listMedia(TOKEN, 1)).map((i) => i.id)).toEqual(['18000000000000003']);
    const f2 = fakeFetch((u) => json(fixture(u.searchParams.get('after') ? 'media-page-2' : 'media-page-1')));
    await igData('v25.0', f2.fn).listMedia(TOKEN, 500, '2026-10-11T00:00:00.000Z');
    expect(f2.calls).toHaveLength(1);
  });

  it('never follows a paging.next that points at another host (it would carry the token)', async () => {
    const page = { ...fixture('media-page-1'), paging: { next: 'https://evil.example/steal?access_token=x' } };
    const f = fakeFetch(() => json(page));
    await igData('v25.0', f.fn).listMedia(TOKEN, 500);
    expect(f.calls).toHaveLength(1);
  });

  it('listMedia stops after a page cap even if every item is filtered out (the cursor can be endless)', async () => {
    const endless = { data: [{ id: 'x', media_type: 'MYSTERY' }], paging: { next: 'https://graph.instagram.com/v25.0/me/media?after=more' } };
    const f = fakeFetch(() => json(endless));
    expect(await igData('v25.0', f.fn).listMedia(TOKEN, 100)).toEqual([]);
    expect(f.calls).toHaveLength(3); // ceil(100 / 50) + 1
  });

  it('listMedia stops paging once the caller says the time is up', async () => {
    const f = fakeFetch((u) => json(fixture(u.searchParams.get('after') ? 'media-page-2' : 'media-page-1')));
    const items = await igData('v25.0', f.fn).listMedia(TOKEN, 500, undefined, () => true);
    expect(f.calls).toHaveLength(1);
    expect(items.length).toBeGreaterThan(0); // what the first page returned is kept
  });

  it('never follows a redirect (the token is in the query string)', async () => {
    const f = fakeFetch((u) => (u.pathname === '/v25.0/me' ? json(fixture('me')) : undefined));
    await igData('v25.0', f.fn).profile(TOKEN);
    expect(f.calls[0].init?.redirect).toBe('error');
  });

  it('listStories reads /me/stories and marks items STORY', async () => {
    const f = fakeFetch((u) => (u.pathname === '/v25.0/me/stories' ? json(fixture('stories')) : undefined));
    expect((await igData('v25.0', f.fn).listStories(TOKEN))[0]).toMatchObject({ kind: 'STORY' });
  });

  it('feedInsights maps saved -> saves and leaves story columns null', async () => {
    const f = fakeFetch((u) => (u.pathname === '/v25.0/18000000000000003/insights' ? json(fixture('media-insights-feed')) : undefined));
    const v = await igData('v25.0', f.fn).feedInsights(TOKEN, '18000000000000003');
    expect(v).toEqual({ reach: 900, views: 2400, likes: 120, comments: 8, shares: 14, saves: 30, totalInteractions: 172, replies: null, tapsForward: null, tapsBack: null, exits: null });
    expect(f.calls[0].url.searchParams.get('metric')).toBe('reach,views,likes,comments,shares,saved,total_interactions');
  });

  it('storyInsights combines metrics with the navigation breakdown (case-insensitive)', async () => {
    const f = fakeFetch((u) => json(fixture(u.searchParams.get('metric') === 'navigation' ? 'story-navigation' : 'media-insights-story')));
    const v = await igData('v25.0', f.fn).storyInsights(TOKEN, '18100000000000001');
    expect(v).toEqual({ reach: 310, views: 420, likes: null, comments: null, shares: 1, saves: null, totalInteractions: 5, replies: 2, tapsForward: 200, tapsBack: 40, exits: 60, swipeForward: 50 });
    expect(f.calls[1].url.searchParams.get('breakdown')).toBe('story_navigation_action_type');
  });

  it('audience asks for follower_demographics with a timeframe, not since/until', async () => {
    const f = fakeFetch(() => json(fixture('demographics-age-gender')));
    expect(await igData('v25.0', f.fn).audience(TOKEN, 'age_gender')).toEqual({ '18-24|F': 210, '25-34|M': 180, '25-34|F': 330 });
    expect(Object.fromEntries(f.calls[0].url.searchParams)).toMatchObject({ metric: 'follower_demographics', period: 'lifetime', metric_type: 'total_value', timeframe: 'this_month', breakdown: 'age,gender' });
    expect(f.calls[0].url.searchParams.has('since')).toBe(false);
  });

  it('onlineFollowers parses the hourly object', async () => {
    const f = fakeFetch(() => json(fixture('online-followers')));
    const [d] = await igData('v25.0', f.fn).onlineFollowers(TOKEN, 1, 2);
    expect(d.hourly).toHaveLength(24);
  });
});

describe('errors', () => {
  const fail = async (body: unknown, status: number) => igData('v25.0', fakeFetch(() => json(body, status)).fn).profile(TOKEN).catch((e) => e);

  it('carry code and subcode but never the token or the message', async () => {
    const e = await fail(fixture('error-token-expired'), 400);
    expect(e).toBeInstanceOf(InstagramApiError);
    expect(e).toMatchObject({ kind: 'data', status: 400, code: 190, subcode: 463 });
    expect(JSON.stringify({ m: e.message, ...e })).not.toContain(TOKEN);
    expect(e.message).not.toContain('Session has expired');
  });

  it('classify into what the sync should do', async () => {
    expect(classifyIgError(await fail(fixture('error-token-expired'), 400))).toBe('auth');
    expect(classifyIgError(await fail({ error: { code: 200 } }, 403))).toBe('auth');
    expect(classifyIgError(await fail(fixture('error-rate-limit'), 400))).toBe('rate_limit');
    expect(classifyIgError(await fail({ error: { code: 17 } }, 400))).toBe('rate_limit');
    expect(classifyIgError(await fail({}, 429))).toBe('rate_limit');
    expect(classifyIgError(await fail({ error: { code: 4 } }, 400))).toBe('app_rate_limit');
    expect(classifyIgError(await fail(fixture('error-not-enough-viewers'), 400))).toBe('no_data');
    expect(classifyIgError(await fail(fixture('error-object-missing'), 400))).toBe('gone');
    expect(classifyIgError(await fail({ error: { code: 100, error_subcode: 2108006 } }, 400))).toBe('no_data'); // posted before the account turned professional
    expect(classifyIgError(await fail({ error: { code: 2 } }, 500))).toBe('transient');
    expect(classifyIgError(await fail({}, 502))).toBe('transient');
    expect(classifyIgError(await fail({ error: { code: 100 } }, 400))).toBe('other');
    expect(classifyIgError(new InstagramApiError('network'))).toBe('transient');
    expect(classifyIgError(new Error('db down'))).toBe('other');
  });

  it('a network failure (including the request timeout) is transient', async () => {
    const boom = (async () => {
      throw new DOMException('timed out', 'TimeoutError');
    }) as typeof fetch;
    expect(classifyIgError(await igData('v25.0', boom).profile(TOKEN).catch((e) => e))).toBe('transient');
  });
});
