/**
 * The Fourth Schedule to the Nigeria Tax Act, 2025, and what the platform does
 * to the people it exempts.
 *
 * Two separate properties are held here.
 *
 * The first is arithmetic: the bands seeded in `seed.ts` must produce the
 * figures the Schedule produces, at the boundary of every band, and must carry
 * no statutory minimum. The old PITA schedule taxed from the first naira and
 * had a ₦5,000 floor; the Schedule exempts the first ₦800,000. A floor
 * reinstated by accident would fall on precisely the people the exemption is
 * for, and would look like an ordinary configuration line while doing it.
 *
 * The second is the one that matters more, and it was found by entering a real
 * income into the running system. A trader on ₦300,000 a year owes nothing.
 * The platform's answer was:
 *
 *   "The calculated amount is zero. Check the values entered before raising
 *    an invoice."
 *
 * The values were not wrong. The trader is exempt. But an agent reading that
 * has been told their input is the problem, and the only way past it is to
 * enter an income the trader does not have. On a platform whose agents are
 * paid commission on what they collect, a message that says "your figures are
 * wrong" to describe a lawful nil liability is an instruction to inflate them.
 *
 * So a zero that comes from the schedule must be reported as a zero that comes
 * from the schedule, and must be distinguishable from a zero that comes from
 * an empty form.
 */

import './env';
import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pool, resetDatabase } from './helpers';
import { query, queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { createAssessment, quote } from '../services/revenue';

/** Items that carry the personal income tax schedule. PAYE and CGT are the
 *  same tax collected differently, so they must carry the same bands. */
const SCHEDULE_ITEMS = ['PIT-DIRECT', 'PIT-PAYE', 'PIT-CGT'];

/**
 * The Fourth Schedule, worked out longhand.
 *
 * Every entry is at a band boundary or just inside one, so a band that was
 * entered with the wrong ceiling or the wrong rate shows up here rather than
 * only for the incomes nobody tested.
 */
const SCHEDULE: { incomeNaira: string; taxNaira: string; why: string }[] = [
  { incomeNaira: '300000', taxNaira: '0', why: 'inside the exempt band' },
  { incomeNaira: '800000', taxNaira: '0', why: 'exactly at the exempt ceiling' },
  { incomeNaira: '1000000', taxNaira: '30000', why: '₦200,000 at 15%' },
  { incomeNaira: '3000000', taxNaira: '330000', why: '₦2.2m at 15%' },
  { incomeNaira: '12000000', taxNaira: '1950000', why: '+ ₦9m at 18%' },
  { incomeNaira: '25000000', taxNaira: '4680000', why: '+ ₦13m at 21%' },
  { incomeNaira: '50000000', taxNaira: '10430000', why: '+ ₦25m at 23%' },
  { incomeNaira: '60000000', taxNaira: '12930000', why: '+ ₦10m at 25%' },
];

const nairaToKobo = (naira: string) => (BigInt(naira) * 100n).toString();

let officerId: string;
let individualId: string;

before(async () => {
  await resetDatabase();
  await seedReferenceData();

  const officer = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO users (full_name, phone, email, password_hash, role, status)
     VALUES ('Schedule Arithmetic Officer', '+2348097100001', 'fourth@psirs.invalid',
             'not-a-usable-hash', 'revenue_officer', 'ACTIVE')
     RETURNING id`,
  );
  officerId = officer!.id;

  const lga = await queryOne<{ id: string }>(pool, 'SELECT id FROM lgas ORDER BY name LIMIT 1');
  const individual = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO taxpayers
       (taxpayer_type, first_name, last_name, phone, address, lga_id, status, source)
     VALUES ('INDIVIDUAL','Fourth','Schedule','+2348097100002','Terminus Market, Jos',$1,
             'ACTIVE','AGENT')
     RETURNING id`,
    [lga!.id],
  );
  individualId = individual!.id;
});

async function rateFor(code: string) {
  return queryOne<{
    id: string;
    item_id: string;
    tiers: unknown;
    minimum_amount_kobo: string | null;
    rate_type: string;
  }>(
    pool,
    `SELECT r.id, ri.id AS item_id, r.tiers, r.minimum_amount_kobo, r.rate_type
       FROM revenue_items ri
       JOIN revenue_item_rates r ON r.revenue_item_id = ri.id
      WHERE ri.code = $1
      ORDER BY r.effective_from DESC LIMIT 1`,
    [code],
  );
}

