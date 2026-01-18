// service-worker.js
const CACHE_NAME = 'anime-images-v1';
const MAX_ENTRIES = 300;

// ================= INSTALL / ACTIVATE =================
self.addEventListener('install', () => {
  console.log('[SW] Installing...');
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => {
            console.log('[SW] Deleting old cache:', k);
            return caches.delete(k);
          })
      )
    ).then(() => {
      console.log('[SW] Claiming clients');
      return self.clients.claim();
    })
  );
});

// ================= CACHE LIMIT =================
async function limitCacheEntries(cache, maxEntries) {
  const keys = await cache.keys();
  if (keys.length > maxEntries) {
    const deleteCount = keys.length - maxEntries;
    console.log(`[SW] Cache limit exceeded, deleting ${deleteCount} old entries`);
    for (let i = 0; i < deleteCount; i++) {
      await cache.delete(keys[i]);
    }
  }
}

// ================= FETCH HANDLER (IMAGES) =================
self.addEventListener('fetch', event => {
  const req = event.request;

  // จัดการเฉพาะ image
  if (
    req.destination === 'image' ||
    (req.headers.get('accept') || '').includes('image')
  ) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);

        // 1️⃣ เช็ค cache ก่อน
        const cached = await cache.match(req);
        if (cached) {
          console.log('[SW] 🟢 image from cache:', req.url);
          return cached;
        }

        // 2️⃣ ถ้าไม่มี → fetch
        console.log('[SW] 🔵 image fetched from network:', req.url);
        try {
          const response = await fetch(req);

          if (response && (response.status === 200 || response.type === 'opaque')) {
            try {
              await cache.put(req, response.clone());
              console.log('[SW] 🟡 image cached:', req.url);
              await limitCacheEntries(cache, MAX_ENTRIES);
            } catch (e) {
              console.warn('[SW] ⚠️ cache put failed (quota?):', req.url, e);
            }
          }
          return response;
        } catch (err) {
          console.error('[SW] 🔴 fetch failed:', req.url, err);
          // fallback: ถ้ามี cache เก่า (กรณี race)
          return cached || Response.error();
        }
      })()
    );
  }
  // request อื่น ๆ ปล่อยผ่านปกติ
});

// ================= WARM CACHE FROM PAGE =================
self.addEventListener('message', event => {
  if (!event.data) return;

  if (event.data.action === 'cacheImages' && Array.isArray(event.data.urls)) {
    console.log('[SW] 📩 Warm cache request received:', event.data.urls.length, 'images');

    caches.open(CACHE_NAME).then(async cache => {
      for (const url of event.data.urls) {
        try {
          const cached = await cache.match(url);
          if (cached) {
            console.log('[SW] 🟢 already cached (skip):', url);
            continue;
          }

          console.log('[SW] 🔵 warm-fetch image:', url);
          const resp = await fetch(url, { mode: 'no-cors' });

          if (resp && (resp.status === 200 || resp.type === 'opaque')) {
            try {
              await cache.put(url, resp.clone());
              console.log('[SW] 🟡 warm-cached:', url);
              await limitCacheEntries(cache, MAX_ENTRIES);
            } catch (e) {
              console.warn('[SW] ⚠️ warm cache put failed:', url, e);
            }
          }
        } catch (e) {
          console.warn('[SW] ❌ warm fetch failed:', url, e);
        }
      }
    });
  }
});
