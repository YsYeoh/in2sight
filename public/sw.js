// in2sight service worker. Hand-written, no build step (SPEC §8b.6).
// Caches ONLY static, content-hashed assets, the icons and the public offline page. Pages, RSC payloads, /api/* and
// every cross-origin request (Supabase, Instagram) are never cached and never answered from cache: on a shared device
// nothing private may outlive the session. Also shows Web Push notifications (SPEC §7c).
// Bump VERSION to drop the old cache (e.g. when the offline page changes).
const VERSION = 'v1';
const CACHE = `in2sight-static-${VERSION}`;
const OFFLINE = '/offline';
const PRECACHE = [OFFLINE, '/icons/icon-192.png', '/icons/icon-512.png'];
// ponytail: old hashed chunks are evicted only on a VERSION bump, plus this crude cap (oldest first by insertion order).
const MAX_ENTRIES = 200;
const KEEP_ENTRIES = 150;
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
      .then(() => caches.open(CACHE))
      .then((cache) =>
        cache.keys().then((reqs) => (reqs.length > MAX_ENTRIES ? Promise.all(reqs.slice(0, reqs.length - KEEP_ENTRIES).map((r) => cache.delete(r))) : null)),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase, Instagram, fonts: straight to the network

  // A tab's frame (Plan 14c) is left to the browser: a fetch() from here would drop its `Sec-Fetch-Dest: iframe`, which
  // the app reads to render the page without the shell chrome. Offline, that frame shows the browser's own error.
  if (req.mode === 'navigate' && req.destination === 'iframe') return;
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
          if (res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            event.waitUntil(caches.open(CACHE).then((cache) => cache.put(req, copy)));
          }
          return res;
        }),
    ),
  );
});

/** Only same-origin paths may be opened from a notification. */
const safePath = (u) => {
  if (typeof u !== 'string') return '/overview';
  try {
    // resolve first: new URL() strips tab/CR/LF and turns backslashes into slashes, so only the resolved origin can be trusted
    const r = new URL(u, self.location.origin);
    return r.origin === self.location.origin ? r.pathname + r.search + r.hash : '/overview';
  } catch {
    return '/overview';
  }
};
/** The app's tab pages (the shell lives on them): the same sections as NAV_ITEMS in lib/nav.ts (the worker test checks). */
const TAB_PAGE = /^\/(overview|accounts|tags|calendar|explorer|settings)(\/|$)/;
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
  const path = safePath(event.notification.data && event.notification.data.url);
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      // The app's frames (tabs, Plan 14c) are window clients too: talk to a top-level window showing the app shell only.
      // It opens the page as a tab, or jumps to the tab that already shows it; without one the page opens in a new window.
      const top = wins.find((w) => w.frameType === 'top-level' && TAB_PAGE.test(new URL(w.url).pathname));
      if (!top) return self.clients.openWindow(new URL(path, self.location.origin).href);
      top.postMessage({ type: 'in2sight:open', url: path });
      return top.focus();
    }),
  );
});
