/**
 * The money path when it does not go straight through.
 *
 * Every payment in the suite was a card payment that succeeded. So the other
 * ways a Nigerian taxpayer actually pays — a bank transfer, a USSD string on a
 * feature phone, a transfer from an account — had never been recorded once,
 * and neither had the outcomes that are the whole reason reconciliation
 * exists: a payment the taxpayer walked away from, a gateway delivery about a
 * reference the platform has never heard of, a payment the platform believes
 * in that the gateway has since reversed.
 *
 * The one that was a defect rather than a gap is the last test here. A
 * reconciliation run writes its own row inside the same transaction as the
 * matching, which is right — a half-matched period must not be left looking
 * reconciled — but it meant a run that threw part way rolled its own row back
 * with everything else. A crashed run left no trace at all, and an officer
 * looking at the period saw no run, which reads exactly like nobody having
 * started one. ABORTED exists so that "reconciliation has been blind since
 * Tuesday" is visible; a crash was the same blindness with no record.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  apiBaseUrl,
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
import { signWebhookPayload } from '../lib/crypto';

let agent: { token: string; device: string };
let financeOfficer = '';
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
  await createGovernmentUser({ fullName: 'Money Admin', phone: '+2348035000001', role: 'admin' });
  await createGovernmentUser({
    fullName: 'Money Finance',
    phone: '+2348035000002',
    role: 'finance_officer',
  });
  financeOfficer = (await loginAs('+2348035000002')).accessToken;

  const demo = await seedDemoAgent();
  assert.ok(demo);
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agent = { token: session.accessToken, device: demo!.deviceIdentifier };
  sequence = 0;
});

const asAgent = () => ({ token: agent.token, deviceId: agent.device });

/** An assessment taken as far as an initiated payment, and no further. */
async function initiate(paymentMethod?: string) {
  sequence += 1;
  const suffix = String(sequence);
  const taxpayer = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Method',
      lastName: `Payer${suffix}`,
      phone: `+23481050000${suffix.padStart(2, '0')}`,
      address: '6 Bauchi Road, Jos',
      lgaId: await firstLgaId(),
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...asAgent(), idempotencyKey: `mp-tp-${suffix}` },
  );
  assert.equal(taxpayer.status, 201, JSON.stringify(taxpayer.body));

  const assessment = await post(
    '/revenue/assessments',
    {
      taxpayerId: taxpayer.body.taxpayerId,
      revenueItemId: await revenueItemByCode('SHOPS-KIOSKS'),
      inputs: {},
    },
    { ...asAgent(), idempotencyKey: `mp-as-${suffix}` },
  );
  assert.equal(assessment.status, 201, JSON.stringify(assessment.body));

  const payment = await post(
    '/payments/initiate',
    {
      transactionId: assessment.body.transactionId,
      ...(paymentMethod ? { paymentMethod } : {}),
    },
    { ...asAgent(), idempotencyKey: `mp-pay-${suffix}` },
  );
  assert.equal(payment.status, 201, JSON.stringify(payment.body));
  return {
    transactionId: assessment.body.transactionId as string,
    paymentId: payment.body.paymentId as string,
    gatewayReference: payment.body.gatewayReference as string,
  };
}

const simulate = (gatewayReference: string, outcome: string) =>
  post('/payments/simulate', { gatewayReference, outcome, deliverWebhook: true }, asAgent());

/** A reconciliation window wide enough to hold everything this file creates. */
const runReconciliation = () =>
  post(
    '/government/reconciliation/run',
    {
      from: new Date(Date.now() - 86_400_000).toISOString(),
      to: new Date(Date.now() + 86_400_000).toISOString(),
    },
    { token: financeOfficer },
  );

describe('The ways a taxpayer actually pays', () => {
  /**
   * Four of the five methods the endpoint accepts had never been stored. The
   * column is not decoration: it is what a finance officer filters a day's
   * collection by when the bank statement and the gateway statement disagree,
   * and what tells an agent whether to expect an instant confirmation or a
   * transfer that lands tomorrow.
   */
  for (const method of ['BANK_TRANSFER', 'USSD', 'ACCOUNT_TRANSFER'] as const) {
    it(`records a ${method.replace('_', ' ').toLowerCase()} as what it was`, async () => {
      const initiated = await initiate(method);
      const stored = await queryOne<{ payment_method: string; status: string }>(
        pool,
        'SELECT payment_method, status FROM payments WHERE id = $1',
        [initiated.paymentId],
      );
      assert.equal(stored?.payment_method, method);

      // And it survives verification rather than being overwritten by whatever
      // the gateway happens to report.
      const done = await simulate(initiated.gatewayReference, 'SUCCESS');
      assert.equal(done.status, 200, JSON.stringify(done.body));
      const after = await queryOne<{ payment_method: string; status: string }>(
        pool,
        'SELECT payment_method, status FROM payments WHERE id = $1',
        [initiated.paymentId],
      );
      assert.equal(after?.status, 'VERIFIED');
      assert.equal(after?.payment_method, method);
    });
  }

  it('refuses a method the platform does not take', async () => {
    sequence += 1;
    const refused = await post(
      '/payments/initiate',
      { transactionId: '00000000-0000-4000-8000-000000000000', paymentMethod: 'CHEQUE' },
      { ...asAgent(), idempotencyKey: `mp-bad-${sequence}` },
    );
    assert.equal(refused.status, 422, JSON.stringify(refused.body));
  });
});

