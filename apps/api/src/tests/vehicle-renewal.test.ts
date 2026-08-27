/**
 * A paid renewal is issued however the payment was confirmed.
 *
 * Issuing the renewal document — and telling the vehicle authority — lived in
 * the route the agent's app calls when it taps "check payment status". So a
 * renewal confirmed by webhook, which is the ordinary path and the one this
 * platform treats as authoritative, took the money, issued a government
 * receipt, and never issued the renewal:
 *
 *   status PENDING_PAYMENT · document_number null · authority PENDING
 *
 * The taxpayer was left holding a receipt for a renewal that had not happened,
 * driving on a vehicle the authority still had as unrenewed. Nothing recovered
 * it either: `retryAuthorityNotifications` only revisits renewals that already
 * have a document, and the one function that would have swept up the rest was
 * never called from anywhere.
 *
 * PRD §95 stops a transaction looking successful when the money is unconfirmed.
 * This is the same failure inverted — the money confirmed and the thing the
 * citizen actually bought silently not delivered — and it deserves the same
 * treatment.
 *
 * WHAT MOVED SINCE. Issuance is no longer triggered by the gateway confirming.
 * A renewal document is what a driver shows at a checkpoint, and granting a
 * year of legal cover on the gateway's word meant the State could grant it for
 * money that never arrived. It is now issued when the settlement covering the
 * renewal is reconciled — so these tests confirm the payment, settle it, and
 * then assert the same properties. The first one also asserts the interval in
 * between, which is the new behaviour: confirmed, and deliberately not yet
 * issued.
 */

import './env';
import { after, before, describe, it } from 'node:test';
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
import { queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';

/**
 * A cleared, active agent, via the seeder that walks the real pipeline.
 *
 * Reused rather than reimplemented: an agent that has not genuinely cleared
 * cannot collect, and a fixture that fakes that would be testing nothing.
 */
async function activeAgent() {
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({
    fullName: 'Renewal Test Admin',
    phone: '+2348000000001',
    role: 'admin',
  });

  const demo = await seedDemoAgent();
  assert.ok(demo, 'the demonstration agent must seed for this suite to mean anything');

  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  return { token: session.accessToken, device: demo!.deviceIdentifier };
}

before(async () => {
  await startTestServer();
});

after(async () => {
  await stopTestServer();
});

/** A renewal taken to the point where only the gateway's word is missing. */
async function renewalAwaitingPayment(plate = 'JOS451ZZ', phone = '+2347044555001') {
  const agent = await activeAgent();
  const DEVICE = agent.device;
  const lgaId = await firstLgaId();

  const taxpayer = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Ladi',
      lastName: 'Bot',
      phone,
      address: 'Kuru village square',
      lgaId,
      consentGiven: true,
      declarationAccepted: true,
    },
    { token: agent.token, deviceId: DEVICE, idempotencyKey: `tp-${Date.now()}` },
  );
  assert.equal(taxpayer.status, 201, JSON.stringify(taxpayer.body));

  const vehicle = await post(
    '/vehicles',
    {
      taxpayerId: taxpayer.body.taxpayerId,
      registrationNumber: plate,
      vehicleType: 'PRIVATE',
      make: 'Toyota',
      model: 'Hilux',
      colour: 'White',
      ownerName: 'Ladi Bot',
    },
    { token: agent.token, deviceId: DEVICE, idempotencyKey: `veh-${Date.now()}` },
  );
  assert.ok(vehicle.status < 400, JSON.stringify(vehicle.body));

  const renewal = await post(
    `/vehicles/${vehicle.body.vehicleId}/renew`,
    {
      revenueItemId: await revenueItemByCode('VEH-RENEW-PRIVATE'),
      renewalPeriodMonths: 12,
      taxpayerId: taxpayer.body.taxpayerId,
    },
    { token: agent.token, deviceId: DEVICE, idempotencyKey: `rnw-${Date.now()}` },
  );
  assert.equal(renewal.status, 201, JSON.stringify(renewal.body));

  const initiated = await post(
    '/payments/initiate',
    { transactionId: renewal.body.transactionId },
    { token: agent.token, deviceId: DEVICE, idempotencyKey: `pay-${Date.now()}` },
  );
  assert.equal(initiated.status, 201, JSON.stringify(initiated.body));

  return {
    agent,
    device: DEVICE,
    renewal: renewal.body,
    gatewayReference: initiated.body.gatewayReference,
  };
}

