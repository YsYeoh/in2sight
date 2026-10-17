import { describe, expect, it } from 'vitest';
import type { MediaDetails } from '@/lib/instagram/parse';
import { afterFailure, COVER_MAX_BYTES, coverPath, coverUrl, fetchImage, isCdnUrl, pickCoverDue, type CoverRef } from '@/lib/sync/covers';

const CDN = 'https://scontent-sin6-1.cdninstagram.com/v/t51.29350-15/abc_n.jpg?stp=dst-jpg&_nc_ht=x&oe=670A1B2C&_nc_sig=SECRET';
const FB = 'https://scontent.xx.fbcdn.net/v/t39/abc.jpg?oe=670A1B2C&_nc_sig=SECRET';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);

function img(body: BodyInit | null = JPEG, headers: Record<string, string> = { 'content-type': 'image/jpeg' }, status = 200) {
  return new Response(body, { status, headers });
}
/** fetch fake: answers by URL; records each URL and RequestInit it was asked for. */
function cdn(routes: Record<string, () => Response>) {
  const seen: { url: string; init?: RequestInit }[] = [];
  const fn = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    seen.push({ url, init });
    const r = routes[url];
    if (!r) throw new TypeError('fetch failed');
    return r();
  }) as typeof fetch;
  return { fn, seen };
}

describe('isCdnUrl', () => {
  it('accepts https Instagram CDN hosts and their subdomains', () => {
    for (const u of [CDN, FB, 'https://fbcdn.net/x.jpg', 'https://CDNINSTAGRAM.COM/x.jpg', 'https://a.b.fbcdn.net:443/x.jpg']) expect(isCdnUrl(u), u).toBe(true);
  });
  it('rejects look-alikes, other schemes, credentials, odd ports, IPs and garbage', () => {
    for (const u of ['http://scontent.cdninstagram.com/x.jpg', 'https://fbcdn.net.evil.com/x.jpg', 'https://evilfbcdn.net/x.jpg', 'https://cdninstagram.com.attacker.io/x', 'https://user:pw@scontent.fbcdn.net/x.jpg', 'https://scontent.fbcdn.net:8443/x.jpg', 'https://157.240.1.1/x.jpg', 'https://localhost/x', 'file:///etc/passwd', 'javascript:alert(1)', 'not a url', ''])
      expect(isCdnUrl(u), u).toBe(false);
  });
});

describe('coverUrl', () => {
  const d = (o: Partial<MediaDetails>): MediaDetails => ({ mediaType: null, productType: null, likeCount: null, commentsCount: null, isSharedToFeed: null, mediaUrl: null, thumbnailUrl: null, childrenCount: null, children: null, ...o });
  it('video/Reel -> thumbnail (never the mp4); photo -> media_url; carousel -> first child', () => {
    expect(coverUrl(d({ mediaType: 'VIDEO', mediaUrl: 'mp4', thumbnailUrl: 'thumb' }))).toBe('thumb');
    expect(coverUrl(d({ mediaType: 'VIDEO', mediaUrl: 'mp4' }))).toBeNull();
    expect(coverUrl(d({ mediaType: 'IMAGE', mediaUrl: 'img' }))).toBe('img');
    expect(coverUrl(d({ mediaType: 'CAROUSEL_ALBUM', mediaUrl: 'parent', children: [{ mediaType: 'VIDEO', mediaUrl: 'mp4', thumbnailUrl: 'kid-thumb' }] }))).toBe('kid-thumb');
    expect(coverUrl(d({ mediaType: 'IMAGE' }))).toBeNull(); // copyrighted media: Meta omits media_url
    expect(coverUrl(undefined)).toBeNull();
  });
});

