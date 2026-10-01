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

/*
 * Bumped to v3 with the /portal/ exclusion below.
 *
 * The bump is not cosmetic here. A handset that visited /portal/ while an
 * older worker was installed has the portal's index.html sitting in its shell
 * cache under the key '/index.html' — the agent's offline shell, replaced by
 * a government sign-in page. New cache names mean `activate` deletes the old
 * ones, so that poisoning does not outlive the fix.
 *
 * Was bumped to v2 with the navigation change below.
 *
 * A browser installs a new service worker only when the BYTES of this file
 * differ from the one it holds. Nothing in the build touches this constant,
 * so every deploy shipped a byte-identical worker and no handset ever
 * installed a new one — which is also why `activate`, and the cache clearing
 * it does, had not run since the first install.
 */
const VERSION = 'psirs-agent-v3';
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

/** A path the officer portal is served from. */
function isPortalPath(pathname) {
  return pathname === '/portal' || pathname.startsWith('/portal/');
}

/**
 * A request this worker must leave entirely alone.
 *
 * The path places the portal's documents and its assets. It cannot place the
 * portal's API reads: those go to `/api/v1/...` on this same origin, which is
 * not under `/portal/`, so they used to fall straight through into the
 * branches that answer on an application's behalf.
 *
 * The referrer is the document that issued the request, and it is the only
 * signal available in time. Resolving the client through `self.clients` is
 * asynchronous, and by the time it answers the chance to decline has gone —
 * `respondWith` has to be called, or not called, synchronously.
 *
 * Measured against the nginx config these images actually serve, which sets
 * `Referrer-Policy: strict-origin-when-cross-origin`: a worker at scope '/'
 * is given the full document URL for a same-origin fetch, so a read issued by
 * /portal/ is attributable and one issued by / is not mistaken for it.
 *
 * No referrer means not attributable, and an unattributable request is
 * handled exactly as it was before this function existed. That is the
 * deliberate direction to fail in: the cost is the portal keeping today's
 * behaviour under a stricter policy, where the alternative would be an agent
 * silently losing the offline reference data this worker exists to provide.
 */
function belongsToPortal(url, request) {
  if (isPortalPath(url.pathname)) return true;

  const referrer = request.referrer;
  if (!referrer) return false;
  try {
    const from = new URL(referrer);
    return from.origin === self.location.origin && isPortalPath(from.pathname);
  } catch {
    return false;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only GET is ever served from a cache. A POST is an instruction to change
  // state; replaying one from a cache could duplicate a government obligation.
  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin && !url.href.startsWith('http://localhost:4000')) return;

  /*
   * The officer portal shares this origin, under /portal/, and this worker
   * must not touch it.
   *
   * Every branch below is written for a single-app origin. The navigation
   * branch caches whatever HTML comes back under the literal key
   * '/index.html', so one officer opening /portal/ would replace the agent's
   * offline shell with the portal's — and the agent, next time it lost
   * signal, would open a government sign-in page it cannot use and cannot
   * get out of. The static-asset branch is worse in the quiet way: it falls
   * back to '/index.html' on any miss, so a portal asset requested offline
   * is answered with the agent's shell, 200, as text/html, and the portal
   * dies at the first script it tries to parse.
   *
   * There is no scope narrower than '/' available — the agent is the root
   * app — so the exclusion is stated here instead. Returning without calling
   * respondWith leaves the request to the network, which is exactly right:
   * the portal has no offline story and does not want one, because nothing
   * it does is safe to serve stale.
   *
   * That claim was once enforced by a check on `/portal/` alone, which is the
   * portal's documents and assets and not its API reads — those are
   * `/api/v1/...` on this same origin. So the two branches below went on
   * answering for the portal: a failed reference read came back out of a
   * cache filled for a handset, and any other failed GET came back as a
   * manufactured 503 reading "You are offline. … Nothing has been sent and
   * nothing has been paid", with moneyStatus NOT_DEBITED. That is a
   * statement about government money, written for an agent in a field with
   * no signal, asserted about a request the portal made — and a failed fetch
   * is no evidence of what reached the server. See `belongsToPortal`.
   */
  if (belongsToPortal(url, request)) return;

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

  /*
   * Opening the application: the network first, the cache as the fallback.
   *
   * This used to be cache-first with no revalidation, like the assets below.
   * For a hashed bundle that is right — the name changes when the contents
   * do. For the shell it meant a handset served its cached `index.html` for
   * ever: a deploy changed the bundle names, the cached shell went on naming
   * the old ones, and those were cached too. The application could not update.
   *
   * Which matters because of what sits on the other side of it. The version
   * gate is "the one lever that stops a bad build collecting money" — it
   * answers 426 and refuses the collection. An agent on a build that has been
   * stopped could not collect AND could not receive the fix, and `nextStep`
   * told them to update an application that was serving itself from a cache.
   * Clearing site data was the only way out, on a handset in a market.
   *
   * Network first costs a request that the fallback covers: offline, the
   * shell still opens from the cache, which is what the draft-capture
   * workflows need.
   */
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put('/index.html', copy));
          }
          return response;
        })
        .catch(() => caches.match('/index.html').then((cached) => cached ?? caches.match('/'))),
    );
    return;
  }

  // Static assets: cache first. A hashed filename changes when its contents
  // do, so a hit is never stale.
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

  /*
   * Where tapping a notification takes an agent, and why it used to be
   * wherever they happened to have been last.
   *
   * The match was `client.url.includes(urlToOpen)`, a substring test, and
   * `urlToOpen` falls back to '/' because nothing sets one: the only sender
   * is services/messaging/push.ts, which calls `sendPushNotification` with a
   * title and a body and no `data`. So the fallback is not an edge case, it
   * is every notification this platform sends — and every URL on this origin
   * contains '/'. The test therefore matched the first window `matchAll`
   * returned, which Chrome orders most-recently-focused first.
   *
   * On a shared origin that window can be the officer portal, so an agent
   * tapping their own notification was handed a government sign-in screen.
   * Before both applications shared a host there was no such window to
   * focus: one URL for both is what made it reachable, and
   * `includeUncontrolled: true` widens it to windows this worker has never
   * controlled.
   *
   * A window already on the notification's own screen is preferred, then any
   * window of the agent's, then a new one. Focusing an agent window that is
   * on some other screen does not navigate it. That was true before and is
   * left alone deliberately: calling `navigate()` on a window somebody is
   * part-way through a collection on is a larger decision than this fix.
   */
  const origin = self.location.origin;

  /** The candidate as one of the agent's own URLs, or null if it is not one. */
  const withinTheAgent = (candidate) => {
    try {
      const url = new URL(candidate, origin);
      return url.origin === origin && !isPortalPath(url.pathname) ? url : null;
    } catch {
      return null;
    }
  };

  // A notification raised by this worker is the agent's, so a `data.url`
  // naming the portal is declined rather than followed.
  const target = withinTheAgent(event.notification.data?.url || '/') ?? new URL('/', origin);

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      const mine = windowClients.filter((client) => withinTheAgent(client.url));
      const onTheSameScreen = mine.find((client) => {
        const url = withinTheAgent(client.url);
        return url !== null && url.pathname === target.pathname && url.hash === target.hash;
      });
      const chosen = onTheSameScreen ?? mine[0];
      if (chosen && 'focus' in chosen) return chosen.focus();
      if (self.clients.openWindow) return self.clients.openWindow(target.href);
      return undefined;
    }),
  );
});
