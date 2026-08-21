/**
 * Taxpayer compliance scoring and social incentive programmes (PRD §40, §41).
 *
 * PRD §40 contains an explicit safeguard that shapes this module:
 *
 *   "The platform should not automatically deny essential public services
 *    merely because a person is not tax-compliant, unless such linkage is
 *    specifically authorized by applicable law or policy."
 *
 * Accordingly, eligibility here is *additive*: a programme records who
 * qualifies for a benefit and why. Nothing in this module withdraws or blocks a
 * service, and `essential_service` programmes are rejected outright unless the
 * programme record names the legal authority for the linkage.
 */

import type { PoolClient } from 'pg';
import { parseKobo } from '@psirs/shared';
import type { Db } from '../db/pool';
import { query, queryOne, withTransaction } from '../db/pool';
import { badRequest, notFound } from '../lib/errors';
import { recordAudit } from './audit';

export interface ComplianceBreakdown {
  score: number;
  components: { factor: string; points: number; detail: string }[];
}

/**
 * Recompute a taxpayer's compliance score (PRD §40).
 *
 * The weighting is explicit and stored alongside the score so a taxpayer can be
 * told why they scored what they did, and an officer can defend it.
 */
export async function computeComplianceScore(
  client: PoolClient,
  taxpayerId: string,
): Promise<ComplianceBreakdown> {
  const stats = await queryOne<{
    has_tin: boolean;
    paid_count: string;
    late_count: string;
    outstanding_kobo: string;
    distinct_periods: string;
    last_payment_at: Date | null;
    reversed_count: string;
  }>(
    client,
    `SELECT
       (SELECT tin IS NOT NULL FROM taxpayers WHERE id = $1) AS has_tin,
       count(*) FILTER (WHERE t.status IN ('SETTLED','RECEIPT_GENERATED','RECONCILIATION_PENDING'))::text
         AS paid_count,
       count(*) FILTER (WHERE i.expires_at IS NOT NULL AND t.verified_at > i.expires_at)::text
         AS late_count,
       COALESCE((SELECT SUM(total_amount_kobo - amount_paid_kobo) FROM invoices
                  WHERE taxpayer_id = $1 AND status IN ('UNPAID','PARTIALLY_PAID')), 0)::text
         AS outstanding_kobo,
       count(DISTINCT a.period_label)::text AS distinct_periods,
       max(t.verified_at) AS last_payment_at,
       count(*) FILTER (WHERE t.status IN ('REVERSED','REFUNDED'))::text AS reversed_count
     FROM transactions t
     JOIN invoices i ON i.id = t.invoice_id
     JOIN assessments a ON a.id = t.assessment_id
     WHERE t.taxpayer_id = $1`,
    [taxpayerId],
  );

  const components: ComplianceBreakdown['components'] = [];
  let score = 0;

  const hasTin = stats?.has_tin ?? false;
  if (hasTin) {
    score += 20;
    components.push({ factor: 'Valid TIN', points: 20, detail: 'Taxpayer holds a valid TIN' });
  } else {
    components.push({ factor: 'Valid TIN', points: 0, detail: 'No TIN assigned yet' });
  }

  const paid = Number.parseInt(stats?.paid_count ?? '0', 10);
  const late = Number.parseInt(stats?.late_count ?? '0', 10);
  const onTime = Math.max(0, paid - late);

  const paymentPoints = Math.min(35, onTime * 5);
  score += paymentPoints;
  components.push({
    factor: 'Payments made on time',
    points: paymentPoints,
    detail: `${onTime} on-time payment(s) of ${paid} total`,
  });

  if (late > 0) {
    const penalty = Math.min(15, late * 5);
    score -= penalty;
    components.push({
      factor: 'Late payments',
      points: -penalty,
      detail: `${late} payment(s) made after the invoice expiry date`,
    });
  }

  const periods = Number.parseInt(stats?.distinct_periods ?? '0', 10);
  const periodPoints = Math.min(20, periods * 5);
  score += periodPoints;
  components.push({
    factor: 'Compliant periods',
    points: periodPoints,
    detail: `${periods} distinct assessment period(s) settled`,
  });

  const outstanding = parseKobo(stats?.outstanding_kobo ?? '0');
  if (outstanding === 0n) {
    score += 25;
    components.push({
      factor: 'No outstanding liabilities',
      points: 25,
      detail: 'No unpaid invoices on record',
    });
  } else {
    components.push({
      factor: 'Outstanding liabilities',
      points: 0,
      detail: `₦${(outstanding / 100n).toString()} outstanding across unpaid invoices`,
    });
  }

  const reversed = Number.parseInt(stats?.reversed_count ?? '0', 10);
  if (reversed > 0) {
    const penalty = Math.min(10, reversed * 5);
    score -= penalty;
    components.push({
      factor: 'Reversed transactions',
      points: -penalty,
      detail: `${reversed} transaction(s) reversed or refunded`,
    });
  }

  score = Math.max(0, Math.min(100, score));

  await client.query(
    `INSERT INTO taxpayer_compliance
       (taxpayer_id, score, on_time_payments, late_payments, compliant_periods,
        outstanding_amount_kobo, has_valid_tin, last_payment_at, score_breakdown, computed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
     ON CONFLICT (taxpayer_id) DO UPDATE SET
       score = EXCLUDED.score,
       on_time_payments = EXCLUDED.on_time_payments,
       late_payments = EXCLUDED.late_payments,
       compliant_periods = EXCLUDED.compliant_periods,
       outstanding_amount_kobo = EXCLUDED.outstanding_amount_kobo,
       has_valid_tin = EXCLUDED.has_valid_tin,
       last_payment_at = EXCLUDED.last_payment_at,
       score_breakdown = EXCLUDED.score_breakdown,
       computed_at = now()`,
    [
      taxpayerId,
      score,
      onTime,
      late,
      periods,
      outstanding.toString(),
      hasTin,
      stats?.last_payment_at ?? null,
      JSON.stringify(components),
    ],
  );

  return { score, components };
}

