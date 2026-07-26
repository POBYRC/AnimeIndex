const CACHE_NAME = 'anime-images-v6';
const MAX_ENTRIES = 300;
const PRUNE_BUFFER = 25; // avoid pruning on every single insert
const WARM_CACHE_CONCURRENCY = 6;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

function isLikelyImageUrl(url) {
  return /\.(png|jpe?g|webp|gif|avif|svg|bmp|ico)(\?.*)?(#.*)?$/i.test(url);
}

async function pruneOldestEntries(cache, maxEntries) {
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;

  const deleteCount = keys.length - maxEntries;
  await Promise.all(keys.slice(0, deleteCount).map(key => cache.delete(key)));
}

async function putImageInCache(cache, request, response) {
  if (!response) return false;
  if (response.status !== 200 && response.type !== 'opaque') return false;

  await cache.put(request, response.clone());
  return true;
}

async function maybePruneCache(cache) {
  const keys = await cache.keys();
  if (keys.length > MAX_ENTRIES + PRUNE_BUFFER) {
    await pruneOldestEntries(cache, MAX_ENTRIES);
  }
}

self.addEventListener('fetch', event => {
  const req = event.request;

  // Cache only image GET requests
  if (req.method !== 'GET' || req.destination !== 'image') return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);

    // Cache-first: if cached exists, use it and do not re-fetch.
    if (cached) return cached;

    // Only new images (cache miss) are fetched from network.
    const networkResponse = await fetch(req);
    const stored = await putImageInCache(cache, req, networkResponse);

    if (stored) {
      event.waitUntil(maybePruneCache(cache));
    }

    return networkResponse;
  })());
});

self.addEventListener('message', event => {
  if (!event.data) return;

  if (event.data.action === 'cacheImages' && Array.isArray(event.data.urls)) {
    event.waitUntil((async () => {
      const cache = await caches.open(CACHE_NAME);
      const uniqueUrls = [...new Set(event.data.urls.filter(Boolean))].filter(isLikelyImageUrl);

      for (let i = 0; i < uniqueUrls.length; i += WARM_CACHE_CONCURRENCY) {
        const batch = uniqueUrls.slice(i, i + WARM_CACHE_CONCURRENCY);

        await Promise.all(batch.map(async url => {
          const cached = await cache.match(url);
          if (cached) return;

          try {
            const req = new Request(url, { mode: 'no-cors' });
            const resp = await fetch(req);
            await putImageInCache(cache, req, resp);
          } catch {
            // Skip failing URLs
          }
        }));
      }

      await maybePruneCache(cache);
    })());
  }
});
