/**
 * The notification channel that could never have worked.
 *
 * Subscriptions are stored, attributed to a person and revoked properly, and
 * `sendPushNotification` refuses rather than lying about sending. That was the
 * honest half. Underneath it, three things made the channel unusable in
 * principle rather than merely unbuilt.
 *
 * THE SERVER GENERATED A NEW IDENTITY EVERY TIME IT STARTED. With no
 * `VAPID_PUBLIC_KEY` set, the module called `generateKeyPairSync` at import and
 * served the result. A browser binds its subscription to the application server
 * key it was given, permanently — so every restart silently invalidated the
 * entire fleet's subscriptions, and every replica in a multi-replica deployment
 * held a different identity from its neighbours. Nothing would have reported
 * this: the handsets would simply have stopped receiving anything.
 *
 * Worse than a missing key, because a missing key is visible.
 *
 * THE KEY IT SERVED WAS THE WRONG SHAPE. `applicationServerKey` takes the raw
 * uncompressed P-256 point — 65 bytes beginning 0x04. What was served was an
 * SPKI DER encoding of it, base64url. `pushManager.subscribe()` rejects that,
 * so no browser reaching this endpoint could have subscribed at all.
 *
 * AND THE FALLBACK WAS A SENTENCE. If key generation threw, the module served
 * the literal string 'BN-mock-public-vapid-key-for-development-purposes-only-
 * 32bytes'. Not a key of any shape.
 *
 * So: the keys are configuration, the endpoint says plainly when there are
 * none rather than inventing some, and delivery is a real adapter that reports
 * SENT, REJECTED or UNAVAILABLE on the same contract as SMS and email — and
 * expires a subscription the push service says is gone.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createVerify, generateKeyPairSync, randomBytes } from 'node:crypto';
import {
  createGovernmentUser,
  get,
  loginAs,
  pool,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './helpers';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { queryOne } from '../db/pool';
import {
  clearVapidForTesting,
  publicKeyFor,
  pushRequestFor,
  resetPushTransport,
  saveSubscription,
  sendPushNotification,
  setPushTransportForTesting,
  setVapidForTesting,
  vapidKeys,
} from '../services/push';
import { providerFor } from '../services/messaging';
import { seedReferenceData } from '../db/seed';

/** A subscriber's keypair, as a browser would produce. */
function subscriberKeys() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const raw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-65);
  return {
    p256dh: Buffer.from(raw).toString('base64url'),
    auth: randomBytes(16).toString('base64url'),
    privateKey,
  };
}

let attempted: string[] = [];
let userId = '';

before(async () => {
  await startTestServer();
});

after(async () => {
  resetPushTransport();
  await stopTestServer();
});

beforeEach(async () => {
  attempted = [];
  await resetDatabase();
  await seedReferenceData();
  userId = await createGovernmentUser({
    role: 'admin',
    phone: '+2348097000001',
    fullName: 'Push Admin',
  });
});

describe('the application server identity', () => {
  it('is configuration, not something the process invents at startup', async () => {
    /*
     * The defect that would have been hardest to diagnose. Two imports of a
     * freshly reset module stand in for two restarts, or for two replicas.
     * Each one previously produced a different key, and every handset bound to
     * the old one went quiet with nothing to look at that would say why.
     */

    const first = vapidKeys();
    const second = vapidKeys();
    assert.deepEqual(
      first,
      second,
      'the application server key must be stable; a browser binds to it permanently',
    );
  });

  it('is absent rather than invented when nothing is configured', async () => {
    const configured = process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY;
    if (configured) return; // the environment has real keys; nothing to assert

    assert.equal(
      vapidKeys(),
      null,
      'a generated key is worse than none: it works until the next deploy',
    );
  });

  it('tells the browser plainly when there is no key to subscribe with', async () => {
    const configured = process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY;
    const response = await get('/push/vapid-key');
    if (configured) {
      assert.equal(response.status, 200);
      return;
    }
    assert.equal(response.status, 503, JSON.stringify(response.body));
    assert.match(response.body.error?.message ?? '', /not configured|no.*key/i);
  });
});

