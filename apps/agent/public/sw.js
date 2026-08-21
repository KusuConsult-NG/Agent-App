/**
 * Service worker (PRD §30; Addendum §1, §23).
 *
 * The caching policy is deliberately narrow. What may be cached:
 *   * the application shell and static assets;
 *   * non-sensitive reference data (LGAs, wards, the revenue catalogue).
 *
 * What is never cached:
 *   * anything under a financial path — payments, receipts, transactions,
 *     commission, documents;
 *   * any response to a non-GET request.
 *
 * The reason is Addendum §23's financial rule: a cached "PAYMENT SUCCESSFUL"
 * screen replayed while offline would tell an agent that money had arrived
 * when the platform had never confirmed it. A stale receipt is worse than no
 * receipt, so financial reads fail loudly offline instead.
 */

const VERSION = 'psirs-agent-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const REFERENCE_CACHE = `${VERSION}-reference`;

const SHELL_ASSETS = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg'];

/** Reference data that is safe to serve from cache while offline. */
const CACHEABLE_API = [
  '/api/v1/reference/lgas',
  '/api/v1/reference/wards',
  '/api/v1/revenue/categories',
  '/api/v1/revenue/items',
  '/api/v1/agents/agreement',
];

/** Paths whose responses must always come from the network, never a cache. */
const NEVER_CACHE = [
  '/api/v1/payments',
  '/api/v1/receipts',
  '/api/v1/documents',
  '/api/v1/auth',
  '/api/v1/taxpayers',
  '/api/v1/vehicles',
  '/api/v1/drafts',
  '/api/v1/government',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

function isCacheableApi(url) {
  return CACHEABLE_API.some((path) => url.pathname.startsWith(path));
}

function isNeverCache(url) {
  return NEVER_CACHE.some((path) => url.pathname.startsWith(path));
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only GET is ever served from a cache. A POST is an instruction to change
  // state; replaying one from a cache could duplicate a government obligation.
  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin && !url.href.startsWith('http://localhost:4000')) return;

  if (url.pathname.startsWith('/api/')) {
    if (isCacheableApi(url) && !isNeverCache(url)) {
      // Network first, falling back to cache: reference data may be slightly
      // stale offline, which is harmless.
      event.respondWith(
        fetch(request)
          .then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(REFERENCE_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          })
          .catch(() =>
            caches.match(request).then(
              (cached) =>
                cached ??
                new Response(
                  JSON.stringify({
                    error: {
                      code: 'OFFLINE',
                      message: 'You are offline and this information has not been saved on the device.',
                      moneyStatus: 'NOT_APPLICABLE',
                    },
                  }),
                  { status: 503, headers: { 'content-type': 'application/json' } },
                ),
            ),
          ),
      );
      return;
    }

    // Financial and account endpoints: network only. Offline returns an
    // explicit, honest failure rather than anything that could be mistaken for
    // a confirmed payment.
    event.respondWith(
      fetch(request).catch(
        () =>
          new Response(
            JSON.stringify({
              error: {
                code: 'OFFLINE',
                message:
                  'You are offline. This action needs a connection because it involves government ' +
                  'money or taxpayer records. Nothing has been sent and nothing has been paid.',
                moneyStatus: 'NOT_DEBITED',
              },
            }),
            { status: 503, headers: { 'content-type': 'application/json' } },
          ),
      ),
    );
    return;
  }

  // Application shell: cache first, so the app opens instantly and works
  // offline for the draft-capture workflows.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (response.ok && request.destination !== '') {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match('/index.html'));
    }),
  );
});

/** Background sync for queued drafts, where the browser supports it. */
self.addEventListener('sync', (event) => {
  if (event.tag === 'psirs-sync-drafts') {
    event.waitUntil(
      self.clients.matchAll().then((clients) => {
        clients.forEach((client) => client.postMessage({ type: 'SYNC_DRAFTS' }));
      }),
    );
  }
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('push', (event) => {
  if (!event.data) return;
  const payload = event.data.json();
  event.waitUntil(
    self.registration.showNotification(payload.title ?? 'PSIRS', {
      body: payload.body ?? '',
      icon: '/icon.svg',
      badge: '/icon.svg',
      data: payload.data ?? {},
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(urlToOpen) && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(urlToOpen);
      }
    }),
  );
});