export interface ProgrammeInput {
  name: string;
  code: string;
  description?: string;
  benefitType: string;
  benefitDescription?: string;
  targetLgaIds?: string[];
  targetTaxpayerTypes?: string[];
  minimumScore?: number;
  minimumCompliancePeriods?: number;
  requiresNoArrears?: boolean;
  startDate: string;
  endDate?: string | null;
  approvalAuthority: string;
  /**
   * Set only when law or policy authorises linking an essential public service
   * to tax compliance. Required to create such a programme (PRD §40).
   */
  essentialServiceLegalBasis?: string | null;
}

const ESSENTIAL_SERVICE_BENEFITS = [
  'HEALTHCARE',
  'EDUCATION',
  'WATER',
  'EMERGENCY_RELIEF',
  'SOCIAL_WELFARE',
];

export async function createProgramme(params: {
  input: ProgrammeInput;
  actorId: string;
  actorRole: string;
}): Promise<{ programmeId: string }> {
  const { input } = params;

  // PRD §40's safeguard, enforced rather than documented.
  if (
    ESSENTIAL_SERVICE_BENEFITS.includes(input.benefitType.toUpperCase()) &&
    !input.essentialServiceLegalBasis
  ) {
    throw badRequest(
      'This programme links an essential public service to tax compliance. ' +
        'It can only be created if the legal or policy authority for that linkage is recorded.',
      [
        {
          field: 'essentialServiceLegalBasis',
          issue: 'Required for programmes affecting essential public services',
        },
      ],
    );
  }

  return withTransaction(async (client) => {
    const programme = await queryOne<{ id: string }>(
      client,
      `INSERT INTO incentive_programmes
         (name, code, description, benefit_type, benefit_description, eligibility_rules,
          target_lga_ids, target_taxpayer_types, minimum_score, minimum_compliance_periods,
          requires_no_arrears, start_date, end_date, approval_authority, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'DRAFT',$15)
       RETURNING id`,
      [
        input.name,
        input.code,
        input.description ?? null,
        input.benefitType,
        input.benefitDescription ?? null,
        JSON.stringify({
          essentialServiceLegalBasis: input.essentialServiceLegalBasis ?? null,
        }),
        input.targetLgaIds ?? [],
        input.targetTaxpayerTypes ?? ['INDIVIDUAL', 'BUSINESS'],
        input.minimumScore ?? 0,
        input.minimumCompliancePeriods ?? 0,
        input.requiresNoArrears ?? true,
        input.startDate,
        input.endDate ?? null,
        input.approvalAuthority,
        params.actorId,
      ],
    );

    await recordAudit(client, {
      actorId: params.actorId,
      actorRole: params.actorRole,
      action: 'incentive.programme_created',
      entityType: 'incentive_programme',
      entityId: programme!.id,
      newValue: {
        code: input.code,
        benefitType: input.benefitType,
        minimumScore: input.minimumScore ?? 0,
        essentialServiceLegalBasis: input.essentialServiceLegalBasis ?? null,
      },
    });

    return { programmeId: programme!.id };
  });
}

