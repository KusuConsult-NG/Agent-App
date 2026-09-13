/**
 * Two things public verification says that are not true.
 *
 * 1. THE NUMBER IS MATCHED CASE-SENSITIVELY. Receipt and document numbers are
 *    generated uppercase — PSIRS/2026/000123 — and looked up with a bare
 *    equality against whatever was typed. A citizen who types their own
 *    receipt number in lower case is told "No government document matches that
 *    number or code. If you were given a receipt bearing this number, it was
 *    not issued by PSIRS." The platform accuses a genuine receipt of being a
 *    forgery because of the shift key. Verification codes were already
 *    normalised; the numbers beside them were not.
 *
 * 2. "COULD NOT CHECK" IS REPORTED AS "DOES NOT MATCH". `verifyDocumentIntegrity`
 *    catches every failure from the storage driver and returns false, which is
 *    the same value it returns for a real checksum mismatch. The driver throws
 *    when a bucket is unreachable as readily as when bytes have been altered,
 *    so a storage outage makes the platform tell every citizen in the state
 *    that their receipt "does not match its original fingerprint" and to report
 *    it to PSIRS. Reporting a suspected forgery is not a thing to say when the
 *    truth is that nothing could be compared.
 *
 * Neither is about a document that is actually wrong. Both are about what the
 * platform says to someone holding a genuine one.
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
  settleTransaction,
  post,
  resetDatabase,
  startTestServer,
  stopTestServer,
  revenueItemByCode,
} from './helpers';
import { rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config';
import { queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';

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
  // seedDemoAgent walks the real clearance pipeline, which needs an approver.
  await createGovernmentUser({ fullName: 'Verify Admin', phone: '+2348000000040', role: 'admin' });
  const demo = await seedDemoAgent();
  assert.ok(demo);
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agent = { token: session.accessToken, device: demo!.deviceIdentifier };
});

/** A collection carried through to a verified payment and a receipt. */
async function collect(suffix: string) {
  const auth = { token: agent.token, deviceId: agent.device };
  const taxpayer = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Lookup',
      lastName: `Subject${suffix}`,
      phone: `+23480333${suffix.padStart(5, '0')}`,
      address: '5 Market Road, Bokkos',
      lgaId: await firstLgaId(),
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

  // A receipt exists only once the money has reached a government account.
  await settleTransaction(assessment.body.transactionId);
  const row = await queryOne<{
    receipt_number: string;
    verification_code: string;
    document_number: string;
    document_id: string;
  }>(
    pool,
    `SELECT r.receipt_number, r.verification_code, d.document_number, d.id AS document_id
       FROM receipts r JOIN documents d ON d.id = r.document_id
      WHERE r.transaction_id = $1`,
    [assessment.body.transactionId],
  );
  assert.ok(row);
  return row!;
}

/** Put the stored bytes out of reach without touching the record. */
async function makeUnreadable(documentId: string): Promise<void> {
  const document = await queryOne<{ storage_reference: string }>(
    pool,
    'SELECT storage_reference FROM documents WHERE id = $1',
    [documentId],
  );
  const path = join(config.storage.localPath, document!.storage_reference);
  await rename(path, `${path}.moved`);
}

