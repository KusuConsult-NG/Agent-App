/**
 * Revenue catalogue, assessment and invoicing (PRD §8, §9, §14, §15).
 *
 * The chain built here is:
 *   revenue item + effective rate version + declared inputs
 *     -> assessment (amount frozen, with its calculation trace)
 *     -> invoice (unique number, QR verification code)
 *     -> transaction (unique reference, agent/territory/device attribution)
 *
 * All three are created in one transaction: an invoice without its assessment,
 * or a transaction without its invoice, would be an orphaned obligation.
 */

import type { PoolClient } from 'pg';
import { parseKobo, koboToNaira, assertTransactionTransition, type Kobo } from '@psirs/shared';
import type { Db } from '../db/pool';
import { query, queryOne, withTransaction } from '../db/pool';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { generateVerificationCode } from '../lib/crypto';
import {
  nextAssessmentNumber,
  nextInvoiceNumber,
  nextTransactionReference,
} from '../lib/references';
import { computeAmount, type ComputationInputs, type RateVersion } from './rate-engine';
import { recordAudit } from './audit';

export async function listCategories(db: Db, options: { authorityId?: string } = {}) {
  return query(
    db,
    `SELECT rc.id, rc.name, rc.code, rc.description, ra.name AS authority_name, ra.tier,
            (SELECT count(*) FROM revenue_items ri
              WHERE ri.category_id = rc.id AND ri.status = 'ACTIVE') AS item_count
       FROM revenue_categories rc
       JOIN revenue_authorities ra ON ra.id = rc.authority_id
      WHERE rc.status = 'ACTIVE'
        AND ($1::uuid IS NULL OR rc.authority_id = $1)
      ORDER BY ra.tier, rc.name`,
    [options.authorityId ?? null],
  );
}

/**
 * Items payable by a given taxpayer profile.
 *
 * Filtering by taxpayer type and LGA here is what stops an agent from being
 * offered, say, a hotel consumption tax for an individual farmer — the
 * catalogue decides what is applicable, not the agent (PRD §9).
 */
export async function listItems(
  db: Db,
  options: { categoryId?: string; taxpayerType?: string; lgaId?: string; search?: string } = {},
) {
  return query(
    db,
    `SELECT ri.id, ri.code, ri.name, ri.description, ri.frequency, ri.self_assessable,
            ri.required_documents, ri.assessment_rules, ri.commission_eligible,
            rc.name AS category_name, rc.id AS category_id,
            m.name AS mda_name, ra.name AS authority_name,
            r.id AS rate_id, r.rate_type, r.fixed_amount_kobo, r.rate_basis_points,
            r.tiers, r.formula, r.minimum_amount_kobo, r.maximum_amount_kobo, r.version
       FROM revenue_items ri
       JOIN revenue_categories rc ON rc.id = ri.category_id
       JOIN revenue_authorities ra ON ra.id = rc.authority_id
       LEFT JOIN mdas m ON m.id = ri.mda_id
       LEFT JOIN LATERAL (
         SELECT * FROM revenue_item_rates rr
          WHERE rr.revenue_item_id = ri.id
            AND rr.effective_from <= now()
            AND (rr.effective_to IS NULL OR rr.effective_to > now())
          ORDER BY rr.effective_from DESC LIMIT 1
       ) r ON true
      WHERE ri.status = 'ACTIVE'
        AND ($1::uuid IS NULL OR ri.category_id = $1)
        AND ($2::text IS NULL OR $2 = ANY(ri.applicable_taxpayer_types))
        AND ($3::uuid IS NULL OR cardinality(ri.applicable_lga_ids) = 0
             OR $3 = ANY(ri.applicable_lga_ids))
        AND ($4::text IS NULL OR ri.name ILIKE '%' || $4 || '%' OR ri.code ILIKE '%' || $4 || '%')
      ORDER BY rc.name, ri.name`,
    [
      options.categoryId ?? null,
      options.taxpayerType ?? null,
      options.lgaId ?? null,
      options.search ?? null,
    ],
  );
}

