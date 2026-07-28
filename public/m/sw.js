// LimoFin companion service worker: cache the app shell so the PWA opens
// instantly (and offline) on the phone. API calls always go to the network —
// offline glance data comes from localStorage in m.js, and receipt queueing
// lives in IndexedDB, so no finance data is ever cached here.
const CACHE = 'limofin-m-v1';
const SHELL = [
  '/m/',
  '/m/index.html',
  '/m/m.css',
  '/m/m.js',
  '/m/manifest.webmanifest',
  '/m/icons/icon-180.png',
  '/m/icons/icon-192.png',
  '/m/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    return; // network only
  }
  if (!url.pathname.startsWith('/m')) {
    return;
  }

  // Shell: cache-first, refresh in the background.
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cached) => {
      const refresh = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);
      if (cached) {
        return cached;
      }
      if (event.request.mode === 'navigate') {
        return refresh.catch(() => caches.match('/m/'));
      }
      return refresh;
    })
  );
});
