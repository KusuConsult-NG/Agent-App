/**
 * A document that goes on promising a receipt that will never come.
 *
 * The acknowledgement of payment says three things: the gateway has confirmed
 * this payment, the State has not yet received the money, and a receipt follows
 * once it does. All three are true when it is issued.
 *
 * A reversal makes the third one false. The money is being returned, so no
 * receipt will ever be issued — and there is nothing to reverse the
 * acknowledgement, because the only reason a reversal was ever taught to revoke
 * documents was the receipt and the vehicle papers, and those are found by
 * `entity_type IN ('receipt', 'vehicle_renewal')`. An acknowledgement hangs off
 * the transaction, so it is not in that set.
 *
 * The window this lives in is exactly the one the two-stage rule created. Before
 * it, a reversal before settlement had no document to worry about; a receipt
 * only existed if the money had already been banked. Now there is always a
 * document, from gateway confirmation onwards, and reversing a collection in
 * that window leaves it standing.
 *
 * What the citizen holds afterwards is a genuine, verifiable PSIRS document
 * saying their payment is confirmed and a government receipt is on its way, for
 * a payment the government has given back. Public verification confirms it.
 * That is §95 read backwards, which the reversal path already has a comment
 * about — a reversed transaction must not still be able to appear successful —
 * and this is the same defect reaching a document type that did not exist when
 * the comment was written.
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
import { queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';

let agentAuth: { token: string; deviceId: string };
let requester = '';
let approver = '';
let executor = '';
let subject = 0;

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({ fullName: 'Ack Admin', phone: '+2348000000030', role: 'admin' });
  // A reversal needs three different people and the platform will not take fewer.
  await createGovernmentUser({ fullName: 'Ack Requester', phone: '+2348000000031', role: 'revenue_officer' });
  await createGovernmentUser({ fullName: 'Ack Finance One', phone: '+2348000000032', role: 'finance_officer' });
  await createGovernmentUser({ fullName: 'Ack Finance Two', phone: '+2348000000033', role: 'finance_officer' });
  requester = (await loginAs('+2348000000031')).accessToken;
  approver = (await loginAs('+2348000000032')).accessToken;
  executor = (await loginAs('+2348000000033')).accessToken;

  const demo = await seedDemoAgent();
  assert.ok(demo);
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agentAuth = { token: session.accessToken, deviceId: demo!.deviceIdentifier };
});

/**
 * A collection the gateway has confirmed and nobody has settled.
 *
 * Deliberately stops there: this is the window the acknowledgement exists in,
 * and the whole question is what a reversal does to a collection inside it.
 */
async function confirmedNotSettled() {
  subject += 1;
  const taxpayer = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Outlived',
      lastName: `Subject${subject}`,
      phone: `+2348142${String(subject).padStart(6, '0')}`,
      address: '9 Ahmadu Bello Way, Jos',
      lgaId: await firstLgaId(),
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...agentAuth, idempotencyKey: `ack-tp-${subject}` },
  );
  assert.equal(taxpayer.status, 201, JSON.stringify(taxpayer.body));

  const assessment = await post(
    '/revenue/assessments',
    {
      taxpayerId: taxpayer.body.taxpayerId,
      revenueItemId: await revenueItemByCode('SHOPS-KIOSKS'),
      inputs: {},
    },
    { ...agentAuth, idempotencyKey: `ack-as-${subject}` },
  );
  assert.equal(assessment.status, 201, JSON.stringify(assessment.body));

  const payment = await post(
    '/payments/initiate',
    { transactionId: assessment.body.transactionId },
    { ...agentAuth, idempotencyKey: `ack-pay-${subject}` },
  );
  assert.equal(payment.status, 201, JSON.stringify(payment.body));

  await post(
    '/payments/simulate',
    { gatewayReference: payment.body.gatewayReference, outcome: 'SUCCESS', deliverWebhook: true },
    agentAuth,
  );

  const acknowledgement = await queryOne<{
    id: string;
    document_number: string;
    verification_code: string;
    status: string;
  }>(
    pool,
    `SELECT id, document_number, verification_code, status FROM documents
      WHERE document_type = 'PAYMENT_ACKNOWLEDGEMENT' AND entity_id = $1`,
    [assessment.body.transactionId],
  );
  assert.ok(acknowledgement, 'the taxpayer must be holding an acknowledgement to begin with');

  const noReceipt = await queryOne<{ n: string }>(
    pool,
    'SELECT count(*)::text AS n FROM receipts WHERE transaction_id = $1',
    [assessment.body.transactionId],
  );
  assert.equal(noReceipt!.n, '0', 'and no receipt, which is the window this is about');

  return { transactionId: assessment.body.transactionId as string, acknowledgement: acknowledgement! };
}

