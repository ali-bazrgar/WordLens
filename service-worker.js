const CACHE_NAME = 'ai-chat-v4-local-provider';
const urlsToCache = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/local-provider.js',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
      .then(() => self.skipWaiting())
  );
});

/*
 * Provider 3 local bridge.
 *
 * The existing application code historically used the Provider 3 slot for
 * OpenRouter, but its current translation request is already OpenAI-compatible
 * and points at a local llama.cpp server. We keep the application code intact
 * and transparently redirect that request to the MikroTik gateway.
 *
 * This is intentionally limited to the exact local Provider 3 endpoint so
 * Gemini/AvalAI/other application requests are not modified.
 */
const LOCAL_LLM_BASE = 'http://192.168.88.1:1234';
const LOCAL_LLM_MODEL = 'Hy-MT2-1.8B-2Bit';
const OLD_LOCAL_LLM_HOST = '192.168.88.50';
const LOCAL_TTS_BASE = 'http://192.168.88.1:4321';

async function rewriteProvider3Request(request) {
  const url = new URL(request.url);

  // Existing Provider 3 LLM endpoint in app.js.
  if (
    url.hostname === OLD_LOCAL_LLM_HOST &&
    url.pathname === '/v1/chat/completions'
  ) {
    let body = null;
    try {
      body = await request.clone().json();
    } catch (_) {
      body = null;
    }

    if (body && typeof body === 'object') {
      body.model = LOCAL_LLM_MODEL;
      delete body.provider;
    }

    const target = `${LOCAL_LLM_BASE}/v1/chat/completions`;
    return new Request(target, {
      method: request.method,
      headers: request.headers,
      body: body ? JSON.stringify(body) : await request.clone().text(),
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store'
    });
  }

  return null;
}

self.addEventListener('fetch', event => {
  event.respondWith((async () => {
    const rewritten = await rewriteProvider3Request(event.request);
    if (rewritten) {
      try {
        return await fetch(rewritten);
      } catch (error) {
        console.error('[WordLens] Local Provider 3 request failed:', error);
        return new Response(JSON.stringify({
          error: {
            message: `Local Provider 3 unavailable at ${LOCAL_LLM_BASE}. ${error.message || error}`
          }
        }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    const cached = await caches.match(event.request);
    if (cached) return cached;

    return fetch(event.request);
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames
        .filter(name => name !== CACHE_NAME)
        .map(name => caches.delete(name))
    );
    await self.clients.claim();
  })());
});
