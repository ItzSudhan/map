/* Map: service worker. Caches the app shell so it opens instantly and works offline (map tiles still need a connection). */
const CACHE = 'map-shell-v5';
const SHELL = ['/', '/index.html', '/style.css', '/app.js', '/search.js', '/extras.js', '/mapx.js', '/streetview.js', '/sheet.js', '/overlays.js', '/overlays.css', '/tools.js', '/tools.css', '/icon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Own files: network first (always fresh after a deploy), fall back to cache when offline.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match('/index.html')))
  );
});
