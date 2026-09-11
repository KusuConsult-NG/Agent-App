/**
 * The benefits roll that answered with the size of its own page.
 *
 * `GET /government/programmes/:id/beneficiaries` returns `{ beneficiaries,
 * total, limit, offset }` — the shape of a paginated answer. `total` was
 * `rows.length`: the number of rows on THIS page, under a name that means the
 * opposite of that.
 *
 * So a programme with three thousand eligible citizens answered `total: 50`,
 * and a caller had no instrument at all for telling a full page from a
 * complete list — `rows.length === limit` is the only hint, and it says the
 * same thing about a roll of exactly fifty. The officer portal, which asks for
 * a hundred and draws whatever arrives, showed a table that looked like the
 * whole roll and was not.
 *
 * The ordering is the half that makes it dangerous rather than merely wrong.
 * `ORDER BY tc.score DESC NULLS LAST` had no tiebreaker, and `score` is an
 * integer from 0 to 100 spread across a whole state's taxpayers — so ties are
 * not an edge case, they are most of the list. Postgres is free to return a
 * different hundred every time the page is opened, and free to repeat one row
 * across two pages while dropping another entirely. This is the roll for a tax
 * amnesty or a health scheme: who is on it must not depend on the query plan.
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
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './helpers';
import { seedReferenceData } from '../db/seed';

let officer = '';
let lgaId = '';
let programmeId = '';

/**
 * Enough people to page through, all on the same score.
 *
 * The same score deliberately: a tiebreaker that only shows up under ties is
 * a tiebreaker that only matters under ties, and a real roll is mostly ties.
 */
const ROLL = 12;

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
  await createGovernmentUser({ fullName: 'Programme Admin', phone: '+2348000000091', role: 'admin' });
  officer = (await loginAs('+2348000000091')).accessToken;

  const programme = await pool.query<{ id: string }>(
    `INSERT INTO incentive_programmes
       (name, code, description, benefit_type, benefit_description,
        minimum_score, minimum_compliance_periods, requires_no_arrears,
        start_date, approval_authority, status)
     VALUES ('Roll Programme','ROLL-1','fixture','TAX_AMNESTY','fixture',
             0, 0, false, CURRENT_DATE, 'Test Authority', 'ACTIVE')
     RETURNING id`,
  );
  programmeId = programme.rows[0]!.id;

  for (let n = 0; n < ROLL; n += 1) {
    const taxpayer = await pool.query<{ id: string }>(
      `INSERT INTO taxpayers
         (taxpayer_type, first_name, last_name, phone, address, lga_id,
          tin, tin_status, consent_given, declaration_accepted)
       VALUES ('INDIVIDUAL', 'Beneficiary', $1, $2, '1 Roll Street', $3,
               $4, 'ASSIGNED', true, true)
       RETURNING id`,
      [
        `Number${n}`,
        `+23480777${String(n).padStart(5, '0')}`,
        lgaId,
        `PL8100${String(n).padStart(4, '0')}`,
      ],
    );
    const taxpayerId = taxpayer.rows[0]!.id;
    // Every one of them on the same score, which is what a real roll looks
    // like: the sort column resolves nothing.
    await pool.query(
      `INSERT INTO taxpayer_compliance (taxpayer_id, score) VALUES ($1, 40)
       ON CONFLICT (taxpayer_id) DO UPDATE SET score = 40`,
      [taxpayerId],
    );
    await pool.query(
      `INSERT INTO programme_eligibility (programme_id, taxpayer_id, eligible, reasons)
       VALUES ($1, $2, true, '[]'::jsonb)`,
      [programmeId, taxpayerId],
    );
  }
});

function page(limit: number, offset = 0) {
  return get(
    `/government/programmes/${programmeId}/beneficiaries?limit=${limit}&offset=${offset}`,
    { token: officer },
  );
}

