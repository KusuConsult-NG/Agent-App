/**
 * PAYE from informal employers: the payroll schedule.
 *
 * Phase 3 of the informal-sector programme, and the largest single line in it.
 * "Informal" does not mean petty trader — it means outside the net, and a
 * private school with forty teachers, a clinic with fifteen staff or a haulage
 * yard with twenty drivers is informal in the only sense that matters: not
 * registered, not assessed, paying nothing. One of them is worth a hundred
 * tailors and takes one visit rather than a hundred.
 *
 * WHY THIS NEEDED NEW MACHINERY WHEN `PIT-PAYE` WAS ALREADY IN THE CATALOGUE.
 *
 * A single PAYE assessment could always be raised against an employer, from a
 * figure somebody typed. That is not PAYE. An employer does not owe an amount;
 * they owe the sum of what they deducted from named people, and until the
 * platform could hold those names there was no difference between an employer
 * remitting everything and an employer remitting a third of it. The schedule
 * is what makes the liability checkable, and therefore collectable.
 *
 * THE INVARIANT THIS TURNS ON.
 *
 * The employer declares emoluments. The server computes the tax. At no point
 * is a tax figure accepted from the filer — the same rule the payment path
 * applies to a caller-supplied `status: VERIFIED`, and for the same reason:
 * the moment a number is typeable it is negotiable, and an employer
 * negotiating their own PAYE is the entire failure mode of the tax.
 *
 * Migration 056 backs this rather than trusting the present file: a filed
 * schedule whose lines do not add up to its header is refused by the database,
 * so a service that stopped computing, or computed against the wrong bands,
 * cannot quietly write a schedule that looks fine.
 *
 * ANNUAL BANDS, MONTHLY MONEY.
 *
 * The PAYE bands are annual — the first ₦800,000 is untaxed. A monthly
 * emolument scored directly against them puts almost every employee in Plateau
 * State in the nil band, which would have the platform confidently assessing
 * zero on a payroll of forty people. So each line is annualised, taxed, and
 * divided back down. The rounding is done per employee rather than on the
 * total, because the per-employee figure is the one that appears on somebody's
 * payslip and has to reconcile with what was actually deducted from them.
 *
 * FILING IS ONE ACT.
 *
 * There is no draft. A payroll is produced whole — by the employer's own
 * system, or written out on a form — and arrives whole. A half-entered
 * schedule would be a liability the platform holds and cannot act on, and the
 * one state nobody could interpret: is this employer mid-filing, or have they
 * declared eleven of their forty staff?
 */

import type { PoolClient } from 'pg';
import type { Db } from '../db/pool';
import { query, queryOne, withTransaction } from '../db/pool';
import { computeAmount, type RateVersion } from './rate-engine';
import { createAssessmentIn, resolveRate } from './revenue';
import { recordAudit } from './audit';
import { scopeParams, type ReportScope } from './report-scope';
import { badRequest, conflict, notFound } from '../lib/errors';
import { REVENUE_STATES_SQL } from '../lib/revenue-states';

const MONTHS_IN_YEAR = 12n;

export interface PayeLineInput {
  employeeName: string;
  employeeTin?: string | null;
  employeePhone?: string | null;
  /** What this employee was paid for the month, in kobo. */
  grossEmolumentKobo: string;
}

export interface FilePayeParams {
  employerTaxpayerId: string;
  periodYear: number;
  periodMonth: number;
  lines: PayeLineInput[];
  actorId: string;
  actorRole: string;
  ipAddress?: string | null;
}

export interface PayeLine {
  employeeName: string;
  employeeTin: string | null;
  grossEmolumentKobo: string;
  taxKobo: string;
}

export interface PayeFiling {
  scheduleId: string;
  employerTaxpayerId: string;
  periodYear: number;
  periodMonth: number;
  employeeCount: number;
  grossEmolumentsKobo: string;
  taxDueKobo: string;
  assessmentId: string;
  invoiceNumber: string;
  transactionId: string;
  /** Employees the employer could not give a TIN for. */
  employeesWithoutTin: number;
  lines: PayeLine[];
}

/**
 * What one employee owes for one month, from what they were paid for it.
 *
 * Exported because it is the arithmetic an officer will be asked to justify at
 * a counter, and a rule that can only be exercised through a filing is a rule
 * that cannot be tested against a worked example.
 */
