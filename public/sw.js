// in2sight service worker. Hand-written, no build step (SPEC §8b.6).
// Caches ONLY static, content-hashed assets, the icons and the public offline page. Pages, RSC payloads, /api/* and
// every cross-origin request (Supabase, Instagram) are never cached and never answered from cache: on a shared device
// nothing private may outlive the session. Also shows Web Push notifications (SPEC §7c).
// Bump VERSION to drop the old cache (e.g. when the offline page changes).
const VERSION = 'v1';
const CACHE = `in2sight-static-${VERSION}`;
const OFFLINE = '/offline';
const PRECACHE = [OFFLINE, '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];
const STATIC = [/^\/_next\/static\//, /^\/icons\//, /^\/favicon\.ico$/];

self.addEventListener('install', (event) => {
  // the cache only holds immutable assets, so the new worker can take over at once
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('in2sight-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase, Instagram, fonts: straight to the network

  if (req.mode === 'navigate') {
    // pages are always fetched live; only when the network is down do we show the public offline page
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE).then((hit) => hit || Response.error())));
    return;
  }
  if (!STATIC.some((re) => re.test(url.pathname))) return; // RSC, /api, data: network only, never cached

  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            event.waitUntil(caches.open(CACHE).then((cache) => cache.put(req, copy)));
          }
          return res;
        }),
    ),
  );
});

/** Only same-origin paths may be opened from a notification. */
const safePath = (u) => (typeof u === 'string' && u.startsWith('/') && !u.startsWith('//') && !u.includes('\\') ? u : '/overview');
const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = text(data.title, 120) || 'in2sight';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: text(data.body, 300),
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: text(data.tag, 100) || undefined,
      data: { url: safePath(data.url) },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(safePath(event.notification.data && event.notification.data.url), self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const open = wins.find((w) => w.url === target);
      return open ? open.focus() : self.clients.openWindow(target);
    }),
  );
});
