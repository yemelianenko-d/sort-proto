/* Basic service worker.
 * Update-safe strategy:
 *  - navigations (HTML) -> network-first, so a new deploy is picked up on
 *    the next visit instead of serving a stale cached shell forever;
 *  - level configs -> network-first with offline fallback;
 *  - hashed /assets/ and icons -> cache-first (immutable by filename). */
const CACHE = 'sortproto-v2';
const CORE = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(CORE)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function networkFirst(request) {
  return fetch(request)
    .then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
      }
      return res;
    })
    .catch(() => caches.match(request, { ignoreSearch: request.mode === 'navigate' }));
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Fresh HTML and fresh level configs whenever we are online.
  if (request.mode === 'navigate' || url.pathname.includes('/levels/')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // cache-first for hashed assets / icons / fonts
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((res) => {
          if (res.ok && url.origin === self.location.origin) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return res;
        }),
    ),
  );
});
