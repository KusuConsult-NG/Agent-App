/**
 * PAYE from an informal employer, and the arithmetic nobody may negotiate.
 *
 * Phase 3 of the informal-sector programme. A private school with forty
 * teachers is informal in the only sense that matters — unregistered,
 * unassessed, paying nothing — and is worth a hundred tailors for one visit.
 *
 * The property this file exists to hold is that the employer declares
 * emoluments and the platform computes the tax. Everything else follows from
 * it. If a tax figure can be typed, PAYE becomes a negotiation at a counter,
 * an employer remits a third of what they deducted, and nobody can tell.
 *
 * Two arithmetic mistakes would each be invisible in production and are tested
 * for by name:
 *
 *   Taxing the payroll as one salary. Forty people at ₦120,000 each is not one
 *   person on ₦4.8m, and treating it as one pushes the whole payroll into the
 *   top band — an overstatement an employer would be right to refuse.
 *
 *   Scoring a monthly figure against annual bands. The first ₦800,000 is
 *   untaxed *per year*. A monthly emolument compared to that directly makes
 *   almost every employee in Plateau State nil-rated, and the platform would
 *   assess zero on a real payroll with complete confidence.
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
import { queryOne, query } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';
import {
  cancelPayeSchedule,
  employersNotFiling,
  filePayeSchedule,
  monthlyPayeFor,
  payeHistory,
  premisesNotPayingConsumptionTax,
} from '../services/paye';
import { resolveRate } from '../services/revenue';
import { computeAmount } from '../services/rate-engine';

let auth: { token: string; deviceId: string };
let officerId: string;
let seq = 0;

/** A month that has certainly ended, whatever day the suite runs on. */
const LAST_MONTH = (() => {
  const now = new Date();
  const previous = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return { year: previous.getUTCFullYear(), month: previous.getUTCMonth() + 1 };
})();

before(async () => { await startTestServer(); });
after(async () => { await stopTestServer(); });

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  officerId = await createGovernmentUser({
    fullName: 'Revenue Admin',
    phone: '+2348000000001',
    role: 'admin',
  });
  const demo = await seedDemoAgent();
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  auth = { token: session.accessToken, deviceId: demo!.deviceIdentifier };
  seq = 0;
});

async function employer(name: string, sector = 'EDUCATION') {
  seq += 1;
  const suffix = String(seq).padStart(5, '0');
  const response = await post(
    '/taxpayers',
    {
      taxpayerType: 'BUSINESS',
      businessName: name,
      firstName: 'Proprietor',
      lastName: `Of${suffix}`,
      phone: `+23480555${suffix}`,
      address: '12 Zaria Road, Jos',
      lgaId: await firstLgaId(),
      economicSector: sector,
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...auth, idempotencyKey: `paye-tp-${suffix}` },
  );
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.taxpayerId as string;
}

const file = (employerId: string, lines: { employeeName: string; grossEmolumentKobo: string; employeeTin?: string }[]) =>
  filePayeSchedule({
    employerTaxpayerId: employerId,
    periodYear: LAST_MONTH.year,
    periodMonth: LAST_MONTH.month,
    lines,
    actorId: officerId,
    actorRole: 'admin',
  });

/** Forty teachers on ₦120,000 a month. */
const payroll = (count: number, monthlyKobo = '12000000') =>
  Array.from({ length: count }, (_, index) => ({
    employeeName: `Teacher ${index + 1}`,
    grossEmolumentKobo: monthlyKobo,
  }));