describe('fetchImage', () => {
  it('downloads a JPEG from the CDN without following redirects automatically', async () => {
    const f = cdn({ [CDN]: () => img() });
    const r = await fetchImage(CDN, f.fn);
    expect(r).toEqual({ ok: true, bytes: JPEG, contentType: 'image/jpeg' });
    expect(f.seen[0].init?.redirect).toBe('manual');
    expect(f.seen[0].init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('follows a redirect only to another CDN host (relative locations too), at most 3 hops', async () => {
    const hop = (to: string) => () => new Response(null, { status: 302, headers: { location: to } });
    const ok = cdn({ [CDN]: hop(FB), [FB]: () => img(JPEG, { 'content-type': 'image/webp' }) });
    expect(await fetchImage(CDN, ok.fn)).toMatchObject({ ok: true, contentType: 'image/webp' });
    const rel = cdn({ [CDN]: hop('/v/other.jpg'), 'https://scontent-sin6-1.cdninstagram.com/v/other.jpg': () => img() });
    expect(await fetchImage(CDN, rel.fn)).toMatchObject({ ok: true });
    const evil = cdn({ [CDN]: hop('https://169.254.169.254/latest/meta-data') });
    expect(await fetchImage(CDN, evil.fn)).toEqual({ ok: false, reason: 'blocked' });
    expect(evil.seen).toHaveLength(1); // the metadata address was never requested
    const loop = cdn({ [CDN]: hop(FB), [FB]: hop(CDN) });
    expect(await fetchImage(CDN, loop.fn)).toEqual({ ok: false, reason: 'blocked' });
    expect(loop.seen).toHaveLength(4);
  });

  it('refuses non-CDN URLs before any request', async () => {
    const f = cdn({});
    expect(await fetchImage('https://example.com/x.jpg', f.fn)).toEqual({ ok: false, reason: 'blocked' });
    expect(f.seen).toHaveLength(0);
  });

  it('expired link (403/404/410), SVG, HTML, empty body', async () => {
    for (const status of [403, 404, 410]) expect(await fetchImage(CDN, cdn({ [CDN]: () => img('denied', { 'content-type': 'text/plain' }, status) }).fn)).toEqual({ ok: false, reason: 'http' });
    expect(await fetchImage(CDN, cdn({ [CDN]: () => img('<svg onload="x()"/>', { 'content-type': 'image/svg+xml' }) }).fn)).toEqual({ ok: false, reason: 'type' });
    expect(await fetchImage(CDN, cdn({ [CDN]: () => img('<html>', { 'content-type': 'text/html; charset=utf-8' }) }).fn)).toEqual({ ok: false, reason: 'type' });
    expect(await fetchImage(CDN, cdn({ [CDN]: () => img(new Uint8Array(0)) }).fn)).toEqual({ ok: false, reason: 'http' });
  });

  it('over 5 MB: refused by the declared length, and cut off while streaming when the length lies', async () => {
    expect(await fetchImage(CDN, cdn({ [CDN]: () => img(JPEG, { 'content-type': 'image/jpeg', 'content-length': String(COVER_MAX_BYTES + 1) }) }).fn)).toEqual({ ok: false, reason: 'too_large' });
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({ pull: (c) => void ((pulled += 1), c.enqueue(new Uint8Array(1024 * 1024))) });
    expect(await fetchImage(CDN, cdn({ [CDN]: () => img(endless) }).fn)).toEqual({ ok: false, reason: 'too_large' });
    expect(pulled).toBeLessThan(10);
  });

  it('network failure or timeout -> network; the result never carries the URL', async () => {
    const r = await fetchImage(CDN, (async () => Promise.reject(new DOMException('timed out', 'TimeoutError'))) as typeof fetch);
    expect(r).toEqual({ ok: false, reason: 'network' });
    expect(JSON.stringify(r)).not.toContain('SECRET');
  });
});

describe('cover retry policy', () => {
  const NOW = new Date('2026-10-14T02:00:00Z');
  const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();
  const ref = (o: Partial<CoverRef> & { id: string }): CoverRef => ({ kind: 'IMAGE', postedAt: minsAgo(60), status: 'pending', attempts: 0, triedAt: null, ...o });
  it('never tried, or failed with its back-off (30, 60, 120… min) passed; newest first; capped', () => {
    const refs = [
      ref({ id: 'old-pending', postedAt: minsAgo(9000) }),
      ref({ id: 'new-pending', postedAt: minsAgo(10) }),
      ref({ id: 'failed-1-wait', status: 'failed', attempts: 1, triedAt: minsAgo(20) }),
      ref({ id: 'failed-1-due', status: 'failed', attempts: 1, triedAt: minsAgo(31), postedAt: minsAgo(30) }),
      ref({ id: 'failed-3-wait', status: 'failed', attempts: 3, triedAt: minsAgo(100) }),
      ref({ id: 'ok', status: 'ok' }),
      ref({ id: 'gave-up', status: 'unavailable' }),
    ];
    expect(pickCoverDue(refs, NOW, 10).map((r) => r.id)).toEqual(['new-pending', 'failed-1-due', 'old-pending']);
    expect(pickCoverDue(refs, NOW, 1).map((r) => r.id)).toEqual(['new-pending']);
  });
  it('gives up after 5 attempts', () => {
    expect(afterFailure(0)).toEqual({ status: 'failed', attempts: 1 });
    expect(afterFailure(3)).toEqual({ status: 'failed', attempts: 4 });
    expect(afterFailure(4)).toEqual({ status: 'unavailable', attempts: 5 });
  });
  it('object key = account/media.jpg', () => {
    expect(coverPath('3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b', '17900000000000001')).toBe('3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b/17900000000000001.jpg');
  });
});
