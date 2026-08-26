/**
 * Rejecting a commission payout has to do something.
 *
 * `requestPayout` does a great deal before anybody has agreed to pay. It
 * creates the payout, moves every eligible commission to `APPROVED` against
 * it, and — this is the part that matters — marks any commission that was paid
 * and later reversed as `recovered_at`, netting the agent's debt off the
 * amount requested.
 *
 * All of that is correct on the way to being paid. None of it is undone if the
 * payout is refused.
 *
 * `POST /government/approvals/:id/decide` handles `BANK_ACCOUNT_CHANGE` in both
 * directions, deliberately and with a comment explaining that deciding and
 * doing have to be one act. `COMMISSION_PAYOUT` is handled in neither. A
 * rejection therefore marks the approval REJECTED and stops:
 *
 *   * The commissions stay `APPROVED`. `requestPayout` only ever selects
 *     `status = 'ELIGIBLE'`, and the state machine is one-directional
 *     (`ELIGIBLE -> APPROVED -> PAID`), so that money can never be requested
 *     again. The agent is told they have no eligible commission.
 *   * The clawback stays written off. `recovered_at` is set, and the next
 *     payout only considers rows where it is null, so money the agent holds
 *     and does not own stops being recoverable.
 *
 * The two errors run in opposite directions — the agent loses what they
 * earned, the State loses what it was owed — which is what makes this worth
 * failing a test over rather than filing as tidy-up.
 *
 * There is also no reject route of the payout's own. The dedicated approve
 * route never reads the approval it mirrors, so a rejection recorded by one
 * officer could be stepped over by another calling approve.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  grantStepUp,
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

let financeToken = '';
let adminToken = '';
let agentId = '';
let agent: { token: string; device: string };
let agentPhone = '';
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

  await createGovernmentUser({ role: 'admin', phone: '+2348030000150', fullName: 'Payout Admin' });
  await createGovernmentUser({
    role: 'finance_officer',
    phone: '+2348030000151',
    fullName: 'Payout Finance',
  });
  adminToken = (await loginAs('+2348030000150')).accessToken;
  financeToken = (await loginAs('+2348030000151')).accessToken;

  const demo = await seedDemoAgent();
  agentId = demo!.agentId;
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agent = { token: session.accessToken, device: demo!.deviceIdentifier };
  agentPhone = demo!.phone;
  collected = 0;

  // The bank account the payout would be paid into, verified.
  await pool.query(
    `UPDATE bank_accounts SET verification_status = 'VERIFIED'
      WHERE id = (SELECT bank_account_id FROM agents WHERE id = $1)`,
    [agentId],
  );
});

/** One collection, which accrues a commission the ordinary way. */
async function collect(): Promise<string> {
  const suffix = String(++collected);
  const auth = { token: agent.token, deviceId: agent.device };
  const taxpayer = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Payout',
      lastName: `Subject${suffix}`,
      phone: `+23480666${suffix.padStart(5, '0')}`,
      address: '5 Market Road, Jos',
      lgaId: await firstLgaId(),
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...auth, idempotencyKey: `po-tp-${suffix}` },
  );
  const assessment = await post(
    '/revenue/assessments',
    {
      taxpayerId: taxpayer.body.taxpayerId,
      revenueItemId: await revenueItemByCode('SHOPS-KIOSKS'),
      inputs: {},
    },
    { ...auth, idempotencyKey: `po-as-${suffix}` },
  );
  const initiated = await post(
    '/payments/initiate',
    { transactionId: assessment.body.transactionId },
    { ...auth, idempotencyKey: `po-pay-${suffix}` },
  );
  await post(
    '/payments/simulate',
    { gatewayReference: initiated.body.gatewayReference, outcome: 'SUCCESS', deliverWebhook: true },
    auth,
  );
  const commission = await queryOne<{ id: string }>(
    pool,
    'SELECT id FROM commissions WHERE transaction_id = $1',
    [assessment.body.transactionId],
  );
  assert.ok(commission, 'a collection accrues a commission');
  return commission!.id;
}

/**
 * A collection whose commission is forced to ELIGIBLE.
 *
 * Setup, not the behaviour under test: reaching ELIGIBLE legitimately needs a
 * settled transaction and an elapsed hold, and this is about what a refusal
 * does to money rather than about how money becomes payable.
 */
async function eligibleCommission(): Promise<string> {
  const id = await collect();
  await pool.query(`UPDATE commissions SET status = 'ELIGIBLE', eligible_at = now() WHERE id = $1`, [id]);
  return id;
}

