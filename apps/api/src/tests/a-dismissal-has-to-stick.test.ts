/**
 * What happens after an officer says "I looked, and it is fine".
 *
 * A fraud flag is a request for a human decision — PRD §32 is explicit that a
 * suspicious transaction is flagged rather than acted on automatically. The
 * one place a flag does bite without a human is money: a HIGH or CRITICAL
 * flag against an agent freezes their commission until it is resolved.
 *
 * `raiseFlag` declined to duplicate a flag that was still OPEN or
 * UNDER_REVIEW, and stopped there. A flag that had been *decided* did not
 * count. So an officer who investigated a signal, found the explanation, and
 * dismissed it — releasing the agent's commission — was overruled by the next
 * sweep, which runs every fifteen minutes and reads the same window over the
 * same unchanged evidence and raises the same flag again. The agent's money
 * froze again; a fresh flag appeared in the queue looking like a new
 * detection; and the officer's only way to make the decision stick was to
 * dismiss it again, and again, for as long as the window held.
 *
 * The evidence a rule reads has a window. A decision covers the window it was
 * made about: while the same evidence is still what the rule is looking at,
 * the answer is the one the officer already gave. When the window has rolled
 * past, what the rule sees is genuinely new and worth asking about again.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  loginAs,
  pool,
  post,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './helpers';
import { queryOne, withTransaction } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';
import { evaluateTransactionRisk } from '../services/fraud';
import { recoverUnverifiedPayments } from '../services/reconciliation';

const OFFICER = '+2348030000400';
const SECOND_OFFICER = '+2348030000402';

let officerToken = '';
let secondOfficerToken = '';
let agent = { id: '', token: '', device: '', deviceUuid: '', userId: '' };
let invoice = {
  invoiceId: '',
  assessmentId: '',
  transactionId: '',
  revenueItemId: '',
  lgaId: '',
  taxpayerId: '',
};
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

  await createGovernmentUser({ role: 'admin', phone: '+2348030000401', fullName: 'Records Admin' });
  await createGovernmentUser({ role: 'revenue_officer', phone: OFFICER, fullName: 'Fraud Officer' });
  officerToken = (await loginAs(OFFICER)).accessToken;
  await createGovernmentUser({
    role: 'revenue_officer',
    phone: SECOND_OFFICER,
    fullName: 'Second Fraud Officer',
  });
  secondOfficerToken = (await loginAs(SECOND_OFFICER)).accessToken;

  const demo = await seedDemoAgent();
  assert.ok(demo);
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  const device = await queryOne<{ id: string }>(
    pool,
    `SELECT id FROM agent_devices WHERE agent_id = $1 AND device_identifier = $2 LIMIT 1`,
    [demo!.agentId, demo!.deviceIdentifier],
  );
  const user = await queryOne<{ user_id: string }>(pool, 'SELECT user_id FROM agents WHERE id = $1', [
    demo!.agentId,
  ]);
  agent = {
    id: demo!.agentId,
    token: session.accessToken,
    device: demo!.deviceIdentifier,
    deviceUuid: device!.id,
    userId: user!.user_id,
  };

  const lga = await queryOne<{ id: string }>(pool, 'SELECT id FROM lgas ORDER BY name LIMIT 1');
  const item = await queryOne<{ id: string }>(
    pool,
    `SELECT id FROM revenue_items WHERE code = 'DEV-LEVY' AND status = 'ACTIVE' LIMIT 1`,
  );

  const registered = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Yakubu',
      lastName: 'Dung',
      phone: '+2348037000711',
      address: '3 Rukuba Road, Jos',
      lgaId: lga!.id,
      consentGiven: true,
      declarationAccepted: true,
    },
    { token: agent.token, deviceId: agent.device, idempotencyKey: 'fraud-flag-taxpayer' },
  );
  assert.equal(registered.status, 201, JSON.stringify(registered.body));

  const assessed = await post(
    '/revenue/assessments',
    { taxpayerId: registered.body.taxpayerId, revenueItemId: item!.id, inputs: {} },
    { token: agent.token, deviceId: agent.device, idempotencyKey: 'fraud-flag-assessment' },
  );
  assert.equal(assessed.status, 201, JSON.stringify(assessed.body));

  invoice = {
    invoiceId: assessed.body.invoiceId,
    assessmentId: assessed.body.assessmentId,
    transactionId: assessed.body.transactionId,
    revenueItemId: item!.id,
    lgaId: lga!.id,
    taxpayerId: registered.body.taxpayerId,
  };
  sequence = 0;
});

/** Put one more collection through the handset, and read the risk of it. */
async function collectOnce(): Promise<void> {
  sequence += 1;
  await pool.query(
    `INSERT INTO transactions
       (transaction_reference, taxpayer_id, invoice_id, assessment_id, revenue_item_id,
        agent_id, device_id, lga_id, amount_kobo, total_amount_kobo, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, 200000, 200000, 'PAYMENT_VERIFIED', $9)`,
    [
      `TXN-VELOCITY-${sequence}`,
      invoice.taxpayerId,
      invoice.invoiceId,
      invoice.assessmentId,
      invoice.revenueItemId,
      agent.id,
      agent.deviceUuid,
      invoice.lgaId,
      agent.userId,
    ],
  );
  const latest = await queryOne<{ id: string }>(
    pool,
    'SELECT id FROM transactions WHERE agent_id = $1 ORDER BY created_at DESC LIMIT 1',
    [agent.id],
  );
  await withTransaction((client) => evaluateTransactionRisk(client, { transactionId: latest!.id }));
}

