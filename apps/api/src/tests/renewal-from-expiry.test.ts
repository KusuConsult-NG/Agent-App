/**
 * Renewing early must not throw away the time already paid for.
 *
 * `initiateRenewal` computes the new period as:
 *
 *     const periodStart = new Date();
 *     const expiryDate = new Date(periodStart);
 *     expiryDate.setMonth(expiryDate.getMonth() + params.renewalPeriodMonths);
 *
 * Always from today, whatever the vehicle's particulars currently say. So a
 * motorist who renews before their papers run out loses the remainder: renew
 * for twelve months a month before expiry and you are covered for thirteen
 * months from now, of which you have paid for twelve and been given eleven.
 *
 * The tell is in the query above it. `current_expiry_date` is selected from
 * `vehicles`, given a type in the row interface, and then never read. Somebody
 * meant to use it.
 *
 * This is the ordinary case rather than an edge one. Renewing before expiry is
 * what a careful owner does, and what the reminder messages this platform sends
 * are asking them to do — so the people who followed the advice are the people
 * who were short-changed. It also compounds: each early renewal starts from the
 * day it was made, so the loss accumulates over a vehicle's life.
 *
 * A renewal for a vehicle that has already lapsed, or that the platform has
 * never renewed, still starts today. There is nothing to carry forward, and
 * back-dating cover to a period the vehicle was driving uninsured would be a
 * worse answer than starting now.
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
  startTestServer,
  stopTestServer,
} from './helpers';
import { queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';

let agent: { token: string; device: string };
let lgaId = '';
let made = 0;

before(async () => {
  await startTestServer();
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({
    role: 'admin',
    phone: '+2348030000170',
    fullName: 'Renewal Admin',
  });
  const demo = await seedDemoAgent();
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agent = { token: session.accessToken, device: demo!.deviceIdentifier };
  lgaId = await firstLgaId();
});

after(async () => {
  await stopTestServer();
});

/** A vehicle whose particulars expire on `currentExpiry`, or have never been renewed. */
async function vehicleExpiring(currentExpiry: Date | null): Promise<{ vehicleId: string; taxpayerId: string }> {
  const suffix = String(++made);
  const auth = { token: agent.token, deviceId: agent.device };

  const taxpayer = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Renewal',
      lastName: `Owner${suffix}`,
      phone: `+23480444${suffix.padStart(5, '0')}`,
      address: 'Kuru village square',
      lgaId,
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...auth, idempotencyKey: `rx-tp-${suffix}` },
  );
  assert.equal(taxpayer.status, 201, JSON.stringify(taxpayer.body));

  const vehicle = await post(
    '/vehicles',
    {
      taxpayerId: taxpayer.body.taxpayerId,
      registrationNumber: `RX${suffix.padStart(3, '0')}ABC`,
      vehicleType: 'PRIVATE',
      make: 'Toyota',
      model: 'Hilux',
      colour: 'White',
      ownerName: `Renewal Owner${suffix}`,
    },
    { ...auth, idempotencyKey: `rx-veh-${suffix}` },
  );
  assert.ok(vehicle.status < 400, JSON.stringify(vehicle.body));

  if (currentExpiry) {
    await pool.query('UPDATE vehicles SET current_expiry_date = $2 WHERE id = $1', [
      vehicle.body.vehicleId,
      currentExpiry,
    ]);
  }

  return { vehicleId: vehicle.body.vehicleId, taxpayerId: taxpayer.body.taxpayerId };
}

async function renew(vehicleId: string, taxpayerId: string, months: 6 | 12 | 24) {
  const suffix = String(made);
  return post(
    `/vehicles/${vehicleId}/renew`,
    {
      revenueItemId: await revenueItemByCode('VEH-RENEW-PRIVATE'),
      renewalPeriodMonths: months,
      taxpayerId,
    },
    { token: agent.token, deviceId: agent.device, idempotencyKey: `rx-rnw-${suffix}-${months}` },
  );
}

const expiryOf = async (vehicleId: string) =>
  (await queryOne<{ expiry_date: Date; period_start: Date }>(
    pool,
    `SELECT expiry_date, period_start FROM vehicle_renewals
      WHERE vehicle_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [vehicleId],
  ))!;

/** Whole days between two dates, ignoring the time of day. */
function daysBetween(a: Date, b: Date): number {
  const day = 86_400_000;
  const floor = (d: Date) => Math.floor(new Date(d).setHours(12, 0, 0, 0) / day);
  return floor(b) - floor(a);
}

describe('an early renewal carries the unexpired time forward', () => {
  it('starts the new period at the old expiry, not today', async () => {
    const inThirtyDays = new Date();
    inThirtyDays.setDate(inThirtyDays.getDate() + 30);

    const { vehicleId, taxpayerId } = await vehicleExpiring(inThirtyDays);
    const response = await renew(vehicleId, taxpayerId, 12);
    assert.equal(response.status, 201, JSON.stringify(response.body));

    const row = await expiryOf(vehicleId);

    assert.equal(
      daysBetween(inThirtyDays, row.period_start),
      0,
      'the new period should begin where the old one ended',
    );

    const expected = new Date(inThirtyDays);
    expected.setMonth(expected.getMonth() + 12);
    assert.equal(
      daysBetween(expected, row.expiry_date),
      0,
      'twelve months paid for should be twelve months added to the existing cover',
    );
  });

  it('gives the same cover whether the owner renews early or late', async () => {
    // The point of the whole thing: renewing a month early must not cost a
    // month. Both vehicles pay for twelve.
    const soon = new Date();
    soon.setDate(soon.getDate() + 30);

    const early = await vehicleExpiring(soon);
    await renew(early.vehicleId, early.taxpayerId, 12);
    const earlyRow = await expiryOf(early.vehicleId);

    const lapsed = await vehicleExpiring(null);
    await renew(lapsed.vehicleId, lapsed.taxpayerId, 12);
    const lapsedRow = await expiryOf(lapsed.vehicleId);

    assert.equal(
      daysBetween(lapsedRow.expiry_date, earlyRow.expiry_date),
      30,
      'the early renewer should be covered exactly their remaining 30 days longer',
    );
  });

  it('starts today when the particulars have already lapsed', async () => {
    const lastMonth = new Date();
    lastMonth.setDate(lastMonth.getDate() - 30);

    const { vehicleId, taxpayerId } = await vehicleExpiring(lastMonth);
    await renew(vehicleId, taxpayerId, 6);
    const row = await expiryOf(vehicleId);

    assert.equal(
      daysBetween(new Date(), row.period_start),
      0,
      'a lapsed vehicle is covered from today — cover is not back-dated over a period it was unlicensed',
    );

    const expected = new Date();
    expected.setMonth(expected.getMonth() + 6);
    assert.equal(daysBetween(expected, row.expiry_date), 0);
  });

  it('starts today for a vehicle this platform has never renewed', async () => {
    const { vehicleId, taxpayerId } = await vehicleExpiring(null);
    await renew(vehicleId, taxpayerId, 24);
    const row = await expiryOf(vehicleId);

    assert.equal(daysBetween(new Date(), row.period_start), 0);
    const expected = new Date();
    expected.setMonth(expected.getMonth() + 24);
    assert.equal(daysBetween(expected, row.expiry_date), 0);
  });
});