describe('the arithmetic', () => {
  it('taxes an annual income, not a monthly one', async () => {
    const item = await queryOne<{ id: string }>(
      pool,
      `SELECT id FROM revenue_items WHERE code = 'PIT-PAYE'`,
      [],
    );
    const rate = await resolveRate(pool, item!.id);

    /*
     * ₦120,000 a month is ₦1,440,000 a year. The first ₦800,000 is nil-rated
     * and the next ₦640,000 falls in the 15% band, so the year's tax is
     * ₦96,000 and the month's is ₦8,000.
     */
    const monthly = monthlyPayeFor(rate, 12_000_000n);
    assert.equal(monthly, 800_000n, `₦8,000 a month, got ${monthly} kobo`);

    /*
     * The mistake this guards against: ₦120,000 scored against annual bands
     * sits under the ₦800,000 threshold and produces nothing at all.
     */
    assert.ok(monthly > 0n, 'a monthly figure read as an annual one would tax this at zero');
  });

  it('taxes each employee separately, not the payroll as one salary', async () => {
    const school = await employer('Highland Academy');
    const filing = await file(school, payroll(40));

    /*
     * Forty people at ₦8,000 each. Taxed as one ₦4.8m monthly salary the
     * figure would be far larger, because most of it would fall in the upper
     * bands — the overstatement an employer would refuse to pay and be right
     * to.
     */
    assert.equal(filing.taxDueKobo, (800_000n * 40n).toString());
    assert.equal(filing.employeeCount, 40);
    assert.equal(filing.grossEmolumentsKobo, (12_000_000n * 40n).toString());
  });

  it('charges nothing on a wage below the threshold, and says so rather than failing', async () => {
    const item = await queryOne<{ id: string }>(
      pool,
      `SELECT id FROM revenue_items WHERE code = 'PIT-PAYE'`,
      [],
    );
    const rate = await resolveRate(pool, item!.id);

    // ₦50,000 a month is ₦600,000 a year — under the ₦800,000 nil band.
    assert.equal(monthlyPayeFor(rate, 5_000_000n), 0n);
  });

  it('rounds a month down, so twelve of them never exceed the year’s tax', async () => {
    /*
     * The deliberate direction, and the reason for it: an employer can only
     * remit what they actually withheld from a payslip. Rounding up would
     * demand a kobo more than anybody deducted, thirty times a month, and the
     * difference would sit unexplained on the employer's account for ever.
     *
     * ₦100,000.01 is used rather than a round figure because a round one
     * divides evenly by twelve and the rounding never bites — a test on
     * ₦120,000 passes whichever direction the code rounds in, which is no
     * test of the decision at all.
     */
    const item = await queryOne<{ id: string }>(
      pool,
      `SELECT id FROM revenue_items WHERE code = 'PIT-PAYE'`,
      [],
    );
    const rate = await resolveRate(pool, item!.id);

    const gross = 10_000_001n;
    const annual = computeAmount(rate, { baseAmountKobo: (gross * 12n).toString() }).amountKobo;
    assert.notEqual(annual % 12n, 0n, 'the fixture must pick a wage where the rounding matters');

    const monthly = monthlyPayeFor(rate, gross);
    assert.ok(
      monthly * 12n <= annual,
      `twelve months must never exceed the year: ${monthly * 12n} against ${annual}`,
    );
    assert.ok(annual - monthly * 12n < 12n, 'and it must not be rounded away to nothing either');
  });

  it('refuses an employee paid nothing, because that is not a payroll line', async () => {
    const school = await employer('Zero Wage School');
    await assert.rejects(
      file(school, [{ employeeName: 'Ghost', grossEmolumentKobo: '0' }]),
      /more than nothing/i,
    );
  });
});

