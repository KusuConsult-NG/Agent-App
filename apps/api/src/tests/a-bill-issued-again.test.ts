/**
 * A bill issued again, for the debt it was always for.
 *
 * Two roads ended at a bill that was owed and could not be paid. Its deadline
 * passed, and the payment path refuses an expired invoice. Or a payment against
 * it was reversed by the taxpayer's bank or the gateway: the reversal puts the
 * bill back to UNPAID because the money never stayed with the State, and its
 * only transaction is REVERSED, which nothing can pay. Nothing in the platform
 * raises a second transaction for an invoice, so for both the only advice was
 * "raise a new assessment" — which re-runs the rate engine against today's
 * catalogue instead of carrying the figure already determined, and leaves the
 * first bill standing beside the second: two demands for one liability.
 *
 * Measured, before any of this existed, in the first test of each group: the
 * refusal the citizen met, and nothing that could replace the bill.
 *
 * A reissue renews the demand and nothing else. Same assessment, same amounts,
 * a fresh window; the old invoice is cancelled and names the new one, and
 * migration 091 refuses it being done any other way.
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
  settleTransaction,
  startTestServer,
  stopTestServer,
} from './helpers';
import { query, queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';
import { expireLapsedInvoices } from '../services/revenue';
import { computeComplianceScore } from '../services/incentives';

let agent: { token: string; device: string };
let officer = '';
let finance = '';
let requester = '';
let approver = '';
let executor = '';
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
  await createGovernmentUser({ fullName: 'Reissue Admin', phone: '+2348036100001', role: 'admin' });
  await createGovernmentUser({ fullName: 'Arrears Officer', phone: '+2348036100002', role: 'revenue_officer' });
  await createGovernmentUser({ fullName: 'Finance One', phone: '+2348036100003', role: 'finance_officer' });
  await createGovernmentUser({ fullName: 'Finance Two', phone: '+2348036100004', role: 'finance_officer' });
  officer = (await loginAs('+2348036100002')).accessToken;
  requester = officer;
  finance = (await loginAs('+2348036100003')).accessToken;
  approver = finance;
  executor = (await loginAs('+2348036100004')).accessToken;

  const demo = await seedDemoAgent();
  assert.ok(demo);
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agent = { token: session.accessToken, device: demo!.deviceIdentifier };
  sequence = 0;
});

const asAgent = () => ({ token: agent.token, deviceId: agent.device });
const key = (label: string) => {
  sequence += 1;
  return `ri-${label}-${sequence}`;
};

interface Bill {
  taxpayerId: string;
  assessmentId: string;
  invoiceId: string;
  invoiceNumber: string;
  transactionId: string;
}

/** A shop rate raised by the agent, with nothing tried against it. */
async function bill(): Promise<Bill> {
  sequence += 1;
  const suffix = String(sequence).padStart(3, '0');
  const taxpayer = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Lapsed',
      lastName: `Bill${suffix}`,
      phone: `+2348105200${suffix}`,
      address: '14 Rwang Pam Street, Jos',
      lgaId: await firstLgaId(),
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...asAgent(), idempotencyKey: key('tp') },
  );
  assert.equal(taxpayer.status, 201, JSON.stringify(taxpayer.body));
  const assessment = await post(
    '/revenue/assessments',
    {
      taxpayerId: taxpayer.body.taxpayerId,
      revenueItemId: await revenueItemByCode('SHOPS-KIOSKS'),
      inputs: {},
    },
    { ...asAgent(), idempotencyKey: key('as') },
  );
  assert.equal(assessment.status, 201, JSON.stringify(assessment.body));
  return {
    taxpayerId: taxpayer.body.taxpayerId,
    assessmentId: assessment.body.assessmentId,
    invoiceId: assessment.body.invoiceId,
    invoiceNumber: assessment.body.invoiceNumber,
    transactionId: assessment.body.transactionId,
  };
}

/** Move the deadline into the past, as thirty days would. */
const lapse = (invoiceId: string) =>
  pool.query(`UPDATE invoices SET expires_at = now() - interval '1 hour' WHERE id = $1`, [invoiceId]);

const sweep = () => expireLapsedInvoices({ actorId: null, actorRole: 'system' });

