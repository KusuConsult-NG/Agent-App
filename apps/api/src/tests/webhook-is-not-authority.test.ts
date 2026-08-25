/**
 * A webhook that lies, and is correctly signed.
 *
 * `handleWebhook` says it plainly: "the delivery conveys no authority over
 * payment state — `confirmPayment` re-verifies against the gateway." Everything
 * else in this path is built on that sentence. It is the difference between a
 * platform that believes what it is told and one that checks, which is PRD §95
 * in a single design decision.
 *
 * What the suite already pins is the perimeter. An unsigned delivery is
 * refused without touching payment state; a redelivery creates nothing; a
 * receipt for a payment that is not VERIFIED is refused by the database; the
 * agent's "I have paid" reports UNCONFIRMED while the gateway says pending.
 *
 * None of those is this. Those are deliveries that fail to authenticate, or
 * claims made through the poll route. This is a delivery that authenticates
 * perfectly and asserts something untrue: signature valid, event
 * `charge.success`, amount stated — for a payment the gateway still holds as
 * pending. The platform has to accept the delivery and disbelieve the claim.
 *
 * The threat is not a forger; a forger has no signing key. It is the ordinary
 * one: a gateway that fires an optimistic callback before settlement, a
 * misrouted notification, a processor whose own state is briefly wrong. The
 * platform must not turn any of those into a government receipt.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  apiBaseUrl,
  firstLgaId,
  loginAs,
  pool,
  post,
  resetDatabase,
  startTestServer,
  stopTestServer,
  revenueItemByCode,
  createGovernmentUser,
} from './helpers';
import { queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';
import { signWebhookPayload } from '../lib/crypto';

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
  await createGovernmentUser({ fullName: 'Webhook Admin', phone: '+2348000000100', role: 'admin' });
  const demo = await seedDemoAgent();
  assert.ok(demo);
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agent = { token: session.accessToken, device: demo!.deviceIdentifier };
});

/** A collection taken as far as an initiated payment, and no further. */
async function awaitingPayment(): Promise<{
  transactionId: string;
  paymentId: string;
  gatewayReference: string;
}> {
  const auth = { token: agent.token, deviceId: agent.device };
  const taxpayer = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Pending',
      lastName: 'Trader',
      phone: '+2348044400001',
      address: '6 Market Road, Bokkos',
      lgaId: await firstLgaId(),
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...auth, idempotencyKey: 'tp-wh' },
  );
  assert.equal(taxpayer.status, 201, JSON.stringify(taxpayer.body));

  const assessment = await post(
    '/revenue/assessments',
    {
      taxpayerId: taxpayer.body.taxpayerId,
      revenueItemId: await revenueItemByCode('SHOPS-KIOSKS'),
      inputs: {},
    },
    { ...auth, idempotencyKey: 'as-wh' },
  );
  assert.equal(assessment.status, 201, JSON.stringify(assessment.body));

  const initiated = await post(
    '/payments/initiate',
    { transactionId: assessment.body.transactionId },
    { ...auth, idempotencyKey: 'pay-wh' },
  );
  assert.equal(initiated.status, 201, JSON.stringify(initiated.body));

  // Deliberately not simulated: the gateway still holds this as pending.
  return {
    transactionId: assessment.body.transactionId,
    paymentId: initiated.body.paymentId,
    gatewayReference: initiated.body.gatewayReference,
  };
}

