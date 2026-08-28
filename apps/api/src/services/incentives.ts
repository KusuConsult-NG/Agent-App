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
    raised_count: string;
    paid_count: string;
    late_count: string;
    outstanding_kobo: string;
    distinct_periods: string;
    assessed_periods: string;
    last_payment_at: Date | null;
    reversed_count: string;
  }>(
    client,
    `SELECT
       (SELECT tin IS NOT NULL FROM taxpayers WHERE id = $1) AS has_tin,
       count(*)::text AS raised_count,
       count(*) FILTER (WHERE t.status IN ('SETTLED','RECEIPT_GENERATED','RECONCILIATION_PENDING'))::text
         AS paid_count,
       count(*) FILTER (WHERE i.expires_at IS NOT NULL AND t.verified_at > i.expires_at)::text
         AS late_count,
       COALESCE((SELECT SUM(total_amount_kobo - amount_paid_kobo) FROM invoices
                  WHERE taxpayer_id = $1 AND status IN ('UNPAID','PARTIALLY_PAID')), 0)::text
         AS outstanding_kobo,
       /*
        * An assessment with no period label is still a period.
        *
        * Most revenue items carry no period_label at all — it is set by the
        * caller, and only vehicle renewals set one. count(DISTINCT ...) ignores
        * nulls, so this counted zero for a daily market levy and one for an
        * annual shop rate. Up to twenty points turned on which levy a citizen
        * happened to be assessed under, which is not a fact about them, and
        * they could neither see it nor influence it.
        *
        * Falling back to the assessment id counts the assessment as its own
        * period, which is what an unlabelled one is: a single occasion the
        * state asked for money.
        */
       count(DISTINCT COALESCE(a.period_label, a.id::text)) FILTER (
         WHERE t.status IN ('SETTLED','RECEIPT_GENERATED','RECONCILIATION_PENDING')
       )::text AS distinct_periods,
       count(DISTINCT COALESCE(a.period_label, a.id::text))::text AS assessed_periods,
       max(t.verified_at) AS last_payment_at,
       /*
        * Only reversals the taxpayer is answerable for.
        *
        * This counted every reversal, and most of them are the state
        * correcting itself — a double charge, an assessment raised against
        * the wrong record. The score gates incentive eligibility, so counting
        * those took a farmer's fertiliser away as a penalty for PSIRS's own
        * clerical error. refunds.attributable_to defaults to GOVERNMENT, so
        * a reversal nobody classified costs the citizen nothing.
        */
       count(*) FILTER (
         WHERE t.status IN ('REVERSED','REFUNDED')
           AND EXISTS (SELECT 1 FROM refunds r
                        WHERE r.transaction_id = t.id AND r.attributable_to = 'TAXPAYER')
       )::text AS reversed_count
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

  const raised = Number.parseInt(stats?.raised_count ?? '0', 10);
  const paid = Number.parseInt(stats?.paid_count ?? '0', 10);
  const late = Number.parseInt(stats?.late_count ?? '0', 10);
  const onTime = Math.max(0, paid - late);
  const periods = Number.parseInt(stats?.distinct_periods ?? '0', 10);
  const assessedPeriods = Number.parseInt(stats?.assessed_periods ?? '0', 10);

  /*
   * WHY THESE TWO COMPONENTS ARE RATIOS AND NOT COUNTS.
   *
   * They were counts: five points per on-time payment up to thirty-five, five
   * per period up to twenty. Full marks therefore needed seven payments and
   * four periods, and a trader assessed once a year could not reach them
   * however punctually they paid. One market trader with a TIN, one levy paid
   * on time and nothing outstanding scored fifty and was told their
   * "compliance score needs improvement" — there was nothing further they
   * could have done.
   *
   * A score that cannot be earned by doing everything asked is not measuring
   * compliance, it is measuring turnover. It gates fertiliser, seed and
   * training access under PRD §41, so the arithmetic decides who receives
   * them.
   *
   * Both are now proportions of what the state actually asked this person
   * for. Paying everything, on time, owing nothing is full marks whether that
   * is one obligation or forty.
   */
  const punctuality = paid > 0 ? onTime / paid : 0;
  const paymentPoints = raised === 0 ? 0 : Math.round(35 * punctuality);
  if (raised > 0) {
    score += paymentPoints;
    components.push({
      factor: 'Payments made on time',
      points: paymentPoints,
      detail: `${onTime} of ${paid} payment(s) made on time`,
    });
  }

  if (late > 0) {
    const penalty = Math.min(15, late * 5);
    score -= penalty;
    components.push({
      factor: 'Late payments',
      points: -penalty,
      detail: `${late} payment(s) made after the invoice expiry date`,
    });
  }

  /*
   * A compliant period is one that was paid for.
   *
   * This counted every distinct period the taxpayer had ever had a transaction
   * in, with no filter on status, while describing them to the taxpayer as
   * "settled". Four assessments raised across four periods and none of them
   * paid earned the full twenty points for compliance — and
   * `minimum_compliance_periods`, which gates programme eligibility, was
   * satisfied by them. The filter is on the same statuses `paid_count` already
   * uses, which are the ones that mean money arrived.
   */
  const coverage = assessedPeriods > 0 ? periods / assessedPeriods : 0;
  const periodPoints = assessedPeriods === 0 ? 0 : Math.round(20 * coverage);
  if (assessedPeriods > 0) {
    score += periodPoints;
    components.push({
      factor: 'Compliant periods',
      points: periodPoints,
      detail: `${periods} of ${assessedPeriods} assessment period(s) settled`,
    });
  }

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

  /*
   * Nothing has been asked of this person yet.
   *
   * A ratio has no meaning with an empty denominator, and reporting the two
   * components as zero reads as a finding about conduct there has not been any
   * of. The citizen portal turned that into "your compliance score needs
   * improvement" for somebody registered the same morning. So the components
   * are omitted and their absence is stated instead, and `assessments_raised`
   * carries the same fact to every other reader of the table.
   */
  if (raised === 0) {
    components.push({
      factor: 'No assessment history',
      points: 0,
      detail: 'Nothing has been assessed against this taxpayer yet, so there is nothing to score',
    });
  }

  const reversed = Number.parseInt(stats?.reversed_count ?? '0', 10);
  if (reversed > 0) {
    const penalty = Math.min(10, reversed * 5);
    score -= penalty;
    components.push({
      factor: 'Reversed transactions',
      points: -penalty,
      detail: `${reversed} payment(s) reversed for a reason attributable to the taxpayer`,
    });
  }

  score = Math.max(0, Math.min(100, score));

  await client.query(
    `INSERT INTO taxpayer_compliance
       (taxpayer_id, score, on_time_payments, late_payments, compliant_periods,
        assessments_raised, outstanding_amount_kobo, has_valid_tin, last_payment_at,
        score_breakdown, computed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
     ON CONFLICT (taxpayer_id) DO UPDATE SET
       score = EXCLUDED.score,
       on_time_payments = EXCLUDED.on_time_payments,
       late_payments = EXCLUDED.late_payments,
       compliant_periods = EXCLUDED.compliant_periods,
       assessments_raised = EXCLUDED.assessments_raised,
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
      raised,
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
  /** Economic sectors this programme is open to. Empty means all of them. */
  targetSectors?: string[];
  requiresGroupMembership?: boolean;
  targetGroupTypes?: string[];
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
  /**
   * How compliance affects the benefit.
   *
   * ELIGIBILITY_GATE (the default) — compliance decides whether the citizen
   * qualifies. ADDITIVE_BENEFIT — compliance decides the tier and never denies.
   */
  linkageMode?: 'ELIGIBILITY_GATE' | 'ADDITIVE_BENEFIT';
}

/**
 * Benefit types that are essential public services under PRD §40.
 *
 * The list previously held only the generic words HEALTHCARE and EDUCATION,
 * and the programmes actually created were typed HEALTH_INSURANCE and
 * EDUCATION_BURSARY — so the guard below matched nothing and never fired. It
 * was dead code protecting nothing. The real type names are now included,
 * along with the generic ones, and matching is by prefix so a future
 * HEALTH_SOMETHING cannot slip past on a name again.
 */
const ESSENTIAL_SERVICE_PREFIXES = [
  'HEALTH',
  'EDUCATION',
  'WATER',
  'EMERGENCY_RELIEF',
  'SOCIAL_WELFARE',
  'SCHOLARSHIP',
];

function isEssentialService(benefitType: string): boolean {
  const type = benefitType.toUpperCase();
  return ESSENTIAL_SERVICE_PREFIXES.some((prefix) => type.startsWith(prefix));
}

export async function createProgramme(params: {
  input: ProgrammeInput;
  actorId: string;
  actorRole: string;
}): Promise<{ programmeId: string }> {
  const { input } = params;

  /*
   * PRD §40's safeguard, enforced rather than documented.
   *
   * An essential public service may be linked to tax compliance in exactly two
   * ways. Either the programme is additive — compliance raises the benefit tier
   * and never withdraws the benefit — in which case nothing is being denied and
   * no legal authority is needed. Or it denies, and then the law or policy that
   * permits the denial has to be on the record before the programme exists.
   *
   * What is not allowed is the third thing: a programme that quietly refuses a
   * citizen health cover because they are behind on a levy, with nobody having
   * written down who decided that was lawful.
   */
  const linkageMode = input.linkageMode ?? 'ELIGIBILITY_GATE';
  if (
    isEssentialService(input.benefitType) &&
    linkageMode !== 'ADDITIVE_BENEFIT' &&
    !input.essentialServiceLegalBasis
  ) {
    throw badRequest(
      'This programme would deny an essential public service on tax-compliance grounds. ' +
        'Either make it additive, so compliance raises the benefit tier rather than ' +
        'withdrawing the benefit, or record the legal or policy authority for the denial.',
      [
        {
          field: 'essentialServiceLegalBasis',
          issue:
            'Required when an essential-service programme denies on compliance grounds. ' +
            'Not required when linkageMode is ADDITIVE_BENEFIT.',
        },
      ],
    );
  }

  return withTransaction(async (client) => {
    const programme = await queryOne<{ id: string }>(
      client,
      `INSERT INTO incentive_programmes
         (name, code, description, benefit_type, benefit_description, eligibility_rules,
          target_sectors, requires_group_membership, target_group_types,
          target_lga_ids, target_taxpayer_types, minimum_score, minimum_compliance_periods,
          requires_no_arrears, start_date, end_date, approval_authority, status, created_by,
          linkage_mode)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'DRAFT',$18,$19)
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
        input.targetSectors ?? [],
        input.requiresGroupMembership ?? false,
        input.targetGroupTypes ?? [],
        input.targetLgaIds ?? [],
        input.targetTaxpayerTypes ?? ['INDIVIDUAL', 'BUSINESS'],
        input.minimumScore ?? 0,
        input.minimumCompliancePeriods ?? 0,
        input.requiresNoArrears ?? true,
        input.startDate,
        input.endDate ?? null,
        input.approvalAuthority,
        params.actorId,
        linkageMode,
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
        // Both recorded, because together they are the §40 decision: how this
        // programme treats a non-compliant citizen, and on whose authority.
        linkageMode,
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
): Promise<{
  eligible: boolean;
  reasons: string[];
  score: number;
  benefitTier: 'BASE' | 'FULL' | null;
}> {
  const evaluate = async (client: PoolClient) => {
    const programme = await queryOne<{
      id: string;
      name: string;
      minimum_score: number;
      minimum_compliance_periods: number;
      requires_no_arrears: boolean;
      target_lga_ids: string[];
      target_taxpayer_types: string[];
      target_sectors: string[];
      requires_group_membership: boolean;
      target_group_types: string[];
      start_date: Date;
      end_date: Date | null;
      status: string;
      linkage_mode: string;
    }>(client, 'SELECT * FROM incentive_programmes WHERE id = $1', [params.programmeId]);
    if (!programme) throw notFound('That programme');

    const taxpayer = await queryOne<{
      lga_id: string;
      taxpayer_type: string;
      tin: string | null;
      economic_sector: string | null;
    }>(
      client,
      'SELECT lga_id, taxpayer_type, tin, economic_sector FROM taxpayers WHERE id = $1',
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

    /*
     * Sector, which is what makes "fertiliser for compliant farmers" sayable.
     * Empty means every sector, as with the LGA list. A taxpayer whose sector
     * was never recorded is out of scope for a sector-targeted programme
     * rather than quietly in it — the remedy is to record what they do, not to
     * guess.
     */
    if (programme.target_sectors.length > 0) {
      if (!taxpayer.economic_sector) {
        eligible = false;
        reasons.push('No economic sector recorded for this taxpayer');
      } else if (!programme.target_sectors.includes(taxpayer.economic_sector)) {
        eligible = false;
        reasons.push(
          `Programme is for ${programme.target_sectors.join(', ').toLowerCase()}, ` +
            `not ${taxpayer.economic_sector.toLowerCase()}`,
        );
      } else {
        reasons.push(`Sector ${taxpayer.economic_sector} is within scope`);
      }
    }

    /*
     * Group membership, which is how the informal sector is reached at all.
     *
     * Only an ATTESTED membership counts. A claim recorded by an agent and not
     * yet confirmed by the group's leader is exactly what an agent inventing
     * members would produce, and the whole reason attestation exists is that
     * the agent is paid on collections and should not also be the one
     * certifying how many farmers there are.
     */
    if (programme.requires_group_membership) {
      const membership = await queryOne<{ group_type: string; name: string }>(
        client,
        `SELECT g.group_type, g.name
           FROM taxpayer_group_members m
           JOIN taxpayer_groups g ON g.id = m.group_id
          WHERE m.taxpayer_id = $1
            AND m.status = 'ATTESTED'
            AND g.status = 'ACTIVE'
            AND (cardinality($2::text[]) = 0 OR g.group_type = ANY($2::text[]))
          LIMIT 1`,
        [params.taxpayerId, programme.target_group_types],
      );

      if (!membership) {
        eligible = false;
        reasons.push(
          programme.target_group_types.length > 0
            ? `No confirmed membership of a ${programme.target_group_types
                .join(' or ')
                .toLowerCase()
                .replace(/_/g, ' ')}`
            : 'No confirmed membership of a registered group',
        );
      } else {
        reasons.push(`Confirmed member of ${membership.name}`);
      }
    }

    if (!taxpayer.tin) {
      eligible = false;
      reasons.push('A valid TIN is required');
    } else {
      reasons.push('Valid TIN on record');
    }

    /*
     * Everything above this point is *scope*: the programme is open, the
     * citizen is the right kind of taxpayer, in the right place, holding a TIN.
     * Failing any of those means the programme is not for them, in either mode.
     *
     * Everything below is *compliance*, and this is where the two modes part.
     * Under ELIGIBILITY_GATE a shortfall denies. Under ADDITIVE_BENEFIT it
     * cannot deny anybody — it decides the tier, so paying on time buys a
     * better entitlement and falling behind never costs the entitlement
     * itself. PRD §40 forbids the platform from denying an essential public
     * service on tax grounds absent a recorded legal authority, and an
     * additive programme never denies, so it needs no such authority.
     */
    const additive = programme.linkage_mode === 'ADDITIVE_BENEFIT';

    /** Compliance shortfalls: they deny under a gate, and downgrade otherwise. */
    const shortfalls: string[] = [];

    if (compliance.score < programme.minimum_score) {
      shortfalls.push(
        `Compliance score ${compliance.score} is below ${programme.minimum_score}`,
      );
    } else {
      reasons.push(`Compliance score ${compliance.score} meets the minimum of ${programme.minimum_score}`);
    }

    const periods = detail?.compliant_periods ?? 0;
    if (periods < programme.minimum_compliance_periods) {
      shortfalls.push(
        `${periods} compliant period(s) recorded; ${programme.minimum_compliance_periods} required`,
      );
    }

    if (programme.requires_no_arrears && parseKobo(detail?.outstanding_amount_kobo ?? '0') > 0n) {
      shortfalls.push('There are outstanding revenue obligations');
    } else if (programme.requires_no_arrears) {
      reasons.push('No outstanding revenue obligations');
    }

    /*
     * A tier is only meaningful on an additive programme; a gated one is a yes
     * or a no. It is also only awarded to somebody the scope checks admitted —
     * a citizen with no TIN does not get a BASE entitlement to something they
     * are not in scope for.
     */
    let benefitTier: 'BASE' | 'FULL' | null = null;
    if (additive) {
      benefitTier = eligible ? (shortfalls.length === 0 ? 'FULL' : 'BASE') : null;
      if (shortfalls.length > 0) {
        reasons.push(...shortfalls.map((reason) => `${reason} — base entitlement rather than full`));
        reasons.push('This benefit is never withdrawn for tax arrears; compliance raises the tier');
      } else if (eligible) {
        reasons.push('Full entitlement: compliance requirements met');
      }
    } else if (shortfalls.length > 0) {
      eligible = false;
      reasons.push(...shortfalls);
    }

    await client.query(
      `INSERT INTO programme_eligibility
         (programme_id, taxpayer_id, eligible, reasons, score_at_evaluation, benefit_tier)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (programme_id, taxpayer_id) DO UPDATE SET
         eligible = EXCLUDED.eligible,
         reasons = EXCLUDED.reasons,
         score_at_evaluation = EXCLUDED.score_at_evaluation,
         benefit_tier = EXCLUDED.benefit_tier,
         evaluated_at = now()`,
      [
        params.programmeId,
        params.taxpayerId,
        eligible,
        JSON.stringify(reasons),
        compliance.score,
        benefitTier,
      ],
    );

    return { eligible, reasons, score: compliance.score, benefitTier };
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
            -- Whether a programme denies on tax grounds is the PRD §40 decision
            -- about it. It was recorded, enforced and audited, and left out of
            -- the list an officer administers these from.
            p.linkage_mode,
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
              p.linkage_mode,
              e.eligible, e.reasons, e.score_at_evaluation, e.evaluated_at,
              -- BASE or FULL. Computed, stored and unit-tested since the
              -- additive mode was added, and returned to nobody: a citizen on
              -- an additive programme was told eligible, which is what a gated
              -- programme says too, and the difference between them is the
              -- entire PRD 40 safeguard.
              e.benefit_tier
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
