/**
 * What public verification says about a document after the money went back.
 *
 * `documents.status` has three values — ISSUED, SUPERSEDED, REVOKED — and
 * `verifyPublicly` has a branch for each. Nothing in the codebase ever writes
 * that column. Every document ever issued is ISSUED, so the REVOKED branch is
 * unreachable and the reversal cascade, which is careful to mark the receipt
 * row, leaves the PDF beside it saying what it always said.
 *
 * Two consequences, and they are not the same size.
 *
 * A RECEIPT looked up by its receipt number or verification code hits the
 * receipts row first and correctly reports REVERSED. Looked up by its
 * *document* number it does not: that only matches the documents table, which
 * still reads ISSUED, and the citizen is told "This is a genuine government
 * receipt issued by PSIRS." The document number is not obscure — the
 * verification endpoint hands it back in every VALID answer, and it is the
 * filename of the PDF on the taxpayer's phone.
 *
 * A VEHICLE RENEWAL document is worse, because it has no receipts row at all.
 * It is a documents row and nothing else, so *every* way of looking it up
 * reports genuine — for the whole renewal period, up to twenty-four months,
 * after the payment behind it was reversed and the money returned. Papers that
 * verify at a checkpoint are the entire point of the document.
 *
 * PRD §95 read backwards: nobody should be able to make a reversed revenue
 * transaction still appear successful.
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
} from './helpers';
import { queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';

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
  await createGovernmentUser({ fullName: 'Doc Admin', phone: '+2348000000030', role: 'admin' });
  await createGovernmentUser({ fullName: 'Doc Requester', phone: '+2348000000031', role: 'revenue_officer' });
  await createGovernmentUser({ fullName: 'Doc Finance One', phone: '+2348000000032', role: 'finance_officer' });
  await createGovernmentUser({ fullName: 'Doc Finance Two', phone: '+2348000000033', role: 'finance_officer' });
  requester = (await loginAs('+2348000000031')).accessToken;
  approver = (await loginAs('+2348000000032')).accessToken;
  executor = (await loginAs('+2348000000033')).accessToken;

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

function auth() {
  return { token: agent.token, deviceId: agent.device };
}

async function makeTaxpayer(suffix: string): Promise<string> {
  const created = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Verify',
      lastName: `Subject${suffix}`,
      phone: `+23480222${suffix.padStart(5, '0')}`,
      address: '11 Market Road, Bokkos',
      lgaId: await firstLgaId(),
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...auth(), idempotencyKey: `tp-${suffix}` },
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return created.body.taxpayerId as string;
}

async function payFor(transactionId: string, suffix: string) {
  const initiated = await post(
    '/payments/initiate',
    { transactionId },
    { ...auth(), idempotencyKey: `pay-${suffix}` },
  );
  const simulated = await post(
    '/payments/simulate',
    { gatewayReference: initiated.body.gatewayReference, outcome: 'SUCCESS', deliverWebhook: true },
    auth(),
  );
  assert.equal(simulated.status, 200, JSON.stringify(simulated.body));
}

/** A shop collection carried through to a verified payment and a receipt. */
async function collect(suffix: string): Promise<{ transactionId: string }> {
  const assessment = await post(
    '/revenue/assessments',
    {
      taxpayerId: await makeTaxpayer(suffix),
      revenueItemId: await revenueItemByCode('SHOPS-KIOSKS'),
      inputs: {},
    },
    { ...auth(), idempotencyKey: `as-${suffix}` },
  );
  assert.equal(assessment.status, 201, JSON.stringify(assessment.body));
  await payFor(assessment.body.transactionId, suffix);
  return { transactionId: assessment.body.transactionId as string };
}

