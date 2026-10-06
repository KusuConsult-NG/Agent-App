/**
 * A vehicle captured a second time, naming somebody else as its owner.
 *
 * Capturing a plate that is already on the platform is a merge: the second
 * sighting fills in what the record lacks (see the capture race test). It
 * also replaced the owner. `COALESCE($2, taxpayer_id)` put whichever taxpayer
 * the latest capture named onto the vehicle.
 *
 * Measured before the change: a plate captured for one taxpayer was captured
 * again naming another (201). The vehicle moved to the second taxpayer, with
 * no audit row for the move. A renewal paid by the second taxpayer was then
 * accepted (201). The renewal's owner check, VEHICLE_OWNER_MISMATCH, compares
 * against the record, and the capture had just rewritten the record.
 *
 * A capture can still name the owner of a vehicle that has none. It cannot
 * name a different one.
 */

import './env';
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
  startTestServer,
  stopTestServer,
} from './helpers';
import { queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';

const PLATE = 'JOS397RW';

let agent: { token: string; deviceId: string };
let owner = '';
let other = '';
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
  await createGovernmentUser({ fullName: 'Vehicle Admin', phone: '+2348000000397', role: 'admin' });
  const demo = await seedDemoAgent();
  assert.ok(demo);
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agent = { token: session.accessToken, deviceId: demo!.deviceIdentifier };

  owner = await registerTaxpayer('Real', '+2347044555398');
  other = await registerTaxpayer('Other', '+2347044555399');
});

async function registerTaxpayer(firstName: string, phone: string): Promise<string> {
  const res = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName,
      lastName: 'Motorist',
      phone,
      address: 'Kuru village square',
      lgaId: await firstLgaId(),
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...agent, idempotencyKey: `taxpayer-${phone}` },
  );
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.taxpayerId as string;
}

const capture = (taxpayerId: string | undefined, ownerName = 'Real Motorist') =>
  post(
    '/vehicles',
    {
      ...(taxpayerId ? { taxpayerId } : {}),
      registrationNumber: PLATE,
      vehicleType: 'PRIVATE',
      make: 'Toyota',
      model: 'Corolla',
      colour: 'Blue',
      ownerName,
    },
    { ...agent, idempotencyKey: `capture-${++sequence}` },
  );

const ownerOnRecord = async () =>
  (await queryOne<{ taxpayer_id: string | null }>(
    pool,
    'SELECT taxpayer_id FROM vehicles WHERE registration_number = $1',
    [PLATE],
  ))!.taxpayer_id;

const renewFor = async (vehicleId: string, taxpayerId: string) =>
  post(
    `/vehicles/${vehicleId}/renew`,
    {
      revenueItemId: await revenueItemByCode('VEH-RENEW-PRIVATE'),
      renewalPeriodMonths: 12,
      taxpayerId,
    },
    { ...agent, idempotencyKey: `renew-${++sequence}` },
  );

describe('a plate captured again', () => {
  it('cannot name a different owner', async () => {
    const first = await capture(owner);
    assert.equal(first.status, 201, JSON.stringify(first.body));

    const second = await capture(other, 'Other Motorist');
    assert.equal(second.status, 409, JSON.stringify(second.body));
    assert.equal(second.body.error.code, 'VEHICLE_OWNER_MISMATCH');
    assert.equal(await ownerOnRecord(), owner);
  });

  it('leaves the renewal owner check holding for the other taxpayer', async () => {
    const first = await capture(owner);
    await capture(other, 'Other Motorist');

    const renewal = await renewFor(first.body.vehicleId, other);
    assert.equal(renewal.status, 409, JSON.stringify(renewal.body));
    assert.equal(renewal.body.error.code, 'VEHICLE_OWNER_MISMATCH');

    // The control: the owner on record still renews.
    const own = await renewFor(first.body.vehicleId, owner);
    assert.equal(own.status, 201, JSON.stringify(own.body));
  });

  it('still merges a capture naming the same owner', async () => {
    const first = await capture(owner);
    const second = await capture(owner);
    assert.equal(second.status, 201, JSON.stringify(second.body));
    assert.equal(second.body.vehicleId, first.body.vehicleId);
    assert.equal(await ownerOnRecord(), owner);
  });

  it('still merges a capture naming nobody, and keeps the owner', async () => {
    await capture(owner);
    const second = await capture(undefined);
    assert.equal(second.status, 201, JSON.stringify(second.body));
    assert.equal(await ownerOnRecord(), owner);
  });

  it('can name the owner of a vehicle that had none', async () => {
    const first = await capture(undefined);
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(await ownerOnRecord(), null);

    const second = await capture(owner);
    assert.equal(second.status, 201, JSON.stringify(second.body));
    assert.equal(await ownerOnRecord(), owner);
  });
});
