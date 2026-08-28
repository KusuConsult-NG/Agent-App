/**
 * A push subscription belongs to somebody.
 *
 * Three faults stacked in one feature, each enough on its own to break it.
 *
 * The route stored `(req as any).actor`, which exists nowhere in this
 * codebase. The cast is what kept the compiler quiet. Every subscription was
 * saved with no userId and no agentId, and `sendPushNotification` matches a
 * target against exactly those two fields — so a targeted push would have
 * matched nobody, while its untargeted fallback, `!target.userId &&
 * !target.agentId`, matches everybody.
 *
 * The router had no `authenticate`, so there was no identity to record even
 * in principle, and unsubscribing accepted any endpoint from anyone.
 *
 * And the PWA called `/api/v1/push/...` through a client that already prefixes
 * `/api/v1`, so every push request went to `/api/v1/api/v1/push/...` and
 * 404ed. Those three were the only calls in the whole app spelled that way.
 *
 * All of it survived because web push delivery is deliberately not built yet —
 * `providerFor('PUSH')` throws and says to add an adapter first. That guard is
 * working as intended, and it is also why nobody was ever going to notice the
 * subscription half rotting underneath it.
 */

import {
  createGovernmentUser,
  get,
  loginAs,
  pool,
  post,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './helpers';
import { queryOne } from '../db/pool';
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';
import {
  clearVapidForTesting,
  saveSubscription,
  sendPushNotification,
  subscriptionsFor,
} from '../services/push';

let agentToken = '';
let agentDevice = '';
let agentUserId = '';
let officerToken = '';
let officerUserId = '';

const endpointFor = (name: string) => `https://push.example.test/${name}-${Date.now()}`;

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();

  officerUserId = await createGovernmentUser({
    role: 'admin',
    phone: '+2348030000099',
    fullName: 'Push Admin',
  });
  officerToken = (await loginAs('+2348030000099')).accessToken;

  const demo = await seedDemoAgent();
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agentToken = session.accessToken;
  agentDevice = demo!.deviceIdentifier;
  agentUserId = session.user.id;
});

describe('registering a device for push', () => {
  it('will not take a subscription from nobody', async () => {
    const response = await post('/push/subscribe', {
      subscription: { endpoint: endpointFor('anonymous') },
    });

    assert.equal(
      response.status,
      401,
      `an unauthenticated subscription cannot be attributed: ${JSON.stringify(response.body)}`,
    );
  });

  it('records the subscriber, so a targeted push can find them', async () => {
    const endpoint = endpointFor('agent');
    const response = await post(
      '/push/subscribe',
      { subscription: { endpoint } },
      { token: agentToken, deviceId: agentDevice },
    );
    assert.equal(response.status, 200, JSON.stringify(response.body));

    /*
     * Asserted against the store rather than through a delivery function that
     * does not deliver. An ownerless row matches no target, which was the
     * defect; the question is whether the row carries who it belongs to.
     */
    const mine = await subscriptionsFor({ userId: agentUserId });
    assert.ok(
      mine.some((row) => row.endpoint === endpoint),
      'the subscription must be findable by the user it belongs to',
    );
  });

  it('does not deliver one agent notification to another', async () => {
    await post(
      '/push/subscribe',
      { subscription: { endpoint: endpointFor('agent-a') } },
      { token: agentToken, deviceId: agentDevice },
    );

    const theirs = await subscriptionsFor({ userId: officerUserId });
    assert.equal(theirs.length, 0, 'a push addressed to one person must not reach another');
  });

  it('only lets you forget your own device', async () => {
    const endpoint = endpointFor('mine');
    await saveSubscription({ endpoint }, { userId: agentUserId });

    // Somebody else asks for it to be removed.
    const response = await post('/push/unsubscribe', { endpoint }, { token: officerToken });
    assert.equal(response.status, 200, JSON.stringify(response.body));

    const stillThere = await subscriptionsFor({ userId: agentUserId });
    assert.ok(
      stillThere.some((row) => row.endpoint === endpoint),
      'another account must not be able to unsubscribe your device',
    );

    // The owner can.
    await post('/push/unsubscribe', { endpoint }, { token: agentToken, deviceId: agentDevice });
    const gone = await subscriptionsFor({ userId: agentUserId });
    assert.equal(gone.length, 0, 'the owner can remove their own device');
  });

  it('survives a restart, because the store is not a process', async () => {
    /*
     * The reason this moved out of a Map. A fleet of handsets would have
     * silently stopped receiving anything after a routine deploy, with nothing
     * to look at that would say so — and in the multi-replica topology the
     * advisory locks exist for, a handset that subscribed through one replica
     * was unknown to the others.
     */
    const endpoint = endpointFor('durable');
    await saveSubscription({ endpoint }, { userId: agentUserId });

    const row = await queryOne<{ endpoint: string; user_id: string }>(
      pool,
      'SELECT endpoint, user_id FROM push_subscriptions WHERE endpoint = $1',
      [endpoint],
    );
    assert.ok(row, 'the subscription is a row, not a map entry');
    assert.equal(row!.user_id, agentUserId, 'and it records whose device it is');
  });

  it('refuses to report a delivery it could not have signed', async () => {
    /*
     * It logged to the console, counted that as `sent`, and returned it. Then
     * it refused outright, correctly, because no adapter existed. There is an
     * adapter now — and this is the one case that must still refuse rather than
     * count: a server with no VAPID identity has not failed to reach anybody's
     * handset, it has not tried. Returning `{ sent: 0, failed: 1 }` would put
     * that on the citizen's record instead of the deployment's.
     *
     * `a-push-nobody-can-receive.test.ts` holds the delivery behaviour itself.
     */
    clearVapidForTesting();
    await saveSubscription({ endpoint: endpointFor('nowhere') }, { userId: agentUserId });
    await assert.rejects(
      () =>
        sendPushNotification(
          { userId: agentUserId },
          { title: 'Anything', body: 'Nothing will carry this.' },
        ),
      /not configured/i,
      'a push nobody sent must not be reported as sent',
    );
  });

  it('says plainly there is no key rather than serving one it invented', async () => {
    /*
     * 200 with a real key when configured; 503 when not. What it must never do
     * again is answer 200 with a key generated at startup — which a browser
     * binds to permanently and the next restart discards.
     */
    const response = await get('/push/vapid-key');
    assert.ok(
      [200, 503].includes(response.status),
      `unexpected ${response.status}: ${JSON.stringify(response.body).slice(0, 160)}`,
    );
    if (response.status === 200) {
      const raw = Buffer.from(response.body.publicKey, 'base64url');
      assert.equal(raw.length, 65, 'a browser can only subscribe with the raw point');
      assert.equal(raw[0], 0x04);
    } else {
      assert.match(response.body.error?.message ?? '', /not configured/i);
    }
  });
});

describe('the PWA addresses the push routes correctly', () => {
  it('does not repeat the API prefix that its client already adds', () => {
    // A structural guard: this was the only file in the app spelling paths
    // with /api/v1, and it made every push request 404 before it began.
    const source = readFileSync(
      join(__dirname, '..', '..', '..', '..', 'apps', 'agent', 'src', 'lib', 'push.ts'),
      'utf8',
    );
    assert.doesNotMatch(
      source,
      /['"`]\/api\/v1\//,
      'the agent API client already prefixes /api/v1; paths here must be relative to it',
    );
  });
});