describe('filing a return', () => {
  it('raises one assessment for the whole payroll, on the ordinary money path', async () => {
    const clinic = await employer('Vom Clinic', 'HEALTHCARE');
    const filing = await file(clinic, payroll(3));

    const invoice = await queryOne<{ amount_kobo: string; status: string }>(
      pool,
      'SELECT amount_kobo, status FROM invoices WHERE invoice_number = $1',
      [filing.invoiceNumber],
    );
    assert.ok(invoice, 'PAYE is collected through the same invoice as everything else');
    assert.equal(
      invoice!.amount_kobo,
      filing.taxDueKobo,
      'the invoice must be for what the schedule computed, to the kobo',
    );
    assert.equal(invoice!.status, 'UNPAID');
  });

  it('records every employee it charged for', async () => {
    const hotel = await employer('Hill Station Hotel', 'HOTEL_HOSPITALITY');
    const filing = await file(hotel, [
      { employeeName: 'Ada Okoro', grossEmolumentKobo: '12000000', employeeTin: 'P1111111' },
      { employeeName: 'Sule Mohammed', grossEmolumentKobo: '9000000' },
    ]);

    const lines = await query<{ employee_name: string; tax_kobo: string; employee_tin: string | null }>(
      pool,
      'SELECT employee_name, tax_kobo, employee_tin FROM paye_schedule_lines WHERE schedule_id = $1 ORDER BY employee_name',
      [filing.scheduleId],
    );
    assert.equal(lines.length, 2, 'the names are the evidence for the liability');
    assert.equal(lines[0]!.employee_name, 'Ada Okoro');
    assert.equal(lines[0]!.employee_tin, 'P1111111');
  });

  it('accepts a return where the employer cannot name every TIN, and counts the gap', async () => {
    /*
     * Refusing this would be the wrong trade. An employer who cannot supply
     * thirty TINs would file nothing, and the State would collect nothing
     * rather than collect and chase the identifiers afterwards.
     */
    const yard = await employer('Jos Haulage', 'TRANSPORT_HAULAGE');
    const filing = await file(yard, [
      { employeeName: 'Driver One', grossEmolumentKobo: '12000000', employeeTin: 'P2222222' },
      { employeeName: 'Driver Two', grossEmolumentKobo: '12000000' },
      { employeeName: 'Driver Three', grossEmolumentKobo: '12000000' },
    ]);
    assert.equal(filing.employeesWithoutTin, 2);
    assert.ok(BigInt(filing.taxDueKobo) > 0n, 'and it is still assessed');
  });

  it('refuses a second return for a month already filed', async () => {
    const school = await employer('Twice Filed School');
    await file(school, payroll(2));

    await assert.rejects(
      file(school, payroll(2)),
      /already been filed/i,
      'a duplicate filing would double what the employer appears to owe',
    );
  });

  it('refuses a month that has not ended', async () => {
    const school = await employer('Future School');
    const now = new Date();
    await assert.rejects(
      filePayeSchedule({
        employerTaxpayerId: school,
        periodYear: now.getUTCFullYear() + 1,
        periodMonth: 6,
        lines: payroll(1),
        actorId: officerId,
        actorRole: 'admin',
      }),
      /has not ended/i,
    );
  });

  it('lets a wrong return be withdrawn and replaced, keeping both records', async () => {
    const school = await employer('Corrected School');
    const first = await file(school, payroll(2));

    await cancelPayeSchedule(pool, {
      scheduleId: first.scheduleId,
      reason: 'Two staff were listed who had already left',
      actorId: officerId,
      actorRole: 'admin',
    });

    const second = await file(school, payroll(1));
    assert.notEqual(second.scheduleId, first.scheduleId);

    const history = await payeHistory(pool, school);
    assert.equal(history.length, 2, 'what was declared survives being wrong');
    assert.ok(history.some((row) => row.status === 'CANCELLED' && row.cancelledReason));
  });

  it('refuses a withdrawal nobody explained', async () => {
    const school = await employer('Silent School');
    const filing = await file(school, payroll(1));
    await assert.rejects(
      cancelPayeSchedule(pool, {
        scheduleId: filing.scheduleId,
        reason: '  ',
        actorId: officerId,
        actorRole: 'admin',
      }),
      /why this return is being withdrawn/i,
    );
  });
});

