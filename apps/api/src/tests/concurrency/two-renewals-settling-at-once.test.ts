/**
 * Two paid renewals for one vehicle, settling at the same moment.
 *
 * `completeRenewal` decides the period it grants by reading the vehicle's
 * current expiry and counting forward from it. That read has to be the vehicle
 * row locked, not merely current: two renewals settling together would
 * otherwise both read the same expiry and both grant the same date, which is
 * the fault one level up in a smaller window.
 *
 * The sequential version of this is in `vehicle-renewal.test.ts` — two
 * twelve-month renewals raised before either is paid, both paid, twelve months
 * of cover granted for twenty-four months of money. That one needed no
 * interleaving at all, because the dates were fixed when the renewals were
 * RAISED. Deciding the period at completion fixes it; `FOR UPDATE` on the
 * vehicle is what stops the same thing happening inside the new window.
 *
 * This file exists because removing that `FOR UPDATE` failed nothing. The
 * sequential tests pass with the lock gone, which is exactly the shape of
 * cover that looks complete and is not.
 */

import '../env';
import { after, before, beforeEach, describe, it } from 'node:test';
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
} from '../helpers';
import { queryOne } from '../../db/pool';
import { seedReferenceData } from '../../db/seed';
import { seedDemoAgent } from '../../db/seed-agent';

const PLATE = 'JOS903RC';
let agent: { token: string; device: string };
let taxpayerId = '';
let vehicleId = '';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({
    fullName: 'Renewal Race Officer',
    phone: '+2348089600001',
    role: 'admin',
  });
  const demo = await seedDemoAgent();
  assert.ok(demo, 'the demo agent needs an administrator to approve it');
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agent = { token: session.accessToken, device: demo!.deviceIdentifier };

  const taxpayer = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Danjuma',
      lastName: 'Race',
      phone: '+2348089601111',
      address: '7 Zaria Road, Jos',
      lgaId: await firstLgaId(),
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...agent, deviceId: agent.device, idempotencyKey: 'rr-tp' },
  );
  assert.equal(taxpayer.status, 201, JSON.stringify(taxpayer.body));
  taxpayerId = taxpayer.body.taxpayerId;

  const vehicle = await post(
    '/vehicles',
    {
      taxpayerId,
      registrationNumber: PLATE,
      vehicleType: 'PRIVATE',
      make: 'Toyota',
      model: 'Corolla',
      colour: 'Silver',
      ownerName: 'Danjuma Race',
    },
    { ...agent, deviceId: agent.device, idempotencyKey: 'rr-veh' },
  );
  assert.ok(vehicle.status < 400, JSON.stringify(vehicle.body));
  vehicleId = vehicle.body.vehicleId;
});

/** A renewal raised and paid for, waiting only on settlement. */
async function paidRenewal(months: number, key: string): Promise<string> {
  const renewal = await post(
    `/vehicles/${vehicleId}/renew`,
    {
      revenueItemId: await revenueItemByCode('VEH-RENEW-PRIVATE'),
      renewalPeriodMonths: months,
      taxpayerId,
    },
    { ...agent, deviceId: agent.device, idempotencyKey: `rr-rnw-${key}` },
  );
  assert.equal(renewal.status, 201, JSON.stringify(renewal.body));

  const initiated = await post(
    '/payments/initiate',
    { transactionId: renewal.body.transactionId },
    { ...agent, deviceId: agent.device, idempotencyKey: `rr-pay-${key}` },
  );
  assert.equal(initiated.status, 201, JSON.stringify(initiated.body));
  const simulated = await post(
    '/payments/simulate',
    {
      gatewayReference: initiated.body.gatewayReference,
      outcome: 'SUCCESS',
      deliverWebhook: true,
    },
    { ...agent, deviceId: agent.device },
  );
  assert.equal(simulated.status, 200, JSON.stringify(simulated.body));
  return renewal.body.transactionId as string;
}

async function expiry(): Promise<string> {
  const row = await queryOne<{ current_expiry_date: Date | null }>(
    pool,
    'SELECT current_expiry_date FROM vehicles WHERE id = $1',
    [vehicleId],
  );
  assert.ok(row?.current_expiry_date, 'the vehicle has no expiry');
  return row!.current_expiry_date!.toISOString().slice(0, 10);
}

/** Months between today and an ISO date, to the nearest whole month. */
function monthsFromToday(to: string): number {
  const from = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  const until = new Date(`${to}T00:00:00Z`);
  return Math.round((until.getTime() - from.getTime()) / (1000 * 60 * 60 * 24 * 30.4375));
}

describe('two renewals for one vehicle settling at the same moment', () => {
  it('adds both periods, not one of them twice', async () => {
    const first = await paidRenewal(12, 'a');
    const second = await paidRenewal(12, 'b');

    await Promise.all([settleTransaction(first), settleTransaction(second)]);

    assert.equal(
      monthsFromToday(await expiry()),
      24,
      'both renewals were paid and settled; the motorist is covered for one of the two ' +
        'periods, which is what reading the vehicle without locking it buys',
    );
  });

  it('adds both when the periods differ', async () => {
    const first = await paidRenewal(12, 'c');
    const second = await paidRenewal(6, 'd');

    await Promise.all([settleTransaction(first), settleTransaction(second)]);

    assert.equal(monthsFromToday(await expiry()), 18, await expiry());
  });
});