/** Request, approve and execute a reversal — the three-person path. */
async function reverse(transactionId: string) {
  const request = await post(
    '/government/approvals',
    {
      approvalType: 'PAYMENT_REVERSAL',
      entityType: 'transaction',
      entityId: transactionId,
      payload: {
        reason: 'Taxpayer charged in error',
        refundType: 'REVERSAL',
      },
      reason: 'Duplicate assessment for the same premises in this period.',
    },
    { token: requester },
  );
  assert.equal(request.status, 201, JSON.stringify(request.body));

  const approved = await post(
    `/government/approvals/${request.body.approvalId}/decide`,
    { decision: 'APPROVE', reason: 'Duplicate confirmed against the record.' },
    { token: approver },
  );
  assert.equal(approved.status, 200, JSON.stringify(approved.body));

  const otp = await post(
    '/auth/otp/request',
    { destination: '+2348000000033', purpose: 'STEP_UP' },
    { token: executor },
  );
  await post(
    '/auth/step-up',
    {
      action: 'payment.reversal.approve',
      destination: '+2348000000033',
      code: otp.body.developmentCode,
    },
    { token: executor },
  );

  const executed = await post(
    `/government/approvals/${request.body.approvalId}/execute-reversal`,
    {},
    { token: executor },
  );
  assert.equal(executed.status, 200, JSON.stringify(executed.body));
  return executed;
}

describe('A reversal before the money ever settled', () => {
  it('revokes the acknowledgement, which is the only document there is', async () => {
    const { transactionId, acknowledgement } = await confirmedNotSettled();
    await reverse(transactionId);

    const after = await queryOne<{ status: string }>(
      pool,
      'SELECT status FROM documents WHERE id = $1',
      [acknowledgement.id],
    );
    assert.equal(
      after!.status,
      'REVOKED',
      'a reversed collection may not leave a live document behind saying it was paid',
    );
  });

  it('stops telling a citizen who checks the code that a receipt is coming', async () => {
    /*
     * The failure a citizen actually meets. They were debited, they were given
     * a number, the government gave the money back, and the number still
     * answers "your payment is confirmed and a receipt follows" — which is now
     * false in both halves.
     */
    const { transactionId, acknowledgement } = await confirmedNotSettled();
    await reverse(transactionId);

    const checked = await get(`/verify/${acknowledgement.verification_code}`);
    assert.equal(checked.status, 200, JSON.stringify(checked.body));
    assert.notEqual(
      checked.body.status,
      'VALID',
      `a reversed collection must not verify as valid: ${JSON.stringify(checked.body)}`,
    );
    assert.doesNotMatch(
      checked.body.message ?? '',
      /a receipt (is issued|follows)/i,
      'nothing may still promise a receipt for money that was given back',
    );
  });

  it('says the money came back, not merely that the document is void', async () => {
    /*
     * A revoked receipt is answered with "the payment has since been reversed
     * or refunded. It is no longer valid evidence of payment." A revoked
     * acknowledgement was getting the generic line every other revoked document
     * gets — "this document has been revoked and is no longer valid" — which
     * tells a citizen nothing about the thing they care about.
     *
     * Somebody standing at a counter with a code and a debited account needs to
     * know whether the State cancelled the document or gave the money back.
     * Those are different situations and only one of them means they are square
     * with the government.
     */
    const { transactionId, acknowledgement } = await confirmedNotSettled();
    await reverse(transactionId);

    const checked = await get(`/verify/${acknowledgement.verification_code}`);
    assert.equal(checked.status, 200, JSON.stringify(checked.body));
    assert.match(
      checked.body.message ?? '',
      /revers|refund|returned|paid back/i,
      `the answer must say what happened to the money: ${JSON.stringify(checked.body)}`,
    );
  });

  it('leaves the document in existence, because it is evidence a payment was made', async () => {
    // Revocation is not deletion here any more than it is for a receipt. The
    // citizen was debited, and the record of that has to survive the reversal.
    const { transactionId, acknowledgement } = await confirmedNotSettled();
    await reverse(transactionId);

    const still = await queryOne<{ n: string }>(
      pool,
      'SELECT count(*)::text AS n FROM documents WHERE id = $1',
      [acknowledgement.id],
    );
    assert.equal(still!.n, '1', 'a revoked acknowledgement is marked, never removed');
  });

  it('cannot be re-issued by a later confirmation of the same payment', async () => {
    /*
     * `issueAcknowledgement` looks for a live one and skips if it finds it, so
     * a revoked acknowledgement is exactly the case where it would issue a
     * second. A redelivered webhook after the reversal is ordinary, and it must
     * not hand the citizen a fresh document saying the payment stands.
     */
    const { transactionId, acknowledgement } = await confirmedNotSettled();
    const payment = await queryOne<{ id: string; gateway_reference: string }>(
      pool,
      'SELECT id, gateway_reference FROM payments WHERE transaction_id = $1',
      [transactionId],
    );
    await reverse(transactionId);

    await post(
      '/payments/simulate',
      { gatewayReference: payment!.gateway_reference, outcome: 'SUCCESS', deliverWebhook: true },
      agentAuth,
    );
    await post(`/payments/${payment!.id}/confirm`, undefined, agentAuth);

    const live = await queryOne<{ n: string }>(
      pool,
      `SELECT count(*)::text AS n FROM documents
        WHERE document_type = 'PAYMENT_ACKNOWLEDGEMENT' AND entity_id = $1
          AND status <> 'REVOKED'`,
      [transactionId],
    );
    assert.equal(live!.n, '0', 'a reversed collection may not acquire a fresh acknowledgement');

    const total = await queryOne<{ n: string }>(
      pool,
      `SELECT count(*)::text AS n FROM documents
        WHERE document_type = 'PAYMENT_ACKNOWLEDGEMENT' AND entity_id = $1`,
      [transactionId],
    );
    assert.equal(total!.n, '1', 'and no second one is created either');
    assert.ok(acknowledgement.id, 'the original is the one that stands revoked');
  });
});
