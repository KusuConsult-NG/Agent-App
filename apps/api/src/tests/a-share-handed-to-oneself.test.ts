/**
 * A share of public goods, awarded and collected by the same officer.
 *
 * An award hands its collection code to the officer who made it — the
 * response says "Give the beneficiary this code" — and officers may record
 * collections too, because `requireActiveAgent` waves officers through. So one
 * officer could award a share to any eligible taxpayer and mark it collected
 * with the code they had just been given; the store's books would show goods
 * reaching a farmer who never came. Measured through the routes: an
 * administrator awarded Ladi Farmer two bags and recorded them collected, 201
 * then 200, with awarded_by and collected_by the same person.
 *
 * Whoever awarded a share now cannot record it collected. The store agent, or
 * any other officer, can.
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
import { queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';

let officer = '';
/*
 * The store's side of the handover. Whoever awarded a share does not also
 * record it collected (`a-share-handed-to-oneself`), so collections in this
 * file are recorded by a second officer.
 */
let storekeeper = '';
let lgaId = '';
let counter = 0;

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  lgaId = await firstLgaId();
  await createGovernmentUser({ fullName: 'Store Officer', phone: '+2348000000080', role: 'admin' });
  officer = (await loginAs('+2348000000080')).accessToken;
  await createGovernmentUser({ fullName: 'Store Keeper', phone: '+2348000000081', role: 'admin' });
  storekeeper = (await loginAs('+2348000000081')).accessToken;
  counter = 0;
});

/** A taxpayer with a TIN, which is all this programme's eligibility asks for. */
async function beneficiary(name: string): Promise<string> {
  counter += 1;
  const row = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO taxpayers (taxpayer_type, first_name, last_name, phone, address, lga_id,
                            consent_given, declaration_accepted, tin, tin_status, status)
     VALUES ('INDIVIDUAL',$1,'Farmer',$2,'Bokkos',$3,true,true,$4,'ASSIGNED','ACTIVE')
     RETURNING id`,
    [name, `+23480777${String(counter).padStart(5, '0')}`, lgaId, `PL7770${String(counter).padStart(4, '0')}`],
  );
  return row!.id;
}

/** A programme whose only requirement is a TIN, so the tests are about bags. */
async function programme(status: 'ACTIVE' | 'DRAFT' = 'ACTIVE'): Promise<string> {
  counter += 1;
  const created = await post(
    '/government/programmes',
    {
      name: 'Wet Season Fertiliser Support',
      code: `WSF-${counter}-${Date.now().toString().slice(-5)}`,
      benefitType: 'AGRICULTURAL_SUBSIDY',
      benefitDescription: 'Subsidised fertiliser.',
      minimumScore: 0,
      requiresNoArrears: false,
      startDate: '2026-01-01',
      approvalAuthority: 'Plateau State Ministry of Agriculture',
    },
    { token: officer },
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.programmeId ?? created.body.id;
  if (status === 'ACTIVE') {
    await post(`/government/programmes/${id}/status`, { status: 'ACTIVE' }, { token: officer });
  }
  return id;
}

async function openRound(programmeId: string, total: number, per: number): Promise<string> {
  const created = await post(
    '/allocations/rounds',
    {
      programmeId,
      name: '2026 wet season',
      unit: 'BAG_50KG',
      totalQuantity: total,
      quantityPerBeneficiary: per,
      collectionPoint: 'Bokkos LGA agricultural store',
      opensAt: new Date(Date.now() - 3_600_000).toISOString(),
    },
    { token: officer },
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  await post(
    `/allocations/rounds/${created.body.roundId}/status`,
    { status: 'OPEN' },
    { token: officer },
  );
  return created.body.roundId as string;
}

const award = (roundId: string, taxpayerId: string) =>
  post(`/allocations/rounds/${roundId}/awards`, { taxpayerId }, { token: officer });


describe('the officer who awarded a share', () => {
  it('cannot record it as collected, and the share stays waiting for its owner', async () => {
    const roundId = await openRound(await programme(), 10, 2);
    const awarded = await award(roundId, await beneficiary('Ladi'));
    assert.equal(awarded.status, 201, JSON.stringify(awarded.body));

    const collected = await post(
      '/allocations/collections',
      { collectionCode: awarded.body.collectionCode },
      { token: officer },
    );
    assert.equal(collected.status, 403, JSON.stringify(collected.body));
    assert.match(collected.body.error.message, /You awarded this share/);

    const row = await queryOne<{ status: string; collected_by: string | null }>(
      pool,
      'SELECT status, collected_by FROM incentive_awards WHERE id = $1',
      [awarded.body.awardId],
    );
    assert.deepEqual(row, { status: 'AWARDED', collected_by: null });
  });
});

describe('somebody else at the store', () => {
  it('records the handover', async () => {
    const roundId = await openRound(await programme(), 10, 2);
    const awarded = await award(roundId, await beneficiary('Ladi'));

    const collected = await post(
      '/allocations/collections',
      { collectionCode: awarded.body.collectionCode },
      { token: storekeeper },
    );
    assert.equal(collected.status, 200, JSON.stringify(collected.body));

    const row = await queryOne<{ awarded_by: string; collected_by: string }>(
      pool,
      'SELECT awarded_by, collected_by FROM incentive_awards WHERE id = $1',
      [awarded.body.awardId],
    );
    assert.notEqual(row!.collected_by, row!.awarded_by, 'two people stand behind the handover');
  });
});
