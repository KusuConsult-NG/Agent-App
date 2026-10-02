/**
 * Two reversals of one payment, arriving together.
 *
 * `enforce_refund_within_payment` is the rule that stops the State giving back
 * more than it took. It sums the refunds already against a payment and refuses
 * an insert that would take the total past what was paid, and it lives in the
 * schema rather than the service deliberately — "a future path that inserts a
 * refund some other way inherits the rule rather than having to remember it".
 *
 * It read the payment and the existing refunds without locking either. Under
 * READ COMMITTED, which is this platform's default, two transactions inserting
 * a refund against the same payment cannot see each other's uncommitted row.
 * Each finds no refunds, each passes, both commit, and the State has recorded
 * that it owes the money twice.
 *
 * Nothing exotic is needed to get two of them going at once. `recordReversal`
 * locks the approval it is executing, not the payment, and `approvals` carries
 * no uniqueness on `(entity_id, approval_type)` — so one transaction can have
 * two reversal approvals, both granted, both executed at the same moment by
 * two officers at two screens. Every guard in that function reads state
 * neither transaction has committed: the payment is still verified to both,
 * and a reversal returns the payment in full by rule, so both refunds are for
 * the whole of it.
 *
 * `enforce_round_quantity`, twelve migrations earlier, has exactly this shape
 * and takes `FOR UPDATE` on its parent row, "so two officers issuing at once
 * cannot between them promise fertiliser that does not exist". These tests are
 * that sentence about money leaving a government account.
 *
 * The rule always worked sequentially, which is why its own test passed. What
 * is held here is the behaviour under contention, at the level the rule lives
 * at: rows inserted directly, because the point of putting it in the schema is
 * that it does not depend on which service wrote them.
 */

import '../env';
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
  settleTransaction,
  startTestServer,
  stopTestServer,
} from '../helpers';
import { queryOne } from '../../db/pool';
import { seedReferenceData } from '../../db/seed';
import { seedDemoAgent } from '../../db/seed-agent';

const REQUESTER = '+2348000000621';
const APPROVER = '+2348000000622';

let agent = { token: '', deviceId: '' };
let requesterId = '';
let approverId = '';
let sequence = 0;

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  requesterId = await createGovernmentUser({
    fullName: 'Reversal Requester',
    phone: REQUESTER,
    role: 'finance_officer',
  });
  approverId = await createGovernmentUser({
    fullName: 'Reversal Approver',
    phone: APPROVER,
    role: 'admin',
  });
  const demo = await seedDemoAgent();
  assert.ok(demo, 'the demo agent needs an administrator to approve it');
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agent = { token: session.accessToken, deviceId: demo!.deviceIdentifier };
});

/** A settled collection, and the verified payment behind it. */
async function collected() {
  sequence += 1;
  const suffix = String(sequence).padStart(2, '0');
  const auth = { ...agent };
  const taxpayer = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Reversed',
      lastName: `Twice${suffix}`,
      phone: `+23480233000${suffix}`,
      address: '3 Market Road, Bokkos',
      lgaId: await firstLgaId(),
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...auth, idempotencyKey: `rr-tp-${suffix}` },
  );
  assert.equal(taxpayer.status, 201, JSON.stringify(taxpayer.body));

  const assessment = await post(
    '/revenue/assessments',
    {
      taxpayerId: taxpayer.body.taxpayerId,
      revenueItemId: await revenueItemByCode('SHOPS-KIOSKS'),
      inputs: {},
    },
    { ...auth, idempotencyKey: `rr-as-${suffix}` },
  );
  assert.equal(assessment.status, 201, JSON.stringify(assessment.body));

  const initiated = await post(
    '/payments/initiate',
    { transactionId: assessment.body.transactionId },
    { ...auth, idempotencyKey: `rr-pay-${suffix}` },
  );
  assert.equal(initiated.status, 201, JSON.stringify(initiated.body));
  await post(
    '/payments/simulate',
    { gatewayReference: initiated.body.gatewayReference, outcome: 'SUCCESS', deliverWebhook: true },
    auth,
  );
  await settleTransaction(assessment.body.transactionId);

  const payment = await queryOne<{ id: string; amount_kobo: string }>(
    pool,
    `SELECT id, amount_kobo FROM payments WHERE transaction_id = $1 AND status = 'VERIFIED'`,
    [assessment.body.transactionId],
  );
  assert.ok(payment, 'the collection produced a verified payment');
  return {
    transactionId: assessment.body.transactionId as string,
    paymentId: payment!.id,
    paidKobo: BigInt(payment!.amount_kobo),
  };
}