describe('what the database refuses, with the service bypassed', () => {
  /*
   * The service is correct. These issue SQL directly, because this table is
   * the evidence for a liability and a rule that only holds through one file
   * is one UPDATE away from being undone.
   */
  async function filedSchedule() {
    const school = await employer(`Bypassed ${seq}`);
    return file(school, payroll(2));
  }

  it('refuses a schedule whose header does not match its lines', async () => {
    const school = await employer('Mismatched School');

    /*
     * On its own connection, with the statements issued separately: the
     * constraint is deferred to commit, which is the only point at which a
     * schedule and its lines can be judged against each other. A single
     * multi-statement string would never reach that check.
     */
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO paye_schedules
           (employer_taxpayer_id, period_year, period_month, employee_count,
            gross_emoluments_kobo, tax_due_kobo, filed_by)
         VALUES ($1, $2, $3, 40, 480000000, 32000000, $4)`,
        [school, LAST_MONTH.year, LAST_MONTH.month, officerId],
      );
      await assert.rejects(
        client.query('COMMIT'),
        /must name the employees/i,
        'a schedule with no lines is a liability nobody can check',
      );
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
  });

  it('refuses a schedule whose total does not add up to its lines', async () => {
    /*
     * The one that matters. The gap between a header and its lines is exactly
     * the shape of an employer remitting less than they deducted, and it is
     * invisible unless something insists the two agree.
     */
    const school = await employer('Short Remitting School');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO paye_schedules
           (employer_taxpayer_id, period_year, period_month, employee_count,
            gross_emoluments_kobo, tax_due_kobo, filed_by)
         VALUES ($1, $2, $3, 2, 24000000, 1600000, $4)
         RETURNING id`,
        [school, LAST_MONTH.year, LAST_MONTH.month, officerId],
      );
      const scheduleId = inserted.rows[0]!.id;
      // Two lines, but only half the declared emoluments between them.
      for (const name of ['Teacher A', 'Teacher B']) {
        await client.query(
          `INSERT INTO paye_schedule_lines
             (schedule_id, employee_name, gross_emolument_kobo, tax_kobo)
           VALUES ($1, $2, 6000000, 800000)`,
          [scheduleId, name],
        );
      }
      await assert.rejects(
        client.query('COMMIT'),
        /emoluments and its lines add to/i,
      );
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
  });

  it('refuses a schedule whose assessment is for a different amount', async () => {
    /*
     * The check that makes the service's precomputed-amount path safe. The
     * assessment engine cannot derive a PAYE total from a rate — it is the sum
     * of thirty separate band computations — so the service hands it a number.
     * This is what stops that being a hole: the number must equal the
     * schedule, which must equal the lines, which are the people it was
     * deducted from.
     *
     * The probe goes in sideways because the obvious attack is already dead:
     * `assessments.amount_kobo` is immutable, so an existing assessment cannot
     * be edited to disagree with its schedule. What remains reachable is a
     * schedule pointed at an assessment raised for something else, which is
     * what a service with a mistake in it would actually produce.
     */
    const small = await employer('One Teacher School');
    const smallFiling = await file(small, payroll(1));
    const large = await employer('Four Teacher School');
    const largeFiling = await file(large, payroll(4));
    assert.notEqual(smallFiling.taxDueKobo, largeFiling.taxDueKobo, 'the fixture needs two totals');

    const third = await employer('Mispointed School');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO paye_schedules
           (employer_taxpayer_id, period_year, period_month, employee_count,
            gross_emoluments_kobo, tax_due_kobo, assessment_id, filed_by)
         VALUES ($1, $2, $3, 1, 12000000, $4, $5, $6)
         RETURNING id`,
        [
          third,
          LAST_MONTH.year,
          LAST_MONTH.month,
          smallFiling.taxDueKobo,
          // Somebody else's assessment, for four teachers rather than one.
          largeFiling.assessmentId,
          officerId,
        ],
      );
      await client.query(
        `INSERT INTO paye_schedule_lines
           (schedule_id, employee_name, gross_emolument_kobo, tax_kobo)
         VALUES ($1, 'Teacher 1', 12000000, $2)`,
        [inserted.rows[0]!.id, smallFiling.taxDueKobo],
      );
      await assert.rejects(client.query('COMMIT'), /does not carry the/i);
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
  });

  it('will not let an assessment be edited away from its schedule either', async () => {
    // The second line of defence, and the reason the probe above had to come
    // in sideways: the amount on an assessment cannot be changed at all.
    const school = await employer('Immutable Assessment School');
    const filing = await file(school, payroll(2));
    await assert.rejects(
      pool.query('UPDATE assessments SET amount_kobo = amount_kobo + 1 WHERE id = $1', [
        filing.assessmentId,
      ]),
      /immutable/i,
    );
  });

  it('refuses to edit a filed return', async () => {
    const filing = await filedSchedule();
    await assert.rejects(
      pool.query('UPDATE paye_schedules SET tax_due_kobo = 1 WHERE id = $1', [filing.scheduleId]),
      /immutable|cannot be changed|tax_due_kobo/i,
    );
  });

  it('refuses to change or remove an employee line', async () => {
    const filing = await filedSchedule();
    const line = await queryOne<{ id: string }>(
      pool,
      'SELECT id FROM paye_schedule_lines WHERE schedule_id = $1 LIMIT 1',
      [filing.scheduleId],
    );

    await assert.rejects(
      pool.query('UPDATE paye_schedule_lines SET tax_kobo = 0 WHERE id = $1', [line!.id]),
      /update/i,
    );
    await assert.rejects(
      pool.query('DELETE FROM paye_schedule_lines WHERE id = $1', [line!.id]),
      /delete/i,
      'an employer who deducted from somebody and later deleted the row is the case this prevents',
    );
  });

  it('refuses a cancellation with no reason and no officer', async () => {
    const filing = await filedSchedule();
    await assert.rejects(
      pool.query(`UPDATE paye_schedules SET status = 'CANCELLED' WHERE id = $1`, [
        filing.scheduleId,
      ]),
      /without a reason and an officer/i,
    );
  });

  it('refuses to reinstate a cancelled return', async () => {
    const filing = await filedSchedule();
    await cancelPayeSchedule(pool, {
      scheduleId: filing.scheduleId,
      reason: 'Filed against the wrong employer',
      actorId: officerId,
      actorRole: 'admin',
    });

    await assert.rejects(
      pool.query(`UPDATE paye_schedules SET status = 'FILED' WHERE id = $1`, [filing.scheduleId]),
      /cannot be reinstated/i,
    );
  });

  it('refuses to delete a return outright', async () => {
    /*
     * Held by two things, and worth naming which. The foreign key from
     * `paye_schedule_lines` is `ON DELETE RESTRICT`, so a schedule with lines
     * cannot go — and a schedule without lines cannot exist, because the
     * deferred check refuses one. The `prevent_delete` trigger on the schedule
     * is therefore unreachable today: dropping it leaves this test passing.
     * It stays as a backstop for a future migration that relaxes the first
     * two, and this comment is here so nobody mistakes it for what is
     * currently doing the work.
     */
    const filing = await filedSchedule();
    await assert.rejects(
      pool.query('DELETE FROM paye_schedules WHERE id = $1', [filing.scheduleId]),
      /delete|violates foreign key/i,
    );
  });

  it('refuses more tax on a line than the employee was paid', async () => {
    const school = await employer('Units Mistake School');
    const filing = await file(school, payroll(1));
    await assert.rejects(
      pool.query(
        `INSERT INTO paye_schedule_lines
           (schedule_id, employee_name, gross_emolument_kobo, tax_kobo)
         VALUES ($1, 'Overtaxed', 100, 500)`,
        [filing.scheduleId],
      ),
      /paye_line_tax_within_emolument/,
    );
  });
});

describe('who should be filing and is not', () => {
  it('lists a school that has never filed', async () => {
    const school = await employer('Never Filed Academy');

    const leads = await employersNotFiling(pool);
    assert.ok(
      leads.rows.some((row) => row.taxpayerId === school),
      'a school has teachers; that is the whole of the inference and it is worth a call',
    );
  });

  it('drops them once they file', async () => {
    const school = await employer('Now Filing Academy');
    assert.ok((await employersNotFiling(pool)).rows.some((row) => row.taxpayerId === school));

    await file(school, payroll(2));

    const after = await employersNotFiling(pool);
    assert.equal(
      after.rows.some((row) => row.taxpayerId === school),
      false,
      'a list headed "not filing" must not carry employers who are',
    );
    assert.equal(after.summary.filing, 1, 'and they move to the denominator');
  });

  it('puts them back if the return is withdrawn', async () => {
    const school = await employer('Withdrawn Academy');
    const filing = await file(school, payroll(2));
    await cancelPayeSchedule(pool, {
      scheduleId: filing.scheduleId,
      reason: 'Filed in error against this school',
      actorId: officerId,
      actorRole: 'admin',
    });

    assert.ok(
      (await employersNotFiling(pool)).rows.some((row) => row.taxpayerId === school),
      'a cancelled return is not a return',
    );
  });

  it('leaves a one-person trade off the list', async () => {
    /*
     * The list is worth running because each name is potentially dozens of
     * taxpayers. Adding retail would fill it with one-person shops and destroy
     * the yield per visit, which is the only reason this phase comes before
     * enumerating individuals.
     */
    const trader = await employer('Corner Shop', 'RETAIL_TRADE');
    assert.equal(
      (await employersNotFiling(pool)).rows.some((row) => row.taxpayerId === trader),
      false,
    );
  });

  it('narrows to one sector when the officer asks', async () => {
    const school = await employer('Sector School', 'EDUCATION');
    const clinic = await employer('Sector Clinic', 'HEALTHCARE');

    const health = await employersNotFiling(pool, { sector: 'HEALTHCARE' });
    assert.ok(health.rows.some((row) => row.taxpayerId === clinic));
    assert.equal(health.rows.some((row) => row.taxpayerId === school), false);
  });

  it('narrows to the officer’s own territories', async () => {
    const school = await employer('Scoped Academy');
    const lgaId = (await queryOne<{ lga_id: string }>(
      pool,
      'SELECT lga_id FROM taxpayers WHERE id = $1',
      [school],
    ))!.lga_id;
    const otherLga = await queryOne<{ id: string }>(
      pool,
      'SELECT id FROM lgas WHERE id <> $1 LIMIT 1',
      [lgaId],
    );
    const territory = await queryOne<{ id: string; name: string; name_ha: string | null; code: string }>(
      pool,
      'SELECT id, name, name_ha, code FROM territories WHERE lga_id = $1 LIMIT 1',
      [otherLga!.id],
    );
    assert.ok(territory, 'the fixture needs a territory in another LGA');

    const elsewhere = await employersNotFiling(pool, {}, {
      kind: 'TERRITORIES',
      territories: [
        {
          id: territory!.id,
          name: territory!.name,
          nameHa: territory!.name_ha,
          code: territory!.code,
          lgaId: otherLga!.id,
        },
      ],
    });
    assert.equal(elsewhere.rows.some((row) => row.taxpayerId === school), false);
  });
});

describe('hospitality that owes consumption tax', () => {
  it('lists a hotel with nothing on record', async () => {
    const hotel = await employer('Unassessed Hotel', 'HOTEL_HOSPITALITY');
    const leads = await premisesNotPayingConsumptionTax(pool);
    assert.ok(leads.rows.some((row) => row.taxpayerId === hotel));
  });

  it('leaves a school alone — it owes PAYE, not consumption tax', async () => {
    const school = await employer('Not Hospitality School', 'EDUCATION');
    const leads = await premisesNotPayingConsumptionTax(pool);
    assert.equal(leads.rows.some((row) => row.taxpayerId === school), false);
  });
});

describe('who may file', () => {
  it('is refused to an agent', async () => {
    const school = await employer('Agent Filed School');
    const response = await post(
      '/government/paye/returns',
      {
        employerTaxpayerId: school,
        periodYear: LAST_MONTH.year,
        periodMonth: LAST_MONTH.month,
        lines: [{ employeeName: 'Teacher', grossEmolumentKobo: '12000000' }],
      },
      auth,
    );
    assert.equal(response.status, 403, `got ${response.status}`);
  });

  it('will not accept a tax figure, because there is nowhere to put one', async () => {
    /*
     * The property stated as a request shape. A caller who sends a tax amount
     * has it dropped by the schema — the assessment still comes out of the
     * emoluments, so the number they sent buys them nothing.
     */
    const school = await employer('Negotiating School');
    const officer = await loginAs('+2348000000001');
    const response = await post(
      '/government/paye/returns',
      {
        employerTaxpayerId: school,
        periodYear: LAST_MONTH.year,
        periodMonth: LAST_MONTH.month,
        lines: [
          { employeeName: 'Teacher', grossEmolumentKobo: '12000000', taxKobo: '1' },
        ],
      },
      { token: officer.accessToken, idempotencyKey: 'paye-negotiate-1' },
    );
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(
      response.body.taxDueKobo,
      '800000',
      'the tax is what the bands say, not what the caller hoped',
    );
  });

  it('refuses a supervisor an employer outside their territories', async () => {
    /*
     * Refused rather than answered empty. The permission says "territory"; a
     * route that offers itself to it and then narrows nothing hands the whole
     * State to somebody holding a district's worth of authority.
     */
    const school = await employer('Out Of Reach School');
    await createGovernmentUser({
      fullName: 'District Supervisor',
      phone: '+2348000000078',
      role: 'supervisor',
    });
    const supervisor = await loginAs('+2348000000078');

    const response = await get(`/government/paye/employers/${school}/returns`, {
      token: supervisor.accessToken,
    });
    assert.equal(response.status, 403, `got ${response.status}: ${JSON.stringify(response.body)}`);
  });

  it('lets an officer read what an employer has filed', async () => {
    const school = await employer('Readable School');
    await file(school, payroll(2));
    const officer = await loginAs('+2348000000001');

    const response = await get(`/government/paye/employers/${school}/returns`, {
      token: officer.accessToken,
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.length, 1);
  });
});
