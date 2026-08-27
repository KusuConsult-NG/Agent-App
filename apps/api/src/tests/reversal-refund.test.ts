/**
 * What a reversal owes the people it touches.
 *
 * Driving the cascade by hand turned up two things that had never shown,
 * because the reversal path had code and unit tests but had never been used.
 *
 * 1. A REFUND WAS RECORDED AS COMPLETED WITHOUT ANY MONEY MOVING. The row was
 *    inserted straight as COMPLETED, and the gateway contract had no refund
 *    method at all. The receipt was voided, the transaction marked REVERSED,
 *    and public verification told anyone who asked that "the payment has since
 *    been reversed or refunded" — while the money sat where it was. That is
 *    PRD §95 inside out: a citizen who paid twice was told they had their
 *    money back.
 *
 * 2. THE CLAWBACK WAS RECORDED AND NEVER RECOVERED. Reversing a transaction
 *    whose commission had already been paid marked it REVERSED and reported a
 *    clawback figure, and the next payout handed over the full amount anyway.
 *
 * The controls that were already right are covered too, because they are the
 * reason a reversal is trustworthy: three different people, and none of them
 * able to do two of the jobs.
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
  startTestServer,
  stopTestServer,
  revenueItemByCode,
  settleTransaction,
} from './helpers';
import { query, queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';
import { computeComplianceScore } from '../services/incentives';

let agent: { token: string; device: string; id: string };
let requester = '';
let approver = '';
let executor = '';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  // seedDemoAgent walks the real clearance pipeline, which needs an approver.
  await createGovernmentUser({ fullName: 'Rev Admin', phone: '+2348000000020', role: 'admin' });
  // A reversal needs three people, and the platform will not accept fewer.
  await createGovernmentUser({ fullName: 'Rev Requester', phone: '+2348000000021', role: 'revenue_officer' });
  await createGovernmentUser({ fullName: 'Finance One', phone: '+2348000000022', role: 'finance_officer' });
  await createGovernmentUser({ fullName: 'Finance Two', phone: '+2348000000023', role: 'finance_officer' });
  requester = (await loginAs('+2348000000021')).accessToken;
  approver = (await loginAs('+2348000000022')).accessToken;
  executor = (await loginAs('+2348000000023')).accessToken;

  const demo = await seedDemoAgent();
  assert.ok(demo);
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  const row = await queryOne<{ id: string }>(
    pool,
    'SELECT a.id FROM agents a JOIN users u ON u.id = a.user_id WHERE u.phone = $1',
    [demo!.phone],
  );
  agent = { token: session.accessToken, device: demo!.deviceIdentifier, id: row!.id };
});

/** A collection taken through to a verified payment and an accrued commission. */
async function collect(suffix: string) {
  const lgaId = await firstLgaId();
  const auth = { token: agent.token, deviceId: agent.device };
  const taxpayer = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Reversal',
      lastName: `Subject${suffix}`,
      phone: `+23480111${suffix.padStart(5, '0')}`,
      address: '3 Market Road, Bokkos',
      lgaId,
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...auth, idempotencyKey: `tp-${suffix}` },
  );
  assert.equal(taxpayer.status, 201, JSON.stringify(taxpayer.body));

  const assessment = await post(
    '/revenue/assessments',
    {
      taxpayerId: taxpayer.body.taxpayerId,
      revenueItemId: await revenueItemByCode('SHOPS-KIOSKS'),
      inputs: {},
    },
    { ...auth, idempotencyKey: `as-${suffix}` },
  );
  const initiated = await post(
    '/payments/initiate',
    { transactionId: assessment.body.transactionId },
    { ...auth, idempotencyKey: `pay-${suffix}` },
  );
  await post(
    '/payments/simulate',
    { gatewayReference: initiated.body.gatewayReference, outcome: 'SUCCESS', deliverWebhook: true },
    auth,
  );
  // A reversal reverses a receipt, and a receipt exists once the State has
  // actually been paid — so the fixture takes the collection all the way.
  await settleTransaction(assessment.body.transactionId);

  return {
    taxpayerId: taxpayer.body.taxpayerId as string,
    transactionId: assessment.body.transactionId as string,
    reference: assessment.body.transactionReference as string,
    gatewayReference: initiated.body.gatewayReference as string,
  };
}