describe('the key a configured server serves', () => {
  it('is the raw uncompressed point a browser can actually subscribe with', async () => {
    /*
     * `applicationServerKey` takes 65 bytes beginning 0x04. What was served was
     * an SPKI DER wrapper, which `pushManager.subscribe()` rejects — so this
     * endpoint could never have produced a single subscription.
     */
    const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const der = publicKey.export({ type: 'spki', format: 'der' });

    const raw = Buffer.from(publicKeyFor(Buffer.from(der).toString('base64url')), 'base64url');
    assert.equal(raw.length, 65, `expected a 65-byte point, got ${raw.length}`);
    assert.equal(raw[0], 0x04, 'an uncompressed point begins 0x04');
  });
});

describe('the request that goes out', () => {
  const configure = async () => {
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const raw = Buffer.from(publicKey.export({ type: 'spki', format: 'der' })).subarray(-65);
    setVapidForTesting({
      publicKey: raw.toString('base64url'),
      // PKCS#8, which is what openssl and Node emit and what web-push refuses.
      // Configuring it must work, or the mismatch surfaces one notification at
      // a time on a live deployment.
      privateKey: Buffer.from(
        privateKey.export({ type: 'pkcs8', format: 'der' }) as Buffer,
      ).toString('base64url'),
      subject: 'mailto:revenue@psirs.pl.gov.ng',
    });
    return { publicKey };
  };

  it('encrypts the payload, so the push service cannot read it', async () => {
    /*
     * The push service is a third party — Google, Mozilla, Microsoft. It routes
     * the message and must not be able to read "Bitrus Danlami paid ₦2,000".
     * RFC 8188's record header is a 16-byte salt, a 4-byte record size, a
     * 1-byte key length and then the sender's 65-byte uncompressed point.
     */
    await configure();
    const keys = subscriberKeys();

    const request = pushRequestFor(
      { endpoint: 'https://push.example.test/abc', p256dh: keys.p256dh, auth: keys.auth },
      { title: 'Settled', body: 'Bitrus Danlami paid ₦2,000.' },
    );

    assert.equal(request.headers['Content-Encoding'], 'aes128gcm');
    assert.doesNotMatch(
      request.body.toString('utf8'),
      /Bitrus|Danlami|2,000/,
      'the payload would have reached the push service in the clear',
    );
    assert.equal(request.body[20], 65, 'the record header must carry the sender key length');
    assert.equal(request.body[21], 0x04, 'and then an uncompressed point');
  });

  it('signs it, so the push service knows which server sent it', async () => {
    const { publicKey } = await configure();
    const keys = subscriberKeys();

    const request = pushRequestFor(
      { endpoint: 'https://push.example.test/signed', p256dh: keys.p256dh, auth: keys.auth },
      { title: 'A', body: 'B' },
    );

    const authorization = request.headers.Authorization ?? '';
    assert.match(authorization, /^vapid /i, `expected a VAPID header, got: ${authorization}`);

    const token = /t=([^,]+)/.exec(authorization)?.[1] ?? '';
    const [header, payload, signature] = token.split('.');
    assert.ok(header && payload && signature, `not a JWT: ${token}`);

    /*
     * Verified against the configured key rather than merely parsed. A JWT
     * signed by a key the push service does not hold is refused with a 403 and
     * nothing ever arrives — which is exactly what the old per-process
     * generated key produced after the first restart.
     */
    const raw = Buffer.from(signature!, 'base64url');
    const der = Buffer.concat([
      Buffer.from([0x30, 0]),
      ...[raw.subarray(0, 32), raw.subarray(32)].map((half) => {
        let value = half;
        while (value.length > 1 && value[0] === 0) value = value.subarray(1);
        const padded = value[0]! & 0x80 ? Buffer.concat([Buffer.from([0]), value]) : value;
        return Buffer.concat([Buffer.from([0x02, padded.length]), padded]);
      }),
    ]);
    der[1] = der.length - 2;

    const verifier = createVerify('sha256');
    verifier.update(`${header}.${payload}`);
    assert.ok(
      verifier.verify(publicKey, der),
      'the push service could not have verified this signature',
    );
  });

  it('names the key the browser subscribed with, so the two match', async () => {
    const { publicKey } = await configure();
    const keys = subscriberKeys();

    const request = pushRequestFor(
      { endpoint: 'https://push.example.test/k', p256dh: keys.p256dh, auth: keys.auth },
      { title: 'A', body: 'B' },
    );

    const served = vapidKeys()!.publicKey;
    const advertised = /k=([^,]+)/.exec(request.headers.Authorization ?? '')?.[1] ?? '';
    assert.equal(advertised, served, 'the signed key must be the one the browser was given');

    const raw = Buffer.from(publicKey.export({ type: 'spki', format: 'der' })).subarray(-65);
    assert.equal(served, raw.toString('base64url'));
  });
});