describe('the personal income tax bands', () => {
  it('are in force, and are the same bands for direct assessment, PAYE and CGT', async () => {
    // PAYE is this tax deducted at source and CGT is now charged inside the
    // same framework. If they ever diverge, someone has edited one item and
    // not the others, and two taxpayers with the same income pay differently
    // depending on how they earned it.
    const rates = await Promise.all(SCHEDULE_ITEMS.map((code) => rateFor(code)));
    for (const [index, rate] of rates.entries()) {
      assert.ok(rate, `${SCHEDULE_ITEMS[index]} has no rate in force`);
      assert.equal(rate!.rate_type, 'TIERED', SCHEDULE_ITEMS[index]);
    }
    const [direct, ...others] = rates;
    for (const [index, other] of others.entries()) {
      assert.deepEqual(
        other!.tiers,
        direct!.tiers,
        `${SCHEDULE_ITEMS[index + 1]} does not carry the same schedule as PIT-DIRECT`,
      );
    }
  });

  it('carry no statutory minimum, because the first ₦800,000 is exempt', async () => {
    // The floor that was here was ₦5,000. Under the Schedule it would be
    // charged to someone whose tax is nil — the exemption cancelled by the
    // line below it.
    for (const code of SCHEDULE_ITEMS) {
      const rate = await rateFor(code);
      assert.equal(
        rate!.minimum_amount_kobo,
        null,
        `${code} has a statutory minimum, which would be charged to exempt taxpayers`,
      );
    }
  });

  it('produce the Fourth Schedule figures at every band boundary', async () => {
    const item = await queryOne<{ id: string }>(
      pool,
      `SELECT id FROM revenue_items WHERE code = 'PIT-DIRECT'`,
    );

    for (const band of SCHEDULE) {
      const result = await quote(pool, {
        revenueItemId: item!.id,
        inputs: { baseAmountKobo: nairaToKobo(band.incomeNaira) },
      });
      assert.equal(
        result.amountKobo.toString(),
        nairaToKobo(band.taxNaira),
        `₦${band.incomeNaira} of income (${band.why})`,
      );
    }
  });
});

describe('a taxpayer the Schedule exempts', () => {
  async function assessIncome(incomeNaira: string) {
    const item = await queryOne<{ id: string }>(
      pool,
      `SELECT id FROM revenue_items WHERE code = 'PIT-DIRECT'`,
    );
    return createAssessment({
      taxpayerId: individualId,
      revenueItemId: item!.id,
      inputs: { baseAmountKobo: nairaToKobo(incomeNaira) },
      actorId: officerId,
      actorRole: 'revenue_officer',
      channel: 'OFFICER',
    });
  }

  it('is told they owe nothing, not that their figures are wrong', async () => {
    await assert.rejects(
      () => assessIncome('300000'),
      (error: { code?: string; message?: string; nextStep?: string }) => {
        assert.equal(
          error.code,
          'NO_TAX_PAYABLE',
          `a lawful nil liability must not be reported as a bad request: ${error.message}`,
        );
        return true;
      },
    );
  });

  it('is not told to check the values entered, because the values are right', async () => {
    // This is the whole finding. An agent on commission who is told the
    // figures are wrong has one way to make the screen proceed, and it is to
    // raise the income until tax falls out of it.
    await assert.rejects(
      () => assessIncome('800000'),
      (error: { message?: string; nextStep?: string }) => {
        const said = `${error.message ?? ''} ${error.nextStep ?? ''}`.toLowerCase();
        assert.ok(
          !said.includes('check the values'),
          `must not blame the input: ${JSON.stringify(said)}`,
        );
        assert.ok(
          said.includes('no tax') || said.includes('nothing'),
          `must say the liability is nil: ${JSON.stringify(said)}`,
        );
        return true;
      },
    );
  });

  it('still gets the plain "check the values" refusal when nothing was declared', async () => {
    // The distinction has to hold in both directions. An empty form is an
    // input problem and must keep saying so, or the new message becomes a
    // blanket excuse for any zero.
    await assert.rejects(
      () => assessIncome('0'),
      (error: { code?: string; message?: string }) => {
        assert.notEqual(
          error.code,
          'NO_TAX_PAYABLE',
          'a form with no income declared is not an exemption',
        );
        assert.match(String(error.message), /check the values/i);
        return true;
      },
    );
  });

  it('has no assessment, invoice or transaction raised against them', async () => {
    // A nil liability that left a row behind would be a debt the taxpayer
    // does not owe, sitting in the system under their name.
    const rows = await query<{ n: string }>(
      pool,
      `SELECT count(*)::text AS n FROM assessments WHERE taxpayer_id = $1`,
      [individualId],
    );
    assert.equal(rows[0]!.n, '0');

    const stray = await queryOne<{ n: string }>(
      pool,
      `SELECT count(*)::text AS n FROM transactions WHERE taxpayer_id = $1`,
      [individualId],
    );
    assert.equal(stray!.n, '0');
  });
});
