/* Full Steam Ahead — service worker (hand-rolled; no build tooling).
 *
 * Goals: make the LMS installable (home-screen / standalone) and load the app
 * shell fast. The LMS is network-dependent (AI tutor, exams, lesson content),
 * so this intentionally does NOT try to make those work offline — it only
 * caches immutable build assets and shows a friendly page if you open the app
 * with no connection.
 *
 * Served from the site root on learn.* (express.static mounts client-v2/build
 * at /), so its scope is "/" and it controls the whole app.
 */
const CACHE = 'fsa-shell-v2';        // bump to invalidate old caches on deploy
const OFFLINE_URL = '/offline.html';
const ASSET_RE = /\/v2\/assets\//;   // hashed, immutable build assets

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.add(OFFLINE_URL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;                 // fonts, GA, etc.
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/media')) return; // never cache

  // Page navigations: always try the network first (so online users get the
  // latest build + live data); fall back to a friendly offline page.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await fetch(request);
      } catch {
        return (await caches.match(OFFLINE_URL)) || Response.error();
      }
    })());
    return;
  }

  // Hashed build assets are content-addressed and immutable → cache-first.
  if (ASSET_RE.test(url.pathname)) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const net = await fetch(request);
      const cache = await caches.open(CACHE);
      cache.put(request, net.clone());
      return net;
    })());
    return;
  }

  // Icons / manifest / other root static files: stale-while-revalidate.
  if (/\.(png|svg|webmanifest|ico)$/.test(url.pathname)) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      const network = fetch(request).then((net) => {
        caches.open(CACHE).then((c) => c.put(request, net.clone()));
        return net;
      }).catch(() => cached);
      return cached || network;
    })());
  }
});