describe('sending one', () => {
  const configure = async () => {
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const raw = Buffer.from(publicKey.export({ type: 'spki', format: 'der' })).subarray(-65);
    setVapidForTesting({
      publicKey: raw.toString('base64url'),
      privateKey: Buffer.from(
        privateKey.export({ type: 'pkcs8', format: 'der' }) as Buffer,
      ).toString('base64url'),
      subject: 'mailto:revenue@psirs.pl.gov.ng',
    });
  };

  /** A push service that answers however this test needs it to. */
  const answering = async (status: number | 'network') => {
    setPushTransportForTesting(async (subscription: { endpoint: string }) => {
      attempted.push(subscription.endpoint);
      if (status === 'network') throw new Error('socket hang up');
      if (status >= 400) throw Object.assign(new Error('refused'), { statusCode: status });
      return { statusCode: status };
    });
  };

  it('reaches the endpoint the browser named', async () => {
    await configure();
    await answering(201);
    const keys = subscriberKeys();
    await saveSubscription(
      {
        endpoint: 'https://push.example.test/abc123',
        keys: { p256dh: keys.p256dh, auth: keys.auth },
      },
      { userId },
    );

    const result = await sendPushNotification(
      { userId },
      { title: 'Settled', body: 'PSIRS has received ₦2,000.' },
    );

    assert.deepEqual(result, { sent: 1, failed: 0 }, JSON.stringify(result));
    assert.deepEqual(attempted, ['https://push.example.test/abc123']);
  });

  it('forgets a subscription the push service says is gone', async () => {
    /*
     * A 410 is how a push service reports that the handset unsubscribed or was
     * wiped. Left in the table it is retried on every notification for ever,
     * and the failure count grows with nothing actually wrong.
     */
    await configure();
    await answering(410);
    const keys = subscriberKeys();
    const endpoint = 'https://push.example.test/gone';
    await saveSubscription({ endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } }, { userId });

    const result = await sendPushNotification({ userId }, { title: 'A', body: 'B' });
    assert.equal(result.failed, 1, JSON.stringify(result));

    const row = await queryOne<{ expired_at: Date | null }>(
      pool,
      'SELECT expired_at FROM push_subscriptions WHERE endpoint = $1',
      [endpoint],
    );
    assert.ok(row?.expired_at, 'a dead endpoint must be retired, not retried for ever');
  });

  it('does the same for a 404, which some services send instead', async () => {
    await configure();
    await answering(404);
    const keys = subscriberKeys();
    const endpoint = 'https://push.example.test/missing';
    await saveSubscription({ endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } }, { userId });

    await sendPushNotification({ userId }, { title: 'A', body: 'B' });
    const row = await queryOne<{ expired_at: Date | null }>(
      pool,
      'SELECT expired_at FROM push_subscriptions WHERE endpoint = $1',
      [endpoint],
    );
    assert.ok(row?.expired_at);
  });

  it('does not retire a subscription over a service that was merely down', async () => {
    /*
     * The distinction the whole delivery contract turns on, and the one that
     * cannot be undone from this side: nothing here can recreate a
     * subscription, only the citizen opening the application again. Retiring
     * the fleet because a push service had a bad afternoon would be permanent.
     */
    await configure();
    await answering(503);
    const keys = subscriberKeys();
    const endpoint = 'https://push.example.test/wobbly';
    await saveSubscription({ endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } }, { userId });

    await sendPushNotification({ userId }, { title: 'A', body: 'B' });

    const row = await queryOne<{ expired_at: Date | null }>(
      pool,
      'SELECT expired_at FROM push_subscriptions WHERE endpoint = $1',
      [endpoint],
    );
    assert.equal(row?.expired_at, null, 'an outage is not a verdict about the handset');
  });

  it('does not retire one over a connection that never got there', async () => {
    await configure();
    await answering('network');
    const keys = subscriberKeys();
    const endpoint = 'https://push.example.test/unreachable';
    await saveSubscription({ endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } }, { userId });

    const result = await sendPushNotification({ userId }, { title: 'A', body: 'B' });
    assert.equal(result.failed, 1);

    const row = await queryOne<{ expired_at: Date | null }>(
      pool,
      'SELECT expired_at FROM push_subscriptions WHERE endpoint = $1',
      [endpoint],
    );
    assert.equal(row?.expired_at, null, 'an error with no status is not a dead handset');
  });

  it('still refuses to report a delivery when there is no key to sign with', async () => {
    await answering(201);
    clearVapidForTesting();
    const keys = subscriberKeys();
    await saveSubscription(
      {
        endpoint: 'https://push.example.test/unconfigured',
        keys: { p256dh: keys.p256dh, auth: keys.auth },
      },
      { userId },
    );

    await assert.rejects(
      () => sendPushNotification({ userId }, { title: 'A', body: 'B' }),
      /not configured/i,
      'an unconfigured server must say so rather than count a failure',
    );
    assert.deepEqual(attempted, [], 'and must not attempt a delivery it cannot sign');
  });

  it('reports nothing sent, and no failure, when nobody is subscribed', async () => {
    await configure();
    await answering(201);
    const result = await sendPushNotification({ userId }, { title: 'A', body: 'B' });
    assert.deepEqual(result, { sent: 0, failed: 0 });
  });

  it('skips a subscription with no encryption keys rather than failing the batch', async () => {
    // A row saved before the browser handed over its keys cannot be encrypted
    // to. One unusable row must not stop the other handsets receiving.
    await configure();
    await answering(201);
    const keys = subscriberKeys();
    await saveSubscription({ endpoint: 'https://push.example.test/keyless' }, { userId });
    await saveSubscription(
      {
        endpoint: 'https://push.example.test/good',
        keys: { p256dh: keys.p256dh, auth: keys.auth },
      },
      { userId },
    );

    const result = await sendPushNotification({ userId }, { title: 'A', body: 'B' });
    assert.equal(result.sent, 1, JSON.stringify(result));
    assert.deepEqual(attempted, ['https://push.example.test/good']);
  });

  it('does not deliver one person\'s notification to another', async () => {
    await configure();
    await answering(201);
    const keys = subscriberKeys();
    const other = await createGovernmentUser({
      role: 'auditor',
      phone: '+2348097000002',
      fullName: 'Another Officer',
    });
    await saveSubscription(
      {
        endpoint: 'https://push.example.test/theirs',
        keys: { p256dh: keys.p256dh, auth: keys.auth },
      },
      { userId: other },
    );

    const result = await sendPushNotification({ userId }, { title: 'A', body: 'B' });
    assert.deepEqual(result, { sent: 0, failed: 0 });
    assert.deepEqual(attempted, []);
  });
});

