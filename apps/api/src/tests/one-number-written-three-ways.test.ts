/**
 * A phone number is not a string, and every match in the platform treated it
 * as one.
 *
 * A Nigerian mobile number has three ordinary spellings, and they are the same
 * number:
 *
 *     08012345678       what a citizen reads off their own handset
 *     2348012345678     what a gateway or a registry hands back
 *     +2348012345678    what `phoneSchema` settles on, and what is stored
 *
 * Everything that WRITES a number through a form goes through that schema. Two
 * kinds of place then compared the stored value with a raw one:
 *
 *   1. Three doors that LOOK A PERSON UP — the public status page, the citizen
 *      OTP door, and the officer search — compared the string as typed.
 *      Observed against the database, on a taxpayer stored as registration
 *      stores them:
 *
 *          stored as:                           +2348012345678
 *          citizen types +2348012345678 -> hits 1
 *          citizen types 08012345678   -> hits 0
 *          citizen types 2348012345678 -> hits 0
 *
 *      The middle line is the one that matters. `08012345678` is the form the
 *      portal's own placeholder tells a citizen to use, and for most people it
 *      is the only form they know their own number in. It found nothing, and
 *      they were told PSIRS had no record of them — on the public page, and on
 *      the door that sends the one-time code, which is their only route to
 *      their full record.
 *
 *   2. The connection graph, which joins `taxpayers.phone` to
 *      `vehicles.owner_phone` with `=`. `owner_phone` never went through
 *      `phoneSchema`: it is whatever the vehicle authority returned, or
 *      whatever an agent typed into a free-text box. Four vehicles owned by
 *      one taxpayer stored as +2348031234567:
 *
 *          owner_phone      edge asserted
 *          +2348031234567   yes
 *          2348031234567    no
 *          08031234567      no
 *          0803 123 4567    no
 *
 *      `rebuildVehicleConnections` returned {fromPhone: 1, ambiguous: 0}. The
 *      three misses are silent both ways: no edge, and nothing in the
 *      ambiguous count, which exists precisely so that a number which never
 *      surfaces is a problem somebody knows they have. `liabilitiesFor` and
 *      `coverageLeads` read those edges, so a vehicle whose owner PSIRS
 *      already holds is an asset the State cannot see when it pursues them.
 *
 * WHY NOTHING CAUGHT IT. Every vehicle fixture in the suite — all six of them,
 * across two files — wrote `ownerPhone: '+234...'`. The tests spelled the
 * number the way the code needed rather than the way a registry does, so the
 * only spelling ever exercised was the one that worked.
 *
 * TWO FIXES, BECAUSE THERE ARE TWO PROBLEMS. A question asked at a door is
 * widened to every spelling (`phoneLookupForms`), because normalising only the
 * question leaves the reverse case: a row imported or seeded before
 * `phoneSchema` covered that path, stored as `0803...`, unreachable by
 * somebody typing `+234803...`. A column that is *joined against* is instead
 * narrowed on write (`canonicalPhoneOrRaw`, migration 081, and a CHECK), so
 * the join stays an equality between two columns that mean the same thing.
 *
 * The citizen cases are written against the HTTP doors rather than the query,
 * because the query is not what a citizen has.
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
} from './helpers';
import { seedReferenceData } from '../db/seed';
import { __rateLimitStore } from '../middleware/security';
import { rebuildVehicleConnections } from '../services/connections';
import { upsertVehicle } from '../services/vehicles';
import {
  canonicalPhoneOrRaw,
  normaliseNigerianPhone,
  phoneLookupForms,
} from '../lib/phone';
import { phoneSchema } from '../middleware/validate';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

/** The same number, written the three ways people write it. */
const SPELLINGS = ['+2348012345678', '08012345678', '2348012345678'] as const;

/** As registration stores it, and as a row predating that path might hold it. */
const CANONICAL = '+2348012345678';
const LEGACY = '08012345678';

let lgaId = '';
let officerToken = '';

