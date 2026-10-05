/**
 * A vehicle renewal is raised by the renewal flow, and only there.
 *
 * The renewal flow (`POST /vehicles/:id/renew`) does what a vehicle renewal
 * needs: it checks the vehicle and its owner, allows 6, 12 or 24 months,
 * records the renewal, and issues the papers once the money lands. The
 * general charge route (`POST /revenue/assessments`) does none of that.
 *
 * Two doors were open between them, one each way:
 *
 *   * The general route would charge a vehicle renewal item. The collect
 *     screen could not reach it only by accident — it sent no inputs for a
 *     formula item, so the quote failed — and making the screen ask for a
 *     formula's inputs (5d16178) removed the accident: an agent could charge
 *     a renewal for one month, with no renewal recorded and no papers to come.
 *   * The renewal flow took any revenue item it was given, so a vehicle's
 *     papers could be renewed for the price of a market levy.
 *
 * Both now use one definition of which items are vehicle renewals.
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
  startTestServer,
  stopTestServer,
} from './helpers';
import { queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';

let agent: { token: string; deviceId: string };
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
  await createGovernmentUser({ fullName: 'Renewal Admin', phone: '+2348000000395', role: 'admin' });
  const demo = await seedDemoAgent();
  assert.ok(demo);
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agent = { token: session.accessToken, deviceId: demo!.deviceIdentifier };

  const taxpayer = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Motor',
      lastName: 'Owner',
      phone: '+2347044555395',
      address: 'Kuru village square',
      lgaId: await firstLgaId(),
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...agent, idempotencyKey: 'renewal-taxpayer' },
  );
  assert.equal(taxpayer.status, 201, JSON.stringify(taxpayer.body));
  taxpayerId = taxpayer.body.taxpayerId as string;

  const vehicle = await post(
    '/vehicles',
    {
      taxpayerId,
      registrationNumber: 'JOS395RW',
      vehicleType: 'PRIVATE',
      make: 'Toyota',
      model: 'Corolla',
      colour: 'Blue',
      ownerName: 'Motor Owner',
    },
    { ...agent, idempotencyKey: 'renewal-vehicle' },
  );
  assert.ok(vehicle.status < 400, JSON.stringify(vehicle.body));
  vehicleId = vehicle.body.vehicleId as string;
});

const assessmentsFor = async () =>
  Number(
    (await queryOne<{ n: string }>(
      pool,
      'SELECT count(*)::text AS n FROM assessments WHERE taxpayer_id = $1',
      [taxpayerId],
    ))!.n,
  );

describe('a vehicle renewal outside the renewal flow', () => {
  it('is not offered on the collect screen', async () => {
    const listed = await get(`/revenue/items?taxpayerType=INDIVIDUAL&taxpayerId=${taxpayerId}`, agent);
    assert.equal(listed.status, 200, JSON.stringify(listed.body));
    const codes = (listed.body as { code: string }[]).map((item) => item.code);
    assert.ok(!codes.includes('VEH-RENEW-PRIVATE'), 'the collect screen offered a vehicle renewal');
    assert.ok(!codes.includes('VEH-RENEW-COMMERCIAL'));
  });

  it('is refused by the general charge route, and nothing is raised', async () => {
    const charged = await post(
      '/revenue/assessments',
      {
        taxpayerId,
        revenueItemId: await revenueItemByCode('VEH-RENEW-PRIVATE'),
        inputs: { renewalPeriodMonths: '1' },
      },
      { ...agent, idempotencyKey: 'renewal-the-wrong-way' },
    );
    assert.equal(charged.status, 409, JSON.stringify(charged.body));
    assert.equal(charged.body.error.code, 'RENEWED_FROM_THE_VEHICLE');
    assert.equal(await assessmentsFor(), 0, 'a renewal was charged with no renewal behind it');
  });
});

describe('the renewal flow, given something that is not a vehicle renewal', () => {
  it('refuses it, and records no renewal', async () => {
    const renewed = await post(
      `/vehicles/${vehicleId}/renew`,
      { revenueItemId: await revenueItemByCode('MARKET-LEVY'), renewalPeriodMonths: 12, taxpayerId },
      { ...agent, idempotencyKey: 'renewal-for-a-levy' },
    );
    assert.equal(renewed.status, 400, JSON.stringify(renewed.body));
    const renewals = await queryOne<{ n: string }>(
      pool,
      'SELECT count(*)::text AS n FROM vehicle_renewals WHERE vehicle_id = $1',
      [vehicleId],
    );
    assert.equal(renewals!.n, '0', 'papers would have been renewed for the price of a market levy');
  });

  it('still renews with a vehicle renewal item', async () => {
    // The control: the flow itself is untouched.
    const renewed = await post(
      `/vehicles/${vehicleId}/renew`,
      { revenueItemId: await revenueItemByCode('VEH-RENEW-PRIVATE'), renewalPeriodMonths: 12, taxpayerId },
      { ...agent, idempotencyKey: 'renewal-proper' },
    );
    assert.equal(renewed.status, 201, JSON.stringify(renewed.body));
  });
});
