/**
 * What must hold when several confirmations of one payment arrive at once.
 *
 * A gateway redelivers webhooks. An agent taps "check payment status" while
 * one is in flight. The reconciliation sweep runs over the same payment an
 * hour later. All three call the same function, and the platform's second
 * inviolable rule is that a confirmed payment yields exactly one government
 * receipt — not two, not none.
 *
 * These tests exist because that guarantee is about to be re-founded. It has
 * been resting on two things at once: an advisory lock per payment, and a
 * SERIALIZABLE transaction. The isolation level is the expensive half — every
 * confirmation appends to the audit chain, the chain hashes its predecessor,
 * so concurrent confirmations of *unrelated* payments all read one tail and
 * write past it. PostgreSQL is obliged to abort them. Measured, that is 83ms
 * alone and 9.3 seconds median at a concurrency of 32, with one in six
 * failing outright.
 *
 * So the question these answer is narrow and worth being exact about: is the
 * advisory lock alone enough? They are written to pass under SERIALIZABLE
 * first, so that a green run afterwards means the guarantee survived the
 * change rather than that the test was too weak to notice.
 */

import '../env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createGovernmentUser, firstLgaId, pool, resetDatabase } from '../helpers';
import { queryOne, query } from '../../db/pool';
import { seedReferenceData } from '../../db/seed';
import { createAssessment } from '../../services/revenue';
import { confirmPayment, initiatePayment } from '../../services/payments';
import { registerTaxpayer } from '../../services/taxpayers';
import { verifyAuditChain } from '../../services/audit';

let officerId = '';
let lgaId = '';
let revenueItemId = '';

/** A payment the gateway will confirm, built the way the platform builds one. */
async function payableFixture(tag: string): Promise<string> {
  const taxpayer = await registerTaxpayer({
    input: {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Race',
      lastName: tag,
      phone: `+23480${String(Date.now()).slice(-8)}`,
      address: '1 Market Road, Jos',
      lgaId,
      consentGiven: true,
      declarationAccepted: true,
    } as never,
    actorId: officerId,
    actorRole: 'revenue_officer',
  });

  const assessment = await createAssessment({
    taxpayerId: taxpayer.taxpayerId,
    revenueItemId,
    inputs: {},
    actorId: officerId,
    actorRole: 'revenue_officer',
    channel: 'OFFICER',
  });

  const payment = await initiatePayment({
    transactionId: assessment.transactionId,
    actorId: officerId,
    actorRole: 'revenue_officer',
  });

  // The gateway now says it was paid. Confirmation still has to go and ask.
  await pool.query(
    `UPDATE mock_gateway_transactions
        SET status = 'SUCCESS', paid_at = now(), payment_method = 'CARD'
      WHERE payment_reference = (SELECT payment_reference FROM payments WHERE id = $1)`,
    [payment.paymentId],
  );

  return payment.paymentId;
}

async function receiptsFor(paymentId: string): Promise<number> {
  const row = await queryOne<{ n: string }>(
    pool,
    'SELECT count(*)::text AS n FROM receipts WHERE payment_id = $1',
    [paymentId],
  );
  return Number(row!.n);
}

before(async () => {
  await resetDatabase();
  await seedReferenceData();
  officerId = await createGovernmentUser({
    fullName: 'Race Test Officer',
    phone: '+2348097000001',
    role: 'revenue_officer',
  });
  lgaId = await firstLgaId();
  const item = await queryOne<{ id: string }>(
    pool,
    `SELECT ri.id FROM revenue_items ri
       JOIN revenue_item_rates r ON r.revenue_item_id = ri.id
      WHERE r.rate_type = 'FIXED' AND ri.status = 'ACTIVE'
        AND 'INDIVIDUAL' = ANY (ri.applicable_taxpayer_types)
      ORDER BY ri.code LIMIT 1`,
  );
  revenueItemId = item!.id;
});

describe('one payment, many confirmations', () => {
  it('issues exactly one receipt when two arrive together', async () => {
    const paymentId = await payableFixture('Pair');

    const [a, b] = await Promise.allSettled([
      confirmPayment({ paymentId, source: 'WEBHOOK', actorRole: 'system' }),
      confirmPayment({ paymentId, source: 'POLL', actorRole: 'system' }),
    ]);

    assert.equal(await receiptsFor(paymentId), 1, 'exactly one receipt');

    // Whichever order they landed in, a caller that succeeded must have been
    // told the receipt — being second is not a failure, it is a replay.
    const succeeded = [a, b].filter((r) => r.status === 'fulfilled');
    assert.ok(succeeded.length >= 1, 'at least one caller is answered');
    const numbers = new Set(
      succeeded.map((r) => (r as PromiseFulfilledResult<any>).value?.receipt?.receiptNumber),
    );
    assert.equal(numbers.size, 1, 'every answered caller gets the same receipt number');
  });

  it('issues exactly one receipt when sixteen arrive together', async () => {
    // Well past the pool size, which is where this used to stop working at all.
    const paymentId = await payableFixture('Sixteen');

    await Promise.allSettled(
      Array.from({ length: 16 }, (_, i) =>
        confirmPayment({
          paymentId,
          source: i % 2 === 0 ? 'WEBHOOK' : 'POLL',
          actorRole: 'system',
        }),
      ),
    );

    assert.equal(await receiptsFor(paymentId), 1, 'still exactly one receipt');

    const payment = await queryOne<{ status: string }>(
      pool,
      'SELECT status FROM payments WHERE id = $1',
      [paymentId],
    );
    assert.equal(payment!.status, 'VERIFIED');
  });

  it('does not let a reconciliation sweep double-receipt a confirmed payment', async () => {
    const paymentId = await payableFixture('Sweep');
    await confirmPayment({ paymentId, source: 'WEBHOOK', actorRole: 'system' });
    await confirmPayment({ paymentId, source: 'RECONCILIATION', actorRole: 'system' });
    assert.equal(await receiptsFor(paymentId), 1);
  });
});

describe('many payments, confirmed at once', () => {
  it('gives every payment its own receipt and loses none', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 12; i += 1) ids.push(await payableFixture(`Many${i}`));

    const results = await Promise.allSettled(
      ids.map((paymentId) => confirmPayment({ paymentId, source: 'POLL', actorRole: 'system' })),
    );

    const rejected = results.filter((r) => r.status === 'rejected');
    assert.deepEqual(
      rejected.map((r) => (r as PromiseRejectedResult).reason?.message),
      [],
      'confirmations of unrelated payments must not fail each other',
    );

    for (const paymentId of ids) {
      assert.equal(await receiptsFor(paymentId), 1, `payment ${paymentId} has one receipt`);
    }

    const numbers = await query<{ receipt_number: string }>(
      pool,
      'SELECT receipt_number FROM receipts WHERE payment_id = ANY($1::uuid[])',
      [ids],
    );
    assert.equal(
      new Set(numbers.map((r) => r.receipt_number)).size,
      ids.length,
      'no two payments share a receipt number',
    );
  });

  it('leaves the audit chain intact after concurrent confirmations', async () => {
    // The chain hashes its predecessor. If concurrency ever forked it, no
    // verifier could replay it afterwards — and that is the record the whole
    // platform rests on.
    const verification = await verifyAuditChain(pool, { fromSequence: 0, limit: 100_000 });
    assert.equal(
      verification.valid,
      true,
      `chain broken at ${verification.brokenAtSequence}: ${verification.detail}`,
    );
    assert.ok(verification.entriesChecked > 0, 'the chain was actually replayed, not skipped');
  });
});
