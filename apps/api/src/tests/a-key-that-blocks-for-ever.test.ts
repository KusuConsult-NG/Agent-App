/**
 * The retry that could never succeed, and the table nothing pruned.
 *
 * A key goes IN_PROGRESS before the handler runs and is settled when the
 * response is written. If the process dies in between — a pod evicted, a
 * container killed — or if the settling UPDATE itself fails, the row stays
 * IN_PROGRESS and nothing is left to move it. Every retry of that action then
 * got 409 REQUEST_IN_PROGRESS with `moneyStatus: UNCONFIRMED` and the advice to
 * "wait a moment", for ever, on `payment.initiate` — the one route where the
 * key is required and the subject is money.
 *
 * The same table had never had a row deleted from it. Every taxpayer
 * registration, assessment, payment initiation and vehicle renewal leaves one
 * carrying a full response body as JSONB, kept for the life of the platform.
 * `idx_idempotency_created` has sat on `created_at` since the first migration
 * serving nothing, which is what a retention sweep somebody intended and never
 * wrote looks like. `usage_events` had the opposite half: a retention function
 * and an endpoint to call it, and no schedule, so telemetry was pruned when
 * somebody remembered.
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
import { query, queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';
import { expireSettledKeys } from '../middleware/idempotency';
import { BACKGROUND_JOBS } from '../services/jobs';

let agent: { token: string; device: string };

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({ fullName: 'Key Admin', phone: '+2348059000001', role: 'admin' });
  const demo = await seedDemoAgent();
  assert.ok(demo);
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agent = { token: session.accessToken, device: demo!.deviceIdentifier };
});

/**
 * Register a taxpayer under a caller-chosen key, which is what a retry reuses.
 *
 * `subject` is passed explicitly rather than incremented, because a retry is
 * the *same* request: the middleware hashes path, method and body, so a retry
 * that changed a single character would be refused as key reuse rather than
 * reaching the behaviour under test.
 */
async function register(idempotencyKey: string, suffix: number) {
  return post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Key',
      lastName: `Subject${suffix}`,
      phone: `+234811900000${suffix}`,
      address: '9 Ahmadu Bello Way, Jos',
      lgaId: await firstLgaId(),
      consentGiven: true,
      declarationAccepted: true,
    },
    { token: agent.token, deviceId: agent.device, idempotencyKey },
  );
}

const age = (key: string, interval: string) =>
  pool.query(
    `UPDATE idempotency_keys SET created_at = now() - $2::interval WHERE idempotency_key = $1`,
    [key, interval],
  );

describe('A request that was interrupted says so', () => {
  it('stops saying "wait a moment" once the attempt is plainly not coming back', async () => {
    /*
     * The interrupted request is created by making a real one and then making
     * the row look like the process died before it could be settled — which is
     * exactly the state a killed container leaves behind.
     */
    const first = await register('stalled-1', 1);
    assert.equal(first.status, 201, JSON.stringify(first.body));
    await pool.query(
      `UPDATE idempotency_keys SET status = 'IN_PROGRESS', response_code = NULL,
              response_body = NULL, completed_at = NULL
        WHERE idempotency_key = 'stalled-1'`,
    );

    // Within the window, waiting is still the right advice.
    const soon = await register('stalled-1', 1);
    assert.equal(soon.status, 409, JSON.stringify(soon.body));
    assert.equal(soon.body.error.code, 'REQUEST_IN_PROGRESS');

    // Past it, the platform stops claiming something is still happening.
    await age('stalled-1', '30 minutes');
    const later = await register('stalled-1', 1);
    assert.equal(later.status, 409, JSON.stringify(later.body));
    assert.equal(later.body.error.code, 'REQUEST_INTERRUPTED');
    assert.equal(later.body.error.moneyStatus, 'UNCONFIRMED');
    assert.match(later.body.error.message, /interrupted and never finished/i);
    assert.match(later.body.error.message, /use a new key/i);
  });

  it('does not re-run the interrupted request, whatever it may have already done', async () => {
    /*
     * The tempting fix is to mark a stalled key retryable. It is the wrong one:
     * an interrupted request may have committed and lost only its response, so
     * re-running it is precisely the double-charge this middleware exists to
     * prevent. The refusal is the deliverable, not a step towards a retry.
     */
    const first = await register('stalled-2', 2);
    assert.equal(first.status, 201);
    const taxpayerId = first.body.taxpayerId;

    await pool.query(
      `UPDATE idempotency_keys SET status = 'IN_PROGRESS' WHERE idempotency_key = 'stalled-2'`,
    );
    await age('stalled-2', '2 hours');

    const retry = await register('stalled-2', 2);
    assert.equal(retry.body.error.code, 'REQUEST_INTERRUPTED');

    const rows = await query(pool, `SELECT id FROM taxpayers WHERE id = $1`, [taxpayerId]);
    assert.equal(rows.length, 1, 'the record the first attempt created is untouched');
    const all = await query(pool, `SELECT id FROM taxpayers`);
    assert.equal(all.length, 1, 'and the refused retry created nothing');
  });

  it('replays a completed request as it always did', async () => {
    const first = await register('replay-1', 3);
    assert.equal(first.status, 201);
    const again = await register('replay-1', 3);
    assert.equal(again.status, 201);
    assert.equal(again.body.taxpayerId, first.body.taxpayerId);
  });
});

