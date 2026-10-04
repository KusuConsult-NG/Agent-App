/**
 * Checking an invoice before paying it, and being told the truth about it.
 *
 * The public verification page answered an invoice from its PDF's register
 * row, which nothing changes once written: paid, replaced, withdrawn or past
 * its deadline, every invoice read "This is a genuine government document
 * issued by PSIRS", under a green tick, with its number labelled "Receipt
 * number". Measured on all three of paid, replaced and lapsed. And an invoice
 * whose PDF had never been made — its code is on the officer's invoice
 * screen — was "not issued by PSIRS".
 *
 * A trader checking a demand needs to know whether it can be paid, and if not
 * why: paid already, replaced by another bill, withdrawn, or lapsed and
 * waiting to be issued again.
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
const codeOf = async (invoiceId: string) =>
  (await queryOne<{ verification_code: string }>(pool, 'SELECT verification_code FROM invoices WHERE id = $1', [
    invoiceId,
  ]))!.verification_code;

const verify = async (code: string) => {
  const answer = await get(`/verify/${encodeURIComponent(code)}`, {});
  return answer;
};

describe('an invoice checked on the public page', () => {
  it('is genuine and payable while it is in date, even before its PDF exists', async () => {
    const first = await bill();
    const answer = await verify(await codeOf(first.invoiceId));
    assert.equal(answer.status, 200, JSON.stringify(answer.body));
    assert.equal(answer.body.status, 'VALID');
    assert.equal(answer.body.reason, 'INVOICE_PAYABLE');
    assert.equal(answer.body.documentNumber, first.invoiceNumber);
    assert.equal(answer.body.amountKobo, '300000', 'the amount, so an inflated demand shows');
    assert.equal(answer.body.taxpayerName, undefined, 'and nothing about the person');
  });

  it('is found by its invoice number as well as its code', async () => {
    const first = await bill();
    const answer = await verify(first.invoiceNumber.toLowerCase());
    assert.equal(answer.body.reason, 'INVOICE_PAYABLE', JSON.stringify(answer.body));
  });

  it('answers by the bill once its PDF has been made, not by the paper', async () => {
    const first = await bill();
    const pdf = await post(`/revenue/invoices/${first.invoiceId}/document`, {}, asAgent());
    assert.equal(pdf.status, 201, JSON.stringify(pdf.body));
    const answer = await verify(await codeOf(first.invoiceId));
    assert.equal(answer.body.reason, 'INVOICE_PAYABLE');
    assert.equal(answer.body.documentNumber, pdf.body.documentNumber);

    await pay(first.transactionId);
    const paid = await verify(await codeOf(first.invoiceId));
    assert.equal(paid.body.status, 'VALID');
    assert.equal(paid.body.reason, 'INVOICE_PAID', JSON.stringify(paid.body));
  });

  it('says a lapsed bill cannot be paid as it stands, before the sweep and after', async () => {
    const first = await bill();
    await post(`/revenue/invoices/${first.invoiceId}/document`, {}, asAgent());
    await lapse(first.invoiceId);
    const lapsed = await verify(await codeOf(first.invoiceId));
    assert.equal(lapsed.body.status, 'INVALID');
    assert.equal(lapsed.body.reason, 'INVOICE_LAPSED');
    await sweep();
    assert.equal((await verify(await codeOf(first.invoiceId))).body.reason, 'INVOICE_LAPSED');
  });

  it('says a bill issued again was replaced, and its replacement is payable', async () => {
    const first = await bill();
    await post(`/revenue/invoices/${first.invoiceId}/document`, {}, asAgent());
    await lapse(first.invoiceId);
    const again = await reissue(first.invoiceId);
    const old = await verify(await codeOf(first.invoiceId));
    assert.equal(old.body.status, 'INVALID');
    assert.equal(old.body.reason, 'INVOICE_REPLACED');
    const replacement = await verify(await codeOf(again.body.invoiceId));
    assert.equal(replacement.body.reason, 'INVOICE_PAYABLE');
  });

  it('says a withdrawn bill is not owed', async () => {
    const first = await bill();
    await pool.query(`UPDATE invoices SET status = 'CANCELLED' WHERE id = $1`, [first.invoiceId]);
    const answer = await verify(await codeOf(first.invoiceId));
    assert.equal(answer.body.status, 'INVALID');
    assert.equal(answer.body.reason, 'INVOICE_WITHDRAWN');
  });

  it('still answers NOT_FOUND for a code nobody issued', async () => {
    const answer = await verify('ZZZZ-ZZZZ');
    assert.equal(answer.status, 404, JSON.stringify(answer.body));
    assert.equal(answer.body.reason, 'NOT_FOUND');
  });
});