/**
 * The rate version in force at `at` for an item.
 *
 * Historical assessments resolve against the date they were raised, so a rate
 * change never rewrites what was already owed (PRD §9).
 */
/**
 * The rate in force for one item, in one place, at one moment.
 *
 * Eleven catalogue items are local government revenue whose rate is set by a
 * Council's own bye-law, and Plateau has seventeen Councils. A rate naming an
 * LGA is therefore preferred over the statewide default, and an item with
 * neither is refused rather than charged at some other Council's figure.
 *
 * `lgaId` is optional only so that callers with no taxpayer in hand — the
 * catalogue browser, the rate-history report — still work. Anything that
 * leads to money must pass it: a quote resolved without the LGA and an
 * assessment resolved with it would show a trader one figure and charge
 * another.
 */
export async function resolveRate(
  db: Db,
  revenueItemId: string,
  at: Date = new Date(),
  lgaId?: string | null,
) {
  const rate = await queryOne<RateVersion>(
    db,
    `SELECT * FROM revenue_item_rates
      WHERE revenue_item_id = $1
        AND effective_from <= $2
        AND (effective_to IS NULL OR effective_to > $2)
        AND (lga_id IS NULL OR lga_id = $3)
      -- The specific beats the general: a Council that has set its own figure
      -- uses it, and one that has not falls back to the statewide default.
      ORDER BY (lga_id IS NOT NULL) DESC, effective_from DESC
      LIMIT 1`,
    [revenueItemId, at, lgaId ?? null],
  );

  if (!rate) {
    throw conflict(
      'NO_EFFECTIVE_RATE',
      'This revenue item has no approved rate in force. It cannot be assessed until government sets one.',
      'Contact PSIRS revenue configuration.',
    );
  }

  return rate;
}

export interface QuoteResult {
  revenueItemId: string;
  revenueItemName: string;
  categoryName: string;
  rateVersionId: string;
  rateVersion: number;
  amountKobo: Kobo;
  serviceChargeKobo: Kobo;
  totalKobo: Kobo;
  trace: { step: string; detail: string; amount?: string }[];
}

/**
 * Calculate what a taxpayer would owe, without creating anything.
 *
 * PRD §15: "The taxpayer must be shown the amount before payment." The agent
 * app calls this to render the confirmation screen, so the figure on screen and
 * the figure assessed come from the same code path.
 */
export async function quote(
  db: Db,
  params: { revenueItemId: string; inputs: ComputationInputs; at?: Date; lgaId?: string | null },
): Promise<QuoteResult> {
  const item = await queryOne<{
    id: string;
    name: string;
    category_name: string;
    assessment_rules: { serviceChargeKobo?: string } | null;
  }>(
    db,
    `SELECT ri.id, ri.name, rc.name AS category_name, ri.assessment_rules
       FROM revenue_items ri JOIN revenue_categories rc ON rc.id = ri.category_id
      WHERE ri.id = $1 AND ri.status = 'ACTIVE'`,
    [params.revenueItemId],
  );

  if (!item) throw notFound('That revenue item');

  const rate = await resolveRate(db, params.revenueItemId, params.at, params.lgaId);
  const computation = computeAmount(rate, params.inputs);

  // PRD §6: an official service charge is separate, explicit and displayed
  // before payment. It is never deducted from the government's figure.
  const serviceCharge = parseKobo(item.assessment_rules?.serviceChargeKobo ?? '0');

  return {
    revenueItemId: item.id,
    revenueItemName: item.name,
    categoryName: item.category_name,
    rateVersionId: rate.id,
    rateVersion: rate.version,
    amountKobo: computation.amountKobo,
    serviceChargeKobo: serviceCharge,
    totalKobo: computation.amountKobo + serviceCharge,
    trace: computation.trace,
  };
}

export interface CreateAssessmentParams {
  taxpayerId: string;
  revenueItemId: string;
  inputs: ComputationInputs;
  periodStart?: string | null;
  periodEnd?: string | null;
  periodLabel?: string | null;
  assessmentType?: 'AGENT_ASSISTED' | 'SELF_ASSESSMENT' | 'OFFICER';
  actorId: string;
  actorRole: string;
  agentId?: string | null;
  territoryId?: string | null;
  deviceId?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  channel?: 'AGENT_PWA' | 'OFFICER' | 'API';
  invoiceValidityDays?: number;
  ipAddress?: string | null;
}