const reissue = (invoiceId: string, auth: Record<string, unknown> = asAgent()) =>
  post(`/revenue/invoices/${invoiceId}/reissue`, {}, { ...auth, idempotencyKey: key('re') });

const startPayment = (transactionId: string) =>
  post('/payments/initiate', { transactionId }, { ...asAgent(), idempotencyKey: key('pay') });

async function pay(transactionId: string) {
  const started = await startPayment(transactionId);
  assert.equal(started.status, 201, JSON.stringify(started.body));
  const paid = await post(
    '/payments/simulate',
    { gatewayReference: started.body.gatewayReference, outcome: 'SUCCESS', deliverWebhook: true },
    asAgent(),
  );
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  return started.body;
}

const invoice = (id: string) =>
  queryOne<{
    id: string;
    invoice_number: string;
    assessment_id: string;
    taxpayer_id: string;
    amount_kobo: string;
    service_charge_kobo: string;
    total_amount_kobo: string;
    amount_paid_kobo: string;
    verification_code: string;
    status: string;
    expires_at: Date | null;
    reissued_as: string | null;
  }>(pool, 'SELECT * FROM invoices WHERE id = $1', [id]);

const transactionStatus = async (id: string) =>
  (await queryOne<{ status: string }>(pool, 'SELECT status FROM transactions WHERE id = $1', [id]))!.status;

/** Request, approve and execute a reversal — the three-person path. */
async function reverse(transactionId: string, attributableTo: string) {
  const request = await post(
    '/government/approvals',
    {
      approvalType: 'PAYMENT_REVERSAL',
      entityType: 'transaction',
      entityId: transactionId,
      payload: {
        amountKobo: '300000',
        reason: 'Recalled by the payer',
        refundType: 'REVERSAL',
        attributableTo,
      },
      reason: 'The payer’s bank recalled the transfer.',
    },
    { token: requester },
  );
  assert.equal(request.status, 201, JSON.stringify(request.body));
  const approved = await post(
    `/government/approvals/${request.body.approvalId}/decide`,
    { decision: 'APPROVE', reason: 'Recall confirmed with the bank.' },
    { token: approver },
  );
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  const otp = await post(
    '/auth/otp/request',
    { destination: '+2348036100004', purpose: 'STEP_UP' },
    { token: executor },
  );
  await post(
    '/auth/step-up',
    { action: 'payment.reversal.approve', destination: '+2348036100004', code: otp.body.developmentCode },
    { token: executor },
  );
  const executed = await post(
    `/government/approvals/${request.body.approvalId}/execute-reversal`,
    {},
    { token: executor },
  );
  assert.equal(executed.status, 200, JSON.stringify(executed.body));
}

