/**
 * The lever that stops a bad build, and no way to deliver the fix.
 *
 * `sw.js` served the application shell cache-first with no revalidation. For
 * a hashed bundle that is right — the filename changes when the contents do.
 * For `index.html` it meant a handset kept its cached shell for ever: a
 * deploy changed the bundle names, the cached shell went on naming the old
 * ones, and those were cached too. The application could not update.
 *
 * What makes that serious is what sits on the other side of it. The version
 * gate is, in `FieldApp.tsx`'s own words, "the one lever that stops a bad
 * build collecting money": below the minimum version the API answers 426 and
 * refuses the collection. So an agent on a stopped build could not collect
 * AND could not receive the fix — while `nextStep` told them to update an
 * application that was serving itself out of a cache. Clearing site data was
 * the only way out, on a handset in a market.
 *
 * And the worker could not replace itself either. A browser installs a new
 * service worker only when the BYTES of the file differ, `VERSION` is the
 * only thing in it that would change between deploys, and nothing in the
 * build touches `VERSION`. So `activate` — and the cache clearing it does —
 * had not run since the first install anywhere.
 *
 * THIS FILE EXISTS BECAUSE sw.js HAD NO TEST AT ALL
 *
 * Two other tests name the service worker, and both only describe the shape
 * of the 503 it answers with; neither loads it. The caching policy — the one
 * piece of this application whose whole job is deciding what an agent may be
 * shown when the platform cannot be reached — was never executed by anything.
 *
 * So this runs the real file in a mocked worker global rather than asserting
 * about a copy of its rules.
 */

import { describe, it, expect, beforeEach } from 'vitest';
/*
 * The real file, as text. `?raw` rather than `node:fs` so this stays inside
 * the agent's own tsconfig, which carries `vite/client` and no node types.
 */
import swSource from '../../public/sw.js?raw';

type Listener = (event: unknown) => void;

interface Harness {
  fetchEvent: (request: Record<string, unknown>) => Promise<Response | undefined>;
  networkCalls: string[];
  cacheContents: () => Map<string, Map<string, Response>>;
  setOffline: (offline: boolean) => void;
  putInCache: (cacheName: string, key: string, body: string) => void;
  version: string;
}

/**
 * Load the real `sw.js` into a mocked service worker global.
 *
 * Run as a classic script through `new Function`, which is what a worker does
 * with it — no module semantics, no transform, no second copy of the rules.
 */
function loadServiceWorker(): Harness {
  const source = swSource;

  const listeners = new Map<string, Listener>();
  const stores = new Map<string, Map<string, Response>>();
  const networkCalls: string[] = [];
  let offline = false;

  const cacheFor = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name)!;
  };

  const keyOf = (request: unknown): string =>
    typeof request === 'string' ? request : String((request as { url: string }).url);

  const cacheApi = {
    open: async (name: string) => ({
      addAll: async (urls: string[]) => {
        urls.forEach((u) => cacheFor(name).set(u, new Response(`shell:${u}`)));
      },
      put: async (request: unknown, response: Response) => {
        cacheFor(name).set(keyOf(request), response);
      },
    }),
    match: async (request: unknown) => {
      const key = keyOf(request);
      for (const store of stores.values()) {
        const hit = store.get(key);
        if (hit) return hit;
        // A navigation to "/" must also find an entry stored as a full URL.
        const short = key.replace('https://psirs.example', '');
        const alt = store.get(short);
        if (alt) return alt;
      }
      return undefined;
    },
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
  };

  const self = {
    location: { origin: 'https://psirs.example' },
    addEventListener: (type: string, fn: Listener) => listeners.set(type, fn),
    skipWaiting: () => undefined,
    clients: { claim: () => undefined, matchAll: async () => [] },
    registration: { showNotification: async () => undefined },
  };

  const fakeFetch = async (request: unknown) => {
    const url = keyOf(request);
    networkCalls.push(url);
    if (offline) throw new TypeError('Failed to fetch');
    return new Response(`network:${url}`, { status: 200 });
  };

  // eslint-disable-next-line no-new-func
  new Function('self', 'caches', 'fetch', 'Response', 'URL', source)(
    self,
    cacheApi,
    fakeFetch,
    Response,
    URL,
  );

  return {
    fetchEvent: async (request) => {
      let answered: Promise<Response> | undefined;
      const handler = listeners.get('fetch');
      if (!handler) throw new Error('sw.js registered no fetch handler');
      handler({ request, respondWith: (p: Promise<Response>) => { answered = p; } });
      return answered ? await answered : undefined;
    },
    networkCalls,
    cacheContents: () => stores,
    setOffline: (value: boolean) => { offline = value; },
    putInCache: (cacheName, key, body) => cacheFor(cacheName).set(key, new Response(body)),
    version: /const VERSION = '([^']+)'/.exec(source)?.[1] ?? '',
  };
}

