// service-worker.js (image-only cache, dev-friendly)

const CACHE_NAME = 'anime-images-v2';
const MAX_ENTRIES = 300;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    )
  );
});

async function limitCacheEntries(cache, maxEntries) {
  const keys = await cache.keys();
  if (keys.length > maxEntries) {
    const deleteCount = keys.length - maxEntries;
    for (let i = 0; i < deleteCount; i++) {
      await cache.delete(keys[i]);
    }
  }
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.destination === 'image') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      if (cached) return cached;

      const response = await fetch(req);
      if (response && (response.status === 200 || response.type === 'opaque')) {
        await cache.put(req, response.clone());
        await limitCacheEntries(cache, MAX_ENTRIES);
      }
      return response;
    })());
  }
});

self.addEventListener('message', event => {
  if (!event.data) return;
  if (event.data.action === 'cacheImages' && Array.isArray(event.data.urls)) {
    caches.open(CACHE_NAME).then(async cache => {
      for (const url of event.data.urls) {
        if (!url.match(/\.(png|jpe?g|webp|gif|avif)$/i)) continue;
        const cached = await cache.match(url);
        if (cached) continue;
        try {
          const resp = await fetch(url, { mode: 'no-cors' });
          if (resp && (resp.status === 200 || resp.type === 'opaque')) {
            await cache.put(url, resp.clone());
            await limitCacheEntries(cache, MAX_ENTRIES);
          }
        } catch {}
      }
    });
  }
});