// ===========================================================================
describe('A bill whose deadline passed', () => {
  it('could not be paid, and is issued again for the same debt', async () => {
    const first = await bill();
    await lapse(first.invoiceId);
    await sweep();

    // The citizen's position before: refused, with nothing to pay instead.
    const refused = await startPayment(first.transactionId);
    assert.equal(refused.status, 409, JSON.stringify(refused.body));
    assert.match(refused.body.error.code, /INVOICE_(EXPIRED|NOT_PAYABLE)/);

    const reissued = await reissue(first.invoiceId);
    assert.equal(reissued.status, 201, JSON.stringify(reissued.body));
    assert.equal(reissued.body.reissued, true);
    assert.deepEqual(reissued.body.replaces, { invoiceId: first.invoiceId, invoiceNumber: first.invoiceNumber });

    const old = await invoice(first.invoiceId);
    const fresh = await invoice(reissued.body.invoiceId);
    assert.ok(old && fresh);

    // The same debt: one assessment, the same three figures.
    assert.equal(fresh!.assessment_id, first.assessmentId);
    assert.equal(fresh!.taxpayer_id, first.taxpayerId);
    assert.equal(fresh!.amount_kobo, old!.amount_kobo);
    assert.equal(fresh!.service_charge_kobo, old!.service_charge_kobo);
    assert.equal(fresh!.total_amount_kobo, old!.total_amount_kobo);
    assert.equal(reissued.body.totalKobo, old!.total_amount_kobo);

    // A new demand: its own number, its own code, a fresh window.
    assert.notEqual(fresh!.invoice_number, old!.invoice_number);
    assert.notEqual(fresh!.verification_code, old!.verification_code);
    assert.equal(fresh!.status, 'UNPAID');
    assert.ok(fresh!.expires_at!.getTime() > Date.now() + 29 * 86_400_000, 'a full payment window');

    // The old one is cancelled and says what replaced it.
    assert.equal(old!.status, 'CANCELLED');
    assert.equal(old!.reissued_as, fresh!.id);
    assert.equal(await transactionStatus(first.transactionId), 'EXPIRED');

    // The liability is billed again, not lapsed.
    const assessment = await queryOne<{ status: string }>(
      pool,
      'SELECT status FROM assessments WHERE id = $1',
      [first.assessmentId],
    );
    assert.equal(assessment?.status, 'INVOICED');

    // And the money can now be taken.
    assert.equal(await transactionStatus(reissued.body.transactionId), 'INVOICE_GENERATED');
    await pay(reissued.body.transactionId);
    assert.equal((await invoice(fresh!.id))!.status, 'PAID');
    assert.equal((await invoice(first.invoiceId))!.status, 'CANCELLED', 'the old demand stays withdrawn');

    const audit = await queryOne<{ actor_id: string; new_value: { reissuedAs: string } }>(
      pool,
      `SELECT actor_id, new_value FROM audit_logs
        WHERE action = 'invoice.reissued' AND entity_id = $1`,
      [first.invoiceId],
    );
    assert.ok(audit, 'the reissue is on the audit trail');
    assert.equal(audit!.new_value.reissuedAs, fresh!.id);
  });

  it('is issued again before the sweep reaches it, and the old charge is closed', async () => {
    const first = await bill();
    await lapse(first.invoiceId);

    const reissued = await reissue(first.invoiceId);
    assert.equal(reissued.status, 201, JSON.stringify(reissued.body));
    assert.equal(await transactionStatus(first.transactionId), 'EXPIRED');

    // Nothing can be collected against the bill it replaced.
    const stale = await startPayment(first.transactionId);
    assert.equal(stale.status, 409, JSON.stringify(stale.body));
    assert.equal(stale.body.error.code, 'INVOICE_NOT_PAYABLE');
  });

  it('closes a declined attempt on the old bill rather than leaving it open', async () => {
    const first = await bill();
    const started = await startPayment(first.transactionId);
    await post(
      '/payments/simulate',
      { gatewayReference: started.body.gatewayReference, outcome: 'FAILED', deliverWebhook: true },
      asAgent(),
    );
    assert.equal(await transactionStatus(first.transactionId), 'FAILED');
    await lapse(first.invoiceId);

    const reissued = await reissue(first.invoiceId);
    assert.equal(reissued.status, 201, JSON.stringify(reissued.body));
    assert.equal(await transactionStatus(first.transactionId), 'CANCELLED');
  });

  it('is issued once, however many times it is asked', async () => {
    const first = await bill();
    await lapse(first.invoiceId);

    const once = await reissue(first.invoiceId);
    const twice = await reissue(first.invoiceId);
    assert.equal(once.status, 201, JSON.stringify(once.body));
    assert.equal(twice.status, 200, JSON.stringify(twice.body));
    assert.equal(twice.body.reissued, false);
    assert.equal(twice.body.invoiceId, once.body.invoiceId, 'the replacement already made');
    assert.equal(twice.body.transactionReference, once.body.transactionReference);

    const live = await query(
      pool,
      `SELECT id FROM invoices WHERE assessment_id = $1 AND reissued_as IS NULL`,
      [first.assessmentId],
    );
    assert.equal(live.length, 1);
  });

  it('is issued once when two people ask at the same moment', async () => {
    const first = await bill();
    await lapse(first.invoiceId);

    const [a, b] = await Promise.all([reissue(first.invoiceId), reissue(first.invoiceId, { token: officer })]);
    assert.deepEqual([a.status, b.status].sort(), [200, 201], `${a.status} ${b.status}`);
    assert.equal(a.body.invoiceId, b.body.invoiceId);

    const all = await query(pool, 'SELECT id FROM invoices WHERE assessment_id = $1', [first.assessmentId]);
    assert.equal(all.length, 2, 'the original and one replacement');
  });

  it('answers for the latest replacement when an earlier bill in the line is asked about', async () => {
    const first = await bill();
    await lapse(first.invoiceId);
    const second = await reissue(first.invoiceId);
    await lapse(second.body.invoiceId);
    const third = await reissue(second.body.invoiceId);
    assert.equal(third.status, 201, JSON.stringify(third.body));

    const asked = await reissue(first.invoiceId);
    assert.equal(asked.status, 200, JSON.stringify(asked.body));
    assert.equal(asked.body.invoiceId, third.body.invoiceId);
  });

  it('shows the live bill on the assessment', async () => {
    const first = await bill();
    await lapse(first.invoiceId);
    const reissued = await reissue(first.invoiceId);
    // Rewrite the replacement's row, so the cancelled invoice is no longer the
    // one a scan happens to meet last. The record has to choose its invoice by
    // the link, not by where Postgres stored it.
    await pool.query('UPDATE invoices SET expires_at = expires_at WHERE id = $1', [reissued.body.invoiceId]);

    const record = await get(`/revenue/assessments/${first.assessmentId}`, asAgent());
    assert.equal(record.status, 200, JSON.stringify(record.body));
    assert.equal(record.body.invoice_number, reissued.body.invoiceNumber);
    assert.equal(record.body.invoice_status, 'UNPAID');
  });
});

