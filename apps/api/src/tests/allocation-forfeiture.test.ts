/**
 * A finite store, and the share nobody can release.
 *
 * FORFEITED is a real status on `incentive_awards`. `recordCollection` refuses
 * to hand goods over against one. The database trigger that stops a round being
 * over-committed excludes it from the running total, so a forfeited share
 * returns to the pool. Both summary queries filter on it. The awards route
 * offers it as a filter an officer can select.
 *
 * Five places account for it. Nothing produces it.
 *
 * So a farmer who is awarded two bags and never comes for them holds those two
 * bags out of the round permanently. The store shows fewer bags than it
 * physically contains, `beneficiariesRemaining` counts them as gone, and there
 * is no way to give them to the next farmer in the queue. For a season input
 * with a planting window that is the whole purpose of running a round.
 *
 * Two smaller things in the same path:
 *
 *   `createRound` selects the programme's `status` and `benefit_type` and reads
 *   neither. A round can be set up against a DRAFT or CLOSED programme, opened,
 *   and staffed — and every award at the collection point is then refused,
 *   because eligibility checks the programme status even though creation did
 *   not.
 *
 *   `recordCollection` upper-cases the code it is given and compares it
 *   verbatim. Codes are generated with a separator (AB3CD-EF9GH), so a code
 *   typed without one is reported as no such code. `normaliseVerificationCode`
 *   exists for exactly this and is used everywhere else a code is matched.
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

describe('A share that was never collected can be released', () => {
  it('returns the quantity to the round so the next farmer can have it', async () => {
    const roundId = await openRound(await programme(), 2, 2); // exactly one beneficiary
    const first = await award(roundId, await beneficiary('Ladi'));
    assert.equal(first.status, 201, JSON.stringify(first.body));

    const secondTaxpayer = await beneficiary('Danladi');
    const blocked = await award(roundId, secondTaxpayer);
    assert.equal(blocked.status, 409, 'the round is full while the first award stands');

    const forfeited = await post(
      `/allocations/awards/${first.body.awardId}/forfeit`,
      { reason: 'Did not come to the store before the round closed.' },
      { token: officer },
    );
    assert.equal(forfeited.status, 200, JSON.stringify(forfeited.body));

    const second = await award(roundId, secondTaxpayer);
    assert.equal(
      second.status,
      201,
      `the released bags must be awardable again: ${JSON.stringify(second.body)}`,
    );
  });

  it('will not forfeit without saying why', async () => {
    const roundId = await openRound(await programme(), 10, 2);
    const first = await award(roundId, await beneficiary('Ladi'));

    const attempt = await post(
      `/allocations/awards/${first.body.awardId}/forfeit`,
      {},
      { token: officer },
    );
    assert.equal(attempt.status, 422, JSON.stringify(attempt.body));
  });

  it('refuses to hand over goods against a forfeited award', async () => {
    const roundId = await openRound(await programme(), 10, 2);
    const first = await award(roundId, await beneficiary('Ladi'));
    await post(
      `/allocations/awards/${first.body.awardId}/forfeit`,
      { reason: 'Beneficiary moved out of the LGA.' },
      { token: officer },
    );

    const collected = await post(
      '/allocations/collections',
      { collectionCode: first.body.collectionCode },
      { token: officer },
    );
    assert.equal(collected.status, 409, JSON.stringify(collected.body));
    assert.equal(collected.body.error.code, 'AWARD_FORFEITED');
  });

  it('will not forfeit goods that have already left the store', async () => {
    const roundId = await openRound(await programme(), 10, 2);
    const first = await award(roundId, await beneficiary('Ladi'));
    await post(
      '/allocations/collections',
      { collectionCode: first.body.collectionCode },
      { token: officer },
    );

    const attempt = await post(
      `/allocations/awards/${first.body.awardId}/forfeit`,
      { reason: 'Changed my mind.' },
      { token: officer },
    );
    // Specifically refused, not merely unavailable: a 404 from a route that
    // does not exist would satisfy "not 200" while proving nothing.
    assert.equal(attempt.status, 409, `the bags are gone: ${JSON.stringify(attempt.body)}`);
    assert.equal(attempt.body.error.code, 'ALREADY_COLLECTED');
  });
});

describe('A round is set up against a programme that can actually run', () => {
  it('refuses a round on a programme that is not active', async () => {
    const draft = await programme('DRAFT');

    const created = await post(
      '/allocations/rounds',
      {
        programmeId: draft,
        name: '2026 wet season',
        unit: 'BAG_50KG',
        totalQuantity: 100,
        quantityPerBeneficiary: 2,
        opensAt: new Date().toISOString(),
      },
      { token: officer },
    );

    assert.notEqual(
      created.status,
      201,
      `a round was set up against a draft programme, and every award from it will be refused: ${JSON.stringify(created.body)}`,
    );
  });
});

describe('The code a farmer presents is read the way they wrote it', () => {
  it('accepts a collection code typed without its separator', async () => {
    const roundId = await openRound(await programme(), 10, 2);
    const first = await award(roundId, await beneficiary('Ladi'));
    const typed = String(first.body.collectionCode).replace(/-/g, '').toLowerCase();

    const collected = await post(
      '/allocations/collections',
      { collectionCode: typed },
      { token: officer },
    );

    assert.equal(
      collected.status,
      200,
      `"${typed}" is the same code: ${JSON.stringify(collected.body)}`,
    );
  });

  // --- controls ---

  it('still hands over the bags against the code as issued', async () => {
    const roundId = await openRound(await programme(), 10, 2);
    const first = await award(roundId, await beneficiary('Ladi'));

    const collected = await post(
      '/allocations/collections',
      { collectionCode: first.body.collectionCode },
      { token: officer },
    );
    assert.equal(collected.status, 200, JSON.stringify(collected.body));
    assert.match(collected.body.message, /collected 2/i);

    const again = await post(
      '/allocations/collections',
      { collectionCode: first.body.collectionCode },
      { token: officer },
    );
    assert.equal(again.status, 409, 'and only once');
  });

  it('still refuses to promise more bags than the round holds', async () => {
    const roundId = await openRound(await programme(), 2, 2);
    await award(roundId, await beneficiary('Ladi'));

    const blocked = await award(roundId, await beneficiary('Danladi'));
    assert.equal(blocked.status, 409, JSON.stringify(blocked.body));

    const summary = await get(`/allocations/rounds/${roundId}`, { token: officer });
    assert.equal(summary.body.remainingQuantity, '0.00', JSON.stringify(summary.body));
  });
});
