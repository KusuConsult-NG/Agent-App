/**
 * What is left in an allocation round, and the arithmetic that cannot say it.
 *
 * Allocation quantities are `NUMERIC(14,2)` — litres of herbicide, bags of
 * fertiliser, a share handed to one farmer. They are the only fractional
 * figure this platform does arithmetic on; everything else is kobo and never
 * leaves integers.
 *
 * `getRound` met this and fixed it, counting in whole hundredths, with the
 * measurement written beside it: 12,231 disagreements against the integer
 * answer over every two-decimal combination a round plausibly holds, every
 * one of them reporting FEWER beneficiaries than the goods can serve. "It
 * never over-promises. It turns people away, which is the direction nobody
 * checks, because a queue that ends early looks like a queue that is
 * finished."
 *
 * The rounds LIST did it in the browser. `listRounds` returned the total and
 * the awarded total, and the screen printed
 * `String(Number(total) - Number(awarded))` — so a round with a tenth of a
 * litre left printed "0.09999999999999998 left" into the column an officer
 * closes a round on, and the beneficiaries figure derived the same way said
 * nobody could be served while a share remained.
 *
 * WHY THE FIGURES COME FROM SQL AND NOT FROM HUNDREDTHS HERE
 *
 * `NUMERIC` arithmetic in Postgres is exact: `0.30 - 0.10` is `0.20` and
 * `floor(0.30 / 0.10)` is `3`, with no rounding step to get right. A figure
 * the database can compute exactly should not be reassembled anywhere else —
 * which is the whole reason the browser had a chance to get it wrong.
 *
 * Each case below asserts the exact answer AND that the float arithmetic
 * disagrees with it, so none of them can quietly stop being a demonstration
 * if the quantities are ever tidied up.
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
  await createGovernmentUser({ fullName: 'Store Officer', phone: '+2348000000190', role: 'admin' });
  officer = (await loginAs('+2348000000190')).accessToken;
  counter = 0;
});

/** A taxpayer with a TIN, which is all this programme's eligibility asks. */
async function beneficiary(): Promise<string> {
  counter += 1;
  const row = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO taxpayers (taxpayer_type, first_name, last_name, phone, address, lga_id,
                            consent_given, declaration_accepted, tin, tin_status, status)
     VALUES ('INDIVIDUAL',$1,'Farmer',$2,'Bokkos',$3,true,true,$4,'ASSIGNED','ACTIVE')
     RETURNING id`,
    [`Farmer${counter}`, `+23480888${String(counter).padStart(5, '0')}`, lgaId,
     `PL8880${String(counter).padStart(4, '0')}`],
  );
  return row!.id;
}

async function programme(): Promise<string> {
  counter += 1;
  const created = await post(
    '/government/programmes',
    {
      name: 'Herbicide Support',
      code: `HRB-${counter}-${Date.now().toString().slice(-5)}`,
      benefitType: 'AGRICULTURAL_SUBSIDY',
      benefitDescription: 'Subsidised herbicide, measured in litres.',
      minimumScore: 0,
      requiresNoArrears: false,
      startDate: '2026-01-01',
      approvalAuthority: 'Plateau State Ministry of Agriculture',
    },
    { token: officer },
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.programmeId ?? created.body.id;
  await post(`/government/programmes/${id}/status`, { status: 'ACTIVE' }, { token: officer });
  return id;
}

/** A round of `total` litres handed out `per` litres at a time. */
async function openRound(total: number, per: number): Promise<string> {
  const created = await post(
    '/allocations/rounds',
    {
      programmeId: await programme(),
      name: '2026 wet season herbicide',
      unit: 'LITRE',
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

async function awardTo(roundId: string, times: number): Promise<void> {
  for (let n = 0; n < times; n += 1) {
    const given = await post(
      `/allocations/rounds/${roundId}/awards`,
      { taxpayerId: await beneficiary() },
      { token: officer },
    );
    assert.equal(given.status, 201, JSON.stringify(given.body));
  }
}

interface RoundRow {
  id: string;
  total_quantity: string;
  quantity_per_beneficiary: string;
  awarded_quantity: string;
  remaining_quantity: string;
  beneficiaries_remaining: string;
}

async function listed(roundId: string): Promise<RoundRow> {
  const answer = await get('/allocations/rounds', { token: officer });
  assert.equal(answer.status, 200, JSON.stringify(answer.body));
  const rows = (answer.body as RoundRow[] | { rounds: RoundRow[] });
  const list = Array.isArray(rows) ? rows : rows.rounds;
  const row = list.find((r) => r.id === roundId);
  assert.ok(row, `the round is not in the list: ${JSON.stringify(list).slice(0, 300)}`);
  return row!;
}

/** What the screen used to print, kept here so each case proves it differs. */
const asFloat = (total: string, awarded: string) => String(Number(total) - Number(awarded));
const floatBeneficiaries = (total: string, awarded: string, per: string) =>
  Math.floor((Number(total) - Number(awarded)) / Number(per));

describe('a round with a share left in it', () => {
  it('says how much, exactly, where subtracting in floats would not', async () => {
    // 0.30 litres, a tenth at a time, one farmer served. 0.20 remains.
    const roundId = await openRound(0.3, 0.1);
    await awardTo(roundId, 1);

    const row = await listed(roundId);

    assert.equal(row.awarded_quantity, '0.10');
    assert.equal(row.remaining_quantity, '0.20', 'what is left must read as a quantity');
    assert.equal(row.beneficiaries_remaining, '2', 'two more farmers can be served');

    // And the arithmetic this replaced really is wrong here, so the case above
    // is a demonstration rather than a coincidence.
    assert.notEqual(
      asFloat(row.total_quantity, row.awarded_quantity),
      row.remaining_quantity,
      'the float subtraction agrees here, so this case no longer demonstrates anything',
    );
    assert.equal(asFloat(row.total_quantity, row.awarded_quantity), '0.19999999999999998');
  });

  it('counts one more farmer where the float answer counts nobody', async () => {
    /*
     * The headline, and the case `getRound`'s own comment describes: "The
     * round holds enough for one more person and the screen says nobody."
     *
     * One litre, a tenth each, nine served. A tenth remains — exactly one
     * more share — and `floor(0.09999999999999998 / 0.1)` is 0.
     */
    const roundId = await openRound(1, 0.1);
    await awardTo(roundId, 9);

    const row = await listed(roundId);

    assert.equal(row.awarded_quantity, '0.90');
    assert.equal(row.remaining_quantity, '0.10');
    assert.equal(
      row.beneficiaries_remaining,
      '1',
      'a tenth of a litre is one more farmer, and the round must say so',
    );

    assert.equal(
      floatBeneficiaries(row.total_quantity, row.awarded_quantity, row.quantity_per_beneficiary),
      0,
      'the float answer should be the nobody this case exists to rule out',
    );
  });

  it('reads zero when the round is fully awarded', async () => {
    // The bound at the other end: nothing left must say nothing left, and not
    // a negative or a float crumb.
    const roundId = await openRound(0.3, 0.1);
    await awardTo(roundId, 3);

    const row = await listed(roundId);

    assert.equal(row.remaining_quantity, '0.00');
    assert.equal(row.beneficiaries_remaining, '0');
  });

  it('is unchanged for a round in whole units', async () => {
    // The other bound. Most rounds are whole numbers and the figures they
    // produced were already right; this change must not move them.
    const roundId = await openRound(100, 2);
    await awardTo(roundId, 1);

    const row = await listed(roundId);

    assert.equal(row.total_quantity, '100.00');
    assert.equal(row.awarded_quantity, '2.00');
    assert.equal(row.remaining_quantity, '98.00');
    assert.equal(row.beneficiaries_remaining, '49');
  });
});
