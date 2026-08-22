/**
 * One list of economic sectors, and programmes that can aim at one.
 *
 * `GET /taxpayers/sectors` serves ECONOMIC_SECTORS from the shared package —
 * thirty entries with Hausa labels, feeding the registration dropdown in the
 * agent PWA. The CHECK constraint written in migration 016 allowed
 * twenty-seven, and the two had drifted: SELF_EMPLOYED, PRIVATE_EMPLOYEE,
 * TRANSPORT_HAULAGE and TRANSPORT_PASSENGER were offered to agents and refused
 * by the database, while TRANSPORT_LOGISTICS survived in the constraint after
 * being split into the two transport codes and could no longer be chosen.
 *
 * An agent registering a self-employed trader picked a valid option from the
 * dropdown and hit a constraint violation. That is most of the informal
 * sector, and exactly the population the compliance-to-incentive pipeline
 * exists to reach.
 *
 * The first test compares the two lists directly, because this is the second
 * time a vocabulary drift has quietly disabled something here — the essential
 * services guard matched HEALTHCARE while the programmes were typed
 * HEALTH_INSURANCE, and protected nobody until someone noticed.
 *
 * The rest cover sector targeting: a programme could be aimed at an LGA and at
 * a taxpayer type but not at what somebody does for a living, so "fertiliser
 * subsidy for compliant farmers" could not be expressed at all.
 */

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
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { query, queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { ECONOMIC_SECTORS } from '@psirs/shared';

let adminToken = '';

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
    role: 'admin',
    phone: '+2348030000101',
    fullName: 'Sector Admin',
  });
  adminToken = (await loginAs('+2348030000101')).accessToken;
});

/** Sector codes the database will actually accept, read from the constraint. */
async function sectorsTheDatabaseAllows(): Promise<string[]> {
  const row = await queryOne<{ def: string }>(
    pool,
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conname = 'taxpayers_economic_sector_check'`,
  );
  assert.ok(row, 'the sector constraint should exist');
  return [...row!.def.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
}

describe('the economic sector vocabulary', () => {
  it('is the same list in the API and in the database', async () => {
    const offered = ECONOMIC_SECTORS.map((s) => s.code).sort();
    const accepted = (await sectorsTheDatabaseAllows()).sort();

    const offeredNotAccepted = offered.filter((c) => !accepted.includes(c));
    const acceptedNotOffered = accepted.filter((c) => !offered.includes(c));

    assert.deepEqual(
      offeredNotAccepted,
      [],
      'these sectors are offered to agents but the database will refuse them',
    );
    assert.deepEqual(
      acceptedNotOffered,
      [],
      'these sectors are stored but nothing can choose them',
    );
  });

  it('accepts every sector it offers, on a real registration', async () => {
    const lgaId = await firstLgaId();
    const offered = ECONOMIC_SECTORS.map((s) => s.code);

    for (const [index, sector] of offered.entries()) {
      const inserted = await query(
        pool,
        `INSERT INTO taxpayers (taxpayer_type, first_name, last_name, phone, address, lga_id,
                                consent_given, declaration_accepted, economic_sector)
         VALUES ('INDIVIDUAL','Sector','Probe',$1,'1 Road',$2,true,true,$3)
         RETURNING id`,
        [`+23480${String(900000 + index)}`, lgaId, sector],
      );
      assert.equal(inserted.length, 1, `${sector} was refused by the database`);
    }
  });

  it('serves the sectors to the registration screen', async () => {
    const response = await get('/taxpayers/sectors', { token: adminToken });
    assert.equal(response.status, 200, JSON.stringify(response.body).slice(0, 200));
    const sectors = response.body.sectors ?? response.body;
    assert.equal(sectors.length, ECONOMIC_SECTORS.length);
  });
});

describe('a programme aimed at one sector', () => {
  async function farmerProgramme(targetSectors?: string[]) {
    const response = await post(
      '/government/programmes',
      {
        name: 'Fertiliser and Input Support',
        code: `FIS-${Date.now().toString().slice(-6)}`,
        benefitType: 'AGRICULTURAL_SUBSIDY',
        benefitDescription: 'Subsidised fertiliser and farm inputs for compliant farmers.',
        ...(targetSectors ? { targetSectors } : {}),
        minimumScore: 50,
        startDate: '2026-01-01',
        approvalAuthority: 'Plateau State Ministry of Agriculture',
      },
      { token: adminToken },
    );
    assert.equal(response.status, 201, JSON.stringify(response.body));
    const id = response.body.programmeId ?? response.body.id;
    await post(`/government/programmes/${id}/status`, { status: 'ACTIVE' }, { token: adminToken });
    return id;
  }

  async function taxpayerIn(sector: string | null, phone: string) {
    const row = await queryOne<{ id: string }>(
      pool,
      `INSERT INTO taxpayers (taxpayer_type, first_name, last_name, phone, address, lga_id,
                              consent_given, declaration_accepted, economic_sector, tin)
       VALUES ('INDIVIDUAL','Sector','Subject',$1,'1 Road',$2,true,true,$3,$4)
       RETURNING id`,
      [phone, await firstLgaId(), sector, `TIN${phone.slice(-8)}`],
    );
    return row!.id;
  }

  const evaluate = (programmeId: string, taxpayerId: string) =>
    post(`/government/programmes/${programmeId}/evaluate`, { taxpayerId }, { token: adminToken });

  it('is in scope for a farmer', async () => {
    const programmeId = await farmerProgramme(['AGRICULTURE', 'LIVESTOCK']);
    const farmer = await taxpayerIn('AGRICULTURE', '+2348091110001');

    const response = await evaluate(programmeId, farmer);

    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.ok(
      response.body.reasons.some((r: string) => /AGRICULTURE is within scope/.test(r)),
      `expected a sector reason, got ${JSON.stringify(response.body.reasons)}`,
    );
  });

  it('is out of scope for a hairdresser', async () => {
    const programmeId = await farmerProgramme(['AGRICULTURE', 'LIVESTOCK']);
    const artisan = await taxpayerIn('ARTISAN_CRAFT', '+2348091110002');

    const response = await evaluate(programmeId, artisan);

    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.eligible, false);
    assert.ok(
      response.body.reasons.some((r: string) => /not artisan_craft/i.test(r)),
      `expected a sector refusal, got ${JSON.stringify(response.body.reasons)}`,
    );
  });

  it('will not guess at a taxpayer whose trade was never recorded', async () => {
    const programmeId = await farmerProgramme(['AGRICULTURE']);
    const unknown = await taxpayerIn(null, '+2348091110003');

    const response = await evaluate(programmeId, unknown);

    assert.equal(response.body.eligible, false);
    assert.ok(
      response.body.reasons.some((r: string) => /No economic sector recorded/i.test(r)),
      `expected a missing-sector reason, got ${JSON.stringify(response.body.reasons)}`,
    );
  });

  it('leaves an untargeted programme open to every sector', async () => {
    const programmeId = await farmerProgramme();
    const artisan = await taxpayerIn('ARTISAN_CRAFT', '+2348091110004');

    const response = await evaluate(programmeId, artisan);

    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.ok(
      !response.body.reasons.some((r: string) => /sector/i.test(r)),
      `an untargeted programme should say nothing about sector: ${JSON.stringify(response.body.reasons)}`,
    );
  });
});
