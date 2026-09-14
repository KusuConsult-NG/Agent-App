/**
 * Which handset the app says it is.
 *
 * The device identifier is how government binds, approves and revokes a
 * specific phone. An agent's *first* handset is auto-approved so onboarding can
 * finish; every one after that starts PENDING and waits for an officer, because
 * revoking a stolen handset would be worth nothing if the thief could register
 * another and carry on.
 *
 * That rule makes a demonstration awkward in a way that is not obvious. The
 * seeded agent already has a handset — the seed registered one so it could
 * create the demonstration data through the real API — so a presenter opening
 * the app in their own browser is a *second* handset, and is refused. It is the
 * control working correctly on a fixture that cannot know which browser will
 * arrive.
 *
 * So a development build accepts `?device=` and adopts that identifier. It is
 * not a way past any check: the server still requires the handset to be
 * registered and approved against the signed-in agent's own account, and naming
 * somebody else's device identifier gains nothing. What it avoids is a
 * presenter having to approve their own browser through the officer portal
 * before they can show anything.
 *
 * A production build ignores it entirely, which is what these tests are mostly
 * here to hold. Honouring it in production would let one approved handset
 * identifier be shared across any number of phones by passing a link around,
 * and device binding would mean nothing.
 */

import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';

const DEVICE_KEY = 'psirs.device.id';
const DEMO = 'uat-agent-device-000001';

function setUrl(search: string): void {
  window.history.replaceState({}, '', `/${search}`);
}

async function freshModule() {
  vi.resetModules();
  return import('./device');
}

beforeEach(() => {
  localStorage.clear();
  setUrl('');
});

afterEach(() => {
  vi.unstubAllEnvs();
  setUrl('');
});

describe('the identifier this handset presents', () => {
  it('mints its own when nothing has been stored', async () => {
    const { getDeviceIdentifier } = await freshModule();
    const identifier = getDeviceIdentifier();

    expect(identifier).toMatch(/^pwa-/);
    expect(localStorage.getItem(DEVICE_KEY)).toBe(identifier);
  });

  it('keeps the one it already has, so approval survives a restart', async () => {
    localStorage.setItem(DEVICE_KEY, 'pwa-already-mine');
    const { getDeviceIdentifier } = await freshModule();

    expect(getDeviceIdentifier()).toBe('pwa-already-mine');
  });

  it('adopts ?device= in a development build, so a demonstration can start', async () => {
    vi.stubEnv('DEV', true);
    setUrl(`?device=${DEMO}`);
    const { getDeviceIdentifier } = await freshModule();

    expect(getDeviceIdentifier()).toBe(DEMO);
    expect(localStorage.getItem(DEVICE_KEY)).toBe(DEMO);
  });

  it('lets ?device= replace a stored one, so the browser can be pointed again', async () => {
    vi.stubEnv('DEV', true);
    localStorage.setItem(DEVICE_KEY, 'pwa-from-an-earlier-demo');
    setUrl(`?device=${DEMO}`);
    const { getDeviceIdentifier } = await freshModule();

    expect(getDeviceIdentifier()).toBe(DEMO);
  });

  it('ignores ?device= in a production build', async () => {
    /*
     * The one that matters. Honouring this in production would let a single
     * approved handset identifier be shared across any number of phones by
     * passing a link around, which is device binding removed.
     */
    vi.stubEnv('DEV', false);
    setUrl(`?device=${DEMO}`);
    const { getDeviceIdentifier } = await freshModule();

    expect(getDeviceIdentifier()).not.toBe(DEMO);
    expect(getDeviceIdentifier()).toMatch(/^pwa-/);
  });

  it('ignores a production ?device= even over a stored identifier', async () => {
    vi.stubEnv('DEV', false);
    localStorage.setItem(DEVICE_KEY, 'pwa-the-real-handset');
    setUrl(`?device=${DEMO}`);
    const { getDeviceIdentifier } = await freshModule();

    expect(getDeviceIdentifier()).toBe('pwa-the-real-handset');
  });

  it('refuses a ?device= that is not shaped like an identifier', async () => {
    // The server takes 8 to 128 characters. Storing something it will reject
    // would leave the app permanently unable to collect, with no way back
    // except clearing site data.
    vi.stubEnv('DEV', true);
    setUrl('?device=short');
    const { getDeviceIdentifier } = await freshModule();

    expect(getDeviceIdentifier()).toMatch(/^pwa-/);
  });
});