export function monthlyPayeFor(rate: RateVersion, monthlyGrossKobo: bigint): bigint {
  if (monthlyGrossKobo <= 0n) {
    throw badRequest('An employee’s emolument must be more than nothing.');
  }

  const annual = monthlyGrossKobo * MONTHS_IN_YEAR;
  const annualTax = computeAmount(rate, { baseAmountKobo: annual.toString() }).amountKobo;

  /*
   * Rounded down to the kobo. An employer deducts a whole number of kobo from
   * a payslip and can only remit what they deducted; rounding up would demand
   * a fraction of a kobo more than anybody actually withheld, thirty times a
   * month, and the difference would sit unexplained on the employer's account
   * for ever.
   */
  return annualTax / MONTHS_IN_YEAR;
}

/**
 * Accept a month's payroll, compute the tax on it, and raise the assessment.
 *
 * One transaction. The schedule, its lines and the assessment that makes the
 * money owed either all exist or none of them do — a schedule with no
 * assessment is a declared liability nobody can pay, and an assessment with no
 * schedule is the untraceable figure this whole table exists to abolish.
 */
export async function filePayeSchedule(params: FilePayeParams): Promise<PayeFiling> {
  if (params.lines.length === 0) {
    throw badRequest('A PAYE return must name the employees it covers.');
  }
  if (params.lines.length > 2000) {
    throw badRequest(
      'This return covers more than 2,000 employees. Split it, or contact PSIRS to file directly.',
    );
  }

  const now = new Date();
  const periodEnd = new Date(Date.UTC(params.periodYear, params.periodMonth, 0));
  if (periodEnd.getTime() > now.getTime()) {
    /*
     * A month that has not finished cannot have been paid. Accepting one would
     * let an employer file an empty-looking future month and appear compliant
     * on a date when nothing was owed yet.
     */
    throw badRequest('That month has not ended yet, so there is no payroll to return.');
  }

  return withTransaction(async (client) => {
    const employer = await queryOne<{ id: string; status: string; lga_id: string; taxpayer_type: string }>(
      client,
      'SELECT id, status, lga_id, taxpayer_type FROM taxpayers WHERE id = $1',
      [params.employerTaxpayerId],
    );
    if (!employer) throw notFound('That employer');
    if (employer.status !== 'ACTIVE') {
      throw conflict(
        'TAXPAYER_NOT_ACTIVE',
        `This employer record is ${employer.status.toLowerCase()} and cannot file a return.`,
      );
    }

    const existing = await queryOne<{ id: string }>(
      client,
      `SELECT id FROM paye_schedules
        WHERE employer_taxpayer_id = $1 AND period_year = $2 AND period_month = $3
          AND status <> 'CANCELLED'`,
      [params.employerTaxpayerId, params.periodYear, params.periodMonth],
    );
    if (existing) {
      throw conflict(
        'PAYE_ALREADY_FILED',
        'A return has already been filed for this employer and month. ' +
          'Cancel it first if it was wrong — a second filing would double what they appear to owe.',
        'Open the existing return to cancel and replace it.',
      );
    }

    const item = await queryOne<{ id: string }>(
      client,
      `SELECT id FROM revenue_items WHERE code = 'PIT-PAYE'`,
      [],
    );
    if (!item) throw notFound('The PAYE revenue item');

    const rate = await resolveRate(client, item.id, now, employer.lga_id);

    /*
     * Per employee, then summed. Summing the emoluments and taxing the total
     * would tax a payroll of forty people as though it were one very large
     * salary, pushing the whole of it into the top band — an overstatement of
     * the liability by a wide margin, and one an employer would be right to
     * refuse to pay.
     */
    let grossTotal = 0n;
    let taxTotal = 0n;
    const computed = params.lines.map((line) => {
      const gross = BigInt(line.grossEmolumentKobo);
      const tax = monthlyPayeFor(rate, gross);
      grossTotal += gross;
      taxTotal += tax;
      return { ...line, gross, tax };
    });

    /*
     * The assessment is raised first and on this same transaction, so the
     * schedule can record it in the row that creates it — the column is
     * immutable, which is what stops an assessment being re-pointed at a
     * different filing afterwards.
     *
     * `createAssessmentIn` rather than `createAssessment` for the reason that
     * matters more: the latter opens its own connection, so the invoice would
     * commit independently and a schedule that then failed to insert would
     * leave the employer holding a bill with no return behind it. The filing
     * is one act and it commits as one.
     *
     * The amount is the total this service computed per employee, and the
     * database will refuse the filing at commit if the assessment does not
     * carry exactly that.
     */
    const assessment = await createAssessmentIn(client, {
      taxpayerId: params.employerTaxpayerId,
      revenueItemId: item.id,
      inputs: {},
      periodLabel: `${params.periodYear}-${String(params.periodMonth).padStart(2, '0')}`,
      assessmentType: 'OFFICER',
      actorId: params.actorId,
      actorRole: params.actorRole,
      channel: 'OFFICER',
      ipAddress: params.ipAddress ?? null,
      precomputedAmountKobo: taxTotal,
      precomputedReason:
        `PAYE for ${computed.length} employee(s), computed per employee from the ` +
        `emoluments declared on this return`,
    });

    const schedule = await queryOne<{ id: string }>(
      client,
      `INSERT INTO paye_schedules
         (employer_taxpayer_id, period_year, period_month, employee_count,
          gross_emoluments_kobo, tax_due_kobo, rate_version_id, assessment_id, filed_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id`,
      [
        params.employerTaxpayerId,
        params.periodYear,
        params.periodMonth,
        computed.length,
        grossTotal.toString(),
        taxTotal.toString(),
        rate.id,
        assessment.assessmentId,
        params.actorId,
      ],
    );

    for (const line of computed) {
      await client.query(
        `INSERT INTO paye_schedule_lines
           (schedule_id, employee_name, employee_tin, employee_phone,
            gross_emolument_kobo, tax_kobo)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          schedule!.id,
          line.employeeName.trim(),
          line.employeeTin?.trim() || null,
          line.employeePhone?.trim() || null,
          line.gross.toString(),
          line.tax.toString(),
        ],
      );
    }

    await recordAudit(client, {
      actorId: params.actorId,
      actorRole: params.actorRole,
      action: 'paye.filed',
      entityType: 'paye_schedule',
      entityId: schedule!.id,
      newValue: {
        employees: computed.length,
        grossKobo: grossTotal.toString(),
        taxKobo: taxTotal.toString(),
        period: `${params.periodYear}-${params.periodMonth}`,
      },
      reason: 'PAYE return filed by employer',
    });

    return {
      scheduleId: schedule!.id,
      employerTaxpayerId: params.employerTaxpayerId,
      periodYear: params.periodYear,
      periodMonth: params.periodMonth,
      employeeCount: computed.length,
      grossEmolumentsKobo: grossTotal.toString(),
      taxDueKobo: taxTotal.toString(),
      assessmentId: assessment.assessmentId,
      invoiceNumber: assessment.invoiceNumber,
      transactionId: assessment.transactionId,
      employeesWithoutTin: computed.filter((line) => !line.employeeTin?.trim()).length,
      lines: computed.map((line) => ({
        employeeName: line.employeeName.trim(),
        employeeTin: line.employeeTin?.trim() || null,
        grossEmolumentKobo: line.gross.toString(),
        taxKobo: line.tax.toString(),
      })),
    };
  });
}

/**
 * Withdraw a filing that was wrong.
 *
 * The schedule is not edited and its lines are not touched. What an employer
 * declared is a fact about what they declared, and it survives being wrong —
 * the correction is a fresh return, and this records that the first one is no
 * longer the State's position and who decided that.
 */
export async function cancelPayeSchedule(
  db: Db,
  params: { scheduleId: string; reason: string; actorId: string; actorRole: string },
): Promise<void> {
  if (!params.reason.trim()) {
    throw badRequest('Say why this return is being withdrawn.');
  }

  await withTransaction(async (client) => {
    const schedule = await queryOne<{ id: string; status: string; assessment_id: string | null }>(
      client,
      'SELECT id, status, assessment_id FROM paye_schedules WHERE id = $1 FOR UPDATE',
      [params.scheduleId],
    );
    if (!schedule) throw notFound('That PAYE return');
    if (schedule.status === 'CANCELLED') {
      throw conflict('PAYE_ALREADY_CANCELLED', 'This return has already been withdrawn.');
    }

    await client.query(
      `UPDATE paye_schedules
          SET status = 'CANCELLED', cancelled_reason = $2, cancelled_at = now(), cancelled_by = $3
        WHERE id = $1`,
      [params.scheduleId, params.reason.trim(), params.actorId],
    );

    /*
     * And the bill goes with it.
     *
     * Filing raised an assessment, which raised an invoice, which is what the
     * employer owes. Withdrawing the return without withdrawing that left them
     * billed for a return PSIRS had taken back — and the filing path's own
     * refusal is what makes it worse than an oversight. It turns a second
     * filing away with "Cancel it first if it was wrong — a second filing
     * would double what they appear to owe", and tells the officer to "cancel
     * and replace". An officer who followed that instruction left the employer
     * owing both figures, which is exactly the doubling the sentence promised
     * cancelling would prevent.
     *
     * The remedy is the one `enumeration.ts` already uses when an objection is
     * upheld, including its guard. A bill that has been paid is not withdrawn
     * here: money that has reached a government account comes back through a
     * refund, with the accountability a refund carries, not by an UPDATE that
     * makes the demand disappear.
     */
    if (schedule.assessment_id) {
      await client.query(
        `UPDATE invoices SET status = 'CANCELLED'
          WHERE assessment_id = $1 AND status IN ('UNPAID', 'PARTIALLY_PAID')`,
        [schedule.assessment_id],
      );
    }

    await recordAudit(client, {
      actorId: params.actorId,
      actorRole: params.actorRole,
      action: 'paye.cancelled',
      entityType: 'paye_schedule',
      entityId: params.scheduleId,
      oldValue: { status: schedule.status },
      newValue: { status: 'CANCELLED' },
      reason: params.reason.trim(),
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Who should be filing and is not                                            */
/* -------------------------------------------------------------------------- */

/**
 * Sectors where a business of any size almost certainly has a payroll.
 *
 * A school has teachers, a clinic has nurses, a hotel has staff and a haulage
 * yard has drivers. This is not a claim that every such business owes PAYE —
 * it is a claim that every one of them is worth an officer asking, which is
 * what a lead list is for. Kept deliberately short: adding RETAIL_TRADE would
 * make the list mostly one-person shops and destroy its yield per visit,
 * which is the one property that makes this phase worth running before the
 * enumeration phases.
 */
const EMPLOYING_SECTORS = [
  'EDUCATION',
  'HEALTHCARE',
  'HOTEL_HOSPITALITY',
  'TRANSPORT_HAULAGE',
  'TRANSPORT_PASSENGER',
  'MANUFACTURING',
  'CONSTRUCTION',
  'FINANCIAL_SERVICES',
  'PROFESSIONAL_SERVICES',
] as const;

/** Sectors that owe consumption tax on what they sell over a counter. */
const CONSUMPTION_SECTORS = [
  'HOTEL_HOSPITALITY',
  'FOOD_BEVERAGE',
  'ENTERTAINMENT_ARTS',
] as const;

export interface EmployerLead {
  taxpayerId: string;
  name: string;
  tin: string | null;
  phone: string;
  lgaId: string;
  lgaName: string;
  economicSector: string | null;
  natureOfBusiness: string | null;
  /** Months since they last filed anything at all — null if they never have. */
  monthsSinceLastFiling: number | null;
  /** What they have paid the State in the last year, in kobo. */
  paidLastYearKobo: string;
}

export interface EmployerLeads {
  summary: {
    leads: number;
    /** Employers in these sectors who *are* filing, for the denominator. */
    filing: number;
  };
  rows: EmployerLead[];
}

/**
 * Businesses in employing sectors with no PAYE return on record.
 *
 * The highest-yield list in the plan after the arrears worklist, because each
 * name is potentially dozens of taxpayers and the premises cannot move. It is
 * built entirely from `economic_sector`, which the register has carried since
 * registration — no new field work, no enumeration.
 *
 * The `filing` figure beside it is the denominator. "Forty schools have never
 * filed" reads very differently when there are forty-two schools on the
 * register than when there are four hundred, and an officer given only the
 * first number cannot tell which situation they are in.
 */
export async function employersNotFiling(
  db: Db,
  params: { lgaId?: string; sector?: string; limit?: number } = {},
  scope: ReportScope = { kind: 'STATEWIDE' },
): Promise<EmployerLeads> {
  const { statewide, lgaIds } = scopeParams(scope);
  const limit = Math.min(Math.max(params.limit ?? 100, 1), 500);

  const rows = await query<{
    taxpayer_id: string;
    name: string;
    tin: string | null;
    phone: string;
    lga_id: string;
    lga_name: string;
    economic_sector: string | null;
    nature_of_business: string | null;
    months_since_last_filing: string | null;
    paid_last_year_kobo: string;
  }>(
    db,
    `SELECT t.id AS taxpayer_id,
            COALESCE(NULLIF(trim(t.business_name), ''),
                     trim(coalesce(t.first_name,'') || ' ' || coalesce(t.last_name,''))) AS name,
            t.tin,
            t.phone,
            t.lga_id,
            l.name AS lga_name,
            t.economic_sector,
            t.nature_of_business,
            NULL::text AS months_since_last_filing,
            COALESCE((
              SELECT SUM(tr.amount_kobo)
                FROM transactions tr
               WHERE tr.taxpayer_id = t.id
                 AND tr.status IN ${REVENUE_STATES_SQL}
                 AND tr.created_at > now() - interval '1 year'
            ), 0)::text AS paid_last_year_kobo
       FROM taxpayers t
       JOIN lgas l ON l.id = t.lga_id
      WHERE t.status = 'ACTIVE'
        AND t.economic_sector = ANY($1::text[])
        AND ($2 OR t.lga_id = ANY($3::uuid[]))
        AND ($4::uuid IS NULL OR t.lga_id = $4::uuid)
        AND NOT EXISTS (
              SELECT 1 FROM paye_schedules s
               WHERE s.employer_taxpayer_id = t.id AND s.status <> 'CANCELLED'
            )
      ORDER BY name
      LIMIT $5`,
    [
      /*
       * One place narrows by sector, not two. The chosen sector is applied by
       * replacing the list itself, which the denominator below uses as well —
       * so the two figures cannot come to disagree about which sectors they
       * were counting. A second `economic_sector = $n` clause alongside it
       * looked like belt and braces and was really a way for one of them to be
       * wrong without anything noticing.
       */
      params.sector ? [params.sector] : EMPLOYING_SECTORS,
      statewide,
      lgaIds,
      params.lgaId ?? null,
      limit,
    ],
  );

  const filing = await queryOne<{ count: string }>(
    db,
    `SELECT count(DISTINCT t.id)::text AS count
       FROM taxpayers t
      WHERE t.status = 'ACTIVE'
        AND t.economic_sector = ANY($1::text[])
        AND ($2 OR t.lga_id = ANY($3::uuid[]))
        AND ($4::uuid IS NULL OR t.lga_id = $4::uuid)
        AND EXISTS (
              SELECT 1 FROM paye_schedules s
               WHERE s.employer_taxpayer_id = t.id AND s.status <> 'CANCELLED'
            )`,
    [
      params.sector ? [params.sector] : EMPLOYING_SECTORS,
      statewide,
      lgaIds,
      params.lgaId ?? null,
    ],
  );

  return {
    summary: {
      leads: rows.length,
      filing: Number.parseInt(filing?.count ?? '0', 10),
    },
    rows: rows.map((row) => ({
      taxpayerId: row.taxpayer_id,
      name: row.name,
      tin: row.tin,
      phone: row.phone,
      lgaId: row.lga_id,
      lgaName: row.lga_name,
      economicSector: row.economic_sector,
      natureOfBusiness: row.nature_of_business,
      monthsSinceLastFiling: null,
      paidLastYearKobo: row.paid_last_year_kobo,
    })),
  };
}

/**
 * Hospitality premises with no consumption tax on record.
 *
 * Five per cent of turnover rather than one, on premises that cannot hide, and
 * the item has been in the catalogue all along. What was missing is the
 * question: which hotels, restaurants and event centres on our own register
 * have never been assessed for it.
 */
export async function premisesNotPayingConsumptionTax(
  db: Db,
  params: { lgaId?: string; limit?: number } = {},
  scope: ReportScope = { kind: 'STATEWIDE' },
): Promise<EmployerLeads> {
  const { statewide, lgaIds } = scopeParams(scope);
  const limit = Math.min(Math.max(params.limit ?? 100, 1), 500);

  const rows = await query<{
    taxpayer_id: string;
    name: string;
    tin: string | null;
    phone: string;
    lga_id: string;
    lga_name: string;
    economic_sector: string | null;
    nature_of_business: string | null;
    months_since_last_filing: string | null;
    paid_last_year_kobo: string;
  }>(
    db,
    `SELECT t.id AS taxpayer_id,
            COALESCE(NULLIF(trim(t.business_name), ''),
                     trim(coalesce(t.first_name,'') || ' ' || coalesce(t.last_name,''))) AS name,
            t.tin, t.phone, t.lga_id, l.name AS lga_name,
            t.economic_sector, t.nature_of_business,
            (SELECT (EXTRACT(EPOCH FROM (now() - max(a.created_at))) / 2592000)::int::text
               FROM assessments a
               JOIN revenue_items ri ON ri.id = a.revenue_item_id
              WHERE a.taxpayer_id = t.id AND ri.code = 'CONSUMPTION-TAX'
            ) AS months_since_last_filing,
            COALESCE((
              SELECT SUM(tr.amount_kobo)
                FROM transactions tr
               WHERE tr.taxpayer_id = t.id
                 AND tr.status IN ${REVENUE_STATES_SQL}
                 AND tr.created_at > now() - interval '1 year'
            ), 0)::text AS paid_last_year_kobo
       FROM taxpayers t
       JOIN lgas l ON l.id = t.lga_id
      WHERE t.status = 'ACTIVE'
        AND t.economic_sector = ANY($1::text[])
        AND ($2 OR t.lga_id = ANY($3::uuid[]))
        AND ($4::uuid IS NULL OR t.lga_id = $4::uuid)
        /*
         * Never assessed, or not for a year. Consumption tax is monthly, so
         * unlike PAYE — where the question is whether an employer is in the
         * system at all — a hotel that filed once in 2024 and stopped is
         * exactly as much of a lead as one that never filed.
         */
        AND NOT EXISTS (
              SELECT 1
                FROM assessments a
                JOIN revenue_items ri ON ri.id = a.revenue_item_id
               WHERE a.taxpayer_id = t.id
                 AND ri.code = 'CONSUMPTION-TAX'
                 AND a.created_at > now() - interval '1 year'
            )
      ORDER BY name
      LIMIT $5`,
    [CONSUMPTION_SECTORS, statewide, lgaIds, params.lgaId ?? null, limit],
  );

  const filing = await queryOne<{ count: string }>(
    db,
    `SELECT count(DISTINCT t.id)::text AS count
       FROM taxpayers t
      WHERE t.status = 'ACTIVE'
        AND t.economic_sector = ANY($1::text[])
        AND ($2 OR t.lga_id = ANY($3::uuid[]))
        AND ($4::uuid IS NULL OR t.lga_id = $4::uuid)
        AND EXISTS (
              SELECT 1
                FROM assessments a
                JOIN revenue_items ri ON ri.id = a.revenue_item_id
               WHERE a.taxpayer_id = t.id
                 AND ri.code = 'CONSUMPTION-TAX'
                 AND a.created_at > now() - interval '1 year'
            )`,
    [CONSUMPTION_SECTORS, statewide, lgaIds, params.lgaId ?? null],
  );

  return {
    summary: { leads: rows.length, filing: Number.parseInt(filing?.count ?? '0', 10) },
    rows: rows.map((row) => ({
      taxpayerId: row.taxpayer_id,
      name: row.name,
      tin: row.tin,
      phone: row.phone,
      lgaId: row.lga_id,
      lgaName: row.lga_name,
      economicSector: row.economic_sector,
      natureOfBusiness: row.nature_of_business,
      monthsSinceLastFiling:
        row.months_since_last_filing === null
          ? null
          : Number.parseInt(row.months_since_last_filing, 10),
      paidLastYearKobo: row.paid_last_year_kobo,
    })),
  };
}

/** What an employer has filed, most recent month first. */
export async function payeHistory(
  db: Db,
  employerTaxpayerId: string,
  limit = 24,
): Promise<
  {
    scheduleId: string;
    periodYear: number;
    periodMonth: number;
    status: string;
    employeeCount: number;
    grossEmolumentsKobo: string;
    taxDueKobo: string;
    filedAt: Date;
    cancelledReason: string | null;
  }[]
> {
  const rows = await query<{
    id: string;
    period_year: number;
    period_month: number;
    status: string;
    employee_count: number;
    gross_emoluments_kobo: string;
    tax_due_kobo: string;
    filed_at: Date;
    cancelled_reason: string | null;
  }>(
    db,
    `SELECT id, period_year, period_month, status, employee_count,
            gross_emoluments_kobo, tax_due_kobo, filed_at, cancelled_reason
       FROM paye_schedules
      WHERE employer_taxpayer_id = $1
      ORDER BY period_year DESC, period_month DESC
      LIMIT $2`,
    [employerTaxpayerId, Math.min(Math.max(limit, 1), 120)],
  );

  return rows.map((row) => ({
    scheduleId: row.id,
    periodYear: row.period_year,
    periodMonth: row.period_month,
    status: row.status,
    employeeCount: row.employee_count,
    grossEmolumentsKobo: row.gross_emoluments_kobo,
    taxDueKobo: row.tax_due_kobo,
    filedAt: row.filed_at,
    cancelledReason: row.cancelled_reason,
  }));
}