function renewalRow(renewalId: string) {
  return queryOne<{
    status: string;
    document_id: string | null;
    document_number: string | null;
    authority_notification_status: string;
  }>(
    pool,
    `SELECT status, document_id, document_number, authority_notification_status
       FROM vehicle_renewals WHERE id = $1`,
    [renewalId],
  );
}

describe('A renewal confirmed by webhook is still issued', () => {
  it('issues the document and notifies the authority without any client poll', async () => {
    const { agent, device, renewal, gatewayReference } = await renewalAwaitingPayment();

    // The gateway confirms on its own. No agent taps anything — the app may
    // well be closed, which is the whole point.
    const simulated = await post(
      '/payments/simulate',
      { gatewayReference, outcome: 'SUCCESS', deliverWebhook: true },
      { token: agent.token, deviceId: device },
    );
    assert.equal(simulated.status, 200, JSON.stringify(simulated.body));

    // Confirmed by the gateway, and deliberately not issued: the State does
    // not hold the money yet, so it has not granted anything.
    const beforeSettlement = await renewalRow(renewal.renewalId);
    assert.equal(beforeSettlement?.document_number, null, 'nothing is granted on the gateway word alone');

    await settleTransaction(renewal.transactionId);

    const row = await renewalRow(renewal.renewalId);
    assert.equal(
      row?.status,
      'COMPLETED',
      'a settled renewal must be issued without an app asking for it',
    );
    assert.ok(row?.document_number, 'the renewal document must exist');
    assert.equal(
      row?.authority_notification_status,
      'ACCEPTED',
      'the vehicle authority must have been told',
    );
  });

  it('does not issue a second document when the payment is confirmed again', async () => {
    const { agent, device, renewal, gatewayReference } = await renewalAwaitingPayment();

    await post(
      '/payments/simulate',
      { gatewayReference, outcome: 'SUCCESS', deliverWebhook: true },
      { token: agent.token, deviceId: device },
    );
    await settleTransaction(renewal.transactionId);
    const first = await renewalRow(renewal.renewalId);

    // A redelivered webhook, and then the agent's app polling anyway. Both are
    // ordinary, and neither may produce a second renewal document.
    await post(
      '/payments/simulate',
      { gatewayReference, outcome: 'SUCCESS', deliverWebhook: true },
      { token: agent.token, deviceId: device },
    );
    const status = await get(`/payments/transactions/${renewal.transactionReference}/status`, {
      token: agent.token,
      deviceId: device,
    });
    await post(`/payments/${status.body.transaction.payment_id}/confirm`, undefined, {
      token: agent.token,
      deviceId: device,
    });

    const again = await renewalRow(renewal.renewalId);
    assert.equal(again?.document_id, first?.document_id, 'the document must not be reissued');

    const count = await queryOne<{ count: string }>(
      pool,
      `SELECT count(*)::text AS count FROM vehicle_renewals WHERE id = $1 AND document_id IS NOT NULL`,
      [renewal.renewalId],
    );
    assert.equal(count?.count, '1');
  });

  it('still confirms the payment when the authority cannot be told', async () => {
    // ZZZ is the mock registry's unreachable prefix. The money is verified and
    // settled whatever the vehicle authority does — refusing a settled payment
    // because a third party is down would be the wrong way round, and claiming
    // the authority accepted it would be worse.
    const { agent, device, renewal, gatewayReference } = await renewalAwaitingPayment(
      'ZZZ451AA',
      '+2347044555002',
    );

    await post(
      '/payments/simulate',
      { gatewayReference, outcome: 'SUCCESS', deliverWebhook: true },
      { token: agent.token, deviceId: device },
    );
    await settleTransaction(renewal.transactionId);

    const status = await get(`/payments/transactions/${renewal.transactionReference}/status`, {
      token: agent.token,
      deviceId: device,
    });
    assert.equal(
      status.body.transaction.payment_status,
      'VERIFIED',
      'the money is confirmed regardless',
    );
    assert.ok(status.body.transaction.receipt_number, 'and the receipt is real');

    const row = await renewalRow(renewal.renewalId);
    assert.notEqual(
      row?.authority_notification_status,
      'ACCEPTED',
      'the authority was unreachable, so nothing may claim it accepted the renewal',
    );
  });
});
