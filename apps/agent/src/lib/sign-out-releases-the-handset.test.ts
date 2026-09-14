/**
 * A push subscription belongs to the handset, and sign-out has to give it back.
 *
 * Agents share handsets — this application has device registration, clearance
 * and a session that refuses a blocked device precisely because they do. Sign
 * out released neither half: the browser kept its subscription and
 * `push_subscriptions` went on pointing at the agent who had just handed the
 * phone over.
 *
 * Two things followed. The seeded PUSH templates make the first concrete —
 * "{{amount}} on {{reference}}", "Your payout {{reference}} has been sent to
 * your bank", and "You have been suspended. Stop collecting now. Reason: …" —
 * so the next agent read the last one's commission, payout and suspension, and
 * would take the suspension to be about themselves.
 *
 * The second is that they could not turn push on. `subscribeToPush` refuses to
 * move an endpoint to a different user, which is right and was itself a fix;
 * a browser returns the same endpoint for the same key; so the refusal was
 * permanent for that handset.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { logout, setSession } from './api';

const USER = {
  id: 'u-1',
  fullName: 'Danladi Musa',
  phone: '+2347011000001',
  email: null,
  role: 'agent',
  permissions: ['taxpayer:create'],
  agentId: 'a-1',
};

const realFetch = globalThis.fetch;
let posted: string[] = [];

/** A handset holding a subscription, and whether the browser let go of it. */
function handsetWithSubscription(subscription: unknown) {
  Object.defineProperty(globalThis.navigator, 'serviceWorker', {
    configurable: true,
    value: {
      ready: Promise.resolve({ pushManager: { getSubscription: async () => subscription } }),
    },
  });
}

beforeEach(() => {
  posted = [];
  setSession({
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    user: USER,
  } as never);
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    posted.push(new URL(String(input), 'http://localhost').pathname);
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  setSession(null);
  vi.restoreAllMocks();
});

describe('signing out of a shared handset', () => {
  it('unsubscribes the browser and tells the server, before ending the session', async () => {
    const unsubscribe = vi.fn(async () => true);
    handsetWithSubscription({ endpoint: 'https://push.example/abc', unsubscribe });

    await logout();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    const unsub = posted.findIndex((path) => path.endsWith('/push/unsubscribe'));
    const out = posted.findIndex((path) => path.endsWith('/auth/logout'));
    expect(unsub, 'the server was never told to release the subscription').toBeGreaterThanOrEqual(0);
    expect(out, 'the session was never ended').toBeGreaterThanOrEqual(0);
    // The release is an authenticated call, so it has to go first.
    expect(unsub).toBeLessThan(out);
  });

  it('signs out anyway when the handset has no subscription', async () => {
    handsetWithSubscription(null);
    await logout();
    expect(posted.some((path) => path.endsWith('/auth/logout'))).toBe(true);
    expect(posted.some((path) => path.endsWith('/push/unsubscribe'))).toBe(false);
  });

  it('signs out anyway when the push service refuses to let go', async () => {
    // Whatever the browser says, the agent still has to be able to hand the
    // phone over — and the server half runs independently of it.
    handsetWithSubscription({
      endpoint: 'https://push.example/abc',
      unsubscribe: async () => {
        throw new Error('push service unavailable');
      },
    });
    await logout();
    expect(posted.some((path) => path.endsWith('/auth/logout'))).toBe(true);
  });
});
