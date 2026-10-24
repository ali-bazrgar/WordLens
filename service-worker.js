const CACHE_NAME = 'ai-chat-v9-network-only';

self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

// Deliberately do not rewrite/cache application resources here.
// server.py is the authoritative same-origin Local Provider bridge.
self.addEventListener('fetch', event => {
  // Preserve request metadata and bodies exactly, including mobile multipart
  // microphone uploads. The server's no-cache headers keep app assets fresh.
  event.respondWith(fetch(event.request));
});