/** A vehicle renewal paid for and its document issued — the plate in hand. */
async function renewedVehicle(plate: string, suffix: string): Promise<{
  transactionId: string;
  documentNumber: string;
  verificationCode: string;
}> {
  const taxpayerId = await makeTaxpayer(suffix);

  const vehicle = await post(
    '/vehicles',
    {
      registrationNumber: plate,
      vehicleType: 'PRIVATE_CAR',
      ownerName: 'Motorist Owner',
      taxpayerId,
    },
    auth(),
  );
  assert.equal(vehicle.status, 201, JSON.stringify(vehicle.body));

  const renewal = await post(
    `/vehicles/${vehicle.body.vehicleId ?? vehicle.body.id}/renew`,
    {
      revenueItemId: await revenueItemByCode('VEH-RENEW-PRIVATE'),
      renewalPeriodMonths: 12,
      taxpayerId,
    },
    { ...auth(), idempotencyKey: `rn-${suffix}` },
  );
  assert.equal(renewal.status, 201, JSON.stringify(renewal.body));
  await payFor(renewal.body.transactionId, suffix);

  const renewalId = renewal.body.renewalId ?? renewal.body.id;
  const document = await post(`/vehicles/renewals/${renewalId}/document`, {}, auth());
  assert.equal(document.status, 200, JSON.stringify(document.body));

  return {
    transactionId: renewal.body.transactionId as string,
    documentNumber: document.body.documentNumber as string,
    verificationCode: document.body.verificationCode as string,
  };
}