describe('A payment the taxpayer walked away from', () => {
  it('is abandoned rather than failed, and issues nothing', async () => {
    const initiated = await initiate('USSD');
    const abandoned = await simulate(initiated.gatewayReference, 'ABANDONED');
    assert.equal(abandoned.status, 200, JSON.stringify(abandoned.body));

    const payment = await queryOne<{ status: string; failure_reason: string | null }>(
      pool,
      'SELECT status, failure_reason FROM payments WHERE id = $1',
      [initiated.paymentId],
    );
    assert.equal(payment?.status, 'ABANDONED', 'walking away is not the same as being refused');

    assert.match(payment!.failure_reason!, /did not succeed/i);

    // The transaction has no ABANDONED of its own — its state machine records
    // only that the collection did not complete — so the distinction between
    // "the gateway refused it" and "the taxpayer closed the page" lives on the
    // payment, which is where a finance officer looks for it.
    const transaction = await queryOne<{ status: string }>(
      pool,
      'SELECT status FROM transactions WHERE id = $1',
      [initiated.transactionId],
    );
    assert.equal(transaction?.status, 'FAILED');

    // §95: nothing that says the money arrived.
    const receipt = await queryOne<{ id: string }>(
      pool,
      'SELECT id FROM receipts WHERE transaction_id = $1',
      [initiated.transactionId],
    );
    assert.equal(receipt, null);
  });
});

describe('A delivery about a reference the platform has never heard of', () => {
  it('is kept for reconciliation rather than dropped on the floor', async () => {
    const payload = {
      id: 'evt_unknown_reference_1',
      event: 'charge.success',
      data: { reference: 'MOCK-NOT-OURS-0001', amount: '450000', channel: 'CARD' },
    };
    const raw = Buffer.from(JSON.stringify(payload));
    const response = await fetch(`${apiBaseUrl()}/webhooks/payments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-psirs-signature': signWebhookPayload(raw) },
      body: raw,
    });
    assert.equal(response.status, 200, 'an authenticated delivery is acknowledged');

    const event = await queryOne<{ processing_status: string; processing_note: string }>(
      pool,
      'SELECT processing_status, processing_note FROM payment_webhook_events WHERE event_id = $1',
      [payload.id],
    );
    assert.equal(event?.processing_status, 'IGNORED');
    assert.match(event!.processing_note, /No platform payment matches/i);

    // Money the gateway says it took against nothing this platform issued is
    // the case reconciliation exists for, so the delivery has to be findable.
    assert.ok(event, 'the delivery is on the record for a finance officer to find');
  });
});

describe('What reconciliation says about a payment that did not complete', () => {
  it('calls it pending rather than missing', async () => {
    // Initiated and left. The gateway holds it as pending, which is not the
    // same as the gateway having no record of a payment we think succeeded.
    const initiated = await initiate('BANK_TRANSFER');

    const run = await runReconciliation();
    assert.equal(run.status, 200, JSON.stringify(run.body));

    const record = await queryOne<{ status: string; detail: { note?: string } }>(
      pool,
      'SELECT status, detail FROM reconciliation_records WHERE payment_id = $1',
      [initiated.paymentId],
    );
    assert.equal(record?.status, 'PENDING');
    assert.equal(
      run.body.exceptions,
      0,
      'a payment nobody completed is not an exception a finance officer must chase',
    );
  });

  it('flags a payment the gateway has since reversed', async () => {
    const initiated = await initiate('CARD');
    await simulate(initiated.gatewayReference, 'SUCCESS');

    const verified = await queryOne<{ status: string }>(
      pool,
      'SELECT status FROM payments WHERE id = $1',
      [initiated.paymentId],
    );
    assert.equal(verified?.status, 'VERIFIED', 'the platform believes it holds this money');

    // The gateway reverses it on its own account — a chargeback, a recall —
    // without the platform having asked for anything.
    await pool.query(
      `UPDATE mock_gateway_transactions SET status = 'REVERSED' WHERE gateway_reference = $1`,
      [initiated.gatewayReference],
    );

    const run = await runReconciliation();
    assert.equal(run.status, 200, JSON.stringify(run.body));

    const record = await queryOne<{ status: string; detail: { gatewayStatus?: string } }>(
      pool,
      'SELECT status, detail FROM reconciliation_records WHERE payment_id = $1',
      [initiated.paymentId],
    );
    assert.equal(
      record?.status,
      'REVERSED',
      'the platform still shows this as collected; the gateway does not',
    );
    assert.equal(record!.detail.gatewayStatus, 'REVERSED');
  });

  it('records a run that could not finish, rather than leaving no run at all', async () => {
    await initiate('CARD');

    // The matching loop is made to fail on its own write. The failure is real
    // and so is everything the run does up to it; only the cause is arranged.
    await pool.query('ALTER TABLE reconciliation_records RENAME TO reconciliation_records_hidden');
    let refused: Awaited<ReturnType<typeof runReconciliation>>;
    try {
      refused = await runReconciliation();
    } finally {
      await pool.query('ALTER TABLE reconciliation_records_hidden RENAME TO reconciliation_records');
    }
    assert.notEqual(refused!.status, 200, 'a run that could not match must not answer as if it had');

    const runs = await query<{ status: string; abort_reason: string | null }>(
      pool,
      'SELECT status, abort_reason FROM reconciliation_runs ORDER BY started_at DESC',
    );
    assert.equal(runs.length, 1, 'the run that failed is on the record');
    assert.equal(runs[0]!.status, 'FAILED');
    assert.ok(runs[0]!.abort_reason, 'and says what stopped it');

    // The next run works, so the failure recorded nothing that blocks recovery.
    const recovered = await runReconciliation();
    assert.equal(recovered.status, 200, JSON.stringify(recovered.body));
  });
});
