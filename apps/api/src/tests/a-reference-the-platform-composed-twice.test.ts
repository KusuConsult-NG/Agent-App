/**
 * A number the platform composed twice, and the reassurance it offered for it.
 *
 * Every government reference here comes from a PostgreSQL sequence rather than
 * `COUNT(*) + 1`, for the reason `lib/references.ts` gives: a count-based
 * scheme "races under concurrent load and can reissue a receipt number". What
 * a sequence does not survive is being restored behind the table it numbers —
 * a dump reloaded without `setval` leaves the next value pointing at numbers
 * already issued, which is an ordinary operational event rather than an
 * exotic one.
 *
 * When that happens the insert meets a unique index on a composed column, and
 * `error-handler.ts` answered it the way it answers any 23505:
 *
 *     409 DUPLICATE_RECORD
 *     "That record already exists. No duplicate has been created."
 *     moneyStatus: NOT_DEBITED
 *
 * Nobody did anything twice. The caller cannot see the reference, did not
 * choose it, and has no action to take about it — and the third line is the
 * one that matters. NOT_DEBITED means "no payment was attempted", and the
 * agent application renders it as "No money has been taken from the
 * taxpayer", in Hausa too, in plain styling rather than the warning styling it
 * reserves for "do not collect again". A receipt is numbered after the money
 * has arrived. So the platform offered its firmest reassurance about money at
 * a moment it could not support it, to an agent standing in front of somebody
 * who had just handed over cash.
 *
 * `internal()` carries that exact correction in its own header — "the one
 * moment the platform knew least was the moment it spoke with most
 * confidence" — and derives the money state from the request instead. This
 * branch had never had it. The nineteen GENERATED entries in
 * `UNIQUE_CONSTRAINT_NOT_SHOWN` now take that answer, which is the commit
 * their own comment said it was waiting for.
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
  revenueItemByCode,
  startTestServer,
  stopTestServer,
} from './helpers';
import { query, queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';
import {
  GENERATED_REFERENCE_CONSTRAINTS,
  UNIQUE_CONSTRAINT_NOT_SHOWN,
} from '../middleware/error-handler';

let agentAuth: { token: string; deviceId: string };
let officerToken = '';
let taxpayerId = '';
let collected = 0;

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
    role: 'admin',
    phone: '+2348030000700',
    fullName: 'Reference Admin',
  });
  officerToken = (await loginAs('+2348030000700')).accessToken;

  const demo = await seedDemoAgent();
  assert.ok(demo);
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agentAuth = { token: session.accessToken, deviceId: demo!.deviceIdentifier };
  collected = 0;

  const taxpayer = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Ladi',
      lastName: 'Gyang',
      phone: '+2348037100911',
      address: '4 Rwang Pam Street, Jos',
      lgaId: await firstLgaId(),
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...agentAuth, idempotencyKey: 'ref-taxpayer' },
  );
  assert.equal(taxpayer.status, 201, JSON.stringify(taxpayer.body));
  taxpayerId = taxpayer.body.taxpayerId;
});

/**
 * Put a sequence back behind the table it numbers.
 *
 * What a restore without `setval` leaves, written in one statement. `false`
 * for `is_called` so the very next `nextval` returns this value rather than
 * the one after it.
 */
async function rewind(sequence: string, to: number): Promise<void> {
  await query(pool, 'SELECT setval($1, $2, false)', [sequence, to]);
}

async function currentValue(sequence: string): Promise<number> {
  const row = await queryOne<{ last_value: string }>(
    pool,
    `SELECT last_value::text FROM pg_sequences WHERE sequencename = $1`,
    [sequence],
  );
  assert.ok(row, `sequence ${sequence} exists`);
  return Number.parseInt(row!.last_value, 10);
}

/** One assessment, which composes an assessment number from a sequence. */
async function assess() {
  const suffix = String(++collected);
  return post(
    '/revenue/assessments',
    {
      taxpayerId,
      revenueItemId: await revenueItemByCode('SHOPS-KIOSKS'),
      inputs: {},
    },
    { ...agentAuth, idempotencyKey: `ref-asm-${suffix}` },
  );
}

describe('a composed reference that collided', () => {
  it('is answered as a fault on our side, not as a record the caller duplicated', async () => {
    const first = await assess();
    assert.equal(first.status, 201, JSON.stringify(first.body));

    // The sequence now points past the number just issued. Put it back on it.
    const issued = await currentValue('assessment_number_seq');
    await rewind('assessment_number_seq', issued);

    const second = await assess();
    assert.equal(
      second.status,
      500,
      `a generator fault was reported as ${second.status}: ${JSON.stringify(second.body)}`,
    );
    assert.equal(second.body.error.code, 'INTERNAL_ERROR');
    assert.notEqual(
      second.body.error.code,
      'DUPLICATE_RECORD',
      'the caller is still being told they created a duplicate',
    );
    assert.ok(
      second.body.error.reference,
      'and without a reference they cannot even report it',
    );
  });

  it('does not tell an agent no money was taken', async () => {
    /*
     * The money line, on the path where it is read aloud. NOT_DEBITED is "no
     * payment was attempted" and the agent application renders it as "No
     * money has been taken from the taxpayer".
     *
     * Asserted on the assessment path as well as in principle, because that
     * is where this test can provoke the collision deterministically — the
     * payment reference carries a random suffix on purpose, so it cannot be
     * made to collide. What the assessment path must not say is the claim
     * itself: NOT_APPLICABLE is the truthful answer for a write that is not
     * under /payments, and NOT_DEBITED is the one that was wrong.
     */
    const first = await assess();
    assert.equal(first.status, 201, JSON.stringify(first.body));
    await rewind('assessment_number_seq', await currentValue('assessment_number_seq'));

    const second = await assess();
    assert.notEqual(
      second.body.error.moneyStatus,
      'NOT_DEBITED',
      'a collision in a generator still claims nothing was taken from the taxpayer',
    );
    assert.equal(second.body.error.moneyStatus, 'NOT_APPLICABLE');
  });

  /*
   * The control for this change — that a duplicate somebody really created
   * keeps its 409 and the sentence naming what they typed — lives in
   * `what-a-five-hundred-claims-about-money.test.ts` beside the money claim
   * it belongs with. It cannot be driven through an endpoint here: every
   * reachable duplicate in this platform is refused by a pre-check first, so
   * `createDepartment` answers DEPARTMENT_EXISTS under its advisory lock and
   * the handler's branch is never reached.
   */
});

describe('the set the handler reads', () => {
  it('is exactly the entries classified GENERATED', () => {
    // Typed once. A new generated reference classified in the comment and
    // missed in the set would keep the old answer, silently.
    const declared = Object.entries(UNIQUE_CONSTRAINT_NOT_SHOWN)
      .filter(([, reason]) => reason.startsWith('GENERATED'))
      .map(([name]) => name)
      .sort();
    assert.deepEqual([...GENERATED_REFERENCE_CONSTRAINTS].sort(), declared);
    assert.ok(declared.length >= 15, `only ${declared.length} GENERATED entries found`);
  });
});