/** Deliver a webhook the way the gateway would, signed with the real key. */
async function deliver(payload: Record<string, unknown>) {
  const raw = Buffer.from(JSON.stringify(payload));
  const response = await fetch(`${apiBaseUrl()}/webhooks/payments`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-psirs-signature': signWebhookPayload(raw),
    },
    body: raw,
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function receiptFor(transactionId: string) {
  return queryOne<{ receipt_number: string }>(
    pool,
    'SELECT receipt_number FROM receipts WHERE transaction_id = $1',
    [transactionId],
  );
}

describe('A signed webhook is a prompt, not a verdict', () => {
  it('issues no receipt when the gateway still calls the payment pending', async () => {
    const { transactionId, paymentId, gatewayReference } = await awaitingPayment();

    const delivered = await deliver({
      id: 'evt_optimistic_1',
      event: 'charge.success',
      data: { reference: gatewayReference, amount: '300000', channel: 'CARD' },
    });

    // The delivery authenticates, so it is accepted and acknowledged.
    assert.equal(delivered.status, 200, JSON.stringify(delivered.body));

    // What it claims is not believed.
    assert.equal(await receiptFor(transactionId), null, 'a receipt was issued on the say-so of a webhook');

    const payment = await queryOne<{ status: string }>(
      pool,
      'SELECT status FROM payments WHERE id = $1',
      [paymentId],
    );
    assert.notEqual(payment!.status, 'VERIFIED', 'the payment was marked verified without verification');

    const transaction = await queryOne<{ status: string }>(
      pool,
      'SELECT status FROM transactions WHERE id = $1',
      [transactionId],
    );
    assert.notEqual(transaction!.status, 'RECEIPT_GENERATED');
    assert.notEqual(transaction!.status, 'RECONCILIATION_PENDING');
  });

  it('records the delivery and why it came to nothing, rather than dropping it', async () => {
    const { gatewayReference } = await awaitingPayment();

    await deliver({
      id: 'evt_optimistic_2',
      event: 'charge.success',
      data: { reference: gatewayReference, amount: '300000' },
    });

    const event = await queryOne<{ processing_status: string; processing_note: string | null }>(
      pool,
      `SELECT processing_status, processing_note FROM payment_webhook_events WHERE event_id = $1`,
      ['evt_optimistic_2'],
    );
    assert.ok(event, 'the delivery is on the record');
    assert.equal(event!.processing_status, 'FAILED');
    assert.match(
      String(event!.processing_note),
      /confirm|pending|unconfirmed/i,
      `the note should say why nothing happened: ${event!.processing_note}`,
    );
  });

  it('does not let the amount in the payload decide anything', async () => {
    const { transactionId, gatewayReference } = await awaitingPayment();

    // A figure that matches nothing, from a delivery that is otherwise perfect.
    await deliver({
      id: 'evt_optimistic_3',
      event: 'charge.success',
      data: { reference: gatewayReference, amount: '1', channel: 'CARD' },
    });

    assert.equal(await receiptFor(transactionId), null);
    const flags = await queryOne<{ n: string }>(
      pool,
      `SELECT count(*)::text AS n FROM fraud_flags WHERE transaction_id = $1`,
      [transactionId],
    );
    // The payload's amount is not consulted at all, so it raises nothing either
    // way — the gateway's own figure is what the amount check compares.
    assert.equal(flags!.n, '0');
  });

  // --- controls ---

  it('still issues the receipt once the gateway itself says the money arrived', async () => {
    const { transactionId, gatewayReference } = await awaitingPayment();

    const simulated = await post(
      '/payments/simulate',
      { gatewayReference, outcome: 'SUCCESS', deliverWebhook: true },
      { token: agent.token, deviceId: agent.device },
    );
    assert.equal(simulated.status, 200, JSON.stringify(simulated.body));

    const receipt = await receiptFor(transactionId);
    assert.ok(receipt, 'the ordinary path still works');
    assert.match(receipt!.receipt_number, /^PSIRS\/\d{4}\/\d{6}$/);
  });

  it('still refuses a delivery that is not signed at all', async () => {
    const { gatewayReference } = await awaitingPayment();
    const response = await fetch(`${apiBaseUrl()}/webhooks/payments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'evt_unsigned_1',
        event: 'charge.success',
        data: { reference: gatewayReference, amount: '300000' },
      }),
    });
    assert.equal(response.status, 401);
  });
});
