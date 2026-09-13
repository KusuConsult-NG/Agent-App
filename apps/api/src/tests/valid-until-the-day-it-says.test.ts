/**
 * A certificate that reads EXPIRED on the date printed on it.
 *
 * `vehicle_renewals.expiry_date` is a DATE — a calendar day, with no time in
 * it. `pg` hands that back as a JS Date at midnight, and that instant is what
 * `registerDocument` writes into `documents.expires_at`, which is a
 * TIMESTAMPTZ. Verification then asks:
 *
 *     document.expires_at.getTime() < Date.now()
 *
 * So from one second past midnight on the expiry date, the platform reports
 * the certificate as DOCUMENT_EXPIRED and its status as INVALID — for the
 * whole of the day the certificate itself gives as its expiry.
 *
 * WHY THAT IS THE DEFECT RATHER THAN A CONVENTION
 *
 * Reasonable people differ about whether papers dated 4 March are good
 * through the 4th or only up to it. What cannot be defended is the platform
 * printing one answer and verifying the other. A motorist stopped on the 4th
 * hands over a document saying 4 March; the officer scans it and is told it
 * is not valid. Nothing on either side explains the disagreement, because
 * neither side knows there is one.
 *
 * The convention this platform already follows elsewhere settles which way to
 * resolve it: `renewalPeriodMonths` of 12 from 4 March 2026 produces 4 March
 * 2027, and a motorist who pays for twelve months and is covered until the
 * morning of the last day has been sold twelve months and given twelve months
 * less a day. A day is owed to the holder, not to the State.
 */

import './env';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  firstLgaId,
  loginAs,
  pool,
  post,
  resetDatabase,
  revenueItemByCode,
  settleTransaction,
  startTestServer,
  stopTestServer,
} from './helpers';
import { queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';
import { verifyPublicly } from '../services/receipts';

let agent: { token: string; device: string };
let lgaId = '';
let made = 0;

before(async () => {
  await startTestServer();
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({
    role: 'admin',
    phone: '+2348030000191',
    fullName: 'Expiry Admin',
  });
  const demo = await seedDemoAgent();
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agent = { token: session.accessToken, device: demo!.deviceIdentifier };
  lgaId = await firstLgaId();
});

after(async () => {
  await stopTestServer();
});

/**
 * A vehicle with a renewal on it, and the certificate that renewal produced.
 *
 * The renewal is driven through the real route rather than inserted, so the
 * expiry that ends up on the document is the one the platform computes.
 */
async function renewedVehicle(): Promise<{ verificationCode: string; documentId: string }> {
  const suffix = String(++made);
  const auth = { token: agent.token, deviceId: agent.device };

  const taxpayer = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Expiry',
      lastName: `Owner${suffix}`,
      phone: `+23480555${suffix.padStart(5, '0')}`,
      address: 'Kuru village square',
      lgaId,
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...auth, idempotencyKey: `ex-tp-${suffix}` },
  );
  assert.equal(taxpayer.status, 201, JSON.stringify(taxpayer.body));

  const vehicle = await post(
    '/vehicles',
    {
      taxpayerId: taxpayer.body.taxpayerId,
      registrationNumber: `EX${suffix.padStart(3, '0')}ABC`,
      vehicleType: 'PRIVATE',
      make: 'Toyota',
      model: 'Hilux',
      colour: 'White',
      ownerName: `Expiry Owner${suffix}`,
    },
    { ...auth, idempotencyKey: `ex-veh-${suffix}` },
  );
  assert.ok(vehicle.status < 400, JSON.stringify(vehicle.body));

  const renewal = await post(
    `/vehicles/${vehicle.body.vehicleId}/renew`,
    {
      revenueItemId: await revenueItemByCode('VEH-RENEW-PRIVATE'),
      renewalPeriodMonths: 12,
      taxpayerId: taxpayer.body.taxpayerId,
    },
    { ...auth, idempotencyKey: `ex-rnw-${suffix}` },
  );
  assert.ok(renewal.status < 400, JSON.stringify(renewal.body));

  /*
   * Driven through the real issuing route, so the `expires_at` written on the
   * document is the one the platform computes. Reproducing the defect by hand
   * would prove the shape and not the fix.
   *
   * `settleTransaction` is the shared helper the other renewal suites use: a
   * certificate is deliberately not issued until the money has reached a
   * government account, and that guard is not what this test is about.
   */
  const row = await queryOne<{ id: string }>(
    pool,
    `SELECT id FROM vehicle_renewals
      WHERE vehicle_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [vehicle.body.vehicleId],
  );
  assert.ok(row, 'the renewal was recorded');

  /*
   * Moved BEFORE the payment on purpose.
   *
   * The gateway webhook completes the renewal and issues the certificate, so
   * an expiry changed afterwards would alter the renewal row and leave the
   * document already written with the original date — which is how the first
   * version of this test passed with the defect still in place.
   */
  await pool.query(
    `UPDATE vehicle_renewals
        SET period_start = CURRENT_DATE - INTERVAL '1 year', expiry_date = CURRENT_DATE
      WHERE id = $1`,
    [row!.id],
  );

  const initiated = await post(
    '/payments/initiate',
    { transactionId: renewal.body.transactionId },
    { ...auth, idempotencyKey: `ex-pay-${suffix}` },
  );
  await post(
    '/payments/simulate',
    { gatewayReference: initiated.body.gatewayReference, outcome: 'SUCCESS', deliverWebhook: true },
    auth,
  );
  await settleTransaction(renewal.body.transactionId);

  const issued = await post(`/vehicles/renewals/${row!.id}/document`, undefined, auth);
  assert.ok(issued.status < 400, JSON.stringify(issued.body));

  const document = await queryOne<{ id: string; verification_code: string }>(
    pool,
    'SELECT id, verification_code FROM documents WHERE entity_id = $1',
    [row!.id],
  );
  assert.ok(document, 'the certificate was issued');
  return { verificationCode: document!.verification_code, documentId: document!.id };
}

describe('papers that expire today', () => {
  it('are not reported as expired on the day they expire', async () => {
    const { verificationCode } = await renewedVehicle();

    const verdict = await verifyPublicly(pool, verificationCode);

    /*
     * Asserted positively, not as "anything but expired".
     *
     * The first version of this test said only `notEqual(DOCUMENT_EXPIRED)`,
     * and a verdict of NOT_FOUND would have satisfied it just as well — which
     * is how it passed for a while against a certificate the webhook had
     * already issued with a different date. Naming the verdict it must have
     * leaves nowhere for that to hide.
     */
    assert.equal(
      verdict.reason,
      'DOCUMENT_GENUINE',
      `the certificate says it expires today; verification said ${verdict.reason}`,
    );
    assert.equal(verdict.status, 'VALID');
  });

  it('are reported as expired once the day is over', async () => {
    /*
     * The control, and the half that must not be broken by the fix. Papers
     * that ran out yesterday are not valid today, and a platform that says
     * they are is worse than one that expires them a day early.
     */
    const { verificationCode, documentId } = await renewedVehicle();
    await pool.query(
      `UPDATE documents SET expires_at = (CURRENT_DATE - INTERVAL '1 day') WHERE id = $1`,
      [documentId],
    );

    const verdict = await verifyPublicly(pool, verificationCode);

    assert.equal(verdict.reason, 'DOCUMENT_EXPIRED');
    assert.equal(verdict.status, 'INVALID');
  });
});