/**
 * Evaluate a taxpayer against a programme, recording the reasons either way
 * (PRD §41: "The system should record why a citizen qualifies").
 */
export async function evaluateEligibility(
  params: {
    programmeId: string;
    taxpayerId: string;
  },
  existingClient?: PoolClient,
): Promise<{ eligible: boolean; reasons: string[]; score: number }> {
  const evaluate = async (client: PoolClient) => {
    const programme = await queryOne<{
      id: string;
      name: string;
      minimum_score: number;
      minimum_compliance_periods: number;
      requires_no_arrears: boolean;
      target_lga_ids: string[];
      target_taxpayer_types: string[];
      start_date: Date;
      end_date: Date | null;
      status: string;
    }>(client, 'SELECT * FROM incentive_programmes WHERE id = $1', [params.programmeId]);
    if (!programme) throw notFound('That programme');

    const taxpayer = await queryOne<{ lga_id: string; taxpayer_type: string; tin: string | null }>(
      client,
      'SELECT lga_id, taxpayer_type, tin FROM taxpayers WHERE id = $1',
      [params.taxpayerId],
    );
    if (!taxpayer) throw notFound('That taxpayer');

    const compliance = await computeComplianceScore(client, params.taxpayerId);

    const detail = await queryOne<{
      compliant_periods: number;
      outstanding_amount_kobo: string;
    }>(
      client,
      'SELECT compliant_periods, outstanding_amount_kobo FROM taxpayer_compliance WHERE taxpayer_id = $1',
      [params.taxpayerId],
    );

    const reasons: string[] = [];
    let eligible = true;

    if (programme.status !== 'ACTIVE') {
      eligible = false;
      reasons.push(`The programme is ${programme.status.toLowerCase()}`);
    }

    const now = new Date();
    if (programme.start_date > now) {
      eligible = false;
      reasons.push('The programme has not opened yet');
    }
    if (programme.end_date && programme.end_date < now) {
      eligible = false;
      reasons.push('The programme has closed');
    }

    if (!programme.target_taxpayer_types.includes(taxpayer.taxpayer_type)) {
      eligible = false;
      reasons.push(`Programme is not open to ${taxpayer.taxpayer_type.toLowerCase()} taxpayers`);
    } else {
      reasons.push(`Taxpayer type ${taxpayer.taxpayer_type} is within scope`);
    }

    if (programme.target_lga_ids.length > 0 && !programme.target_lga_ids.includes(taxpayer.lga_id)) {
      eligible = false;
      reasons.push('Taxpayer is outside the programme target area');
    } else if (programme.target_lga_ids.length > 0) {
      reasons.push('Taxpayer is within the programme target area');
    }

    if (!taxpayer.tin) {
      eligible = false;
      reasons.push('A valid TIN is required');
    } else {
      reasons.push('Valid TIN on record');
    }

    if (compliance.score < programme.minimum_score) {
      eligible = false;
      reasons.push(
        `Compliance score ${compliance.score} is below the required minimum of ${programme.minimum_score}`,
      );
    } else {
      reasons.push(`Compliance score ${compliance.score} meets the minimum of ${programme.minimum_score}`);
    }

    const periods = detail?.compliant_periods ?? 0;
    if (periods < programme.minimum_compliance_periods) {
      eligible = false;
      reasons.push(
        `${periods} compliant period(s) recorded; ${programme.minimum_compliance_periods} required`,
      );
    }

    if (programme.requires_no_arrears && parseKobo(detail?.outstanding_amount_kobo ?? '0') > 0n) {
      eligible = false;
      reasons.push('There are outstanding revenue obligations');
    } else if (programme.requires_no_arrears) {
      reasons.push('No outstanding revenue obligations');
    }

    await client.query(
      `INSERT INTO programme_eligibility
         (programme_id, taxpayer_id, eligible, reasons, score_at_evaluation)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (programme_id, taxpayer_id) DO UPDATE SET
         eligible = EXCLUDED.eligible,
         reasons = EXCLUDED.reasons,
         score_at_evaluation = EXCLUDED.score_at_evaluation,
         evaluated_at = now()`,
      [params.programmeId, params.taxpayerId, eligible, JSON.stringify(reasons), compliance.score],
    );

    return { eligible, reasons, score: compliance.score };
  };

  if (existingClient) {
    return evaluate(existingClient);
  }
  return withTransaction(evaluate);
}