describe('Verification answers the person in front of it', () => {
  it('finds a genuine receipt whatever case its number was typed in', async () => {
    const handles = await collect('1');

    for (const typed of [
      handles.receipt_number.toLowerCase(),
      handles.document_number.toLowerCase(),
      handles.verification_code.toLowerCase(),
    ]) {
      const result = await get(`/verify/${encodeURIComponent(typed)}`);
      assert.equal(
        result.body.status,
        'VALID',
        `typing "${typed}" reported: ${JSON.stringify(result.body)}`,
      );
    }
  });

  it('does not accuse a receipt of tampering when the stored copy cannot be read', async () => {
    const handles = await collect('2');
    // The row is untouched — the immutability trigger would refuse to let it be
    // otherwise. Only the bytes became unreachable: a bucket outage, a mislaid
    // mount. Nothing was compared, so nothing may be alleged.
    await makeUnreadable(handles.document_id);

    const result = await get(`/verify/${encodeURIComponent(handles.receipt_number)}`);
    assert.doesNotMatch(
      result.body.message,
      /does not match its original fingerprint/i,
      'nothing was compared, so a mismatch must not be alleged',
    );
    assert.notEqual(result.body.integrityConfirmed, true, 'and it must not claim it checked out');
    assert.match(
      result.body.message,
      /could not be checked|could not be read/i,
      'it should say plainly that the stored copy could not be checked',
    );
  });

  it('does not do the same to vehicle papers, which have no receipt row behind them', async () => {
    const auth = { token: agent.token, deviceId: agent.device };
    const taxpayer = await post(
      '/taxpayers',
      {
        taxpayerType: 'INDIVIDUAL',
        firstName: 'Lookup',
        lastName: 'Motorist',
        phone: '+2348033300099',
        address: '9 Motor Park Road, Bokkos',
        lgaId: await firstLgaId(),
        consentGiven: true,
        declarationAccepted: true,
      },
      { ...auth, idempotencyKey: 'tp-veh' },
    );
    const vehicle = await post(
      '/vehicles',
      {
        registrationNumber: 'PL-VFY-09C',
        vehicleType: 'PRIVATE_CAR',
        ownerName: 'Motorist Owner',
        taxpayerId: taxpayer.body.taxpayerId,
      },
      auth,
    );
    const renewal = await post(
      `/vehicles/${vehicle.body.vehicleId ?? vehicle.body.id}/renew`,
      {
        revenueItemId: await revenueItemByCode('VEH-RENEW-PRIVATE'),
        renewalPeriodMonths: 12,
        taxpayerId: taxpayer.body.taxpayerId,
      },
      { ...auth, idempotencyKey: 'rn-veh' },
    );
    const initiated = await post(
      '/payments/initiate',
      { transactionId: renewal.body.transactionId },
      { ...auth, idempotencyKey: 'pay-veh' },
    );
    await post(
      '/payments/simulate',
      { gatewayReference: initiated.body.gatewayReference, outcome: 'SUCCESS', deliverWebhook: true },
      auth,
    );
    // Particulars are granted when the money reaches a government account, not
    // when the gateway says it has it.
    await settleTransaction(renewal.body.transactionId);
    const issued = await post(
      `/vehicles/renewals/${renewal.body.renewalId ?? renewal.body.id}/document`,
      {},
      auth,
    );
    assert.equal(issued.status, 200, JSON.stringify(issued.body));

    await makeUnreadable(issued.body.documentId);

    const result = await get(`/verify/${encodeURIComponent(issued.body.documentNumber)}`);
    assert.notEqual(
      result.body.status,
      'INVALID',
      `papers nobody could read are not thereby invalid: ${JSON.stringify(result.body)}`,
    );
    assert.doesNotMatch(result.body.message, /does not match its original fingerprint/i);
  });

  // --- controls ---

  it('still calls out a document whose stored bytes were actually altered', async () => {
    const handles = await collect('3');
    const document = await queryOne<{ storage_reference: string }>(
      pool,
      'SELECT storage_reference FROM documents WHERE id = $1',
      [handles.document_id],
    );
    await writeFile(join(config.storage.localPath, document!.storage_reference), 'not the receipt');

    const result = await get(`/verify/${encodeURIComponent(handles.receipt_number)}`);
    assert.equal(result.body.status, 'INVALID', JSON.stringify(result.body));
    assert.match(result.body.message, /fingerprint/i);
    assert.equal(result.body.integrityConfirmed, false);
  });

  it('still finds nothing for a number that was never issued', async () => {
    const result = await get('/verify/PSIRS%2F2026%2F999999');
    assert.equal(result.body.status, 'NOT_FOUND');
    assert.match(result.body.message, /not issued by PSIRS/i);
  });
});
