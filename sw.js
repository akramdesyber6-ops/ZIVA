'use strict';

const CACHE_NAME = 'ziva-shell-v1';
const SHELL = [
  '/',
  '/anime',
  '/account',
  '/plans',
  '/offline.html',
  '/styles.css',
  '/app.js',
  '/src/catalogue.js',
  '/src/catalogue-sections.js',
  '/src/api-client.js',
  '/src/library-client.js',
  '/anime.js',
  '/account.js',
  '/manifest.json',
  '/assets/icons/ziva.svg'
];
const PRIVATE_API = /^\/api\/(?:auth|admin|library|watch-history|playback|profile|billing)(?:\/|$)/;
const PUBLIC_METADATA_API = /^\/api\/(?:tmdb|anime)$/;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('ziva-shell-') && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || PRIVATE_API.test(url.pathname)) return;

  if (PUBLIC_METADATA_API.test(url.pathname)) {
    event.respondWith(fetch(request).then(async (response) => {
      if (response.ok) {
        const copy = response.clone();
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, copy);
        const keys = await cache.keys();
        if (keys.length > 50) await Promise.all(keys.slice(0, keys.length - 50).map((key) => cache.delete(key)));
      }
      return response;
    }).catch(async () => {
      const cached = await caches.match(request);
      return cached || Response.json({ error: 'OFFLINE', message: 'Catalogue data is unavailable offline.' }, { status: 503 });
    }));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => {
      const cached = await caches.match(request);
      return cached || caches.match('/offline.html');
    }));
    return;
  }

  if (request.destination === 'script' || request.destination === 'style' || request.destination === 'image' || url.pathname === '/manifest.json') {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return response;
    })));
  }
});
