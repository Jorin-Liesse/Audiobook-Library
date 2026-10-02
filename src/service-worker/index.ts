import { version } from '$app/env';
import { assets, immutable, prerendered } from '$app/manifest';
import { self } from '$app/service-worker';

// Scope the caches so other apps on the same origin keep their own caches.
const prefix = `audiobook-library:${self.registration.scope}:`;
const cacheName = `${prefix}${version}`;
const appFiles = new Set<string>(
  [...immutable, ...assets, ...prerendered].map(
    ({ path }) => new URL(path, self.registration.scope).pathname
  )
);
const home = new URL(self.registration.scope).pathname;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(cacheName);
      // Include every chunk, even the tag reader that loads only when a book opens.
      await cache.addAll(
        [...appFiles].map(
          (path) => new Request(new URL(path, self.location.origin), { cache: 'reload' })
        )
      );
    })()
  );
  // Let updates wait for existing tabs to close, keeping ongoing playback intact.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith(prefix) && name !== cacheName)
          .map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  // Local audio uses blob URLs. Do not cache media, partial responses, or external requests.
  if (
    request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    request.headers.has('range')
  )
    return;

  // Static hosts may serve the entry page with a slash or an explicit index.html.
  const path =
    url.pathname === home.replace(/\/$/, '') || url.pathname === `${home}index.html`
      ? home
      : url.pathname;
  if (!appFiles.has(path)) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(cacheName);
      // Ignore query strings so a bookmarked or installed entry URL works offline too.
      const cached = await cache.match(path);
      if (cached) return cached;

      const response = await fetch(request);
      if (response.status === 200) await cache.put(path, response.clone());
      return response;
    })()
  );
});
