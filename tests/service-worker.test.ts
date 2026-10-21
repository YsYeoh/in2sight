// public/sw.js runs in a fake service-worker global (node:vm): event handlers, caches, fetch and clients are fakes.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { NAV_ITEMS } from '@/lib/nav';

const SRC = readFileSync(join(process.cwd(), 'public/sw.js'), 'utf8');
const ORIGIN = 'https://app.test';
type Handler = (e: Record<string, unknown>) => void;
type Req = { url: string; method: string; mode: string; destination?: string };
type Win = { url: string; frameType: string; focus: () => void; postMessage: (m: unknown) => void };

const basic = (body: string, status = 200) => Object.defineProperty(new Response(body, { status }), 'type', { value: 'basic' }); // like a same-origin fetch

function load(o: { offline?: boolean; status?: number } = {}) {
  const handlers: Record<string, Handler> = {};
  const store = new Map<string, Map<string, Response>>();
  const key = (r: string | Req) => (typeof r === 'string' ? new URL(r, ORIGIN).href : r.url);
  const caches = {
    open: vi.fn(async (name: string) => {
      if (!store.has(name)) store.set(name, new Map());
      const m = store.get(name)!;
      return {
        addAll: async (urls: string[]) => urls.forEach((u) => m.set(key(u), basic(`cached ${u}`))),
        put: async (r: Req, res: Response) => void m.set(key(r), res),
        keys: async () => [...m.keys()].map((url) => ({ url, method: 'GET', mode: 'cors' })), // insertion order, like the real Cache
        delete: async (r: Req) => m.delete(key(r)),
      };
    }),
    match: async (r: string | Req) => [...store.values()].find((m) => m.has(key(r)))?.get(key(r)),
    keys: async () => [...store.keys()],
    delete: vi.fn(async (k: string) => store.delete(k)),
  };
  const fetch = vi.fn(async (r: Req) => (o.offline ? Promise.reject(new TypeError('Failed to fetch')) : basic(`network ${r.url}`, o.status)));
  const self = {
    addEventListener: (t: string, fn: Handler) => void (handlers[t] = fn),
    location: { origin: ORIGIN },
    skipWaiting: vi.fn(async () => {}),
    clients: { claim: vi.fn(async () => {}), matchAll: vi.fn(async () => [] as Win[]), openWindow: vi.fn(async () => null) },
    registration: { showNotification: vi.fn(async () => {}) },
  };
  runInNewContext(SRC, { self, caches, fetch, Response, URL, Promise, console });
  const fire = (type: string, init: Record<string, unknown> = {}) => {
    const waits: Promise<unknown>[] = [];
    let responded: Promise<Response> | undefined;
    handlers[type]({ ...init, waitUntil: (p: Promise<unknown>) => void waits.push(p), respondWith: (p: Promise<Response>) => void (responded = p) });
    return { responded, settled: () => Promise.all(waits) };
  };
  return { fire, store, caches, fetch, self };
}

const req = (path: string, o: Partial<Req> = {}): Req => ({ url: new URL(path, ORIGIN).href, method: 'GET', mode: 'cors', ...o });
const cachedUrls = (store: Map<string, Map<string, Response>>) => [...store.values()].flatMap((m) => [...m.keys()]);

