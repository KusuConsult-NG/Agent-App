/**
 * One declined card, and the bill could never be paid.
 *
 * A payment the gateway refuses moves its transaction to FAILED. FAILED led
 * only to CANCELLED, the payment path took a payment only from
 * INVOICE_GENERATED or PAYMENT_INITIATED, and nothing in the platform raises a
 * second transaction for an invoice. So the first failed attempt was the last
 * attempt: every later one was refused with TRANSACTION_NOT_PAYABLE.
 *
 * Measured before the change, for both ways an attempt ends without money:
 * the gateway refusing it (FAILED) and the citizen walking away from a USSD
 * session or a card page (ABANDONED). Either way the invoice stayed UNPAID,
 * the agent's collection screen went on listing it with "Take this payment",
 * and the transaction screen said "No money has been taken from the taxpayer.
 * You can start the payment again." over actions it had hidden. Pressing the
 * one on the list led to the refusal. A citizen with a declined card in a
 * market had a bill nobody could take their money for until it lapsed.
 *
 * A failed attempt is not a failed debt, so another attempt is now a legal
 * move — through PAYMENT_INITIATED like the first, so a payment still reaches
 * success only from a payment in flight, and only one attempt can be in
 * flight at a time.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  firstLgaId,
  get,
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

let agent: { token: string; device: string };
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
  await createGovernmentUser({ fullName: 'Retry Admin', phone: '+2348035100001', role: 'admin' });
  const demo = await seedDemoAgent();
  assert.ok(demo);
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agent = { token: session.accessToken, device: demo!.deviceIdentifier };
  sequence = 0;
});

const asAgent = () => ({ token: agent.token, deviceId: agent.device });

/** A bill raised by the agent, with nothing yet tried against it. */
async function raise() {
  sequence += 1;
  const suffix = String(sequence);
  const taxpayer = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Declined',
      lastName: `Card${suffix}`,
      phone: `+23481051000${suffix.padStart(2, '0')}`,
      address: '9 Ahmadu Bello Way, Jos',
      lgaId: await firstLgaId(),
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...asAgent(), idempotencyKey: `dc-tp-${suffix}` },
  );
  assert.equal(taxpayer.status, 201, JSON.stringify(taxpayer.body));

  const assessment = await post(
    '/revenue/assessments',
    {
      taxpayerId: taxpayer.body.taxpayerId,
      revenueItemId: await revenueItemByCode('SHOPS-KIOSKS'),
      inputs: {},
    },
    { ...asAgent(), idempotencyKey: `dc-as-${suffix}` },
  );
  assert.equal(assessment.status, 201, JSON.stringify(assessment.body));
  return {
    taxpayerId: taxpayer.body.taxpayerId as string,
    transactionId: assessment.body.transactionId as string,
    invoiceId: assessment.body.invoiceId as string,
  };
}

let attempt = 0;
const startPayment = (transactionId: string) => {
  attempt += 1;
  return post('/payments/initiate', { transactionId }, { ...asAgent(), idempotencyKey: `dc-pay-${attempt}` });
};

const simulate = (gatewayReference: string, outcome: string) =>
  post('/payments/simulate', { gatewayReference, outcome, deliverWebhook: true }, asAgent());

/** Start an attempt and have the gateway end it the given way. */
async function attemptThatEnds(transactionId: string, outcome: 'FAILED' | 'ABANDONED') {
  const started = await startPayment(transactionId);
  assert.equal(started.status, 201, JSON.stringify(started.body));
  const ended = await simulate(started.body.gatewayReference, outcome);
  assert.equal(ended.status, 200, JSON.stringify(ended.body));
  const transaction = await queryOne<{ status: string }>(
    pool,
    'SELECT status FROM transactions WHERE id = $1',
    [transactionId],
  );
  assert.equal(transaction?.status, 'FAILED', 'the precondition: the attempt ended without money');
  return started.body.paymentId as string;
}