describe('how many beneficiaries there are', () => {
  it('is the size of the roll, not the size of the page', async () => {
    const first = await page(5);

    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.beneficiaries.length, 5, 'the page is the page');
    assert.equal(
      first.body.total,
      ROLL,
      `total reported the page size, so ${ROLL} people read as ` +
        `${first.body.total}: ${JSON.stringify({ total: first.body.total, limit: first.body.limit })}`,
    );
  });

  it('does not shrink on the last page', async () => {
    /*
     * The half a caller would notice second. Under the old answer the total
     * changed as you paged — 5, 5, 2 — so it could not even be used to detect
     * its own unreliability.
     */
    const last = await page(5, 10);

    assert.equal(last.body.beneficiaries.length, 2, 'two left over');
    assert.equal(last.body.total, ROLL, JSON.stringify(last.body));
  });

  it('is zero when the roll is empty', async () => {
    const empty = await pool.query<{ id: string }>(
      `INSERT INTO incentive_programmes
         (name, code, description, benefit_type, benefit_description,
          minimum_score, minimum_compliance_periods, requires_no_arrears,
          start_date, approval_authority, status)
       VALUES ('Empty Programme','ROLL-2','fixture','TAX_AMNESTY','fixture',
               0, 0, false, CURRENT_DATE, 'Test Authority', 'ACTIVE')
       RETURNING id`,
    );
    const read = await get(
      `/government/programmes/${empty.rows[0]!.id}/beneficiaries?limit=5`,
      { token: officer },
    );

    assert.equal(read.status, 200, JSON.stringify(read.body));
    assert.deepEqual(read.body.beneficiaries, []);
    assert.equal(read.body.total, 0, 'no rows carry no count');
  });

  it('counts what the filter matched, not the whole table', async () => {
    /*
     * The control on the count: it has to move with the WHERE clause, or it
     * is just a table size wearing a different name.
     *
     * Asked three at a time deliberately. With a limit above the match count
     * the page IS the roll, so `rows.length` answers correctly by accident and
     * this proves nothing — checked, and it passed with the defect restored
     * until the limit came down.
     */
    await refuseFour();

    const eligible = await page(3);
    assert.equal(eligible.body.beneficiaries.length, 3);
    assert.equal(eligible.body.total, ROLL - 4, JSON.stringify(eligible.body));
  });
});

/**
 * The parameter that read as a value and behaved as a switch.
 *
 * `eligible` was `z.enum(['true', 'false'])` and `false` was implemented as
 * "apply no filter" — so an officer asking this programme who it had turned
 * down received every taxpayer it had evaluated, with the four refusals buried
 * among them. Nothing passed the parameter, so nothing depended on the old
 * reading; the third state now has its own spelling.
 */
describe('asking which way a decision went', () => {
  it('false means the people it refused', async () => {
    await refuseFour();

    const refused = await get(
      `/government/programmes/${programmeId}/beneficiaries?limit=50&eligible=false`,
      { token: officer },
    );

    assert.equal(refused.body.total, 4, JSON.stringify(refused.body));
    assert.equal(
      refused.body.beneficiaries.every((row: { eligible: boolean }) => row.eligible === false),
      true,
      JSON.stringify(refused.body.beneficiaries),
    );
  });

  it('all means both, which is what false used to do', async () => {
    await refuseFour();

    const everyone = await get(
      `/government/programmes/${programmeId}/beneficiaries?limit=50&eligible=all`,
      { token: officer },
    );

    assert.equal(everyone.body.total, ROLL, JSON.stringify(everyone.body));
  });

  it('true and saying nothing are the same thing', async () => {
    // The control: the reading the officer panel depends on is unchanged.
    await refuseFour();

    const stated = await get(
      `/government/programmes/${programmeId}/beneficiaries?limit=50&eligible=true`,
      { token: officer },
    );
    const silent = await page(50);

    assert.equal(stated.body.total, ROLL - 4, JSON.stringify(stated.body));
    assert.equal(silent.body.total, ROLL - 4, JSON.stringify(silent.body));
  });

  it('refuses a spelling it does not have', async () => {
    const nonsense = await get(
      `/government/programmes/${programmeId}/beneficiaries?eligible=maybe`,
      { token: officer },
    );
    assert.equal(nonsense.status, 422, JSON.stringify(nonsense.body));
    assert.equal(nonsense.body.error.code, 'VALIDATION_FAILED');
  });
});