// ===========================================================================
describe('A bill a reversal left owed', () => {
  async function collectedAndReversed(attributableTo: string) {
    const first = await bill();
    await pay(first.transactionId);
    await settleTransaction(first.transactionId);
    await reverse(first.transactionId, attributableTo);
    return first;
  }

  it('could not be paid, and is issued again while still in date', async () => {
    const first = await collectedAndReversed('TAXPAYER');
    assert.equal((await invoice(first.invoiceId))!.status, 'UNPAID', 'the precondition: owed again');
    assert.equal(await transactionStatus(first.transactionId), 'REVERSED');

    const refused = await startPayment(first.transactionId);
    assert.equal(refused.status, 409, JSON.stringify(refused.body));
    assert.equal(refused.body.error.code, 'TRANSACTION_NOT_PAYABLE');

    const reissued = await reissue(first.invoiceId);
    assert.equal(reissued.status, 201, JSON.stringify(reissued.body));
    await pay(reissued.body.transactionId);
    assert.equal((await invoice(reissued.body.invoiceId))!.status, 'PAID');
    assert.equal(await transactionStatus(first.transactionId), 'REVERSED', 'the reversal stays on the record');
  });

  it('is not issued again when the State withdrew it', async () => {
    const first = await collectedAndReversed('GOVERNMENT');
    const refused = await reissue(first.invoiceId);
    assert.equal(refused.status, 409, JSON.stringify(refused.body));
    assert.equal(refused.body.error.code, 'INVOICE_WITHDRAWN');
  });
});

// ===========================================================================
describe('What is not issued again', () => {
  it('a bill that can still be paid', async () => {
    const first = await bill();
    const refused = await reissue(first.invoiceId);
    assert.equal(refused.status, 409, JSON.stringify(refused.body));
    assert.equal(refused.body.error.code, 'INVOICE_STILL_PAYABLE');
  });

  it('a bill that has been paid', async () => {
    const first = await bill();
    await pay(first.transactionId);
    await lapse(first.invoiceId);
    const refused = await reissue(first.invoiceId);
    assert.equal(refused.status, 409, JSON.stringify(refused.body));
    assert.equal(refused.body.error.code, 'INVOICE_ALREADY_PAID');
  });

  it('a bill with a payment still being processed', async () => {
    const first = await bill();
    const started = await startPayment(first.transactionId);
    assert.equal(started.status, 201, JSON.stringify(started.body));
    await lapse(first.invoiceId);
    await sweep();

    const refused = await reissue(first.invoiceId);
    assert.equal(refused.status, 409, JSON.stringify(refused.body));
    assert.equal(refused.body.error.code, 'INVOICE_PAYMENT_IN_PROGRESS');
  });

  it('a bill on a record that is no longer active', async () => {
    const first = await bill();
    await lapse(first.invoiceId);
    await pool.query(`UPDATE taxpayers SET status = 'SUSPENDED' WHERE id = $1`, [first.taxpayerId]);
    const refused = await reissue(first.invoiceId);
    assert.equal(refused.status, 409, JSON.stringify(refused.body));
    assert.equal(refused.body.error.code, 'TAXPAYER_NOT_ACTIVE');
  });

  it('by somebody whose role does not issue bills', async () => {
    const first = await bill();
    await lapse(first.invoiceId);
    const refused = await reissue(first.invoiceId, { token: finance });
    assert.equal(refused.status, 403, JSON.stringify(refused.body));

    const byOfficer = await reissue(first.invoiceId, { token: officer });
    assert.equal(byOfficer.status, 201, 'a revenue officer working arrears may issue a lapsed bill again');
  });

  it('an invoice that does not exist', async () => {
    const missing = await reissue('00000000-0000-4000-8000-000000000000');
    assert.equal(missing.status, 404, JSON.stringify(missing.body));
    const malformed = await reissue('not-an-invoice');
    assert.equal(malformed.status, 404, JSON.stringify(malformed.body));
  });
});

