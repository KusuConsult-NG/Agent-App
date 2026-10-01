/**
 * The identifier this computer presents, and that it is actually sent.
 *
 * The portal sent nothing, so the server's handle for an officer's computer
 * was a function of the user agent alone -- see `fingerprintOf` in
 * `apps/api/src/services/officer-devices.ts`. A browser update therefore
 * produced a new "device", and blocking a laptop stopped applying at the next
 * Chrome update.
 *
 * Two halves have to hold for that to be fixed, and only the first is about
 * this module. The second is that `raw()` actually puts it on the wire, and in
 * particular on the sign-in request, which is the one request an officer's
 * device row is resolved from.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

const DEVICE_KEY = 'psirs.portal.device.id';

async function freshModule() {
  vi.resetModules();
  return import('./device');
}

/**
 * Storage refused, in the two shapes a browser actually refuses it.
 *
 * `vi.spyOn(Storage.prototype, 'getItem')` was the first attempt and did
 * nothing: happy-dom's `localStorage` does not route through the global
 * `Storage.prototype`, so the stub was never consulted and the test asserted
 * an empty string against a freshly minted identifier.
 *
 * `blocked` makes reaching `localStorage` at all throw, which is what a
 * browser does when storage is disabled by policy. `readOnly` lets the read
 * succeed and refuses the write, which is what a full or partitioned store
 * does. Both have to end at the same answer, because an identifier that
 * cannot be persisted is worse than none: it would differ on the next call
 * and put a new device row behind every sign-in.
 */
function refuseStorage(mode: 'blocked' | 'readOnly'): () => void {
  if (mode === 'readOnly') {
    const spy = vi.spyOn(globalThis.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('the store is full');
    });
    return () => spy.mockRestore();
  }

  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new Error('storage is not available');
    },
  });
  return () => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
  };
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the identifier this computer presents', () => {
  it('mints its own when nothing has been stored', async () => {
    const { getDeviceIdentifier } = await freshModule();

    const identifier = getDeviceIdentifier();

    expect(identifier).toMatch(/^portal-[0-9a-f-]{36}$/);
    expect(localStorage.getItem(DEVICE_KEY)).toBe(identifier);
  });

  it('keeps the one it already has', async () => {
    localStorage.setItem(DEVICE_KEY, 'portal-already-mine');
    const { getDeviceIdentifier } = await freshModule();

    expect(getDeviceIdentifier()).toBe('portal-already-mine');
  });

  it('replaces a stored value the server would refuse', async () => {
    // Shorter than the eight characters the server accepts. Storing something
    // it will reject leaves the browser presenting a handle that is ignored.
    localStorage.setItem(DEVICE_KEY, 'short');
    const { getDeviceIdentifier } = await freshModule();

    const identifier = getDeviceIdentifier();

    expect(identifier).not.toBe('short');
    expect(identifier).toMatch(/^portal-[0-9a-f-]{36}$/);
  });

  it('is not the key the agent app uses, since both share one origin', async () => {
    const { getDeviceIdentifier } = await freshModule();
    getDeviceIdentifier();

    expect(localStorage.getItem('psirs.device.id')).toBeNull();
  });

  it('survives the browser closing, unlike the session', async () => {
    /*
     * The session goes to sessionStorage by default and the device does not.
     * A handle that forgot overnight would recreate the whole defect as a new
     * device row every morning, and a block that outlived nothing.
     */
    const { getDeviceIdentifier } = await freshModule();
    const identifier = getDeviceIdentifier();

    sessionStorage.clear();
    const { getDeviceIdentifier: again } = await freshModule();

    expect(again()).toBe(identifier);
  });

  for (const mode of ['blocked', 'readOnly'] as const) {
    it(`gives an empty answer rather than a fresh one when storage is ${mode}`, async () => {
      /*
       * Private browsing, storage disabled by policy, or a store that will not
       * take a write. The caller omits the header and the server falls back to
       * the user-agent handle it used before.
       */
      const { getDeviceIdentifier } = await freshModule();
      const restore = refuseStorage(mode);
      try {
        expect(getDeviceIdentifier()).toBe('');
      } finally {
        restore();
      }
    });
  }
});

describe('putting it on the wire', () => {
  /** The headers of every request `api` made, in order. */
  function captureFetch(): Record<string, string>[] {
    const seen: Record<string, string>[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      seen.push({ ...((init?.headers ?? {}) as Record<string, string>) });
      return new Response(
        JSON.stringify({ accessToken: 'a', refreshToken: 'r', user: { id: 'u', role: 'admin' } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    return seen;
  }

  it('sends it on the sign-in request, which is the one that is read', async () => {
    const seen = captureFetch();
    const { login } = await import('./api');

    await login('+2348000000001', 'Password123');

    expect(seen).toHaveLength(1);
    expect(seen[0]!['x-device-id']).toMatch(/^portal-[0-9a-f-]{36}$/);
  });

  it('sends the same one every time, so it is one computer and not many', async () => {
    const seen = captureFetch();
    const { login } = await import('./api');

    await login('+2348000000001', 'Password123');
    await login('+2348000000001', 'Password123');

    /*
     * The presence is asserted before the equality. Comparing the two headers
     * alone passed when neither was sent — `undefined === undefined` — so this
     * test went green against a client that sent no identifier at all, which
     * is the defect it exists to rule out.
     */
    expect(seen[0]!['x-device-id']).toMatch(/^portal-[0-9a-f-]{36}$/);
    expect(seen[1]!['x-device-id']).toBe(seen[0]!['x-device-id']);
  });

  it('omits the header entirely when there is no identifier to send', async () => {
    const seen = captureFetch();
    const { login } = await import('./api');
    const restore = refuseStorage('readOnly');
    try {
      await login('+2348000000001', 'Password123');
    } finally {
      restore();
    }

    expect(seen[0]).not.toHaveProperty('x-device-id');
  });
});