/** Turn four of the roll down, so the two sides of the filter are both real. */
async function refuseFour() {
  await pool.query(
    `UPDATE programme_eligibility SET eligible = false
       WHERE programme_id = $1
         AND taxpayer_id IN (
           SELECT taxpayer_id FROM programme_eligibility
            WHERE programme_id = $1 ORDER BY taxpayer_id LIMIT 4)`,
    [programmeId],
  );
}

describe('which beneficiaries are on which page', () => {
  /*
   * These assert the ORDER the endpoint declares, not merely that some order
   * came back twice running.
   *
   * The distinction is the whole test. Twelve rows on one small table come
   * back in a stable order under any plan Postgres is likely to pick, so
   * "page 2 held the same four both times" and "nobody appeared twice" BOTH
   * pass with the tiebreaker deleted — checked, and they did, which is why
   * neither of those is what is asserted below.
   *
   * Which of these two bites, and which does not, was also checked. The
   * unpaginated one does NOT: `programme_eligibility` carries a UNIQUE index
   * on (programme_id, taxpayer_id), so a plain scan already hands back exactly
   * the taxpayer_id order the tiebreaker asks for, and it passes with or
   * without it. It is kept as a statement of the declared contract, not as
   * proof of it.
   *
   * The PAGED one bites, and it is also the one that matters: adding OFFSET
   * moves Postgres onto a sort-and-limit plan that does not inherit the
   * index's order, so the pages stop tiling the roll. An unresolved tie is
   * only dangerous once something slices it.
   */

  /** Everyone on the roll, in the order the endpoint says it returns them. */
  async function declaredOrder(): Promise<string[]> {
    const rows = await pool.query<{ taxpayer_id: string }>(
      `SELECT taxpayer_id FROM programme_eligibility
        WHERE programme_id = $1 AND eligible ORDER BY taxpayer_id`,
      [programmeId],
    );
    return rows.rows.map((row) => row.taxpayer_id);
  }

  it('resolves the ties the score leaves, in a stated order', async () => {
    const expected = await declaredOrder();
    const read = await page(ROLL);

    assert.deepEqual(
      read.body.beneficiaries.map((row: { taxpayer_id: string }) => row.taxpayer_id),
      expected,
      'the order between equal scores was whatever the plan produced',
    );
  });

  it('cuts the pages along that order, so nobody is served twice', async () => {
    /*
     * The one that decides whether a benefit gets handed out twice. OFFSET
     * slices a re-ordered result without noticing, so an unresolved tie can
     * repeat one citizen across two pages and drop another entirely.
     */
    const expected = await declaredOrder();
    const seen: string[] = [];
    for (let offset = 0; offset < ROLL; offset += 4) {
      const read = await page(4, offset);
      assert.equal(read.status, 200, JSON.stringify(read.body));
      seen.push(...read.body.beneficiaries.map((row: { taxpayer_id: string }) => row.taxpayer_id));
    }

    assert.deepEqual(seen, expected, 'the three pages did not tile the roll');
    assert.equal(new Set(seen).size, ROLL, 'somebody appeared twice');
  });

  it('still puts the highest score first', async () => {
    /*
     * The control on the sort. A tiebreaker must break ties and nothing else:
     * the score is why this list is ordered at all.
     */
    const top = await pool.query<{ taxpayer_id: string }>(
      `SELECT taxpayer_id FROM programme_eligibility
        WHERE programme_id = $1 ORDER BY taxpayer_id DESC LIMIT 1`,
      [programmeId],
    );
    await pool.query('UPDATE taxpayer_compliance SET score = 99 WHERE taxpayer_id = $1', [
      top.rows[0]!.taxpayer_id,
    ]);

    const read = await page(3);
    assert.equal(
      read.body.beneficiaries[0]!.taxpayer_id,
      top.rows[0]!.taxpayer_id,
      'the tiebreaker overtook the score it was meant to break ties within',
    );
    assert.equal(read.body.beneficiaries[0]!.score, 99);
  });

  it('does not put the count in front of the officer as a column', async () => {
    // The count rides on every row out of the database. It is the response's
    // business, not the row's, and these rows are rendered as a table.
    const read = await page(3);
    for (const row of read.body.beneficiaries) {
      assert.equal('matching_total' in row, false, JSON.stringify(row));
    }
  });
});