async function requestPayout(): Promise<{ payoutId: string; approvalId: string }> {
  await grantStepUp(agent.token, agentPhone, 'commission.payout.request');
  const response = await post(
    '/agents/me/commission/payout',
    {},
    { token: agent.token, deviceId: agent.device, idempotencyKey: `po-req-${Date.now()}` },
  );
  assert.equal(response.status, 201, JSON.stringify(response.body));
  const row = await queryOne<{ id: string; approval_id: string }>(
    pool,
    'SELECT id, approval_id FROM commission_payouts ORDER BY requested_at DESC LIMIT 1',
    [],
  );
  return { payoutId: row!.id, approvalId: row!.approval_id };
}

const statusOfCommission = async (id: string) =>
  (await queryOne<{ status: string }>(pool, 'SELECT status FROM commissions WHERE id = $1', [id]))!
    .status;

const statusOfPayout = async (id: string) =>
  (await queryOne<{ status: string }>(pool, 'SELECT status FROM commission_payouts WHERE id = $1', [id]))!
    .status;

describe('a refused payout gives the money back to where it came from', () => {
  it('returns the commission to eligible, so the agent can be paid later', async () => {
    const commissionId = await eligibleCommission();
    const { payoutId, approvalId } = await requestPayout();
    assert.equal(await statusOfCommission(commissionId), 'APPROVED');

    const decided = await post(
      `/government/approvals/${approvalId}/decide`,
      { decision: 'REJECT', reason: 'The bank details need confirming before this is paid.' },
      { token: financeToken },
    );
    assert.equal(decided.status, 200, JSON.stringify(decided.body));

    assert.equal(
      await statusOfCommission(commissionId),
      'ELIGIBLE',
      'a refused payout left the commission APPROVED, where nothing can ever pick it up again',
    );
    assert.equal(await statusOfPayout(payoutId), 'REJECTED');
  });

  it('lets the agent request it again once the reason is dealt with', async () => {
    const commissionId = await eligibleCommission();
    const { approvalId } = await requestPayout();

    await post(
      `/government/approvals/${approvalId}/decide`,
      { decision: 'REJECT', reason: 'The bank details need confirming before this is paid.' },
      { token: financeToken },
    );

    await grantStepUp(agent.token, agentPhone, 'commission.payout.request');
    const again = await post(
      '/agents/me/commission/payout',
      {},
      { token: agent.token, deviceId: agent.device, idempotencyKey: 'po-req-again' },
    );
    assert.equal(again.status, 201, JSON.stringify(again.body));
    assert.equal(await statusOfCommission(commissionId), 'APPROVED', 'it is in the new payout');
  });

  it('puts a written-off clawback back on the books', async () => {
    // Commission that was paid and then reversed: money the agent holds and
    // does not own. requestPayout nets it off and marks it recovered.
    const owed = await collect();
    await pool.query(
      `UPDATE commissions SET status = 'REVERSED', paid_at = now(), reversed_at = now()
        WHERE id = $1`,
      [owed],
    );
    // Two eligible commissions, so gross exceeds the single reversed one and
    // something remains payable. The amount cannot simply be raised: a trigger
    // holds commissions.amount_kobo immutable once written.
    await eligibleCommission();
    await eligibleCommission();

    const { approvalId } = await requestPayout();
    const marked = await queryOne<{ recovered_at: Date | null }>(
      pool,
      'SELECT recovered_at FROM commissions WHERE id = $1',
      [owed],
    );
    assert.ok(marked!.recovered_at, 'the debt was netted off against the requested payout');

    await post(
      `/government/approvals/${approvalId}/decide`,
      { decision: 'REJECT', reason: 'The bank details need confirming before this is paid.' },
      { token: financeToken },
    );

    const after = await queryOne<{ recovered_at: Date | null }>(
      pool,
      'SELECT recovered_at FROM commissions WHERE id = $1',
      [owed],
    );
    assert.equal(
      after!.recovered_at,
      null,
      'the payout was refused, so nothing was recovered — but the debt stayed written off',
    );
  });

  it('will not let approve step over a rejection somebody already recorded', async () => {
    const { payoutId, approvalId } = await eligibleCommission().then(() => requestPayout());

    await post(
      `/government/approvals/${approvalId}/decide`,
      { decision: 'REJECT', reason: 'The bank details need confirming before this is paid.' },
      { token: financeToken },
    );

    // A second officer calling the payout's own approve route, which never
    // reads the approval it mirrors.
    const approved = await post(
      `/government/commissions/payouts/${payoutId}/approve`,
      { reason: 'Approving anyway.' },
      { token: adminToken },
    );

    assert.notEqual(
      approved.status,
      200,
      'a payout another officer refused was approved through a route that never looked',
    );
    assert.equal(await statusOfPayout(payoutId), 'REJECTED');
  });
});

