// Clara's offline cache.
//
// Bump VERSION whenever the cached file list changes; the activate handler
// deletes every older cache, so a stale shell can never linger.
//
// Strategy differs by request kind on purpose:
//   - the page itself is network-first, so a republish reaches you on the next
//     online load rather than being pinned to whatever was cached first
//   - icons, the manifest and webfonts are cache-first, since they change
//     rarely and this is what makes a cold offline launch fast
const VERSION = 'clara-v2';

const CORE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './logo.svg',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './favicon-32.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(VERSION)
      // addAll is all-or-nothing, so one missing file would leave us with no
      // cache at all; add them individually and tolerate misses.
      .then(cache => Promise.all(CORE.map(url => cache.add(url).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isPage(request, url) {
  return request.mode === 'navigate'
    || url.pathname.endsWith('/')
    || url.pathname.endsWith('/index.html');
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try { url = new URL(request.url); } catch (e) { return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  if (isPage(request, url)) {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(VERSION).then(cache => cache.put(request, copy)).catch(() => {});
          return response;
        })
        .catch(() => caches.match(request).then(hit => hit || caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(hit => {
      if (hit) return hit;
      return fetch(request).then(response => {
        // Opaque responses (the Google Fonts files) report ok === false but are
        // still worth keeping, otherwise the type falls back offline.
        if (response && (response.ok || response.type === 'opaque')) {
          const copy = response.clone();
          caches.open(VERSION).then(cache => cache.put(request, copy)).catch(() => {});
        }
        return response;
      });
    })
  );
});