/** Forty-one collections on one handset inside the hour: over the threshold. */
async function busyHour(): Promise<void> {
  for (let index = 0; index < 41; index += 1) await collectOnce();
}

const velocityFlags = async (status?: string) => {
  const row = await queryOne<{ n: string }>(
    pool,
    `SELECT count(*)::text AS n FROM fraud_flags
      WHERE rule = 'DEVICE_VELOCITY' AND entity_type = 'DEVICE' AND entity_id = $1
        AND ($2::text IS NULL OR status = $2)`,
    [agent.deviceUuid, status ?? null],
  );
  return Number(row!.n);
};

const openFlagId = async () => {
  const row = await queryOne<{ id: string }>(
    pool,
    `SELECT id FROM fraud_flags WHERE rule = 'DEVICE_VELOCITY' AND entity_id = $1
      ORDER BY created_at DESC LIMIT 1`,
    [agent.deviceUuid],
  );
  return row!.id;
};

const review = (id: string, decision: string, note: string, token = officerToken) =>
  post(`/government/fraud/flags/${id}/review`, { decision, note }, { token });

const flagStatus = async (id: string) => {
  const row = await queryOne<{ status: string }>(pool, 'SELECT status FROM fraud_flags WHERE id = $1', [
    id,
  ]);
  return row!.status;
};

describe('a decision on a fraud flag', () => {
  it('is not undone by the next reading of the same evidence', async () => {
    await busyHour();
    assert.equal(await velocityFlags('OPEN'), 1, 'the handset is over the threshold');

    const decided = await review(
      await openFlagId(),
      'DISMISSED',
      'Market day at Bukuru. Volume checked against the settlement file and it stands up.',
    );
    assert.equal(decided.status, 200, JSON.stringify(decided.body));

    // The next collection, minutes later. The window has not moved; nothing
    // about the evidence has changed; the officer has already answered.
    await collectOnce();

    assert.equal(
      await velocityFlags('OPEN'),
      0,
      "the officer's decision was overruled by the next sweep, and the agent's commission froze again",
    );
    assert.equal(await velocityFlags(), 1, 'and no second flag was filed');
  });

  it('does not silence the signal for good', async () => {
    await busyHour();
    await review(await openFlagId(), 'DISMISSED', 'Checked against the settlement file; it stands up.');

    // An hour later. The rule reads the last hour, so what it is looking at
    // now is evidence the officer never saw.
    await pool.query(
      `UPDATE fraud_flags SET reviewed_at = now() - interval '3 hours' WHERE entity_id = $1`,
      [agent.deviceUuid],
    );
    await busyHour();

    assert.equal(
      await velocityFlags('OPEN'),
      1,
      'a decision covers the window it was made about, not every window after it',
    );
  });

  it('does not file a second flag while the first is upheld', async () => {
    await busyHour();
    await review(await openFlagId(), 'CONFIRMED', 'Handset is being run by somebody it was not issued to.');

    await collectOnce();

    assert.equal(await velocityFlags('OPEN'), 0);
    assert.equal(await velocityFlags('CONFIRMED'), 1);
    assert.equal(await velocityFlags(), 1, 'one investigation, one flag');
  });
});

