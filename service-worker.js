const CACHE_NAME = 'wordlens-app-v28-meanings-only';
const APP_BASE = self.registration.scope;
const APP_VERSION = '20261024-meanings-only-v28';

// The app shell, local data, and flashcards work offline after one successful
// online visit. API endpoints are intentionally never cached.
const APP_SHELL = [
  './',
  './index.html',
  './style.css?v=' + APP_VERSION,
  './app.js?v=' + APP_VERSION,
  './local-provider.js',
  './local-provider-runtime.js?v=' + APP_VERSION,
  './manifest.json',
  './favicon.ico',
  './icons/icon-192x192.png',
  './icons/icon-512x512.png'
];

const MARKED_URL = 'https://cdn.jsdelivr.net/npm/marked/marked.min.js';

async function cacheFirstPartyAsset(cache, relativeUrl, required = false) {
  try {
    const request = new Request(new URL(relativeUrl, APP_BASE).href, { cache: 'reload' });
    const response = await fetch(request);
    if (response && response.ok) {
      await cache.put(request, response.clone());
      return true;
    }
    if (required) throw new Error('HTTP ' + (response?.status ?? 'unknown'));
  } catch (error) {
    console.warn('[WordLens SW] Could not precache:', relativeUrl, error);
    if (required) throw error;
  }
  return false;
}

async function cacheMarkdownDependency(cache) {
  try {
    // Script tags use no-cors requests. Cache the same URL/mode so Markdown
    // rendering remains available if the CDN is unreachable after installation.
    const request = new Request(MARKED_URL, { mode: 'no-cors', cache: 'reload' });
    const response = await fetch(request);
    if (response && (response.ok || response.type === 'opaque')) {
      await cache.put(request, response.clone());
    }
  } catch (error) {
    console.warn('[WordLens SW] Markdown library will use the app fallback:', error);
  }
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Cache critical first-party files before this worker takes control.
    const requiredShell = [
      './index.html',
      './style.css?v=' + APP_VERSION,
      './app.js?v=' + APP_VERSION,
      './local-provider.js',
      './local-provider-runtime.js?v=' + APP_VERSION,
      './manifest.json'
    ];
    const optionalShell = [
      './',
      './favicon.ico',
      './icons/icon-192x192.png',
      './icons/icon-512x512.png'
    ];
    await Promise.all(requiredShell.map(url => cacheFirstPartyAsset(cache, url, true)));
    await Promise.allSettled([
      ...optionalShell.map(url => cacheFirstPartyAsset(cache, url)),
      cacheMarkdownDependency(cache)
    ]);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    // Only remove older WordLens caches; leave unrelated apps' caches untouched.
    await Promise.all(names
      .filter(name => name.startsWith('wordlens-app-') && name !== CACHE_NAME)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') {
    // POST bodies and microphone uploads must never be cached or rewritten.
    event.respondWith(fetch(request));
    return;
  }

  const url = new URL(request.url);
  const scopeUrl = new URL(APP_BASE);
  const localApiPath = new URL('local-api/', APP_BASE).pathname;
  if (url.origin === scopeUrl.origin && url.pathname.startsWith(localApiPath)) {
    // Local AI/TTS/STT proxies need a running server and live upstreams.
    event.respondWith(fetch(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response && response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone()).catch(() => {});
        }
        return response;
      } catch (error) {
        return (await caches.match(request)) ||
          (await caches.match(new URL('./index.html', APP_BASE).href)) ||
          new Response('WordLens is not available offline yet. Open it once while connected to the internet, then try again.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;

    try {
      const response = await fetch(request);
      if (response && (response.ok || response.type === 'opaque')) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    } catch (error) {
      return new Response('This resource is not cached for offline use.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }
  })());
});