describe('A bill whose first payment attempt did not go through', () => {
  for (const outcome of ['FAILED', 'ABANDONED'] as const) {
    it(`takes a second attempt after the gateway reports ${outcome}`, async () => {
      const bill = await raise();
      const firstPayment = await attemptThatEnds(bill.transactionId, outcome);

      const again = await startPayment(bill.transactionId);
      assert.equal(
        again.status,
        201,
        `a second attempt was refused: ${JSON.stringify(again.body)}`,
      );
      assert.notEqual(again.body.paymentId, firstPayment, 'a new attempt, not the old one returned');

      const paid = await simulate(again.body.gatewayReference, 'SUCCESS');
      assert.equal(paid.status, 200, JSON.stringify(paid.body));

      const invoice = await queryOne<{ status: string; amount_paid_kobo: string; total_amount_kobo: string }>(
        pool,
        'SELECT status, amount_paid_kobo, total_amount_kobo FROM invoices WHERE id = $1',
        [bill.invoiceId],
      );
      assert.equal(invoice?.status, 'PAID');
      assert.equal(invoice?.amount_paid_kobo, invoice?.total_amount_kobo, 'paid once, in full');

      // Both attempts are on the record, each with its own outcome.
      const payments = await query<{ id: string; status: string }>(
        pool,
        'SELECT id, status FROM payments WHERE transaction_id = $1 ORDER BY initiated_at',
        [bill.transactionId],
      );
      assert.deepEqual(
        payments.map((p) => p.status),
        [outcome === 'ABANDONED' ? 'ABANDONED' : 'FAILED', 'VERIFIED'],
      );

      // And the journal says what happened, in order: the failure is not
      // erased by the success that followed it.
      const journey = await query<{ to_status: string }>(
        pool,
        `SELECT to_status FROM transaction_events WHERE transaction_id = $1
          ORDER BY created_at, sequence`,
        [bill.transactionId],
      );
      const states = journey.map((e) => e.to_status);
      const failedAt = states.indexOf('FAILED');
      assert.ok(failedAt > 0, `FAILED is in the journal: ${states.join(' > ')}`);
      assert.equal(states[failedAt + 1], 'PAYMENT_INITIATED', states.join(' > '));
      assert.ok(states.includes('PAYMENT_VERIFIED'), states.join(' > '));
    });
  }

  it('shows the bill on the collection screen as something that can be taken, and it can', async () => {
    const bill = await raise();
    await attemptThatEnds(bill.transactionId, 'FAILED');

    const owed = await get(`/revenue/taxpayers/${bill.taxpayerId}/obligations`, asAgent());
    assert.equal(owed.status, 200, JSON.stringify(owed.body));
    const row = (owed.body as { invoice_id: string; transaction_id: string }[]).find(
      (r) => r.invoice_id === bill.invoiceId,
    );
    assert.ok(row, 'the bill is still listed as owed');

    // The list offers "Take this payment" against this transaction. Following
    // it is what used to end in TRANSACTION_NOT_PAYABLE.
    const taken = await startPayment(row!.transaction_id);
    assert.equal(taken.status, 201, JSON.stringify(taken.body));
  });

  it('still holds one attempt in flight at a time', async () => {
    const bill = await raise();
    await attemptThatEnds(bill.transactionId, 'FAILED');

    const first = await startPayment(bill.transactionId);
    const second = await startPayment(bill.transactionId);
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(
      second.body.paymentId,
      first.body.paymentId,
      'a double press after a failure returns the attempt already in flight',
    );
    const live = await query(
      pool,
      `SELECT id FROM payments WHERE transaction_id = $1
         AND status IN ('INITIATED','PENDING','SUCCESSFUL','VERIFIED')`,
      [bill.transactionId],
    );
    assert.equal(live.length, 1);
  });

  it('does not reopen a bill whose deadline has passed', async () => {
    const bill = await raise();
    await attemptThatEnds(bill.transactionId, 'FAILED');
    await pool.query(`UPDATE invoices SET expires_at = now() - interval '1 hour' WHERE id = $1`, [
      bill.invoiceId,
    ]);

    const late = await startPayment(bill.transactionId);
    assert.equal(late.status, 409, JSON.stringify(late.body));
    assert.equal(late.body.error.code, 'INVOICE_EXPIRED');
  });

  it('does not reopen a bill that has been withdrawn', async () => {
    const bill = await raise();
    await attemptThatEnds(bill.transactionId, 'FAILED');
    await pool.query(`UPDATE invoices SET status = 'CANCELLED' WHERE id = $1`, [bill.invoiceId]);

    const withdrawn = await startPayment(bill.transactionId);
    assert.equal(withdrawn.status, 409, JSON.stringify(withdrawn.body));
    assert.equal(withdrawn.body.error.code, 'INVOICE_NOT_PAYABLE');
  });
});
