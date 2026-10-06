/**
 * What an agent learns about a person by looking up their number plate.
 *
 * Every agent in the State can look up any plate (`vehicle:read:all`). The
 * lookup joined the owner's taxpayer record. Measured: an agent's lookup
 * returned the owner's TIN, their phone twice over (the taxpayer's and the
 * vehicle's) and their names. It wrote nothing to
 * `taxpayer_record_access_logs`, which records every other route to a named
 * person's details.
 *
 * The field app shows none of those fields. It shows the plate, the name on
 * the vehicle record, make and model, chassis and expiry. The lookup now
 * answers with the vehicle and leaves the person out, including the phone the
 * vehicle authority sends back.
 */

import './env';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
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
} from './helpers';
import { queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';
import { vehicleRegistry } from '../integrations/vehicles';

const OWNER_PHONE = '+2347044555401';
const AUTHORITY_PHONE = '+2347044555402';

let agent: { token: string; deviceId: string };
let taxpayerId = '';
let tin = '';
const originalLookup = vehicleRegistry.lookup.bind(vehicleRegistry);

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});
afterEach(() => {
  vehicleRegistry.lookup = originalLookup;
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({ fullName: 'Lookup Admin', phone: '+2348000000399', role: 'admin' });
  const demo = await seedDemoAgent();
  assert.ok(demo);
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agent = { token: session.accessToken, deviceId: demo!.deviceIdentifier };

  const taxpayer = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Plate',
      lastName: 'Owner',
      phone: OWNER_PHONE,
      address: 'Kuru village square',
      lgaId: await firstLgaId(),
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...agent, idempotencyKey: 'lookup-taxpayer' },
  );
  assert.equal(taxpayer.status, 201, JSON.stringify(taxpayer.body));
  taxpayerId = taxpayer.body.taxpayerId as string;
  tin = (await queryOne<{ tin: string }>(pool, 'SELECT tin FROM taxpayers WHERE id = $1', [
    taxpayerId,
  ]))!.tin;
  assert.ok(tin, 'the taxpayer has a TIN to leak');
});

const digits = (phone: string) => phone.replace(/^\+234/, '');

describe('a plate lookup', () => {
  it("answers with the vehicle and not its owner's TIN, phone or names", async () => {
    const captured = await post(
      '/vehicles',
      {
        taxpayerId,
        registrationNumber: 'JOS401RW',
        vehicleType: 'PRIVATE',
        ownerName: 'Plate Owner',
        ownerPhone: OWNER_PHONE,
      },
      { ...agent, idempotencyKey: 'lookup-vehicle' },
    );
    assert.equal(captured.status, 201, JSON.stringify(captured.body));

    const res = await get('/vehicles/lookup/JOS401RW', agent);
    assert.equal(res.status, 200);
    assert.equal(res.body.source, 'PLATFORM');
    const vehicle = res.body.vehicle as Record<string, unknown>;

    for (const field of ['tin', 'taxpayer_phone', 'owner_phone', 'first_name', 'last_name', 'business_name']) {
      assert.equal(field in vehicle, false, `${field} was sent`);
    }
    const serialised = JSON.stringify(res.body);
    assert.equal(serialised.includes(tin), false, 'the TIN is in the answer');
    assert.equal(serialised.includes(digits(OWNER_PHONE)), false, 'the phone is in the answer');

    // What the field app shows is all still there.
    assert.equal(vehicle.id, captured.body.vehicleId);
    assert.equal(vehicle.registration_number, 'JOS401RW');
    assert.ok(vehicle.owner_name);
    for (const field of ['make', 'model', 'chassis_number', 'current_expiry_date', 'colour']) {
      assert.equal(field in vehicle, true, `${field} is missing`);
    }
  });

  it("leaves out the phone the vehicle authority sends back", async () => {
    vehicleRegistry.lookup = async (registrationNumber: string) => {
      const answer = await originalLookup(registrationNumber);
      return answer.vehicle
        ? { ...answer, vehicle: { ...answer.vehicle, ownerPhone: AUTHORITY_PHONE } }
        : answer;
    };

    const res = await get('/vehicles/lookup/JOS402RW', agent);
    assert.equal(res.status, 200);
    assert.equal(res.body.source, 'AUTHORITY');
    assert.equal('ownerPhone' in res.body.vehicle, false);
    assert.equal(JSON.stringify(res.body).includes(digits(AUTHORITY_PHONE)), false);
    assert.ok(res.body.vehicle.ownerName, 'the name the app shows is still there');
    assert.ok(res.body.vehicle.chassisNumber);
  });

  it("still records the authority's phone when the vehicle is captured from it", async () => {
    vehicleRegistry.lookup = async (registrationNumber: string) => {
      const answer = await originalLookup(registrationNumber);
      return answer.vehicle
        ? { ...answer, vehicle: { ...answer.vehicle, ownerPhone: AUTHORITY_PHONE } }
        : answer;
    };

    // What the field app sends after a lookup: no phone of its own.
    const captured = await post(
      '/vehicles',
      { taxpayerId, registrationNumber: 'JOS403RW', vehicleType: 'PRIVATE', ownerName: 'Registered Owner' },
      { ...agent, idempotencyKey: 'lookup-authority-capture' },
    );
    assert.equal(captured.status, 201, JSON.stringify(captured.body));
    const row = await queryOne<{ owner_phone: string | null }>(
      pool,
      'SELECT owner_phone FROM vehicles WHERE registration_number = $1',
      ['JOS403RW'],
    );
    assert.equal(row!.owner_phone, AUTHORITY_PHONE);
  });
});