/** Request, approve and execute a reversal — the three-person path. */
async function reverse(transactionId: string, payload: Record<string, unknown> = {}) {
  const request = await post(
    '/government/approvals',
    {
      approvalType: 'PAYMENT_REVERSAL',
      entityType: 'transaction',
      entityId: transactionId,
      payload: {
        amountKobo: '300000',
        reason: 'Taxpayer charged in error',
        refundType: 'REVERSAL',
        ...payload,
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

  await grantStepUp('+2348000000023', executor);
  return post(`/government/approvals/${request.body.approvalId}/execute-reversal`, {}, { token: executor });
}

async function grantStepUp(phone: string, token: string) {
  const otp = await post('/auth/otp/request', { destination: phone, purpose: 'STEP_UP' }, { token });
  await post(
    '/auth/step-up',
    { action: 'payment.reversal.approve', destination: phone, code: otp.body.developmentCode },
    { token },
  );
}

describe('A refund is not made until the gateway says it was', () => {
  it('records the refund as pending, then completed only once the gateway accepts', async () => {
    const collected = await collect('1');
    const result = await reverse(collected.transactionId);
    assert.equal(result.status, 200, JSON.stringify(result.body));

    assert.equal(result.body.refundStatus, 'COMPLETED');
    const refund = await queryOne<{ status: string; attempts: number; gateway_reference: string }>(
      pool,
      'SELECT status, attempts, gateway_reference FROM refunds WHERE refund_reference = $1',
      [result.body.refundReference],
    );
    assert.equal(refund?.status, 'COMPLETED');
    assert.ok(refund!.attempts > 0, 'the gateway was actually asked');
    assert.ok(refund!.gateway_reference, 'and gave its own reference for the refund');

    // The gateway's own ledger, not just ours.
    const atGateway = await queryOne<{ status: string }>(
      pool,
      'SELECT status FROM mock_gateway_transactions WHERE gateway_reference = $1',
      [collected.gatewayReference],
    );
    assert.equal(atGateway?.status, 'REVERSED', 'the money was returned at the gateway');
  });

  it('leaves the refund outstanding when the gateway cannot be reached, and says so', async () => {
    const collected = await collect('2');
    // The mock treats this marker as unreachable, the way ZZZ plates do for the
    // vehicle registry.
    const unreachable = `${collected.gatewayReference}-UNREACHABLE`;
    await pool.query('UPDATE mock_gateway_transactions SET gateway_reference = $2 WHERE gateway_reference = $1', [collected.gatewayReference, unreachable]);
    await pool.query('UPDATE payments SET gateway_reference = $2 WHERE gateway_reference = $1', [collected.gatewayReference, unreachable]);

    const result = await reverse(collected.transactionId);
    assert.equal(result.status, 200);
    assert.equal(result.body.refundStatus, 'PENDING', 'not completed — nobody returned any money');
    assert.match(result.body.refundMessage, /NOT been refunded/i);

    const refund = await queryOne<{ status: string; failure_reason: string }>(
      pool,
      'SELECT status, failure_reason FROM refunds WHERE refund_reference = $1',
      [result.body.refundReference],
    );
    assert.equal(refund?.status, 'PENDING');
    assert.ok(refund!.failure_reason, 'and why is recorded');

    // The reversal itself still stands: it was government's decision, not the
    // gateway's.
    const receipt = await queryOne<{ status: string }>(
      pool,
      'SELECT status FROM receipts WHERE transaction_id = $1',
      [collected.transactionId],
    );
    assert.equal(receipt?.status, 'REVERSED');

    // And it is queued as money still owed, not closed.
    const outstanding = await get('/government/refunds/outstanding', { token: approver });
    assert.ok(
      outstanding.body.refunds.some((r: { refund_reference: string }) => r.refund_reference === result.body.refundReference),
      'the taxpayer is still owed, and a finance officer can see it',
    );

    // When the gateway returns, the retry makes it.
    await pool.query('UPDATE mock_gateway_transactions SET gateway_reference = $2 WHERE gateway_reference = $1', [unreachable, collected.gatewayReference]);
    await pool.query('UPDATE payments SET gateway_reference = $2 WHERE gateway_reference = $1', [unreachable, collected.gatewayReference]);
    const retried = await post('/government/refunds/retry', {}, { token: approver });
    assert.equal(retried.body.completed, 1);

    const settled = await queryOne<{ status: string }>(
      pool,
      'SELECT status FROM refunds WHERE refund_reference = $1',
      [result.body.refundReference],
    );
    assert.equal(settled?.status, 'COMPLETED');
  });
});

describe('Commission paid on a transaction later reversed is recovered', () => {
  /** Take one commission all the way to PAID. */
  async function payCommission(transactionId: string, gatewayReference: string) {
    const amount = await queryOne<{ total_amount_kobo: string }>(
      pool,
      'SELECT total_amount_kobo FROM transactions WHERE id = $1',
      [transactionId],
    );
    await post(
      '/government/settlements',
      {
        settlementDate: new Date().toISOString().slice(0, 10),
        gatewayReferences: [gatewayReference],
        receivedAmountKobo: amount!.total_amount_kobo,
        bankReference: `SETTLE-${transactionId.slice(0, 8)}`,
      },
      { token: approver },
    );
    await pool.query(
      `UPDATE transactions SET settled_at = now() - interval '80 hours' WHERE id = $1`,
      [transactionId],
    );
    await post('/government/commissions/promote', {}, { token: approver });

    const otp = await post(
      '/auth/otp/request',
      { destination: '+2347010000001', purpose: 'STEP_UP' },
      { token: agent.token, deviceId: agent.device },
    );
    await post(
      '/auth/step-up',
      { action: 'commission.payout.request', destination: '+2347010000001', code: otp.body.developmentCode },
      { token: agent.token, deviceId: agent.device },
    );
    const payout = await post('/agents/me/commission/payout', {}, { token: agent.token, deviceId: agent.device });
    assert.equal(payout.status, 201, JSON.stringify(payout.body));
    await post(
      `/government/commissions/payouts/${payout.body.payoutId}/approve`,
      { reason: 'Verified account, settled revenue.' },
      { token: approver },
    );
    await post(
      `/government/commissions/payouts/${payout.body.payoutId}/complete`,
      { bankReference: `BANK-${payout.body.payoutReference}` },
      { token: approver },
    );
  }

  it('refuses a payout while more is owed back than is earned, in naira the agent recognises', async () => {
    const first = await collect('3');
    await payCommission(first.transactionId, first.gatewayReference);
    await reverse(first.transactionId);

    const wallet = await get('/agents/me/commission', { token: agent.token, deviceId: agent.device });
    assert.equal(wallet.body.wallet.owedBackKobo, '4500', 'the overpayment is visible to the agent');

    // Earn less than is owed.
    const second = await collect('4');
    await post(
      '/government/settlements',
      {
        settlementDate: new Date().toISOString().slice(0, 10),
        gatewayReferences: [second.gatewayReference],
        receivedAmountKobo: '300000',
        bankReference: 'SETTLE-SECOND',
      },
      { token: approver },
    );
    await pool.query(`UPDATE transactions SET settled_at = now() - interval '80 hours' WHERE id = $1`, [second.transactionId]);
    await post('/government/commissions/promote', {}, { token: approver });

    const otp = await post('/auth/otp/request', { destination: '+2347010000001', purpose: 'STEP_UP' }, { token: agent.token, deviceId: agent.device });
    await post('/auth/step-up', { action: 'commission.payout.request', destination: '+2347010000001', code: otp.body.developmentCode }, { token: agent.token, deviceId: agent.device });
    const refused = await post('/agents/me/commission/payout', {}, { token: agent.token, deviceId: agent.device });

    assert.equal(refused.status, 409);
    assert.equal(refused.body.error.code, 'CLAWBACK_EXCEEDS_COMMISSION');
    assert.match(refused.body.error.message, /₦45\.00/, 'says what is eligible');
    assert.match(refused.body.error.message, /₦45\.00 is owed back/, 'and what is owed');
  });

  it('deducts the overpayment from a later payout, once and only once', async () => {
    const first = await collect('5');
    await payCommission(first.transactionId, first.gatewayReference);
    await reverse(first.transactionId);

    // Earn more than is owed: two further collections.
    for (const suffix of ['6', '7']) {
      const next = await collect(suffix);
      await post(
        '/government/settlements',
        {
          settlementDate: new Date().toISOString().slice(0, 10),
          gatewayReferences: [next.gatewayReference],
          receivedAmountKobo: '300000',
          bankReference: `SETTLE-${suffix}`,
        },
        { token: approver },
      );
      await pool.query(`UPDATE transactions SET settled_at = now() - interval '80 hours' WHERE id = $1`, [next.transactionId]);
    }
    await post('/government/commissions/promote', {}, { token: approver });

    const otp = await post('/auth/otp/request', { destination: '+2347010000001', purpose: 'STEP_UP' }, { token: agent.token, deviceId: agent.device });
    await post('/auth/step-up', { action: 'commission.payout.request', destination: '+2347010000001', code: otp.body.developmentCode }, { token: agent.token, deviceId: agent.device });
    const payout = await post('/agents/me/commission/payout', {}, { token: agent.token, deviceId: agent.device });

    assert.equal(payout.status, 201, JSON.stringify(payout.body));
    assert.equal(payout.body.grossKobo, '9000', 'two collections were eligible');
    assert.equal(payout.body.clawbackAppliedKobo, '4500', 'and the overpayment came off');
    assert.equal(payout.body.amountKobo, '4500');
    assert.match(payout.body.message, /deducted/i, 'the agent is told why it is smaller');

    const recovered = await query<{ id: string }>(
      pool,
      'SELECT id FROM commissions WHERE recovered_at IS NOT NULL',
    );
    assert.equal(recovered.length, 1, 'exactly the one overpayment');

    const wallet = await get('/agents/me/commission', { token: agent.token, deviceId: agent.device });
    assert.equal(wallet.body.wallet.owedBackKobo, '0', 'and nothing is owed any more');
  });
});

describe('A reversal needs three people', () => {
  it('refuses the requester approving, and the approver executing', async () => {
    const collected = await collect('8');
    const request = await post(
      '/government/approvals',
      {
        approvalType: 'PAYMENT_REVERSAL',
        entityType: 'transaction',
        entityId: collected.transactionId,
        payload: { amountKobo: '300000', reason: 'Charged in error', refundType: 'REVERSAL' },
        reason: 'Duplicate assessment for the same premises this period.',
      },
      { token: requester },
    );

    const selfApprove = await post(
      `/government/approvals/${request.body.approvalId}/decide`,
      { decision: 'APPROVE', reason: 'Approving my own request.' },
      { token: requester },
    );
    assert.equal(selfApprove.status, 403);

    await post(
      `/government/approvals/${request.body.approvalId}/decide`,
      { decision: 'APPROVE', reason: 'Duplicate confirmed against the record.' },
      { token: approver },
    );

    await grantStepUp('+2348000000022', approver);
    const selfExecute = await post(
      `/government/approvals/${request.body.approvalId}/execute-reversal`,
      {},
      { token: approver },
    );
    assert.equal(selfExecute.status, 409);
    assert.equal(selfExecute.body.error.code, 'SEGREGATION_OF_DUTIES');
  });
});

// ---------------------------------------------------------------------------

describe('A reversal says whose doing it was', () => {
  /**
   * `refunds.attributable_to` was added so the compliance score would stop
   * charging a citizen for the State's own double charges, and it defaults to
   * GOVERNMENT for that reason. But nothing on any path ever set it to
   * anything else, so the half of the rule that was still meant to bite — a
   * payment the taxpayer's own bank pulled back — could not bite either. The
   * column had one reachable value, which is not a classification, and the
   * score's reversal component was dead in both directions at once.
   */
  async function scoreFor(taxpayerId: string) {
    const client = await pool.connect();
    try {
      return await computeComplianceScore(client, taxpayerId);
    } finally {
      client.release();
    }
  }

  const reversalPenalty = (breakdown: { components: { factor: string; points: number }[] }) =>
    breakdown.components.find((c) => c.factor.toLowerCase().includes('revers'))?.points ?? 0;

  it('costs the citizen nothing when nobody said, and nothing when the gateway did it', async () => {
    const unclassified = await collect('7');
    assert.equal((await reverse(unclassified.transactionId)).status, 200);
    const unsaid = await queryOne<{ attributable_to: string }>(
      pool,
      'SELECT attributable_to FROM refunds WHERE transaction_id = $1',
      [unclassified.transactionId],
    );
    assert.equal(unsaid?.attributable_to, 'GOVERNMENT', 'silence is not an accusation');

    const gatewayFault = await collect('8');
    const executed = await reverse(gatewayFault.transactionId, { attributableTo: 'GATEWAY' });
    assert.equal(executed.status, 200, JSON.stringify(executed.body));
    const blamed = await queryOne<{ attributable_to: string }>(
      pool,
      'SELECT attributable_to FROM refunds WHERE transaction_id = $1',
      [gatewayFault.transactionId],
    );
    assert.equal(blamed?.attributable_to, 'GATEWAY');

    // Neither costs a point. The citizen did nothing in either case.
    assert.equal(reversalPenalty(await scoreFor(unclassified.taxpayerId)), 0);
    assert.equal(reversalPenalty(await scoreFor(gatewayFault.taxpayerId)), 0);
  });

  it('costs the citizen when the payment was recalled on their side', async () => {
    const recalled = await collect('9');
    const before = await scoreFor(recalled.taxpayerId);
    const executed = await reverse(recalled.transactionId, { attributableTo: 'TAXPAYER' });
    assert.equal(executed.status, 200, JSON.stringify(executed.body));

    const blamed = await queryOne<{ attributable_to: string }>(
      pool,
      'SELECT attributable_to FROM refunds WHERE transaction_id = $1',
      [recalled.transactionId],
    );
    assert.equal(blamed?.attributable_to, 'TAXPAYER');

    const after = await scoreFor(recalled.taxpayerId);
    assert.ok(
      reversalPenalty(after) < 0,
      `a reversal the taxpayer caused should cost points: ${JSON.stringify(after.components)}`,
    );
    assert.ok(after.score < before.score, 'and the score they are judged on should fall');
  });

  it('refuses an attribution it does not recognise rather than guessing', async () => {
    const collected = await collect('10');
    const refused = await reverse(collected.transactionId, { attributableTo: 'THE_WEATHER' });
    assert.equal(refused.status, 409, JSON.stringify(refused.body));
    assert.equal(refused.body.error?.code, 'REVERSAL_ATTRIBUTION_UNKNOWN');

    // And nothing was carried out on the strength of it.
    const refund = await queryOne<{ id: string }>(
      pool,
      'SELECT id FROM refunds WHERE transaction_id = $1',
      [collected.transactionId],
    );
    assert.equal(refund, null, 'no refund is recorded for a reversal that was refused');
  });
});