// ===========================================================================
describe('The score, after a bill is issued again', () => {
  it('counts a payment after the first deadline as late, whatever the new one says', async () => {
    const first = await bill();
    await lapse(first.invoiceId);
    const reissued = await reissue(first.invoiceId);
    await pay(reissued.body.transactionId);

    const client = await pool.connect();
    try {
      const breakdown = await computeComplianceScore(client, first.taxpayerId);
      const late = breakdown.components.find((c) => c.factor === 'Late payments');
      assert.ok(late, `paid after the deadline the citizen was first given: ${JSON.stringify(breakdown.components)}`);
    } finally {
      client.release();
    }
  });

  it('does not call a payment inside the first window late', async () => {
    const first = await bill();
    await pay(first.transactionId);
    const client = await pool.connect();
    try {
      const breakdown = await computeComplianceScore(client, first.taxpayerId);
      assert.equal(breakdown.components.find((c) => c.factor === 'Late payments'), undefined);
    } finally {
      client.release();
    }
  });
});

// ===========================================================================
describe('A lapsed vehicle renewal bill', () => {
  async function renewalBill(plate: string) {
    sequence += 1;
    const taxpayer = await post(
      '/taxpayers',
      {
        taxpayerType: 'INDIVIDUAL',
        firstName: 'Motorist',
        lastName: `Owner${sequence}`,
        phone: `+23470466${String(sequence).padStart(5, '0')}`,
        address: 'Kuru village square',
        lgaId: await firstLgaId(),
        consentGiven: true,
        declarationAccepted: true,
      },
      { ...asAgent(), idempotencyKey: key('vtp') },
    );
    assert.equal(taxpayer.status, 201, JSON.stringify(taxpayer.body));
    const vehicle = await post(
      '/vehicles',
      {
        taxpayerId: taxpayer.body.taxpayerId,
        registrationNumber: plate,
        vehicleType: 'PRIVATE',
        make: 'Toyota',
        model: 'Corolla',
        colour: 'Silver',
        ownerName: 'Motorist Owner',
      },
      { ...asAgent(), idempotencyKey: key('veh') },
    );
    assert.ok(vehicle.status < 400, JSON.stringify(vehicle.body));
    const renewal = await post(
      `/vehicles/${vehicle.body.vehicleId}/renew`,
      {
        revenueItemId: await revenueItemByCode('VEH-RENEW-PRIVATE'),
        renewalPeriodMonths: 12,
        taxpayerId: taxpayer.body.taxpayerId,
      },
      { ...asAgent(), idempotencyKey: key('rnw') },
    );
    assert.equal(renewal.status, 201, JSON.stringify(renewal.body));
    return renewal.body as { renewalId: string; invoiceId: string; transactionId: string };
  }

  it('carries the renewal to the new bill, so paying it renews the vehicle', async () => {
    const renewal = await renewalBill('JOS771RI');
    await lapse(renewal.invoiceId);
    await sweep();

    const reissued = await reissue(renewal.invoiceId);
    assert.equal(reissued.status, 201, JSON.stringify(reissued.body));

    const moved = await queryOne<{ transaction_id: string; status: string }>(
      pool,
      'SELECT transaction_id, status FROM vehicle_renewals WHERE id = $1',
      [renewal.renewalId],
    );
    assert.equal(moved?.transaction_id, reissued.body.transactionId, 'the renewal follows the bill');

    await pay(reissued.body.transactionId);
    await settleTransaction(reissued.body.transactionId);
    const done = await queryOne<{ status: string; document_id: string | null }>(
      pool,
      'SELECT status, document_id FROM vehicle_renewals WHERE id = $1',
      [renewal.renewalId],
    );
    assert.equal(done?.status, 'COMPLETED', 'the motorist paid, and received the renewal they paid for');
    assert.ok(done?.document_id);
  });

  it('is not issued again once its renewal has been cancelled', async () => {
    const renewal = await renewalBill('JOS772RI');
    await lapse(renewal.invoiceId);
    await pool.query(`UPDATE vehicle_renewals SET status = 'CANCELLED' WHERE id = $1`, [renewal.renewalId]);

    const refused = await reissue(renewal.invoiceId);
    assert.equal(refused.status, 409, JSON.stringify(refused.body));
    assert.equal(refused.body.error.code, 'VEHICLE_RENEWAL_CLOSED');
  });
});