describe('service worker', () => {
  it('install precaches the offline page and icons, then activates at once', async () => {
    const sw = load();
    await sw.fire('install').settled();
    expect(cachedUrls(sw.store).sort()).toEqual([`${ORIGIN}/icons/icon-192.png`, `${ORIGIN}/icons/icon-512.png`, `${ORIGIN}/offline`]);
    expect([...sw.store.keys()]).toEqual(['in2sight-static-v1']);
    expect(sw.self.skipWaiting).toHaveBeenCalled();
  });

  it('activate drops older in2sight caches only, then claims open pages', async () => {
    const sw = load();
    for (const k of ['in2sight-static-v0', 'in2sight-static-v1', 'someone-else']) sw.store.set(k, new Map());
    await sw.fire('activate').settled();
    expect([...sw.store.keys()].sort()).toEqual(['in2sight-static-v1', 'someone-else']);
    expect(sw.self.clients.claim).toHaveBeenCalled();
  });

  it('never caches /api, pages, RSC or cross-origin responses', async () => {
    const sw = load();
    for (const r of [req('/api/cron/tick'), req('/api/instagram/connect'), req('/overview?_rsc=1x2y'), req('/accounts/7b0c7c2e?tab=posts'), req('https://abc.supabase.co/rest/v1/media'), req('https://scontent.cdninstagram.com/a.jpg'), req('/_next/static/a.js', { method: 'POST' })]) {
      expect(sw.fire('fetch', { request: r }).responded, r.url).toBeUndefined(); // not intercepted: the browser fetches it normally
    }
    const page = sw.fire('fetch', { request: req('/overview', { mode: 'navigate' }) });
    expect(await (await page.responded!).text()).toBe(`network ${ORIGIN}/overview`);
    await page.settled();
    expect(cachedUrls(sw.store)).toEqual([]);
  });

  it('static assets: fetched once, then served from the cache', async () => {
    const sw = load();
    const first = sw.fire('fetch', { request: req('/_next/static/chunks/app.js') });
    expect(await (await first.responded!).text()).toBe(`network ${ORIGIN}/_next/static/chunks/app.js`);
    await first.settled();
    const second = sw.fire('fetch', { request: req('/_next/static/chunks/app.js') });
    await second.responded;
    expect(sw.fetch).toHaveBeenCalledTimes(1);
    expect(cachedUrls(sw.store)).toEqual([`${ORIGIN}/_next/static/chunks/app.js`]);
  });

  it('offline: a page navigation gets the cached public offline page', async () => {
    const sw = load({ offline: true });
    sw.store.set('in2sight-static-v1', new Map([[`${ORIGIN}/offline`, basic('offline page')]]));
    const r = sw.fire('fetch', { request: req('/accounts', { mode: 'navigate' }) });
    expect(await (await r.responded!).text()).toBe('offline page');
  });

  it('push shows the notification with the sent title, body, tag and same-origin url', async () => {
    const sw = load();
    const data = { json: () => ({ title: 'Reconnect needed', body: '@cafe lost its connection', url: '/accounts', tag: 'needs_reconnect:a1' }) };
    await sw.fire('push', { data }).settled();
    expect(sw.self.registration.showNotification).toHaveBeenCalledWith('Reconnect needed', { body: '@cafe lost its connection', icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: 'needs_reconnect:a1', data: { url: '/accounts' } });
  });

  it('push with junk, oversized or hostile data still shows something safe', async () => {
    const sw = load();
    await sw.fire('push', { data: { json: () => { throw new SyntaxError('not json'); } } }).settled();
    await sw.fire('push', { data: { json: () => ({ title: 'x'.repeat(500), body: 42, url: 'https://evil.example/phish' }) } }).settled();
    await sw.fire('push', { data: { json: () => ({ title: 'T', url: '//evil.example' }) } }).settled();
    const calls = sw.self.registration.showNotification.mock.calls as unknown as [string, { body: string; data: { url: string } }][];
    expect(calls[0][0]).toBe('in2sight');
    expect(calls[1][0]).toHaveLength(120);
    expect(calls[1][1].body).toBe('');
    expect(calls.map((c) => c[1].data.url)).toEqual(['/overview', '/overview', '/overview']);
  });

  it('does not cache a non-200 static response (e.g. a 206 partial)', async () => {
    const sw = load({ status: 206 });
    const r = sw.fire('fetch', { request: req('/_next/static/chunks/big.js') });
    await r.responded;
    await r.settled();
    expect(cachedUrls(sw.store)).toEqual([]);
  });

  it('activate trims the static cache to 150 entries (oldest first) once it holds more than 200', async () => {
    const sw = load();
    const big = new Map<string, Response>(Array.from({ length: 201 }, (_, i) => [`${ORIGIN}/_next/static/c${i}.js`, basic('x')]));
    sw.store.set('in2sight-static-v1', big);
    await sw.fire('activate').settled();
    const left = [...big.keys()];
    expect(left).toHaveLength(150);
    expect(left[0]).toBe(`${ORIGIN}/_next/static/c51.js`);
    expect(left.at(-1)).toBe(`${ORIGIN}/_next/static/c200.js`);
  });

  it('activate leaves a cache of 200 or fewer entries alone', async () => {
    const sw = load();
    const m = new Map<string, Response>(Array.from({ length: 200 }, (_, i) => [`${ORIGIN}/_next/static/c${i}.js`, basic('x')]));
    sw.store.set('in2sight-static-v1', m);
    await sw.fire('activate').settled();
    expect(m.size).toBe(200);
  });

  it.each([
    ['tab hidden in the path', '/\t/evil.example'],
    ['protocol-relative', '//evil.example'],
    ['backslash host', '\\\\evil.example'],
    ['single backslash host', '/\\evil.example'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['absolute foreign url', 'https://evil.example/x'],
  ])('push url: %s falls back to /overview', async (_n, url) => {
    const sw = load();
    await sw.fire('push', { data: { json: () => ({ title: 'T', url }) } }).settled();
    const call = (sw.self.registration.showNotification.mock.calls as unknown as [string, { data: { url: string } }][])[0];
    expect(call[1].data.url).toBe('/overview');
  });

  it('push url: a normal path with query and hash is kept', async () => {
    const sw = load();
    await sw.fire('push', { data: { json: () => ({ title: 'T', url: '/accounts/a1?tab=posts#top' }) } }).settled();
    const call = (sw.self.registration.showNotification.mock.calls as unknown as [string, { data: { url: string } }][])[0];
    expect(call[1].data.url).toBe('/accounts/a1?tab=posts#top');
  });

  it('a tab frame’s navigation is left to the browser (keeps Sec-Fetch-Dest: iframe); a top-level navigation is still answered', async () => {
    const sw = load();
    expect(sw.fire('fetch', { request: req('/overview', { mode: 'navigate', destination: 'iframe' }) }).responded).toBeUndefined();
    expect(sw.fire('fetch', { request: req('/overview', { mode: 'navigate', destination: 'document' }) }).responded).toBeDefined();
  });

  it('notification click without an app window opens one at the page', async () => {
    const sw = load();
    const close = vi.fn();
    await sw.fire('notificationclick', { notification: { close, data: { url: '/accounts' } } }).settled();
    expect(close).toHaveBeenCalled();
    expect(sw.self.clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}/accounts`);
  });

  it('notification click asks the top-level app window to open the page as a tab and focuses it; frames and other pages are ignored', async () => {
    const sw = load();
    const win = (path: string, frameType: string): Win => ({ url: `${ORIGIN}${path}`, frameType, focus: vi.fn(), postMessage: vi.fn() });
    const frame = win('/accounts/a1?tab=posts', 'nested');
    const report = win('/report?scope=all', 'top-level');
    const shell = win('/explorer', 'top-level');
    sw.self.clients.matchAll.mockResolvedValueOnce([frame, report, shell]);
    await sw.fire('notificationclick', { notification: { close: vi.fn(), data: { url: '/accounts/a1?tab=posts' } } }).settled();
    expect(shell.postMessage).toHaveBeenCalledWith({ type: 'in2sight:open', url: '/accounts/a1?tab=posts' });
    expect(shell.focus).toHaveBeenCalled();
    for (const w of [frame, report]) expect(w.postMessage).not.toHaveBeenCalled();
    expect(sw.self.clients.openWindow).not.toHaveBeenCalled();
  });

  it('the worker knows the same tab pages as the app navigation', () => {
    const re = SRC.match(/const TAB_PAGE = (\/.+\/);/)![1];
    for (const { href } of NAV_ITEMS) expect(new RegExp(re.slice(1, -1)).test(href), href).toBe(true);
    expect(re).toContain(NAV_ITEMS.map((i) => i.href.slice(1)).join('|'));
  });
});