/**
 * Undoing an upheld investigation.
 *
 * Confirming a flag freezes the agent's commission; dismissing it hands the
 * money back. Both decisions sat behind one permission and one officer, so the
 * same person could uphold an investigation and then, at any later moment,
 * quietly release everything it was holding — with nothing in the way but
 * their own note.
 *
 * Every comparable release in this platform already asks for a second person:
 * an officer cannot change their own role, cannot approve the bank account
 * change they requested, cannot authorise their own payout. An investigation
 * that was carried out and upheld is the strongest signal the platform holds
 * about an agent, and reversing it is the one decision here that moves money
 * back towards the person under suspicion.
 *
 * Raising, reviewing and confirming are unchanged — one officer does all of
 * that. Only the reversal of a confirmation needs somebody else, and the
 * officer who confirmed can still reopen it for review, so the route to a
 * second opinion is never closed.
 */
describe('reversing a confirmed fraud flag', () => {
  it('is refused to the officer who confirmed it', async () => {
    await busyHour();
    const flagId = await openFlagId();
    await review(flagId, 'CONFIRMED', 'Handset is being run by somebody it was not issued to.');

    const response = await review(
      flagId,
      'DISMISSED',
      'On reflection the volume looks like an ordinary market day after all.',
    );

    assert.equal(response.status, 403, JSON.stringify(response.body));
    assert.match(response.body.error.message, /another officer|second officer/i);
    assert.equal(await flagStatus(flagId), 'CONFIRMED', 'and the flag still stands');
  });

  it('is allowed to a different officer', async () => {
    await busyHour();
    const flagId = await openFlagId();
    await review(flagId, 'CONFIRMED', 'Handset is being run by somebody it was not issued to.');

    const response = await review(
      flagId,
      'DISMISSED',
      'Reviewed the settlement file with the supervisor; the volume is genuine.',
      secondOfficerToken,
    );

    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(await flagStatus(flagId), 'DISMISSED');
  });

  it('does not stop the same officer reopening it for review', async () => {
    await busyHour();
    const flagId = await openFlagId();
    await review(flagId, 'CONFIRMED', 'Handset is being run by somebody it was not issued to.');

    const response = await review(flagId, 'UNDER_REVIEW', 'Reopening: the agent has produced the till roll.');
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(await flagStatus(flagId), 'UNDER_REVIEW');
  });

  it('lets the officer investigating it close it themselves', async () => {
    // Taking a flag for review records the officer against it too. Nothing has
    // been upheld, so nothing needs a second pair of eyes — refusing here
    // would mean an officer could never finish their own investigation.
    await busyHour();
    const flagId = await openFlagId();
    await review(flagId, 'UNDER_REVIEW', 'Asked the agent for the till roll for that hour.');

    const response = await review(flagId, 'DISMISSED', 'Till roll matches the settlement file.');
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(await flagStatus(flagId), 'DISMISSED');
  });

  it('does not stand in the way of dismissing a flag nobody upheld', async () => {
    await busyHour();
    const flagId = await openFlagId();

    const response = await review(flagId, 'DISMISSED', 'Market day at Bukuru; the volume stands up.');
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(await flagStatus(flagId), 'DISMISSED');
  });
});