/**
 * Automatically recompute a taxpayer's compliance score and re-evaluate all active
 * social incentive programmes. This directly ties revenue payments and compliance
 * to government benefits eligibility (e.g. Health Insurance, Fertilizer Subsidy).
 */
export async function syncTaxpayerComplianceAndIncentives(
  dbOrClient: Db,
  taxpayerId: string,
): Promise<{ score: number; eligibleProgrammes: number }> {
  const sync = async (client: PoolClient) => {
    const compliance = await computeComplianceScore(client, taxpayerId);
    const activeProgrammes = await query<{ id: string }>(
      client,
      `SELECT id FROM incentive_programmes WHERE status = 'ACTIVE'`,
    );
    let eligibleCount = 0;
    for (const prog of activeProgrammes) {
      const result = await evaluateEligibility({ programmeId: prog.id, taxpayerId }, client);
      if (result.eligible) eligibleCount++;
    }
    return { score: compliance.score, eligibleProgrammes: eligibleCount };
  };

  if ('release' in dbOrClient && typeof (dbOrClient as PoolClient).release === 'function') {
    return sync(dbOrClient as PoolClient);
  }
  return withTransaction(sync);
}

export async function listProgrammes(db: Db, options: { status?: string } = {}) {
  return query(
    db,
    `SELECT p.id, p.name, p.code, p.description, p.benefit_type, p.benefit_description,
            p.minimum_score, p.minimum_compliance_periods, p.requires_no_arrears,
            p.start_date, p.end_date, p.approval_authority, p.status,
            (SELECT count(*) FROM programme_eligibility e
              WHERE e.programme_id = p.id AND e.eligible) AS eligible_taxpayers
       FROM incentive_programmes p
      WHERE ($1::text IS NULL OR p.status = $1)
      ORDER BY p.start_date DESC`,
    [options.status ?? null],
  );
}

export async function getTaxpayerIncentives(db: Db, taxpayerId: string) {
  const [compliance, programmes] = await Promise.all([
    queryOne(db, 'SELECT * FROM taxpayer_compliance WHERE taxpayer_id = $1', [taxpayerId]),
    query(
      db,
      `SELECT p.id, p.name, p.benefit_type, p.benefit_description, p.approval_authority,
              e.eligible, e.reasons, e.score_at_evaluation, e.evaluated_at
         FROM incentive_programmes p
         LEFT JOIN programme_eligibility e
                ON e.programme_id = p.id AND e.taxpayer_id = $1
        WHERE p.status = 'ACTIVE'
        ORDER BY p.name`,
      [taxpayerId],
    ),
  ]);

  return { compliance, programmes };
}