/** A granted reversal approval, of which one transaction may have several. */
async function approvalFor(transactionId: string): Promise<string> {
  const row = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO approvals (approval_type, entity_type, entity_id, payload, requested_by,
                            requested_reason, status)
     VALUES ('PAYMENT_REVERSAL','transaction',$1,'{}'::jsonb,$2,'Raced reversal','REQUESTED')
     RETURNING id`,
    [transactionId, requesterId],
  );
  return row!.id;
}

/**
 * One refund insert, on its own connection, inside its own transaction.
 *
 * Both are opened and both insert before either commits, which is the state
 * the service can reach with two officers executing two approvals at once.
 */
async function refundInFlight(params: {
  transactionId: string;
  paymentId: string;
  amountKobo: bigint;
  reference: string;
  approvalId: string;
}) {
  const client = await pool.connect();
  await client.query('BEGIN');
  try {
    await client.query(
      `INSERT INTO refunds (refund_reference, transaction_id, payment_id, amount_kobo,
                            refund_type, reason, approval_id, requested_by, approved_by, approved_at)
       VALUES ($1,$2,$3,$4,'REVERSAL','Raced reversal',$5,$6,$7,now())`,
      [
        params.reference,
        params.transactionId,
        params.paymentId,
        params.amountKobo.toString(),
        params.approvalId,
        requesterId,
        approverId,
      ],
    );
  } catch (error) {
    /*
     * Rolled back and handed back here, not by the caller.
     *
     * A refused insert leaves this connection inside an open transaction, and
     * a caller that only catches the rejection leaves it there — the first
     * version of this file did, and Postgres closed four connections for
     * being idle in a transaction after the tests had already passed. A
     * fixture that leaks the thing it is testing against is a fixture that
     * will fail the next file in the shard rather than this one.
     */
    await client.query('ROLLBACK');
    client.release();
    throw error;
  }
  return client;
}

async function refundedTotal(paymentId: string): Promise<bigint> {
  const row = await queryOne<{ total: string }>(
    pool,
    `SELECT COALESCE(SUM(amount_kobo), 0)::text AS total FROM refunds
      WHERE payment_id = $1 AND status <> 'FAILED'`,
    [paymentId],
  );
  return BigInt(row!.total);
}

describe('two reversals of one payment', () => {
  it('gives back the payment once when both are in flight together', async () => {
    const { transactionId, paymentId, paidKobo } = await collected();
    const first = await approvalFor(transactionId);
    const second = await approvalFor(transactionId);

    /*
     * The first insert is left open and the second is attempted while it is,
     * and what this asserts is that the second WAITS.
     *
     * The first version of this case committed the first insert and then
     * awaited the second, which made the test's own scheduling decide the
     * outcome: if the second insert happened to run after the commit it was
     * refused by the plain sum, lock or no lock. Removing the lock left this
     * case passing, and only the four-at-once case below failed. A test whose
     * verdict depends on a race is the thing being tested, not a test of it.
     *
     * So the second insert is observed while the first is still open. Blocked
     * is the correct state: it means the lock is doing the serialising. Being
     * accepted there is the defect, and it is what the unlocked version does.
     */
    const a = await refundInFlight({
      transactionId,
      paymentId,
      amountKobo: paidKobo,
      reference: 'RFD-RACE-A',
      approvalId: first,
    });

    let settled: 'waiting' | 'accepted' | 'refused' = 'waiting';
    const b = refundInFlight({
      transactionId,
      paymentId,
      amountKobo: paidKobo,
      reference: 'RFD-RACE-B',
      approvalId: second,
    }).then(
      (client) => {
        settled = 'accepted';
        return client;
      },
      (error) => {
        settled = 'refused';
        throw error;
      },
    );
    // Handled here as well, so a rejection before the assertion below is not
    // reported as unhandled and failed outside any test.
    b.catch(() => {});

    /*
     * The first connection is handed back whatever this case decides.
     *
     * Without the `finally` an assertion failure here left it open, the pool
     * ran out, and every later case in the file failed too — so a mutation
     * that broke only this one read as having broken all four, which is a
     * measurement that cannot tell you what it measured.
     */
    try {
      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.equal(
        settled,
        'waiting',
        'the second reversal waits for the first rather than being accepted beside it',
      );
    } finally {
      await a.query('COMMIT');
      a.release();
      // Whatever the second did, it must not keep a connection either.
      await b.then(
        async (client) => {
          await client.query('ROLLBACK');
          client.release();
        },
        () => undefined,
      );
    }

    assert.equal(settled, 'refused', 'and is then refused by the rule');
    assert.equal(
      await refundedTotal(paymentId),
      paidKobo,
      'the State has recorded that it owes the payment once, not twice',
    );
  });

  it('refuses the second of four arriving at once', async () => {
    // Well past two, because the lock has to serialise all of them rather than
    // pair them off.
    const { transactionId, paymentId, paidKobo } = await collected();
    const approvals = await Promise.all([
      approvalFor(transactionId),
      approvalFor(transactionId),
      approvalFor(transactionId),
      approvalFor(transactionId),
    ]);

    const attempts = await Promise.allSettled(
      approvals.map(async (approvalId, index) => {
        const client = await refundInFlight({
          transactionId,
          paymentId,
          amountKobo: paidKobo,
          reference: `RFD-RACE-${index}`,
          approvalId,
        });
        try {
          await client.query('COMMIT');
        } finally {
          client.release();
        }
      }),
    );

    const survived = attempts.filter((result) => result.status === 'fulfilled').length;
    assert.equal(survived, 1, `exactly one of four survives, not ${survived}`);
    assert.equal(await refundedTotal(paymentId), paidKobo);
  });

  it('still refuses a second reversal raised after the first has settled', async () => {
    // The control: the rule worked sequentially before any of this, and has to
    // go on working. A test that only covered the race could be satisfied by a
    // lock that refused everything.
    const { transactionId, paymentId, paidKobo } = await collected();

    const first = await refundInFlight({
      transactionId,
      paymentId,
      amountKobo: paidKobo,
      reference: 'RFD-SEQ-A',
      approvalId: await approvalFor(transactionId),
    });
    await first.query('COMMIT');
    first.release();

    await assert.rejects(
      pool.query(
        `INSERT INTO refunds (refund_reference, transaction_id, payment_id, amount_kobo,
                              refund_type, reason, approval_id, requested_by, approved_by, approved_at)
         VALUES ($1,$2,$3,$4,'REVERSAL','Second reversal',$5,$6,$7,now())`,
        [
          'RFD-SEQ-B',
          transactionId,
          paymentId,
          paidKobo.toString(),
          await approvalFor(transactionId),
          requesterId,
          approverId,
        ],
      ),
      /exceeds/i,
    );
    assert.equal(await refundedTotal(paymentId), paidKobo);
  });

  it('still allows the one reversal a payment is entitled to', async () => {
    // The other control: a lock that deadlocked or refused the first insert
    // would satisfy both checks above and make reversal impossible.
    const { transactionId, paymentId, paidKobo } = await collected();

    const only = await refundInFlight({
      transactionId,
      paymentId,
      amountKobo: paidKobo,
      reference: 'RFD-ONLY-A',
      approvalId: await approvalFor(transactionId),
    });
    await only.query('COMMIT');
    only.release();

    assert.equal(await refundedTotal(paymentId), paidKobo, 'the reversal was recorded');
  });
});