async function taxpayerStoredAs(phone: string, lastName: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO taxpayers (taxpayer_type, phone, address, lga_id, first_name, last_name, status)
     VALUES ('INDIVIDUAL', $1, 'Jos', $2, 'Zainab', $3, 'ACTIVE') RETURNING id`,
    [phone, lgaId, lastName],
  );
  return rows[0]!.id;
}

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  (__rateLimitStore as { reset?: () => void }).reset?.();
  lgaId = await firstLgaId();
  await createGovernmentUser({
    fullName: 'Phone Search Officer',
    phone: '+2348095410001',
    role: 'admin',
  });
  officerToken = (await loginAs('+2348095410001')).accessToken;
});

describe('a citizen looking themselves up by the number on their own handset', () => {
  it('is found by every spelling of it, on the public status page', async () => {
    await taxpayerStoredAs(CANONICAL, 'Audu');

    for (const spelling of SPELLINGS) {
      const response = await get(`/citizen-status?phone=${encodeURIComponent(spelling)}`);
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.equal(
        response.body.found,
        true,
        `a citizen typing ${spelling} was told PSIRS has no record of them, ` +
          `and their record is stored as ${CANONICAL}`,
      );
    }
  });

  it('is found by every spelling when the record predates the canonical form', async () => {
    // The reverse direction, and the reason the fix widens the question
    // instead of narrowing it: a row can hold the local form too.
    await taxpayerStoredAs(LEGACY, 'Bello');

    for (const spelling of SPELLINGS) {
      const response = await get(`/citizen-status?phone=${encodeURIComponent(spelling)}`);
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.equal(
        response.body.found,
        true,
        `a record stored as ${LEGACY} was unreachable by someone typing ${spelling}`,
      );
    }
  });

  it('gets a code on the OTP door by every spelling', async () => {
    // The door that matters most: it is a citizen's only route to their full
    // record, and it answers "if a record matches, a code has been sent"
    // either way — so a miss here is invisible to the person it happened to.
    await taxpayerStoredAs(CANONICAL, 'Chollom');

    for (const spelling of SPELLINGS) {
      await pool.query('DELETE FROM otp_codes');
      const response = await post('/citizen-status/statement/request', { phone: spelling });
      assert.equal(response.status, 200, JSON.stringify(response.body));

      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM otp_codes
          WHERE destination = $1 AND purpose = 'CITIZEN_STATEMENT'`,
        [CANONICAL],
      );
      assert.equal(
        rows[0]!.count,
        '1',
        `no code was sent for ${spelling}; the citizen was told one had been`,
      );
    }
  });

  // --- control ---

  it('does not find somebody else by a number that is not theirs', async () => {
    await taxpayerStoredAs(CANONICAL, 'Dung');

    const response = await get('/citizen-status?phone=08019999999');
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.found, false, 'a different number matched a record');
  });
});

describe('an officer searching for a taxpayer by phone', () => {
  it('finds them by every spelling', async () => {
    await taxpayerStoredAs(CANONICAL, 'Gyang');

    for (const spelling of SPELLINGS) {
      const response = await get<Array<{ phone: string }>>(
        `/taxpayers/search?phone=${encodeURIComponent(spelling)}`,
        { token: officerToken },
      );
      assert.equal(response.status, 200, JSON.stringify(response.body).slice(0, 300));
      assert.equal(
        response.body.length,
        1,
        `an officer searching ${spelling} found nobody`,
      );
    }
  });

  it('still returns nobody for a number on no record', async () => {
    await taxpayerStoredAs(CANONICAL, 'Dashe');

    const response = await get<unknown[]>('/taxpayers/search?phone=08019999999', {
      token: officerToken,
    });
    assert.equal(response.status, 200, JSON.stringify(response.body).slice(0, 300));
    assert.equal(response.body.length, 0);
  });
});