describe('The table nothing pruned', () => {
  it('deletes settled keys past the retention window', async () => {
    await register('old-1', 4);
    await register('recent-1', 5);
    await age('old-1', '90 days');

    const result = await expireSettledKeys(30);
    assert.equal(result.deleted, 1);

    const left = await query<{ idempotency_key: string }>(
      pool,
      `SELECT idempotency_key FROM idempotency_keys ORDER BY idempotency_key`,
    );
    assert.deepEqual(left.map((row) => row.idempotency_key), ['recent-1']);
  });

  it('never deletes the record of a request that was interrupted', async () => {
    /*
     * Deleting an IN_PROGRESS row would let the same key re-execute, turning
     * the one control against a double charge into the cause of one. Age is
     * not a reason to forget a money-path request whose outcome is unknown.
     */
    await register('interrupted-1', 6);
    await pool.query(
      `UPDATE idempotency_keys SET status = 'IN_PROGRESS' WHERE idempotency_key = 'interrupted-1'`,
    );
    await age('interrupted-1', '400 days');

    const result = await expireSettledKeys(30);
    assert.equal(result.deleted, 0, 'nothing was deleted');
    assert.equal(result.interrupted, 1, 'and the sweep says it found one');

    const row = await queryOne(
      pool,
      `SELECT status FROM idempotency_keys WHERE idempotency_key = 'interrupted-1'`,
    );
    assert.ok(row, 'the row is still there');
  });

  it('leaves a failed attempt retryable rather than pruning it early', async () => {
    await register('failed-1', 7);
    await pool.query(
      `UPDATE idempotency_keys SET status = 'FAILED' WHERE idempotency_key = 'failed-1'`,
    );

    assert.equal((await expireSettledKeys(30)).deleted, 0, 'not old enough to prune');

    /*
     * A FAILED key is the one status the middleware lets through to the
     * handler again, and it does: the refusal that comes back is duplicate
     * detection on the taxpayer, not an idempotency code. That layering is the
     * point — the key stops a retry being *replayed* wrongly, and the handler's
     * own guard stops it creating a second record.
     */
    const before = (await query(pool, `SELECT id FROM taxpayers`)).length;
    const retry = await register('failed-1', 7);
    assert.ok(
      !['REQUEST_IN_PROGRESS', 'REQUEST_INTERRUPTED', 'IDEMPOTENCY_KEY_REUSED'].includes(
        retry.body?.error?.code,
      ),
      `the retry reached the handler, got ${JSON.stringify(retry.body)}`,
    );
    const after = (await query(pool, `SELECT id FROM taxpayers`)).length;
    assert.equal(after, before, 'and did not create a second record');
  });
});

describe('Both sweeps are on a schedule rather than a button', () => {
  it('declares the two tables that grew without bound', () => {
    assert.ok(BACKGROUND_JOBS['idempotency-sweep']);
    assert.ok(BACKGROUND_JOBS['usage-retention']);
    // Daily. Neither is urgent and both are unbounded, which is the argument
    // for a schedule at all rather than for any particular cadence.
    assert.equal(BACKGROUND_JOBS['idempotency-sweep'].intervalMs, 24 * 60 * 60_000);
    assert.equal(BACKGROUND_JOBS['usage-retention'].intervalMs, 24 * 60 * 60_000);
  });
});
