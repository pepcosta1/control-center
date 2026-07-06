// Service worker: memòria cau per a l'app shell; l'API sempre va per xarxa.
const CACHE = 'cc-v15';
const APP_SHELL = [
  '/',
  '/index.html',
  '/login.html',
  '/css/style.css',
  '/js/app.js',
  '/js/login.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Mai posar en cache l'API: estat en temps real i credencials
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // App shell: xarxa primer amb fallback a la cache (perquè els canvis arribin aviat)
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && event.request.method === 'GET') {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