/** Request, approve and execute a reversal — the three-person path. */
async function reverse(transactionId: string) {
  const amount = await queryOne<{ amount_kobo: string }>(
    pool,
    'SELECT amount_kobo FROM transactions WHERE id = $1',
    [transactionId],
  );

  const request = await post(
    '/government/approvals',
    {
      approvalType: 'PAYMENT_REVERSAL',
      entityType: 'transaction',
      entityId: transactionId,
      payload: { amountKobo: amount!.amount_kobo, reason: 'Charged in error', refundType: 'FULL' },
      reason: 'Duplicate charge confirmed against the record.',
    },
    { token: requester },
  );
  assert.equal(request.status, 201, JSON.stringify(request.body));

  const approved = await post(
    `/government/approvals/${request.body.approvalId}/decide`,
    { decision: 'APPROVE', reason: 'Duplicate confirmed.' },
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

/** The receipt row and its paired document, as the public would look them up. */
async function receiptHandles(transactionId: string) {
  const row = await queryOne<{
    receipt_number: string;
    verification_code: string;
    document_number: string;
  }>(
    pool,
    `SELECT r.receipt_number, r.verification_code, d.document_number
       FROM receipts r JOIN documents d ON d.id = r.document_id
      WHERE r.transaction_id = $1`,
    [transactionId],
  );
  assert.ok(row, 'a receipt with a document was issued');
  return row!;
}

describe('A reversed payment leaves no document that still verifies', () => {
  it('does not call a reversed receipt genuine when it is looked up by document number', async () => {
    const { transactionId } = await collect('1');
    const handles = await receiptHandles(transactionId);

    await reverse(transactionId);

    const byDocumentNumber = await get(`/verify/${encodeURIComponent(handles.document_number)}`);
    assert.notEqual(
      byDocumentNumber.body.status,
      'VALID',
      `verifying ${handles.document_number} after reversal reported: ${JSON.stringify(byDocumentNumber.body)}`,
    );
    assert.doesNotMatch(
      byDocumentNumber.body.message,
      /genuine/i,
      'a citizen must not be told a reversed receipt is genuine',
    );
    // Not merely "revoked": a receipt answers with its own status by every
    // handle it has, so the person holding it is told what actually happened.
    assert.equal(byDocumentNumber.body.status, 'REVERSED', JSON.stringify(byDocumentNumber.body));
    assert.match(byDocumentNumber.body.message, /reversed or refunded/i);
  });

  it('does not call vehicle papers genuine after the renewal payment is reversed', async () => {
    const renewed = await renewedVehicle('PL-VRF-01A', '4');

    await reverse(renewed.transactionId);

    for (const lookup of [renewed.documentNumber, renewed.verificationCode]) {
      const result = await get(`/verify/${encodeURIComponent(lookup)}`);
      assert.notEqual(
        result.body.status,
        'VALID',
        `verifying ${lookup} after reversal reported: ${JSON.stringify(result.body)}`,
      );
      assert.doesNotMatch(
        result.body.message,
        /genuine/i,
        'papers backed by a reversed payment must not verify as genuine',
      );
    }
  });

  // --- controls: neither of these should change ---

  it('still calls an untouched receipt genuine by every handle it has', async () => {
    const { transactionId } = await collect('2');
    const handles = await receiptHandles(transactionId);

    for (const lookup of [handles.receipt_number, handles.verification_code, handles.document_number]) {
      const result = await get(`/verify/${encodeURIComponent(lookup)}`);
      assert.equal(
        result.body.status,
        'VALID',
        `${lookup} should verify: ${JSON.stringify(result.body)}`,
      );
      assert.match(result.body.message, /genuine/i);
    }
  });

  /*
   * 028 narrowed `renewals_require_payment` so that cancelling a renewal is
   * possible after reversal. These two hold the line it must still hold: the
   * check is skipped only when the document link is untouched, so attaching a
   * document to an unpaid renewal, or swapping the document on a reversed one,
   * is refused by the database exactly as before.
   */
  it('still refuses to attach a document to a renewal that was never paid for', async () => {
    const { transactionId } = await collect('5');
    const lender = await receiptHandles(transactionId);
    const documentId = await queryOne<{ id: string }>(
      pool,
      'SELECT id FROM documents WHERE document_number = $1',
      [lender.document_number],
    );

    const taxpayerId = await makeTaxpayer('6');
    const vehicle = await post(
      '/vehicles',
      {
        registrationNumber: 'PL-UNPAID-1A',
        vehicleType: 'PRIVATE_CAR',
        ownerName: 'Unpaid Owner',
        taxpayerId,
      },
      auth(),
    );
    const renewal = await post(
      `/vehicles/${vehicle.body.vehicleId ?? vehicle.body.id}/renew`,
      {
        revenueItemId: await revenueItemByCode('VEH-RENEW-PRIVATE'),
        renewalPeriodMonths: 12,
        taxpayerId,
      },
      { ...auth(), idempotencyKey: 'rn-unpaid' },
    );
    assert.equal(renewal.status, 201, JSON.stringify(renewal.body));

    await assert.rejects(
      () =>
        pool.query('UPDATE vehicle_renewals SET document_id = $2 WHERE id = $1', [
          renewal.body.renewalId ?? renewal.body.id,
          documentId!.id,
        ]),
      /cannot be issued while transaction is|requires a paid transaction/i,
      'the database must still refuse papers for a renewal nobody paid for',
    );
  });

  it('still refuses to swap the document on a renewal after its payment is reversed', async () => {
    const renewed = await renewedVehicle('PL-VRF-02B', '7');
    const other = await collect('8');
    const replacement = await queryOne<{ id: string }>(
      pool,
      'SELECT id FROM documents WHERE document_number = $1',
      [(await receiptHandles(other.transactionId)).document_number],
    );

    await reverse(renewed.transactionId);

    const renewalId = await queryOne<{ id: string }>(
      pool,
      'SELECT id FROM vehicle_renewals WHERE document_number = $1',
      [renewed.documentNumber],
    );

    await assert.rejects(
      () =>
        pool.query('UPDATE vehicle_renewals SET document_id = $2 WHERE id = $1', [
          renewalId!.id,
          replacement!.id,
        ]),
      /cannot be issued while transaction is/i,
      'a reversed renewal must not be given fresh papers',
    );
  });

  it('already reports a reversed receipt correctly by receipt number and code', async () => {
    const { transactionId } = await collect('3');
    const handles = await receiptHandles(transactionId);

    await reverse(transactionId);

    for (const lookup of [handles.receipt_number, handles.verification_code]) {
      const result = await get(`/verify/${encodeURIComponent(lookup)}`);
      assert.equal(result.body.status, 'REVERSED', JSON.stringify(result.body));
      assert.match(result.body.message, /reversed or refunded/i);
    }
  });
});
