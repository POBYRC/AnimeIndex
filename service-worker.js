// service-worker.js
const CACHE_NAME = 'anime-images-v1';
const MAX_ENTRIES = 300;

// ติดตั้ง/activate
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ลิมิตจำนวน entry ใน cache (simple FIFO)
async function limitCacheEntries(cache, maxEntries) {
  const keys = await cache.keys();
  if (keys.length > maxEntries) {
    for (let i = 0; i < keys.length - maxEntries; i++) {
      await cache.delete(keys[i]);
    }
  }
}

// กลยุทธ์: cache-first สำหรับ image
self.addEventListener('fetch', event => {
  const req = event.request;

  if (req.destination === 'image' || (req.headers.get('accept') || '').includes('image')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async cache => {
        const cached = await cache.match(req);
        if (cached) return cached;

        try {
          const response = await fetch(req);
          if (response && (response.status === 200 || response.type === 'opaque')) {
            try { await cache.put(req, response.clone()); } catch (e) { /* quota หรือ error */ }
            limitCacheEntries(cache, MAX_ENTRIES);
          }
          return response;
        } catch (err) {
          return cached || Response.error();
        }
      })
    );
  }
  // อื่นๆ ให้ไปปกติ
});

// รับข้อความจากหน้า เพื่อ warm cache ด้วย list ของ URLs
self.addEventListener('message', event => {
  if (!event.data) return;
  if (event.data.action === 'cacheImages' && Array.isArray(event.data.urls)) {
    caches.open(CACHE_NAME).then(async cache => {
      for (const url of event.data.urls) {
        try {
          // mode no-cors เพื่อรองรับ cross-origin opaque responses
          const resp = await fetch(url, { mode: 'no-cors' });
          if (resp && (resp.status === 200 || resp.type === 'opaque')) {
            try { await cache.put(url, resp.clone()); } catch (e) {}
            await limitCacheEntries(cache, MAX_ENTRIES);
          }
        } catch (e) {
          // ข้ามรายการที่โหลดไม่สำเร็จ
        }
      }
    });
  }
});