export interface AssessmentResult {
  assessmentId: string;
  assessmentNumber: string;
  invoiceId: string;
  invoiceNumber: string;
  invoiceVerificationCode: string;
  transactionId: string;
  transactionReference: string;
  amountKobo: Kobo;
  serviceChargeKobo: Kobo;
  totalKobo: Kobo;
  expiresAt: Date | null;
  trace: { step: string; detail: string; amount?: string }[];
}

/**
 * Create assessment, invoice and transaction as one atomic obligation.
 *
 * The amount comes from `computeAmount` and nothing else: there is no
 * parameter on this function through which a caller can supply an amount
 * (PRD §31 "No agent-created amounts").
 */
export async function createAssessment(params: CreateAssessmentParams): Promise<AssessmentResult> {
  return withTransaction(async (client) => {
    const taxpayer = await queryOne<{
      id: string;
      taxpayer_type: string;
      lga_id: string;
      ward_id: string | null;
      tin: string | null;
      status: string;
    }>(
      client,
      'SELECT id, taxpayer_type, lga_id, ward_id, tin, status FROM taxpayers WHERE id = $1',
      [params.taxpayerId],
    );

    if (!taxpayer) throw notFound('That taxpayer');
    if (taxpayer.status !== 'ACTIVE') {
      throw conflict(
        'TAXPAYER_NOT_ACTIVE',
        `This taxpayer record is ${taxpayer.status.toLowerCase()} and cannot be assessed.`,
      );
    }

    const item = await queryOne<{
      id: string;
      name: string;
      applicable_taxpayer_types: string[];
      applicable_lga_ids: string[];
      self_assessable: boolean;
      assessment_rules: { serviceChargeKobo?: string } | null;
      status: string;
    }>(
      client,
      `SELECT id, name, applicable_taxpayer_types, applicable_lga_ids, self_assessable,
              assessment_rules, status
         FROM revenue_items WHERE id = $1`,
      [params.revenueItemId],
    );

    if (!item) throw notFound('That revenue item');
    if (item.status !== 'ACTIVE') {
      throw conflict('REVENUE_ITEM_INACTIVE', `"${item.name}" is not currently collectable.`);
    }
    if (!item.applicable_taxpayer_types.includes(taxpayer.taxpayer_type)) {
      throw badRequest(
        `"${item.name}" does not apply to ${taxpayer.taxpayer_type.toLowerCase()} taxpayers.`,
      );
    }
    if (item.applicable_lga_ids.length > 0 && !item.applicable_lga_ids.includes(taxpayer.lga_id)) {
      throw badRequest(`"${item.name}" is not collected in this taxpayer's Local Government Area.`);
    }
    if (params.assessmentType === 'SELF_ASSESSMENT' && !item.self_assessable) {
      throw forbidden(`"${item.name}" cannot be self-assessed.`);
    }

    const rate = await resolveRate(client, params.revenueItemId, new Date(), taxpayer.lga_id);
    const computation = computeAmount(rate, params.inputs);

    if (computation.amountKobo <= 0n) {
      /*
       * Zero means two entirely different things, and the platform used to say
       * the same wrong thing about both.
       *
       * Under the Fourth Schedule to the Nigeria Tax Act, 2025 the first
       * ₦800,000 of annual income is taxed at nothing. A trader on ₦300,000
       * owes nothing — that is the law working, not a data-entry fault. The
       * message here said "Check the values entered", which tells an agent
       * their input is wrong when it is right, and leaves them one way to make
       * the screen proceed: enter an income the trader does not have. Agents
       * are paid commission on what they collect. A refusal that blames the
       * figures is, to that agent, an instruction to raise them.
       *
       * So a zero that came out of the schedule is reported as a nil
       * liability, and a zero that came out of an empty form keeps the old
       * message. `declaredBaseKobo` is what separates them.
       */
      if (computation.declaredBaseKobo !== null && computation.declaredBaseKobo > 0n) {
        throw conflict(
          'NO_TAX_PAYABLE',
          `No tax is payable on ₦${koboToNaira(computation.declaredBaseKobo)} under the rate in force for "${item.name}", so there is no invoice to raise.`,
          'The figures are not wrong — this taxpayer is below the threshold. Do not increase the amount to make the assessment go through.',
        );
      }
      throw badRequest(
        'The calculated amount is zero. Check the values entered before raising an invoice.',
      );
    }

    const serviceCharge = parseKobo(item.assessment_rules?.serviceChargeKobo ?? '0');
    const total = computation.amountKobo + serviceCharge;

    const assessmentNumber = await nextAssessmentNumber(client);
    const assessment = await queryOne<{ id: string }>(
      client,
      `INSERT INTO assessments (
         assessment_number, taxpayer_id, revenue_item_id, rate_version_id, assessment_type,
         computation_inputs, computation_trace, base_amount_kobo, discount_kobo,
         service_charge_kobo, amount_kobo, period_start, period_end, period_label,
         lga_id, ward_id, status, created_by, agent_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,$9,$10,$11,$12,$13,$14,$15,'INVOICED',$16,$17)
       RETURNING id`,
      [
        assessmentNumber,
        params.taxpayerId,
        params.revenueItemId,
        rate.id,
        params.assessmentType ?? 'AGENT_ASSISTED',
        JSON.stringify(params.inputs),
        JSON.stringify(computation.trace),
        computation.amountKobo.toString(),
        serviceCharge.toString(),
        total.toString(),
        params.periodStart ?? null,
        params.periodEnd ?? null,
        params.periodLabel ?? null,
        taxpayer.lga_id,
        taxpayer.ward_id,
        params.actorId,
        params.agentId ?? null,
      ],
    );

    const validityDays = params.invoiceValidityDays ?? 30;
    const expiresAt = new Date(Date.now() + validityDays * 86_400_000);
    const invoiceNumber = await nextInvoiceNumber(client);
    const invoiceCode = generateVerificationCode();

    const invoice = await queryOne<{ id: string }>(
      client,
      `INSERT INTO invoices (
         invoice_number, assessment_id, taxpayer_id, amount_kobo, service_charge_kobo,
         total_amount_kobo, verification_code, expires_at, agent_id, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [
        invoiceNumber,
        assessment!.id,
        params.taxpayerId,
        computation.amountKobo.toString(),
        serviceCharge.toString(),
        total.toString(),
        invoiceCode,
        expiresAt,
        params.agentId ?? null,
        params.actorId,
      ],
    );

    const transactionReference = await nextTransactionReference(client);
    const transaction = await queryOne<{ id: string }>(
      client,
      `INSERT INTO transactions (
         transaction_reference, taxpayer_id, invoice_id, assessment_id, revenue_item_id,
         agent_id, territory_id, device_id, lga_id, ward_id, latitude, longitude, channel,
         amount_kobo, service_charge_kobo, total_amount_kobo, status, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'INVOICE_GENERATED',$17)
       RETURNING id`,
      [
        transactionReference,
        params.taxpayerId,
        invoice!.id,
        assessment!.id,
        params.revenueItemId,
        params.agentId ?? null,
        params.territoryId ?? null,
        params.deviceId ?? null,
        taxpayer.lga_id,
        taxpayer.ward_id,
        params.latitude ?? null,
        params.longitude ?? null,
        params.channel ?? 'AGENT_PWA',
        computation.amountKobo.toString(),
        serviceCharge.toString(),
        total.toString(),
        params.actorId,
      ],
    );

    for (const status of ['INITIATED', 'ASSESSMENT_CREATED', 'INVOICE_GENERATED'] as const) {
      await client.query(
        `INSERT INTO transaction_events (transaction_id, from_status, to_status, actor_id, source, metadata)
         VALUES ($1, NULL, $2, $3, $4, $5)`,
        [
          transaction!.id,
          status,
          params.actorId,
          params.channel === 'OFFICER' ? 'OFFICER' : 'AGENT',
          JSON.stringify({ assessmentNumber, invoiceNumber }),
        ],
      );
    }

    await recordAudit(client, {
      actorId: params.actorId,
      actorRole: params.actorRole,
      action: 'assessment.created',
      entityType: 'assessment',
      entityId: assessment!.id,
      newValue: {
        assessmentNumber,
        invoiceNumber,
        transactionReference,
        revenueItemId: params.revenueItemId,
        rateVersionId: rate.id,
        amountKobo: computation.amountKobo.toString(),
        serviceChargeKobo: serviceCharge.toString(),
        taxpayerId: params.taxpayerId,
        agentId: params.agentId ?? null,
      },
      ipAddress: params.ipAddress ?? null,
      deviceId: params.deviceId ?? null,
      latitude: params.latitude ?? null,
      longitude: params.longitude ?? null,
    });

    return {
      assessmentId: assessment!.id,
      assessmentNumber,
      invoiceId: invoice!.id,
      invoiceNumber,
      invoiceVerificationCode: invoiceCode,
      transactionId: transaction!.id,
      transactionReference,
      amountKobo: computation.amountKobo,
      serviceChargeKobo: serviceCharge,
      totalKobo: total,
      expiresAt,
      trace: computation.trace,
    };
  });
}

/**
 * Move a transaction to a new state, recording the event.
 *
 * Every state change in the platform goes through here so the legality check
 * and the event journal can never be skipped independently.
 */
export async function transitionTransaction(
  client: PoolClient,
  params: {
    transactionId: string;
    to: Parameters<typeof assertTransactionTransition>[1];
    reason?: string;
    actorId?: string | null;
    source: 'SYSTEM' | 'AGENT' | 'OFFICER' | 'GATEWAY_WEBHOOK' | 'RECONCILIATION';
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const current = await queryOne<{ status: string }>(
    client,
    'SELECT status FROM transactions WHERE id = $1 FOR UPDATE',
    [params.transactionId],
  );
  if (!current) throw notFound('That transaction');

  assertTransactionTransition(
    current.status as Parameters<typeof assertTransactionTransition>[0],
    params.to,
  );

  await client.query(
    `UPDATE transactions
        SET status = $2,
            status_reason = $3,
            verified_at = CASE WHEN $2 = 'PAYMENT_VERIFIED' THEN now() ELSE verified_at END,
            settled_at  = CASE WHEN $2 = 'SETTLED' THEN now() ELSE settled_at END,
            reversed_at = CASE WHEN $2 IN ('REVERSED','REFUNDED') THEN now() ELSE reversed_at END
      WHERE id = $1`,
    [params.transactionId, params.to, params.reason ?? null],
  );

  await client.query(
    `INSERT INTO transaction_events (transaction_id, from_status, to_status, reason, actor_id, source, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      params.transactionId,
      current.status,
      params.to,
      params.reason ?? null,
      params.actorId ?? null,
      params.source,
      JSON.stringify(params.metadata ?? {}),
    ],
  );
}

/** Outstanding obligations for a taxpayer (PRD §5.2 "Know what they owe"). */
export async function getObligations(db: Db, taxpayerId: string) {
  return query(
    db,
    `SELECT i.id AS invoice_id, i.invoice_number, i.total_amount_kobo, i.amount_paid_kobo,
            i.status, i.expires_at, i.issued_at,
            a.assessment_number, a.period_label,
            ri.name AS revenue_item, rc.name AS revenue_category,
            t.id AS transaction_id, t.transaction_reference, t.status AS transaction_status
       FROM invoices i
       JOIN assessments a ON a.id = i.assessment_id
       JOIN revenue_items ri ON ri.id = a.revenue_item_id
       JOIN revenue_categories rc ON rc.id = ri.category_id
       LEFT JOIN transactions t ON t.invoice_id = i.id
      WHERE i.taxpayer_id = $1 AND i.status IN ('UNPAID', 'PARTIALLY_PAID')
      ORDER BY i.issued_at DESC`,
    [taxpayerId],
  );
}