describe('the messaging layer', () => {
  it('no longer throws for PUSH once an adapter exists', async () => {
    const provider = providerFor('PUSH');
    assert.ok(provider, 'PUSH must resolve to a provider');
    assert.match(provider.name, /push/i);
  });

  it('permanently refuses a row addressed to something that is not a person', async () => {
    /*
     * A push is addressed to a user id. A queued row carrying a subscription
     * token or a phone number is a template written for the wrong channel, and
     * no amount of retrying makes it a person — so it is refused rather than
     * left in the queue, and refused rather than reported as an outage.
     */
    const result = await providerFor('PUSH').send({
      channel: 'PUSH',
      recipient: 'push-subscription-token',
      message: 'Your receipt is ready',
    });
    assert.equal(result.outcome, 'REJECTED', JSON.stringify(result));
    assert.match(result.reason ?? '', /user id/i);
  });

  it('reports an unconfigured server as UNAVAILABLE, not as a refusal', async () => {
    /*
     * The distinction the notification queue turns on. A deployment missing two
     * environment variables has not failed to reach anybody — it has not tried
     * — and recording that against the citizen would mark them unreachable by
     * push for a mistake made in a configuration file.
     */
    clearVapidForTesting();
    await saveSubscription(
      { endpoint: 'https://push.example.test/waiting', keys: { p256dh: 'x', auth: 'y' } },
      { userId },
    );

    const result = await providerFor('PUSH').send({
      channel: 'PUSH',
      recipient: userId,
      message: 'Your receipt is ready',
    });
    assert.equal(result.outcome, 'UNAVAILABLE', JSON.stringify(result));
    assert.match(result.reason ?? '', /not configured/i);
  });

  it('reports a push to nobody as REJECTED rather than sent', async () => {
    // The recipient of a PUSH delivery is a user id. One with no live
    // subscription is a real refusal — there is no device to deliver to — and
    // it must not be recorded as sent.
    const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    setVapidForTesting({
      publicKey: Buffer.from(pair.publicKey.export({ type: 'spki', format: 'der' }))
        .subarray(-65)
        .toString('base64url'),
      privateKey: (pair.privateKey.export({ format: 'jwk' }) as { d: string }).d,
      subject: 'mailto:revenue@psirs.pl.gov.ng',
    });
    const result = await providerFor('PUSH').send({
      channel: 'PUSH',
      recipient: '00000000-0000-0000-0000-000000000000',
      message: 'Nothing to receive this.',
    });
    assert.equal(result.outcome, 'REJECTED', JSON.stringify(result));
  });
});