// ===========================================================================
describe('What the database refuses, whoever asks', () => {
  /** Run statements on one connection, in one transaction, and report how it ended. */
  async function attempt(statements: (client: import('pg').PoolClient) => Promise<unknown>) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await statements(client);
      await client.query('COMMIT');
      return null;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      return (error as Error).message;
    } finally {
      client.release();
    }
  }

  async function reissued() {
    const first = await bill();
    await lapse(first.invoiceId);
    const again = await reissue(first.invoiceId);
    assert.equal(again.status, 201, JSON.stringify(again.body));
    return { first, replacementId: again.body.invoiceId as string };
  }

  it('a replacement re-pointed', async () => {
    const { first } = await reissued();
    const other = await bill();
    const error = await attempt((c) =>
      c.query('UPDATE invoices SET reissued_as = $2 WHERE id = $1', [first.invoiceId, other.invoiceId]),
    );
    assert.match(error ?? '', /replaced by another invoice|never changed/i);
  });

  it('a replaced invoice brought back to life', async () => {
    const { first } = await reissued();
    const error = await attempt((c) =>
      c.query(`UPDATE invoices SET status = 'UNPAID' WHERE id = $1`, [first.invoiceId]),
    );
    assert.match(error ?? '', /invoices_replaced_is_cancelled/);
  });

  it('a replacement for a different debt', async () => {
    const first = await bill();
    const other = await bill();
    await lapse(first.invoiceId);
    const error = await attempt((c) =>
      c.query(`UPDATE invoices SET status = 'CANCELLED', reissued_as = $2 WHERE id = $1`, [
        first.invoiceId,
        other.invoiceId,
      ]),
    );
    assert.match(error ?? '', /same assessment, taxpayer and amounts/);
  });

  it('a second live bill for one assessment', async () => {
    const first = await bill();
    const error = await attempt((c) =>
      c.query(
        `INSERT INTO invoices (invoice_number, assessment_id, taxpayer_id, amount_kobo,
                               service_charge_kobo, total_amount_kobo, verification_code, created_by)
         SELECT 'INV/TEST/DUP', assessment_id, taxpayer_id, amount_kobo, service_charge_kobo,
                total_amount_kobo, 'DUPCODE1', created_by
           FROM invoices WHERE id = $1`,
        [first.invoiceId],
      ),
    );
    assert.match(error ?? '', /invoices_one_live_per_assessment/);
  });

  it('a paid bill replaced', async () => {
    const first = await bill();
    await pay(first.transactionId);
    const error = await attempt(async (c) => {
      const copy = await c.query<{ id: string }>(
        `INSERT INTO invoices (invoice_number, assessment_id, taxpayer_id, amount_kobo,
                               service_charge_kobo, total_amount_kobo, verification_code, created_by)
         SELECT 'INV/TEST/PAID', assessment_id, taxpayer_id, amount_kobo, service_charge_kobo,
                total_amount_kobo, 'PAIDCOPY', created_by
           FROM invoices WHERE id = $1 RETURNING id`,
        [first.invoiceId],
      );
      await c.query(`UPDATE invoices SET status = 'CANCELLED', reissued_as = $2 WHERE id = $1`, [
        first.invoiceId,
        copy.rows[0]!.id,
      ]);
    });
    assert.match(error ?? '', /money paid against it/);
  });
});
