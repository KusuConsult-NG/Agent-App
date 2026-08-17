/**
 * A retry never sees a key still in progress once the caller has its answer.
 *
 * The middleware recorded the completed response without waiting for the write
 * and sent the reply immediately, so between those two moments the key was
 * still IN_PROGRESS while the caller already held the result. A client that
 * retried inside that window got 409 REQUEST_IN_PROGRESS with moneyStatus
 * UNCONFIRMED rather than a replay of the success that had already happened.
 *
 * That is precisely what a phone on a failing connection does, and on
 * `payment.initiate` it is the worst available answer: the agent is told the
 * state of the money is unknown when the request had in fact succeeded.
 *
 * The window was small enough that it never lost locally and lost on CI, which
 * is the least useful size for a bug to be.
 *
 * Note what each test below is worth. The three end-to-end ones assert the
 * behaviour a client depends on, but they are not proof: against the old
 * implementation they pass on a fast machine, because the write usually wins.
 * They will catch a regression where it actually bites — under load, on a slow
 * runner — and nowhere else.
 *
 * The last test is the real guard. It calls the middleware directly and checks
 * the ordering itself: at the moment the response is handed to Express, the row
 * must already say COMPLETED. That holds regardless of how fast the database
 * is, and it fails against the old implementation every time.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  firstLgaId,
  loginAs,
  pool,
  post,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './helpers';
import { queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';
import { idempotent } from '../middleware/idempotency';

let token = '';
let device = '';
let lgaId = '';

before(async () => {
  await startTestServer();
});

after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({
    fullName: 'Idempotency Test Admin',
    phone: '+2348000000001',
    role: 'admin',
  });
  const demo = await seedDemoAgent();
  assert.ok(demo);
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  token = session.accessToken;
  device = demo!.deviceIdentifier;
  lgaId = await firstLgaId();
});

function taxpayerBody(phone: string) {
  return {
    taxpayerType: 'INDIVIDUAL' as const,
    firstName: 'Rahila',
    lastName: 'Bot',
    phone,
    address: '22 Bauchi Road, Jos',
    lgaId,
    consentGiven: true,
    declarationAccepted: true,
  };
}

describe('An idempotent request is recorded before its caller is answered', () => {
  it('replays immediately, with no gap in which the key is still in progress', async () => {
    const body = taxpayerBody('+2347033900001');
    const key = 'race-taxpayer-1';

    const first = await post('/taxpayers', body, { token, deviceId: device, idempotencyKey: key });
    assert.equal(first.status, 201, JSON.stringify(first.body));

    // No delay. The previous implementation was still writing COMPLETED at
    // this point, so this arrived while the row said IN_PROGRESS.
    const replay = await post('/taxpayers', body, { token, deviceId: device, idempotencyKey: key });

    assert.equal(
      replay.status,
      201,
      `a retry must replay the original response, not be refused: ${JSON.stringify(replay.body)}`,
    );
    assert.equal(replay.headers.get('idempotent-replay'), 'true');
    assert.equal(replay.body.taxpayerId, first.body.taxpayerId);
  });

  it('holds under a burst of retries, none of which may be refused', async () => {
    const body = taxpayerBody('+2347033900002');
    const key = 'race-taxpayer-2';

    const first = await post('/taxpayers', body, { token, deviceId: device, idempotencyKey: key });
    assert.equal(first.status, 201);

    const retries = await Promise.all(
      Array.from({ length: 5 }, () =>
        post('/taxpayers', body, { token, deviceId: device, idempotencyKey: key }),
      ),
    );

    for (const retry of retries) {
      assert.equal(retry.status, 201, JSON.stringify(retry.body));
      assert.equal(retry.body.taxpayerId, first.body.taxpayerId);
    }

    const count = await queryOne<{ count: string }>(
      pool,
      'SELECT count(*)::text AS count FROM taxpayers WHERE phone = $1',
      [body.phone],
    );
    assert.equal(count?.count, '1', 'and still exactly one taxpayer');
  });

  it('has already stored the response by the time the caller sees it', async () => {
    // The property itself, checked directly rather than through a retry: the
    // row is COMPLETED the moment the response has been read.
    const body = taxpayerBody('+2347033900003');
    const key = 'race-taxpayer-3';

    const response = await post('/taxpayers', body, {
      token,
      deviceId: device,
      idempotencyKey: key,
    });
    assert.equal(response.status, 201);

    const row = await queryOne<{ status: string; response_code: number | null }>(
      pool,
      'SELECT status, response_code FROM idempotency_keys WHERE idempotency_key = $1',
      [key],
    );
    assert.equal(row?.status, 'COMPLETED');
    assert.equal(row?.response_code, 201);
  });
});

describe('The ordering itself, independent of how fast the database is', () => {
  it('has written COMPLETED before the response reaches Express', async () => {
    // The middleware wraps res.json and calls the original once it has
    // recorded the outcome. Standing in for Express here means the recorded
    // state can be read at exactly the moment the response would be sent —
    // which is the invariant, rather than a race that a fast machine wins.
    const key = 'ordering-probe-1';
    let statusWhenSent: string | undefined;

    const req = {
      header: (name: string) => (name.toLowerCase() === 'idempotency-key' ? key : undefined),
      path: '/probe',
      method: 'POST',
      body: { probe: true },
      auth: undefined,
    } as unknown as Parameters<ReturnType<typeof idempotent>>[0];

    const res = {
      statusCode: 201,
      setHeader: () => {},
      json: async () => {
        const row = await queryOne<{ status: string }>(
          pool,
          'SELECT status FROM idempotency_keys WHERE idempotency_key = $1',
          [key],
        );
        statusWhenSent = row?.status;
      },
    } as unknown as Parameters<ReturnType<typeof idempotent>>[1];

    await new Promise<void>((resolve, reject) => {
      void idempotent('probe.scope')(req, res, ((error?: unknown) =>
        error ? reject(error) : resolve()) as never);
    });

    // The handler responds; the middleware must record before passing it on.
    res.json({ ok: true });

    // Let the recording and the forwarded send settle.
    await new Promise((resolve) => setTimeout(resolve, 150));

    assert.equal(
      statusWhenSent,
      'COMPLETED',
      'the response reached Express while the key still said ' +
        `${statusWhenSent} — a retry arriving now would be refused as in progress`,
    );
  });
});