describe('the two halves of a notification', () => {
  /**
   * The server encrypts a payload and the service worker decrypts and renders
   * it, and they live in different packages with nothing between them but this
   * agreement. A field of a different name would encrypt, transmit, decrypt and
   * then render a notification with an empty body — silently, on a handset
   * nobody is watching.
   */
  it('agree about what a notification looks like', () => {
    const worker = readFileSync(
      join(__dirname, '..', '..', '..', '..', 'apps', 'agent', 'public', 'sw.js'),
      'utf8',
    );
    const handler = worker.slice(worker.indexOf("addEventListener('push'"));

    for (const field of ['title', 'body', 'data']) {
      assert.match(
        handler,
        new RegExp(`payload\\.${field}\\b`),
        `the server sends "${field}" and the service worker does not read it`,
      );
    }
  });

  it('is sent as JSON, because that is what the service worker parses', () => {
    setVapidForTesting({
      publicKey: Buffer.from(
        generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({
          type: 'spki',
          format: 'der',
        }),
      )
        .subarray(-65)
        .toString('base64url'),
      privateKey: (
        generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({
          format: 'jwk',
        }) as { d: string }
      ).d,
      subject: 'mailto:revenue@psirs.pl.gov.ng',
    });

    const worker = readFileSync(
      join(__dirname, '..', '..', '..', '..', 'apps', 'agent', 'public', 'sw.js'),
      'utf8',
    );
    assert.match(
      worker.slice(worker.indexOf("addEventListener('push'")),
      /event\.data\.json\(\)/,
      'the service worker parses JSON, so the server must send it',
    );
  });
});