/**
 * And a transfer the bank refused.
 *
 * A refusal by an officer and a refusal by the bank leave the agent in the
 * same place — unpaid, with commission that has to become payable again — but
 * only the first had anywhere to be recorded. `commission_payouts.status`
 * allows FAILED, and nothing wrote it; `completePayout` took a bank reference
 * and marked the payout PAID. So an approved payout the bank would not make —
 * a closed account, a name mismatch, a rejected batch — had two homes: left
 * APPROVED for good, where `requestPayout` selects only ELIGIBLE and can never
 * pick those commissions up again, or marked PAID, which says a transfer
 * happened when it did not.
 *
 * The second is the one somebody under pressure picks, and it is the one this
 * platform exists to make impossible.
 */
describe('a payout the bank would not make', () => {
  it('says so, and makes the commission payable again', async () => {
    const commissionId = await eligibleCommission();
    const { payoutId } = await requestPayout();
    assert.equal(await statusOfCommission(commissionId), 'APPROVED');

    const approved = await post(
      `/government/commissions/payouts/${payoutId}/approve`,
      { reason: 'Checked against the settlement file.' },
      { token: financeToken },
    );
    assert.equal(approved.status, 200, JSON.stringify(approved.body));

    const failed = await post(
      `/government/commissions/payouts/${payoutId}/fail`,
      { reason: 'Bank returned the transfer: account name does not match the mandate.' },
      { token: financeToken },
    );
    assert.equal(failed.status, 200, JSON.stringify(failed.body));
    assert.equal(failed.body.returnedToEligible, 1);

    assert.equal(await statusOfPayout(payoutId), 'FAILED');
    assert.equal(
      await statusOfCommission(commissionId),
      'ELIGIBLE',
      'left APPROVED, this money could never be requested again',
    );

    const row = await queryOne<{ failure_reason: string | null; payout_id: string | null }>(
      pool,
      `SELECT p.failure_reason, c.payout_id
         FROM commission_payouts p JOIN commissions c ON c.id = $2
        WHERE p.id = $1`,
      [payoutId, commissionId],
    );
    assert.match(row!.failure_reason ?? '', /does not match the mandate/);
    assert.equal(row!.payout_id, null, 'and it no longer belongs to a payout that never happened');
  });

  it('puts back a clawback the payout had netted off', async () => {
    const reversed = await collect();
    await pool.query(
      `UPDATE commissions SET status = 'REVERSED', paid_at = now() - interval '30 days',
              reversed_at = now() WHERE id = $1`,
      [reversed],
    );
    // Two collections against one debt: `amount_kobo` is immutable, so netting
    // an equal debt off a single commission leaves nothing payable and the
    // request is refused before there is a payout to fail.
    const commissionId = await eligibleCommission();
    await eligibleCommission();
    const { payoutId } = await requestPayout();

    const recovered = await queryOne<{ recovered_at: Date | null }>(
      pool,
      'SELECT recovered_at FROM commissions WHERE id = $1',
      [reversed],
    );
    assert.notEqual(recovered!.recovered_at, null, 'the debt was netted off on the way out');

    await post(
      `/government/commissions/payouts/${payoutId}/approve`,
      { reason: 'Checked against the settlement file.' },
      { token: financeToken },
    );
    await post(
      `/government/commissions/payouts/${payoutId}/fail`,
      { reason: 'Bank returned the transfer: the account is closed.' },
      { token: financeToken },
    );

    const after = await queryOne<{ recovered_at: Date | null }>(
      pool,
      'SELECT recovered_at FROM commissions WHERE id = $1',
      [reversed],
    );
    assert.equal(
      after!.recovered_at,
      null,
      'money the agent holds and does not own stopped being recoverable',
    );
    assert.equal(await statusOfCommission(commissionId), 'ELIGIBLE');
  });

  it('is not a way to undo a payout that was actually paid', async () => {
    const commissionId = await eligibleCommission();
    const { payoutId } = await requestPayout();
    await post(
      `/government/commissions/payouts/${payoutId}/approve`,
      { reason: 'Checked against the settlement file.' },
      { token: financeToken },
    );
    await post(
      `/government/commissions/payouts/${payoutId}/complete`,
      { bankReference: 'BNK-PAID-0001' },
      { token: financeToken },
    );

    const response = await post(
      `/government/commissions/payouts/${payoutId}/fail`,
      { reason: 'Trying to unwind a transfer that already left the account.' },
      { token: financeToken },
    );
    assert.equal(response.status, 409, JSON.stringify(response.body));
    assert.equal(await statusOfPayout(payoutId), 'PAID');
    assert.equal(await statusOfCommission(commissionId), 'PAID');
  });

  it('cannot be recorded against a payout nobody approved', async () => {
    await eligibleCommission();
    const { payoutId } = await requestPayout();
    const response = await post(
      `/government/commissions/payouts/${payoutId}/fail`,
      { reason: 'No transfer has been attempted on this one.' },
      { token: financeToken },
    );
    assert.equal(response.status, 409, JSON.stringify(response.body));
    assert.equal(await statusOfPayout(payoutId), 'REQUESTED');
  });
});
