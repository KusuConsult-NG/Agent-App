/**
 * Test environment shims.
 *
 * The offline code needs three browser APIs and nothing else: IndexedDB for the
 * draft queue (supplied by `fake-indexeddb`), and Web Storage for the session.
 * A ~20-line Storage implementation is a fairer trade than a full DOM just to
 * get `localStorage`, and it keeps the tests honest about how small the browser
 * surface actually is.
 *
 * And a fourth thing, added after a CI failure nobody could reproduce: no test
 * reaches the network.
 */

class MemoryStorage implements Storage {
  private entries = new Map<string, string>();

  get length(): number {
    return this.entries.size;
  }

  key(index: number): string | null {
    return [...this.entries.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.entries.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.entries.set(key, String(value));
  }

  removeItem(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}

Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), writable: true });
Object.defineProperty(globalThis, 'sessionStorage', { value: new MemoryStorage(), writable: true });

/**
 * Nothing here talks to a server.
 *
 * Screens load reference data on mount -- the registration wizard its LGAs, the
 * ticket form its sectors, the group form its LGAs again -- and a test that
 * renders one and asserts in the same tick leaves that request in flight.
 * happy-dom resolves the relative `/api/v1/...` against `http://localhost:3000`
 * and really tries, so the suite was making 26 connection attempts to a server
 * that is not running: 24 from `the-app-in-hausa`, 2 from `ui-components`.
 *
 * On this machine those refuse instantly and land before teardown, which is why
 * every local run is green. On a CI runner that tries `::1` before `127.0.0.1`
 * they arrive later, and the run that failed shows both signatures together --
 * an `AggregateError` of refused connections, and happy-dom aborting fetches
 * inside `teardownWindow` -- alongside an error thrown from React's scheduler
 * that failed the run while all 150 assertions passed.
 *
 * Pointing those requests at a socket that accepts and never answers reproduces
 * the abort half exactly: twelve `AbortError`s out of teardown. The React error
 * itself has not been reproduced here across plain runs, runs under full CPU
 * load, delayed rejections and hung sockets -- so this is not offered as a
 * confirmed cure for that specific throw. What it does is remove the thing all
 * of those symptoms depend on: an unfinished request outliving the test that
 * started it.
 *
 * A resolved empty response rather than a rejection, deliberately. A rejecting
 * default would replace one late-arriving promise with another, which is the
 * problem rather than a fix. A test that needs a real shape stubs `fetch`
 * itself -- `group-screens` and `writing-down-a-stall` already do.
 */
Object.defineProperty(globalThis, 'fetch', {
  writable: true,
  configurable: true,
  value: async () =>
    new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }),
});