const navigation = (url = 'https://psirs.example/') => ({
  url,
  method: 'GET',
  mode: 'navigate',
  destination: 'document',
});

let sw: Harness;

beforeEach(() => {
  sw = loadServiceWorker();
});

describe('opening the application after a new version was deployed', () => {
  it('asks the network rather than serving the shell it already has', async () => {
    // The cached shell is what a handset has after any previous visit. It
    // must not be the answer while there is a connection, or a deploy never
    // reaches the agent.
    sw.putInCache('psirs-agent-v2-shell', '/', 'old-shell');

    const response = await sw.fetchEvent(navigation());

    expect(sw.networkCalls).toContain('https://psirs.example/');
    expect(await response!.text()).toContain('network:');
  });

  it('stores what the network gave, so the next open offline is the new one', async () => {
    await sw.fetchEvent(navigation());

    const shell = sw.cacheContents().get('psirs-agent-v2-shell');
    expect(shell?.has('/index.html')).toBe(true);
  });
});

describe('what this must not have broken', () => {
  it('still opens from the cache when there is no connection', async () => {
    // The whole reason the shell is cached. An agent in a market with no
    // signal still needs the application to start.
    sw.putInCache('psirs-agent-v2-shell', '/index.html', 'cached-shell');
    sw.setOffline(true);

    const response = await sw.fetchEvent(navigation());

    expect(await response!.text()).toBe('cached-shell');
  });

  it('still refuses to answer a financial read from anything but the network', async () => {
    // Addendum §23. A cached "payment successful" replayed offline would tell
    // an agent money had arrived when the platform never confirmed it.
    sw.setOffline(true);

    const response = await sw.fetchEvent({
      url: 'https://psirs.example/api/v1/payments/transactions/TX-1/status',
      method: 'GET',
      mode: 'cors',
      destination: '',
    });

    expect(response!.status).toBe(503);
    const body = (await response!.json()) as { error: { code: string; moneyStatus: string } };
    expect(body.error.code).toBe('OFFLINE');
    expect(body.error.moneyStatus).toBe('NOT_DEBITED');
  });

  it('still serves reference data from the cache when the network is gone', async () => {
    sw.putInCache(
      'psirs-agent-v2-reference',
      'https://psirs.example/api/v1/reference/lgas',
      'cached-lgas',
    );
    sw.setOffline(true);

    const response = await sw.fetchEvent({
      url: 'https://psirs.example/api/v1/reference/lgas',
      method: 'GET',
      mode: 'cors',
      destination: '',
    });

    expect(await response!.text()).toBe('cached-lgas');
  });

  it('still never intercepts a request that changes state', async () => {
    // Replaying a POST from a cache could duplicate a government obligation.
    const response = await sw.fetchEvent({
      url: 'https://psirs.example/api/v1/payments/initiate',
      method: 'POST',
      mode: 'cors',
      destination: '',
    });

    expect(response).toBeUndefined();
    expect(sw.networkCalls).toHaveLength(0);
  });
});

describe('the worker being able to replace itself', () => {
  it('carries a version that differs from the one deployed before it', async () => {
    /*
     * A browser installs a new worker only when these bytes differ. `VERSION`
     * is the only thing here that changes between deploys and nothing in the
     * build touches it, so this is the one line that lets a fix reach a
     * handset that already has the old worker — and the one that makes
     * `activate` run and clear the caches it no longer owns.
     */
    expect(sw.version).not.toBe('psirs-agent-v1');
  });
});