/**
 * The most serious flag the platform can raise, and where it went.
 *
 * A gateway reporting success for an amount that is not the invoiced amount is
 * "either a gateway fault or an attack" — the code says so — and the response
 * is threefold: hold the transaction UNDER_REVIEW, raise a CRITICAL
 * AMOUNT_MISMATCH flag against it, and write the discrepancy to the audit
 * trail. All three are database writes, and all three were made inside the
 * transaction that then threw the refusal at the agent. The rollback took
 * every one of them.
 *
 * What survived was the parts that are not database writes: the metric, and
 * the alert to the on-call address. What did not survive was the record. The
 * agent was told "the transaction has been placed under review", which was not
 * true; the flag queue an officer works from stayed empty; and the audit trail
 * — the thing that is supposed to make a discrepancy findable a year later —
 * had nothing in it. The one anomaly the platform treats as urgent left less
 * evidence behind than an ordinary failed payment.
 *
 * A refusal still has to be recorded. What the caller is told is decided after
 * the transaction has committed, so that saying no cannot undo the writing
 * down of it.
 */
describe('a gateway confirming the wrong amount', () => {
  const mismatchedConfirm = async () => {
    const initiated = await post(
      '/payments/initiate',
      { transactionId: invoice.transactionId, paymentMethod: 'POS' },
      { token: agent.token, deviceId: agent.device, idempotencyKey: 'mismatch-initiate' },
    );
    assert.equal(initiated.status, 201, JSON.stringify(initiated.body));

    await post(
      '/payments/simulate',
      { gatewayReference: initiated.body.gatewayReference, outcome: 'SUCCESS', deliverWebhook: false },
      { token: agent.token, deviceId: agent.device },
    );

    // The gateway now reports ₦1,000 more than the invoice says.
    await pool.query(
      'UPDATE mock_gateway_transactions SET amount_kobo = amount_kobo + 100000 WHERE gateway_reference = $1',
      [initiated.body.gatewayReference],
    );

    const paymentId = initiated.body.paymentId as string;
    const response = await post(
      `/payments/${paymentId}/confirm`,
      {},
      { token: agent.token, deviceId: agent.device },
    );
    return { paymentId, response };
  };

  const confirmAgain = (paymentId: string) =>
    post(`/payments/${paymentId}/confirm`, {}, { token: agent.token, deviceId: agent.device });

  it('is refused, and leaves the evidence of why', async () => {
    const { response: confirmed } = await mismatchedConfirm();
    assert.equal(confirmed.status, 409, JSON.stringify(confirmed.body));
    assert.equal(confirmed.body.error.code, 'PAYMENT_AMOUNT_MISMATCH');

    const flag = await queryOne<{ severity: string; detail: Record<string, unknown> }>(
      pool,
      `SELECT severity, detail FROM fraud_flags
        WHERE rule = 'AMOUNT_MISMATCH' AND transaction_id = $1`,
      [invoice.transactionId],
    );
    assert.ok(flag, 'the CRITICAL flag an officer works from was never written');
    assert.equal(flag!.severity, 'CRITICAL');
    assert.ok(flag!.detail.gatewayKobo, 'and it has to say what the gateway claimed');

    const transaction = await queryOne<{ status: string }>(
      pool,
      'SELECT status FROM transactions WHERE id = $1',
      [invoice.transactionId],
    );
    assert.equal(
      transaction!.status,
      'UNDER_REVIEW',
      'the agent was told it had been placed under review',
    );

    const entry = await queryOne<{ result: string }>(
      pool,
      `SELECT result FROM audit_logs WHERE action = 'payment.amount_mismatch' ORDER BY created_at DESC LIMIT 1`,
    );
    assert.ok(entry, 'and a discrepancy has to be findable a year later');
  });

  it('files one flag however many times Confirm is pressed', async () => {
    const { paymentId, response } = await mismatchedConfirm();
    assert.equal(response.status, 409, JSON.stringify(response.body));

    // The refusal says "do not collect payment again"; it does not stop
    // anybody pressing Confirm again, and support will.
    const second = await confirmAgain(paymentId);
    assert.equal(second.status, 409, JSON.stringify(second.body));
    assert.equal(
      second.body.error.code,
      'PAYMENT_AMOUNT_MISMATCH',
      'the second press has to get the same answer as the first, not a sentence about state machines',
    );

    const flags = await queryOne<{ n: string }>(
      pool,
      `SELECT count(*)::text AS n FROM fraud_flags
        WHERE rule = 'AMOUNT_MISMATCH' AND transaction_id = $1`,
      [invoice.transactionId],
    );
    assert.equal(Number(flags!.n), 1, 'one discrepancy, one flag');
  });

  it('issues no receipt for money the state did not receive', async () => {
    await mismatchedConfirm();
    const receipts = await queryOne<{ n: string }>(
      pool,
      'SELECT count(*)::text AS n FROM receipts WHERE transaction_id = $1',
      [invoice.transactionId],
    );
    assert.equal(Number(receipts!.n), 0);
  });

  /*
   * And the review ends when the gateway answers again.
   *
   * Nothing led out of UNDER_REVIEW. Measured: the gateway corrected its
   * figure and Confirm was refused with "Transaction cannot move from
   * UNDER_REVIEW to PAYMENT_SUCCESSFUL"; the gateway sent the money back and
   * its webhook was acknowledged with "cannot move from UNDER_REVIEW to
   * FAILED". The bill could then never be paid, issued again or withdrawn.
   */
  const state = () =>
    queryOne<{ transaction: string; invoice: string }>(
      pool,
      `SELECT t.status AS transaction, i.status AS invoice
         FROM transactions t JOIN invoices i ON i.id = t.invoice_id WHERE t.id = $1`,
      [invoice.transactionId],
    );
  const gatewayReferenceOf = async (paymentId: string) =>
    (await queryOne<{ gateway_reference: string }>(
      pool,
      'SELECT gateway_reference FROM payments WHERE id = $1',
      [paymentId],
    ))!.gateway_reference;

  it('completes once the gateway reports the amount the bill asked for', async () => {
    const { paymentId } = await mismatchedConfirm();
    await pool.query(
      'UPDATE mock_gateway_transactions SET amount_kobo = amount_kobo - 100000 WHERE gateway_reference = $1',
      [await gatewayReferenceOf(paymentId)],
    );

    const confirmed = await confirmAgain(paymentId);
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
    assert.equal(confirmed.body.status, 'VERIFIED');
    assert.deepEqual(await state(), { transaction: 'RECONCILIATION_PENDING', invoice: 'PAID' });
  });

  it('stays under review while the gateway still names the wrong amount', async () => {
    const { paymentId } = await mismatchedConfirm();
    const again = await confirmAgain(paymentId);
    assert.equal(again.body.error.code, 'PAYMENT_AMOUNT_MISMATCH');
    assert.deepEqual(await state(), { transaction: 'UNDER_REVIEW', invoice: 'UNPAID' });
  });

  it('ends the attempt when the gateway sends the money back, so the bill can be paid', async () => {
    const { paymentId } = await mismatchedConfirm();
    const returned = await post(
      '/payments/simulate',
      { gatewayReference: await gatewayReferenceOf(paymentId), outcome: 'REVERSED', deliverWebhook: true },
      { token: agent.token, deviceId: agent.device },
    );
    assert.equal(returned.status, 200, JSON.stringify(returned.body));
    assert.deepEqual(await state(), { transaction: 'FAILED', invoice: 'UNPAID' });

    const next = await post(
      '/payments/initiate',
      { transactionId: invoice.transactionId, paymentMethod: 'POS' },
      { token: agent.token, deviceId: agent.device, idempotencyKey: 'mismatch-next-attempt' },
    );
    assert.equal(next.status, 201, JSON.stringify(next.body));
    assert.notEqual(next.body.paymentId, paymentId, 'a second attempt, not the held one handed back');
  });

  it('is picked up by the recovery job without anybody pressing Confirm', async () => {
    const { paymentId } = await mismatchedConfirm();
    await pool.query(
      'UPDATE mock_gateway_transactions SET amount_kobo = amount_kobo - 100000 WHERE gateway_reference = $1',
      [await gatewayReferenceOf(paymentId)],
    );
    const recovered = await recoverUnverifiedPayments({
      from: new Date(Date.now() - 3600_000),
      to: new Date(Date.now() + 60_000),
    });
    assert.equal(recovered.verified, 1, JSON.stringify(recovered));
    assert.deepEqual(await state(), { transaction: 'RECONCILIATION_PENDING', invoice: 'PAID' });
  });
});