describe('a vehicle whose owner is already on the register', () => {
  it('is connected to them however the registry spelled the number', async () => {
    const taxpayerId = await taxpayerStoredAs(CANONICAL, 'Pam');

    const captured = ['+2348012345678', '2348012345678', '08012345678', '0801 234 5678'];
    for (const [index, ownerPhone] of captured.entries()) {
      await upsertVehicle({
        input: {
          registrationNumber: `PL${100 + index}PHN`,
          vehicleType: 'PRIVATE',
          ownerName: 'Zainab Pam',
          ownerPhone,
        },
        actorId: null as unknown as string,
        actorRole: 'system',
      });
    }

    const result = await rebuildVehicleConnections(pool);
    assert.equal(
      result.fromPhone,
      captured.length,
      `${captured.length - result.fromPhone} of ${captured.length} vehicles owned by one ` +
        'taxpayer were left unconnected because of how the number was spelled',
    );

    const { rows } = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM taxpayer_connections
        WHERE taxpayer_id = $1 AND match_basis = 'SHARED_PHONE'`,
      [taxpayerId],
    );
    assert.equal(rows[0]!.count, String(captured.length));
  });

  it('stores the owner number in the one form the join can use', async () => {
    await upsertVehicle({
      input: {
        registrationNumber: 'PL999PHN',
        vehicleType: 'PRIVATE',
        ownerName: 'Zainab Pam',
        ownerPhone: '0801 234 5678',
      },
      actorId: null as unknown as string,
      actorRole: 'system',
    });

    const { rows } = await pool.query<{ owner_phone: string }>(
      `SELECT owner_phone FROM vehicles WHERE registration_number = 'PL999PHN'`,
    );
    assert.equal(rows[0]!.owner_phone, CANONICAL);
  });

  it('keeps a number it cannot parse rather than refusing the capture', async () => {
    // An owner may hold a number that is not Nigerian at all. Losing the
    // vehicle over the dialling code is the worse outcome of the two.
    await upsertVehicle({
      input: {
        registrationNumber: 'PL998PHN',
        vehicleType: 'PRIVATE',
        ownerName: 'Amara Eze',
        ownerPhone: '+441632960011',
      },
      actorId: null as unknown as string,
      actorRole: 'system',
    });

    const { rows } = await pool.query<{ owner_phone: string }>(
      `SELECT owner_phone FROM vehicles WHERE registration_number = 'PL998PHN'`,
    );
    assert.equal(rows[0]!.owner_phone, '+441632960011');
  });

  it('refuses a raw Nigerian number written straight into the column', async () => {
    // The service canonicalises; this is the same rule where a migration, a
    // repair script or a path written later can also reach the column.
    await assert.rejects(
      pool.query(
        `INSERT INTO vehicles (registration_number, owner_name, owner_phone, vehicle_type, source, status)
         VALUES ('PL997PHN', 'Zainab Pam', '08012345678', 'PRIVATE', 'MANUAL_ENTRY', 'ACTIVE')`,
      ),
      /vehicles_owner_phone_canonical/,
      'a raw local-format number was accepted into the column the connection graph joins on',
    );
  });
});

describe('the shape of a canonical number', () => {
  it('is the same one phoneSchema produces, whichever spelling it is given', () => {
    for (const spelling of SPELLINGS) {
      assert.equal(phoneSchema.parse(spelling), CANONICAL, spelling);
      assert.equal(normaliseNigerianPhone(spelling), CANONICAL, spelling);
      assert.equal(canonicalPhoneOrRaw(spelling), CANONICAL, spelling);
    }
  });

  it('always offers the caller their own string back, so nothing findable is lost', () => {
    // A number this platform cannot parse is still somebody's number, and a
    // row holding it has to stay reachable by typing it exactly.
    assert.deepEqual(phoneLookupForms('+441632960011'), ['+441632960011']);
    assert.ok(phoneLookupForms(LEGACY).includes(LEGACY));
    assert.ok(phoneLookupForms(CANONICAL).includes(CANONICAL));
    assert.equal(canonicalPhoneOrRaw('+441632960011'), '+441632960011');
  });

  it('offers all three spellings for a number it can parse', () => {
    assert.deepEqual(phoneLookupForms(LEGACY).sort(), [...SPELLINGS].sort());
  });
});
