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
import { parseKobo, formatNaira, assertTransactionTransition, type Kobo } from '@psirs/shared';
import type { Db } from '../db/pool';
import { pool, query, queryOne, withTransaction } from '../db/pool';
import { UNDER_OPEN_OBJECTION_SQL } from '../lib/enforcement-suspended';
import { conflict, forbidden, notFound, refused } from '../lib/errors';
import { generateVerificationCode } from '../lib/crypto';
import { escapeLike } from '../lib/like';
import { CHARGE_PERIOD_SHUT_SQL, OWED_INVOICE_SQL, PAYABLE_INVOICE_SQL } from '../lib/payable-invoice';
import {
  nextAssessmentNumber,
  nextInvoiceNumber,
  nextTransactionReference,
} from '../lib/references';
import { computeAmount, type ComputationInputs, type RateVersion } from './rate-engine';
import { recordAudit } from './audit';
import { log } from '../lib/logger';

export async function listCategories(db: Db, options: { authorityId?: string } = {}) {
  return query(
    db,
    `SELECT rc.id, rc.name, rc.name_ha, rc.code, rc.description, ra.name AS authority_name, ra.name_ha AS authority_name_ha, ra.tier,
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
 *
 * ACTIVE items only, because everybody who calls this is deciding what can be
 * sold. `includeWithdrawn` is for the one screen that needs the rest — the
 * officer configuring the catalogue, who cannot restore a suspended item they
 * are unable to see.
 */
export async function listItems(
  db: Db,
  options: {
    categoryId?: string;
    /*
     * Which arm of government the item's revenue belongs to.
     *
     * Mirrors the filter `listCategories` has always had. The row already
     * carries `authority_name`; what it did not carry was the id, so nothing
     * could ask for one tier's catalogue without matching on a display name.
     */
    authorityId?: string;
    taxpayerType?: string;
    lgaId?: string;
    search?: string;
    includeWithdrawn?: boolean;
  } = {},
) {
  return query(
    db,
    `SELECT ri.id, ri.code, ri.name, ri.name_ha, ri.description, ri.frequency, ri.self_assessable,
            ri.required_documents, ri.assessment_rules, ri.commission_eligible,
            rc.name AS category_name, rc.name_ha AS category_name_ha, rc.id AS category_id,
            m.name AS mda_name, m.name_ha AS mda_name_ha,
            ra.id AS authority_id, ra.name AS authority_name, ra.name_ha AS authority_name_ha, ra.tier,
            r.id AS rate_id, r.rate_type, r.fixed_amount_kobo, r.rate_basis_points,
            r.tiers, r.formula, r.minimum_amount_kobo, r.maximum_amount_kobo, r.version,
            ri.status, ri.status_reason, ri.status_changed_at
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
      WHERE ($5::boolean OR ri.status = 'ACTIVE')
        AND ($1::uuid IS NULL OR ri.category_id = $1)
        AND ($2::text IS NULL OR $2 = ANY(ri.applicable_taxpayer_types))
        AND ($3::uuid IS NULL OR cardinality(ri.applicable_lga_ids) = 0
             OR $3 = ANY(ri.applicable_lga_ids))
        AND ($4::text IS NULL OR ri.name ILIKE '%' || $4 || '%' OR ri.code ILIKE '%' || $4 || '%')
        AND ($6::uuid IS NULL OR rc.authority_id = $6)
      ORDER BY ra.tier, rc.name, ri.name`,
    [
      options.categoryId ?? null,
      options.taxpayerType ?? null,
      options.lgaId ?? null,
      options.search ? escapeLike(options.search) : null,
      options.includeWithdrawn ?? false,
      options.authorityId ?? null,
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
  revenueItemNameHa: string | null;
  categoryName: string;
  categoryNameHa: string | null;
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
    name_ha: string | null;
    category_name: string;
    category_name_ha: string | null;
    assessment_rules: { serviceChargeKobo?: string } | null;
  }>(
    db,
    `SELECT ri.id, ri.name, ri.name_ha, rc.name AS category_name, rc.name_ha AS category_name_ha, ri.assessment_rules
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
    revenueItemNameHa: item.name_ha,
    categoryName: item.category_name,
    categoryNameHa: item.category_name_ha,
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
  /**
   * How long the invoice may be paid for, in days. Defaults to thirty.
   *
   * Nothing passes it. Not a route, not a service, not a test — so thirty days
   * is the only validity any invoice in this platform has ever had, which is
   * worth saying because something downstream was built for a longer one: the
   * reminder sweep declares a six-week window that a thirty-day invoice can
   * never enter, and so has never sent that reminder to anybody. See the note
   * at the top of `services/reminders.ts`.
   */
  invoiceValidityDays?: number;
  ipAddress?: string | null;
  /*
   * An amount this platform worked out for itself, for the one case the rate
   * engine cannot express: a liability that is the sum of many computations
   * rather than one. PAYE is that case — an employer owes the total of what
   * was deducted from thirty named people, and taxing the payroll as a single
   * salary would push the whole of it into the top band.
   *
   * This is emphatically not a way for a caller to name a price. No route
   * passes it; only server code that has already computed the figure from
   * stored evidence does. And the discipline is not what holds it: migration
   * 056 refuses a PAYE filing whose assessment amount is not exactly the
   * schedule total, and that total is itself refused unless it equals the sum
   * of the schedule's lines. A service that invented a number here would be
   * caught by the database before the transaction committed.
   */
  precomputedAmountKobo?: Kobo;
  /** Why that figure, recorded on the assessment's trace for an auditor. */
  precomputedReason?: string;
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
 * The amount comes from `computeAmount` and nothing a caller sent (PRD §31,
 * "No agent-created amounts"). The single exception is `precomputedAmountKobo`,
 * which no route passes and which only server code that has already derived
 * the figure from stored evidence may use — see its own comment, and migration
 * 056, which refuses the one liability that uses it unless the assessment
 * matches the schedule it was computed from.
 */
export async function createAssessment(params: CreateAssessmentParams): Promise<AssessmentResult> {
  return withTransaction((client) => createAssessmentIn(client, params));
}

/**
 * The same thing, on a caller's transaction.
 *
 * Exists for the one case where an assessment is part of a larger indivisible
 * act: a PAYE return, where the schedule, its employee lines and the
 * assessment are one filing. Raising the assessment on its own connection
 * would commit it independently, so a schedule that then failed to insert
 * would leave an employer holding an invoice with nothing behind it — a bill
 * nobody could explain, for a liability the platform has no record of.
 *
 * Callers with nothing to join should use `createAssessment` above.
 */
export async function createAssessmentIn(
  client: PoolClient,
  params: CreateAssessmentParams,
): Promise<AssessmentResult> {
  {
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
    /*
     * Named refusals, not anonymous ones.
     *
     * Everything in this block is reached from the agent's collect screen, and
     * the agent application translates a refusal by its code. These two were
     * raised as INVALID_REQUEST — the same code a malformed field gets — so
     * there was nothing to key a Hausa sentence on, and an agent standing in a
     * market was told in English why the levy they had just chosen would not
     * go through. `REVENUE_ITEM_INACTIVE` immediately above was already named;
     * these are the two beside it that were not.
     *
     * The status stays 400. The request is well formed and the catalogue
     * simply does not allow it, which is what it always said; what changes is
     * that the sentence can now be said in the reader's language.
     */
    if (!item.applicable_taxpayer_types.includes(taxpayer.taxpayer_type)) {
      throw refused(
        'REVENUE_ITEM_NOT_FOR_TAXPAYER_TYPE',
        `"${item.name}" does not apply to ${taxpayer.taxpayer_type.toLowerCase()} taxpayers.`,
      );
    }
    if (item.applicable_lga_ids.length > 0 && !item.applicable_lga_ids.includes(taxpayer.lga_id)) {
      throw refused(
        'REVENUE_ITEM_NOT_IN_LGA',
        `"${item.name}" is not collected in this taxpayer's Local Government Area.`,
      );
    }
    if (params.assessmentType === 'SELF_ASSESSMENT' && !item.self_assessable) {
      throw forbidden(`"${item.name}" cannot be self-assessed.`);
    }

    const rate = await resolveRate(client, params.revenueItemId, new Date(), taxpayer.lga_id);
    /*
     * The rate version is resolved either way, so a precomputed assessment
     * still records which bands were in force when it was made and can be
     * re-checked years later against them.
     */
    const computation =
      params.precomputedAmountKobo === undefined
        ? computeAmount(rate, params.inputs)
        : {
            amountKobo: params.precomputedAmountKobo,
            declaredBaseKobo: null,
            trace: [
              {
                step: 'Computed from a filed schedule',
                detail:
                  params.precomputedReason ??
                  'Sum of per-person amounts computed by the platform from a filed return',
                amount: params.precomputedAmountKobo.toString(),
              },
              {
                step: 'Payable',
                detail: 'Amount payable to government',
                amount: params.precomputedAmountKobo.toString(),
              },
            ],
          };

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
          `No tax is payable on ${formatNaira(computation.declaredBaseKobo)} under the rate in force for "${item.name}", so there is no invoice to raise.`,
          'The figures are not wrong — this taxpayer is below the threshold. Do not increase the amount to make the assessment go through.',
        );
      }
      /*
       * Named for the same reason as the two above, and this one matters more:
       * it is the sentence an agent sees when a rate is misconfigured, which
       * `a-rate-has-to-be-usable` describes as blaming them for a figure they
       * did not enter and cannot change. Unreadable as well as unfair was the
       * worse of the two halves.
       */
      throw refused(
        'ASSESSMENT_AMOUNT_ZERO',
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

    const raised = await raiseInvoiceIn(client, {
      assessmentId: assessment!.id,
      assessmentNumber,
      taxpayerId: params.taxpayerId,
      revenueItemId: params.revenueItemId,
      lgaId: taxpayer.lga_id,
      wardId: taxpayer.ward_id,
      amountKobo: computation.amountKobo,
      serviceChargeKobo: serviceCharge,
      totalKobo: total,
      validityDays: params.invoiceValidityDays ?? 30,
      actorId: params.actorId,
      agentId: params.agentId ?? null,
      territoryId: params.territoryId ?? null,
      deviceId: params.deviceId ?? null,
      latitude: params.latitude ?? null,
      longitude: params.longitude ?? null,
      channel: params.channel ?? 'AGENT_PWA',
    });
    const { invoiceNumber, transactionReference, expiresAt } = raised;

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
      invoiceId: raised.invoiceId,
      invoiceNumber,
      invoiceVerificationCode: raised.verificationCode,
      transactionId: raised.transactionId,
      transactionReference,
      amountKobo: computation.amountKobo,
      serviceChargeKobo: serviceCharge,
      totalKobo: total,
      expiresAt,
      trace: computation.trace,
    };
  }
}

interface RaiseInvoiceParams {
  assessmentId: string;
  assessmentNumber: string;
  taxpayerId: string;
  revenueItemId: string;
  lgaId: string;
  wardId: string | null;
  amountKobo: Kobo;
  serviceChargeKobo: Kobo;
  totalKobo: Kobo;
  validityDays: number;
  /** A deadline to keep rather than one `validityDays` from now. */
  expiresAt?: Date;
  actorId: string;
  agentId: string | null;
  territoryId: string | null;
  deviceId: string | null;
  latitude: number | null;
  longitude: number | null;
  channel: 'AGENT_PWA' | 'OFFICER' | 'API';
  /** Recorded on the transaction's opening events, beside the numbers. */
  eventMetadata?: Record<string, unknown>;
}

interface RaisedInvoice {
  invoiceId: string;
  invoiceNumber: string;
  verificationCode: string;
  transactionId: string;
  transactionReference: string;
  expiresAt: Date;
}

/**
 * The demand for an assessment: its invoice and the transaction that collects it.
 *
 * Every invoice in the platform is written here, and every transaction. An
 * assessment's first demand comes from `createAssessmentIn`; a later one, for
 * a bill that could no longer be paid, from `reissueInvoice` — the same rows,
 * written the same way, so nothing downstream can tell a reissued bill from
 * a first one except by the link the reissue records.
 */
async function raiseInvoiceIn(client: PoolClient, params: RaiseInvoiceParams): Promise<RaisedInvoice> {
  const expiresAt = params.expiresAt ?? new Date(Date.now() + params.validityDays * 86_400_000);
  const invoiceNumber = await nextInvoiceNumber(client);
  const verificationCode = generateVerificationCode();

  const invoice = await queryOne<{ id: string }>(
    client,
    `INSERT INTO invoices (
       invoice_number, assessment_id, taxpayer_id, amount_kobo, service_charge_kobo,
       total_amount_kobo, verification_code, expires_at, agent_id, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [
      invoiceNumber,
      params.assessmentId,
      params.taxpayerId,
      params.amountKobo.toString(),
      params.serviceChargeKobo.toString(),
      params.totalKobo.toString(),
      verificationCode,
      expiresAt,
      params.agentId,
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
      params.assessmentId,
      params.revenueItemId,
      params.agentId,
      params.territoryId,
      params.deviceId,
      params.lgaId,
      params.wardId,
      params.latitude,
      params.longitude,
      params.channel,
      params.amountKobo.toString(),
      params.serviceChargeKobo.toString(),
      params.totalKobo.toString(),
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
        JSON.stringify({
          assessmentNumber: params.assessmentNumber,
          invoiceNumber,
          ...(params.eventMetadata ?? {}),
        }),
      ],
    );
  }

  return {
    invoiceId: invoice!.id,
    invoiceNumber,
    verificationCode,
    transactionId: transaction!.id,
    transactionReference,
    expiresAt,
  };
}

/**
 * Move a transaction to a new state, recording the event.
 *
 * Every state change in the platform goes through here so the legality check
 * and the event journal can never be skipped independently.
 */
/**
 * Retire invoices whose deadline has passed (PRD §14).
 *
 * Every invoice carries an `expires_at`, and the payment path honours it: an
 * attempt to pay a lapsed invoice is refused with INVOICE_EXPIRED. Nothing
 * acted on it anywhere else. `invoices.status` allows EXPIRED,
 * `assessments.status` allows EXPIRED, and `INVOICE_GENERATED -> EXPIRED` is a
 * legal transaction move — three states, all legal, none ever written. A
 * lapsed invoice stayed UNPAID for the life of the deployment, and everything
 * reading UNPAID believed it: the State's outstanding revenue figure climbed by
 * every invoice that was never going to be paid, the taxpayer's own list showed
 * a bill the platform would refuse to take, and their compliance score — which
 * decides incentive eligibility — went on counting it against them.
 *
 * The sweep is the enforcement, not the deadline itself. Nothing here decides
 * whether an invoice may be paid; that is settled at the payment path against
 * `expires_at`, exactly as before. What this does is make the record agree with
 * the answer the payment path was already giving.
 *
 * PARTIALLY_PAID is left alone. Money has been taken against it, and what
 * happens to a part-paid bill that lapses is a decision about somebody's money
 * — a refund of the part, or an extension — and not one a sweep should take at
 * three in the morning.
 */
export async function expireLapsedInvoices(params: {
  actorId: string | null;
  actorRole: string;
  limit?: number;
}): Promise<{ expired: number; failed: string[] }> {
  const lapsed = await query<{ id: string; assessment_id: string; invoice_number: string }>(
    pool,
    `SELECT id, assessment_id, invoice_number FROM invoices
      WHERE status = 'UNPAID' AND expires_at IS NOT NULL AND expires_at < now()
      ORDER BY expires_at
      LIMIT $1`,
    [params.limit ?? 500],
  );

  let expired = 0;
  /*
   * One bill that cannot be expired does not stop the rest.
   *
   * Each bill is its own transaction already, but the loop had no catch, so
   * the first one to throw ended the sweep — and it works in deadline order,
   * so that bill sat at the front of every run and nothing behind it ever
   * lapsed. That is how a single bill raised in a month since closed held
   * back every lapsed bill in the State (migration 093). A failure is now
   * logged by invoice number and reported back, and the sweep moves on.
   */
  const failed: string[] = [];
  for (const invoice of lapsed) {
    try {
      await withTransaction(async (client) => {
        // Re-read under the lock: a payment may have landed between the scan and
        // now, and an invoice that has just been paid is not lapsed.
        const current = await queryOne<{ status: string }>(
          client,
          'SELECT status FROM invoices WHERE id = $1 FOR UPDATE',
          [invoice.id],
        );
        if (!current || current.status !== 'UNPAID') return;

        await client.query(`UPDATE invoices SET status = 'EXPIRED' WHERE id = $1`, [invoice.id]);
        await client.query(
          `UPDATE assessments SET status = 'EXPIRED' WHERE id = $1 AND status IN ('ACTIVE','INVOICED')`,
          [invoice.assessment_id],
        );

        const transactions = await query<{ id: string }>(
          client,
          `SELECT id FROM transactions
            WHERE invoice_id = $1 AND status IN ('ASSESSMENT_CREATED','INVOICE_GENERATED')`,
          [invoice.id],
        );
        for (const transaction of transactions) {
          await transitionTransaction(client, {
            transactionId: transaction.id,
            to: 'EXPIRED',
            reason: `Invoice ${invoice.invoice_number} passed its payment deadline`,
            actorId: params.actorId,
            source: 'SYSTEM',
          });
        }

        await recordAudit(client, {
          actorId: params.actorId,
          actorRole: params.actorRole,
          action: 'invoice.expired',
          entityType: 'invoice',
          entityId: invoice.id,
          oldValue: { status: 'UNPAID' },
          newValue: { status: 'EXPIRED' },
          reason: `Payment deadline passed without payment (${invoice.invoice_number})`,
        });
        expired += 1;
      });
    } catch (error) {
      failed.push(invoice.invoice_number);
      log.error('an invoice past its deadline could not be expired', {
        component: 'revenue',
        invoiceNumber: invoice.invoice_number,
        error,
      });
    }
  }

  return { expired, failed };
}

/**
 * Withdraw the bill behind an assessment the State has taken back.
 *
 * Two decisions take a bill back: an objection upheld (`enumeration.ts`) and a
 * PAYE return withdrawn to be refiled (`paye.ts`). Each cancelled the invoice
 * with the same guard, the second copied from the first and saying so:
 * "only a bill that has not been paid is withdrawn". The guard was written as
 * UNPAID or PARTIALLY_PAID, and an invoice whose payment window has closed is
 * neither. It is EXPIRED, and it has not been paid either.
 *
 * That is not a corner. An objection window and an invoice's payment window
 * are both thirty days, so an objection raised late in its window is still
 * open when the expiry sweep reaches the bill. Measured: a trader objects, the
 * invoice lapses while the objection is open, the objection is upheld. The
 * presumptive assessment read WITHDRAWN and its invoice read EXPIRED, and the
 * arrears worklist's lapsed figure and the person's liabilities both went on
 * listing the ₦48,000 as money that needed a fresh assessment to collect —
 * for an estimate the State had just agreed was wrong.
 *
 * A paid bill is still not withdrawn here, for the reason `paye.ts` gives:
 * money that has reached a government account comes back through a refund,
 * with the accountability a refund carries.
 *
 * AND ITS CHARGE IS CLOSED, OR THE DECISION WAITS.
 *
 * This cancelled the invoice and nothing else. The charge behind it stayed
 * INVOICE_GENERATED for good — the expiry sweep reads UNPAID invoices, and
 * this one no longer was — so the field app's transaction screen went on
 * saying "payment not yet confirmed" over a start button the server refused.
 * The charge is closed now, as the bill raised in error closes it.
 *
 * And a bill somebody was part-way through paying was cancelled under them.
 * Measured: a trader starts paying, the objection is upheld while the gateway
 * holds the attempt, and the gateway then confirms. The invoice went from
 * CANCELLED to PAID — the settlement writes PAID over whatever was there —
 * and the trader had paid ₦48,000 on an estimate the State had just agreed was
 * wrong, against an assessment reading WITHDRAWN, with nothing anywhere
 * saying a refund was owed. The decision now refuses while a payment is
 * moving, in the words every other path that ends a bill uses; once it has
 * settled the bill is either paid, and left for a refund, or not, and
 * withdrawn.
 */
export async function withdrawUnpaidBill(
  client: PoolClient,
  assessmentId: string,
  params: { actorId: string; reason: string },
): Promise<void> {
  const invoices = await query<{ id: string; invoice_number: string }>(
    client,
    `SELECT id, invoice_number FROM invoices
      WHERE assessment_id = $1 AND status IN ('UNPAID', 'PARTIALLY_PAID', 'EXPIRED')
      ORDER BY created_at
      FOR UPDATE`,
    [assessmentId],
  );

  for (const invoice of invoices) {
    const transactions = await chargesAtRest(
      client,
      invoice,
      true,
      'Decide once it has settled. If it goes through, the bill has been paid, and what was paid comes back through a refund.',
    );

    await client.query(`UPDATE invoices SET status = 'CANCELLED' WHERE id = $1`, [invoice.id]);

    for (const transaction of transactions) {
      if (!['ASSESSMENT_CREATED', 'INVOICE_GENERATED', 'FAILED'].includes(transaction.status)) continue;
      await transitionTransaction(client, {
        transactionId: transaction.id,
        to: 'CANCELLED',
        reason: `Invoice ${invoice.invoice_number} withdrawn: ${params.reason}`,
        actorId: params.actorId,
        source: 'OFFICER',
      });
    }
  }
}

/**
 * Transaction states in which nothing is moving or held against a bill.
 *
 * An allow-list, so a bill is issued again only from a state known to be at
 * rest: never raised further than an invoice, a failed attempt, or ended.
 * Anything else — an attempt in flight, money the gateway or the State holds,
 * a payment under review — refuses, and so would a state added later that
 * nobody thought to put here, which is the direction to be wrong in when the
 * alternative is two demands for money already taken.
 */
const AT_REST = [
  'ASSESSMENT_CREATED',
  'INVOICE_GENERATED',
  'FAILED',
  'EXPIRED',
  'CANCELLED',
  'REVERSED',
  'REFUNDED',
] as const;

/** Transaction states from which the payment path will start an attempt. */
const PAYABLE_TRANSACTION_STATES = ['INVOICE_GENERATED', 'FAILED'] as const;

export interface ReissueParams {
  invoiceId: string;
  actorId: string;
  actorRole: string;
  agentId?: string | null;
  territoryId?: string | null;
  deviceId?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  channel?: 'AGENT_PWA' | 'OFFICER' | 'API';
  ipAddress?: string | null;
}

export interface ReissueResult {
  /** False when the bill had already been issued again, and this is that replacement. */
  reissued: boolean;
  invoiceId: string;
  invoiceNumber: string;
  transactionId: string;
  transactionReference: string;
  totalKobo: Kobo;
  expiresAt: Date | null;
  replaces: { invoiceId: string; invoiceNumber: string };
}

/**
 * Issue a bill again, for the debt it was always for.
 *
 * Two roads ended at a bill that was owed and could not be paid. Its deadline
 * passed — the payment path refuses an expired invoice — or a payment against
 * it was reversed by the taxpayer's bank or the gateway, which leaves the bill
 * owed and its only transaction REVERSED. The advice for both was "raise a new
 * assessment", which re-runs the rate engine against today's catalogue rather
 * than the figure the State determined, and leaves the first bill standing
 * beside the second: two demands for one liability.
 *
 * This renews the demand and nothing else. The replacement is against the same
 * assessment — so its period, its objection, its PAYE schedule and its vehicle
 * renewal stay attached — for the same amounts, with a fresh payment window.
 * The old invoice is cancelled and names the new one. Migration 091 refuses
 * any of that being done differently, by this function or anything else.
 *
 * Refused, by name, where issuing again would be wrong rather than merely
 * unnecessary: a bill that can still be paid, one paid in whole or in part,
 * one the State withdrew, one under an open objection (collection is
 * suspended, and a fresh demand would be the enforcement the objection
 * stops), one with money in motion, and one whose taxpayer record is closed.
 *
 * Asked twice — a retried request, a second press — it answers with the
 * replacement already made rather than making another, the way a payment
 * already in flight is returned rather than duplicated.
 */
export async function reissueInvoice(params: ReissueParams): Promise<ReissueResult> {
  return withTransaction(async (client) => {
    const old = await queryOne<{
      id: string;
      invoice_number: string;
      assessment_id: string;
      assessment_number: string;
      taxpayer_id: string;
      revenue_item_id: string;
      lga_id: string;
      ward_id: string | null;
      amount_kobo: string;
      service_charge_kobo: string;
      total_amount_kobo: string;
      amount_paid_kobo: string;
      status: string;
      expires_at: Date | null;
      reissued_as: string | null;
      taxpayer_status: string;
      under_objection: boolean;
    }>(
      client,
      `SELECT i.id, i.invoice_number, i.assessment_id, a.assessment_number, i.taxpayer_id,
              a.revenue_item_id, a.lga_id, a.ward_id, i.amount_kobo, i.service_charge_kobo,
              i.total_amount_kobo, i.amount_paid_kobo, i.status, i.expires_at, i.reissued_as,
              tp.status AS taxpayer_status, ${UNDER_OPEN_OBJECTION_SQL} AS under_objection
         FROM invoices i
         JOIN assessments a ON a.id = i.assessment_id
         JOIN taxpayers tp ON tp.id = i.taxpayer_id
        WHERE i.id = $1
        FOR UPDATE OF i`,
      [params.invoiceId],
    );
    if (!old) throw notFound('That invoice');

    if (old.reissued_as) {
      const head = await queryOne<{
        id: string;
        invoice_number: string;
        total_amount_kobo: string;
        expires_at: Date | null;
        transaction_id: string;
        transaction_reference: string;
      }>(
        client,
        `WITH RECURSIVE chain AS (
           SELECT id, reissued_as, 0 AS depth FROM invoices WHERE id = $1
           UNION ALL
           SELECT n.id, n.reissued_as, c.depth + 1
             FROM invoices n JOIN chain c ON n.id = c.reissued_as
            WHERE c.depth < 100
         )
         SELECT i.id, i.invoice_number, i.total_amount_kobo, i.expires_at,
                t.id AS transaction_id, t.transaction_reference
           FROM chain c
           JOIN invoices i ON i.id = c.id
           JOIN LATERAL (SELECT id, transaction_reference FROM transactions
                          WHERE invoice_id = i.id ORDER BY created_at DESC LIMIT 1) t ON true
          WHERE c.reissued_as IS NULL
          LIMIT 1`,
        [old.reissued_as],
      );
      if (!head) throw notFound('The invoice that replaced this one');
      return {
        reissued: false,
        invoiceId: head.id,
        invoiceNumber: head.invoice_number,
        transactionId: head.transaction_id,
        transactionReference: head.transaction_reference,
        totalKobo: parseKobo(head.total_amount_kobo),
        expiresAt: head.expires_at,
        replaces: { invoiceId: old.id, invoiceNumber: old.invoice_number },
      };
    }

    if (old.status === 'PAID') {
      throw conflict(
        'INVOICE_ALREADY_PAID',
        `Invoice ${old.invoice_number} has already been paid. There is nothing to issue again.`,
        'Do not collect payment again. Open the receipt from the transaction history.',
      );
    }
    if (old.status === 'PARTIALLY_PAID' || parseKobo(old.amount_paid_kobo) > 0n) {
      throw conflict(
        'INVOICE_PART_PAID',
        `Part of invoice ${old.invoice_number} has been paid, so it cannot be issued again for the full amount.`,
        'What happens to the part already paid is a decision for a PSIRS officer.',
      );
    }
    if (old.status === 'CANCELLED') {
      throw conflict(
        'INVOICE_WITHDRAWN',
        `Invoice ${old.invoice_number} was withdrawn, and nothing is owed on it.`,
      );
    }
    if (old.under_objection) {
      throw conflict(
        'INVOICE_UNDER_OBJECTION',
        `Invoice ${old.invoice_number} is under objection, and collection is suspended until the objection is decided.`,
      );
    }
    if (old.taxpayer_status !== 'ACTIVE') {
      throw conflict(
        'TAXPAYER_NOT_ACTIVE',
        `This taxpayer record is ${old.taxpayer_status.toLowerCase()} and cannot be billed.`,
      );
    }

    const transactions = await query<{ id: string; status: string }>(
      client,
      'SELECT id, status FROM transactions WHERE invoice_id = $1 ORDER BY created_at FOR UPDATE',
      [old.id],
    );
    const paymentInFlight = await queryOne<{ id: string }>(
      client,
      `SELECT p.id FROM payments p
         JOIN transactions t ON t.id = p.transaction_id
        WHERE t.invoice_id = $1 AND p.status IN ('INITIATED','PENDING','SUCCESSFUL','VERIFIED')
        LIMIT 1`,
      [old.id],
    );
    if (
      paymentInFlight ||
      transactions.some((t) => !(AT_REST as readonly string[]).includes(t.status))
    ) {
      throw conflict(
        'INVOICE_PAYMENT_IN_PROGRESS',
        `A payment against invoice ${old.invoice_number} is still being processed.`,
        'Check the payment status first. If the gateway says it did not go through, the bill can then be issued again.',
      );
    }

    const lapsed =
      old.status === 'EXPIRED' || (old.expires_at !== null && old.expires_at.getTime() <= Date.now());
    const payable = transactions.some((t) =>
      (PAYABLE_TRANSACTION_STATES as readonly string[]).includes(t.status),
    );
    /*
     * Or raised in a month that has since been closed.
     *
     * Still in date, and still not payable as it stands: paying it would add
     * to the revenue the close froze for that month, so the payment path
     * refuses it with INVOICE_PERIOD_CLOSED. Issuing it again raises it in an
     * open month — for the same amount and, unlike a lapsed bill, the same
     * deadline, because nothing about what the taxpayer owes or when has
     * changed; only which month's books it will be counted in.
     */
    const monthClosed =
      !lapsed && payable
        ? ((
            await queryOne<{ shut: string | null }>(
              client,
              `SELECT ${CHARGE_PERIOD_SHUT_SQL} AS shut FROM transactions t
                WHERE t.invoice_id = $1 AND t.status = ANY($2::text[])
                ORDER BY t.created_at DESC LIMIT 1`,
              [old.id, PAYABLE_TRANSACTION_STATES],
            )
          )?.shut ?? null)
        : null;
    if (!lapsed && payable && !monthClosed) {
      throw conflict(
        'INVOICE_STILL_PAYABLE',
        `Invoice ${old.invoice_number} can still be paid` +
          (old.expires_at ? ` until ${old.expires_at.toISOString().slice(0, 10)}` : '') +
          '. Take the payment against it.',
      );
    }

    /*
     * A vehicle renewal follows the bill, or the bill is not issued again.
     *
     * The renewal is tied to a transaction, not to the assessment, and it is
     * completed by `issueRenewalFor` when that transaction is paid. Left on
     * the old one, the motorist would pay the new bill and receive nothing.
     * Its period is decided at completion, not here, so moving it is safe.
     *
     * A renewal that is no longer pending — cancelled when its payment was
     * reversed, after the vehicle's expiry had already been moved and the
     * authority told — is not one this can finish. Issuing the bill again
     * would collect for a renewal the registry already shows, or grant a
     * second one on top of it.
     */
    const renewal = transactions.length
      ? await queryOne<{ id: string; status: string }>(
          client,
          'SELECT id, status FROM vehicle_renewals WHERE transaction_id = ANY($1::uuid[]) FOR UPDATE',
          [transactions.map((t) => t.id)],
        )
      : null;
    if (renewal && renewal.status !== 'PENDING_PAYMENT') {
      throw conflict(
        'VEHICLE_RENEWAL_CLOSED',
        `Invoice ${old.invoice_number} was for a vehicle renewal that is now ${renewal.status.toLowerCase()}, so it cannot be issued again.`,
        'A PSIRS officer has to settle this with the vehicle registry.',
      );
    }

    const raised = await raiseInvoiceIn(client, {
      assessmentId: old.assessment_id,
      assessmentNumber: old.assessment_number,
      taxpayerId: old.taxpayer_id,
      revenueItemId: old.revenue_item_id,
      lgaId: old.lga_id,
      wardId: old.ward_id,
      amountKobo: parseKobo(old.amount_kobo),
      serviceChargeKobo: parseKobo(old.service_charge_kobo),
      totalKobo: parseKobo(old.total_amount_kobo),
      validityDays: 30,
      expiresAt: monthClosed && old.expires_at ? old.expires_at : undefined,
      actorId: params.actorId,
      agentId: params.agentId ?? null,
      territoryId: params.territoryId ?? null,
      deviceId: params.deviceId ?? null,
      latitude: params.latitude ?? null,
      longitude: params.longitude ?? null,
      channel: params.channel ?? 'AGENT_PWA',
      eventMetadata: { reissueOf: old.invoice_number },
    });

    const why = lapsed
      ? `Invoice ${old.invoice_number} passed its payment deadline unpaid`
      : monthClosed
        ? `Invoice ${old.invoice_number} was raised in ${monthClosed}, which has been closed`
        : `The payment against invoice ${old.invoice_number} was reversed`;

    await client.query(`UPDATE invoices SET status = 'CANCELLED', reissued_as = $2 WHERE id = $1`, [
      old.id,
      raised.invoiceId,
    ]);

    // The old transactions are closed, so nothing can be collected on them.
    for (const transaction of transactions) {
      // A charge moved out of a closed month did not lapse; it is cancelled.
      const to =
        transaction.status === 'INVOICE_GENERATED' || transaction.status === 'ASSESSMENT_CREATED'
          ? monthClosed
            ? 'CANCELLED'
            : 'EXPIRED'
          : transaction.status === 'FAILED'
            ? 'CANCELLED'
            : null;
      if (!to) continue;
      await transitionTransaction(client, {
        transactionId: transaction.id,
        to,
        reason: `${why}; issued again as ${raised.invoiceNumber}`,
        actorId: params.actorId,
        source: params.channel === 'OFFICER' ? 'OFFICER' : 'AGENT',
      });
    }

    // The assessment the sweep marked EXPIRED is billed again.
    await client.query(
      `UPDATE assessments SET status = 'INVOICED' WHERE id = $1 AND status = 'EXPIRED'`,
      [old.assessment_id],
    );

    if (renewal) {
      await client.query('UPDATE vehicle_renewals SET transaction_id = $2 WHERE id = $1', [
        renewal.id,
        raised.transactionId,
      ]);
    }

    await recordAudit(client, {
      actorId: params.actorId,
      actorRole: params.actorRole,
      action: 'invoice.reissued',
      entityType: 'invoice',
      entityId: old.id,
      oldValue: {
        invoiceNumber: old.invoice_number,
        status: old.status,
        expiresAt: old.expires_at,
      },
      newValue: {
        status: 'CANCELLED',
        reissuedAs: raised.invoiceId,
        invoiceNumber: raised.invoiceNumber,
        transactionReference: raised.transactionReference,
        totalKobo: old.total_amount_kobo,
        expiresAt: raised.expiresAt,
        vehicleRenewalId: renewal?.id ?? null,
      },
      reason: why,
      ipAddress: params.ipAddress ?? null,
      deviceId: params.deviceId ?? null,
      latitude: params.latitude ?? null,
      longitude: params.longitude ?? null,
    });

    return {
      reissued: true,
      invoiceId: raised.invoiceId,
      invoiceNumber: raised.invoiceNumber,
      transactionId: raised.transactionId,
      transactionReference: raised.transactionReference,
      totalKobo: parseKobo(old.total_amount_kobo),
      expiresAt: raised.expiresAt,
      replaces: { invoiceId: old.id, invoiceNumber: old.invoice_number },
    };
  });
}

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


/**
 * Why a bill cannot be withdrawn, if it cannot.
 *
 * Asked twice: when the withdrawal is requested, so an officer is told at once
 * rather than after a colleague has spent time deciding, and again under lock
 * when it is granted, because a bill can be paid in between.
 */
async function withdrawableInvoice(client: PoolClient, invoiceId: string, lock: boolean) {
  const invoice = await queryOne<{
    id: string;
    invoice_number: string;
    status: string;
    amount_paid_kobo: string;
    total_amount_kobo: string;
    taxpayer_id: string;
  }>(
    client,
    `SELECT id, invoice_number, status, amount_paid_kobo, total_amount_kobo, taxpayer_id
       FROM invoices WHERE id = $1 ${lock ? 'FOR UPDATE' : ''}`,
    [invoiceId],
  );
  if (!invoice) throw notFound('That invoice');
  if (invoice.status === 'PAID') {
    throw conflict(
      'INVOICE_ALREADY_PAID',
      `Invoice ${invoice.invoice_number} has been paid. A paid bill raised in error is put right by reversing the payment, not by withdrawing the bill.`,
    );
  }
  if (invoice.status === 'PARTIALLY_PAID' || parseKobo(invoice.amount_paid_kobo) > 0n) {
    throw conflict(
      'INVOICE_PART_PAID',
      `Part of invoice ${invoice.invoice_number} has been paid, so it cannot simply be withdrawn.`,
      'What happens to the part already paid is a decision for a PSIRS officer.',
    );
  }
  if (invoice.status === 'CANCELLED') {
    throw conflict(
      'INVOICE_WITHDRAWN',
      `Invoice ${invoice.invoice_number} is no longer owed, so there is nothing to withdraw.`,
    );
  }

  const transactions = await chargesAtRest(
    client,
    invoice,
    lock,
    'Check the payment status first. A bill somebody is paying is not withdrawn.',
  );
  return { invoice, transactions };
}

/**
 * A bill's charges, provided nothing is moving against any of them.
 *
 * Refuses while an attempt is in flight or money is held — the gateway's or
 * the State's — because a bill ended under a payment is a bill the payment
 * then settles: the settlement writes PAID over whatever status it finds.
 */
async function chargesAtRest(
  client: PoolClient,
  invoice: { id: string; invoice_number: string },
  lock: boolean,
  nextStep: string,
) {
  const transactions = await query<{ id: string; status: string }>(
    client,
    `SELECT id, status FROM transactions WHERE invoice_id = $1 ORDER BY created_at ${lock ? 'FOR UPDATE' : ''}`,
    [invoice.id],
  );
  const paymentInFlight = await queryOne<{ id: string }>(
    client,
    `SELECT p.id FROM payments p
       JOIN transactions t ON t.id = p.transaction_id
      WHERE t.invoice_id = $1 AND p.status IN ('INITIATED','PENDING','SUCCESSFUL','VERIFIED')
      LIMIT 1`,
    [invoice.id],
  );
  if (paymentInFlight || transactions.some((t) => !(AT_REST as readonly string[]).includes(t.status))) {
    throw conflict(
      'INVOICE_PAYMENT_IN_PROGRESS',
      `A payment against invoice ${invoice.invoice_number} is still being processed.`,
      nextStep,
    );
  }
  return transactions;
}

/** The request-time half: refuses, by name, a bill that could not be withdrawn. */
export async function checkInvoiceWithdrawal(client: PoolClient, invoiceId: string): Promise<void> {
  await withdrawableInvoice(client, invoiceId, false);
}

/**
 * Withdraw a bill raised in error, once a second officer has granted it.
 *
 * Called from the approval decision, inside its transaction, so a bill that
 * can no longer be withdrawn — paid since it was asked for — refuses the
 * decision as well, and the request stays open for somebody to reject.
 *
 * The bill is cancelled and its charge closed, so nothing can be collected
 * on it; a vehicle renewal waiting on it is cancelled with it. The assessment
 * is left as it was, as an upheld objection leaves it: what is withdrawn is
 * the demand, and the record of what was assessed stays for the auditor.
 */
export async function withdrawInvoiceIn(
  client: PoolClient,
  params: { approvalId: string; actorId: string; actorRole: string },
): Promise<{ invoiceId: string; invoiceNumber: string }> {
  const approval = await queryOne<{ entity_id: string; requested_reason: string; requested_by: string }>(
    client,
    `SELECT entity_id, requested_reason, requested_by FROM approvals
      WHERE id = $1 AND approval_type = 'INVOICE_WITHDRAWAL'`,
    [params.approvalId],
  );
  if (!approval) throw notFound('That withdrawal request');

  const { invoice, transactions } = await withdrawableInvoice(client, approval.entity_id, true);

  await client.query(`UPDATE invoices SET status = 'CANCELLED' WHERE id = $1`, [invoice.id]);

  for (const transaction of transactions) {
    if (!['ASSESSMENT_CREATED', 'INVOICE_GENERATED', 'FAILED'].includes(transaction.status)) continue;
    await transitionTransaction(client, {
      transactionId: transaction.id,
      to: 'CANCELLED',
      reason: `Invoice ${invoice.invoice_number} withdrawn as raised in error`,
      actorId: params.actorId,
      source: 'OFFICER',
      metadata: { approvalId: params.approvalId },
    });
  }

  if (transactions.length) {
    await client.query(
      `UPDATE vehicle_renewals SET status = 'CANCELLED'
        WHERE transaction_id = ANY($1::uuid[]) AND status = 'PENDING_PAYMENT'`,
      [transactions.map((t) => t.id)],
    );
  }

  await client.query(`UPDATE approvals SET status = 'EXECUTED', executed_at = now() WHERE id = $1`, [
    params.approvalId,
  ]);

  await recordAudit(client, {
    actorId: params.actorId,
    actorRole: params.actorRole,
    action: 'invoice.withdrawn',
    entityType: 'invoice',
    entityId: invoice.id,
    oldValue: { status: invoice.status },
    newValue: {
      status: 'CANCELLED',
      approvalId: params.approvalId,
      requestedBy: approval.requested_by,
      totalKobo: invoice.total_amount_kobo,
    },
    reason: approval.requested_reason,
  });

  return { invoiceId: invoice.id, invoiceNumber: invoice.invoice_number };
}

/**
 * Outstanding obligations for a taxpayer (PRD §5.2 "Know what they owe").
 *
 * Everything owed, lapsed or not (`OWED_INVOICE_SQL`), each with whether it
 * can be taken today or has to be issued again first.
 *
 * This list used to be what could be paid. A lapsed invoice left it at its
 * deadline, because shown, it carried a "Take this payment" button the
 * payment path then refused with INVOICE_EXPIRED, and nothing could replace
 * it except a fresh assessment. Leaving it off was also what let an agent
 * raise that second assessment without being told the debt was on file — the
 * double charge the collection screen's own comment exists to prevent.
 *
 * A lapsed bill can now be issued again (`reissueInvoice`), so it comes back,
 * marked `needs_reissue`, and the screen offers the reissue where it offered
 * the payment. So is a bill owed again after a payment its payer's bank
 * reversed: in date, but its only charge is REVERSED and takes nothing.
 */
export async function getObligations(db: Db, taxpayerId: string) {
  /*
   * AND WHETHER THE STATE HAS AGREED NOT TO PURSUE IT.
   *
   * `lib/enforcement-suspended.ts` records four readers of the open-objection
   * rule, three of them once wrong, and predicts "a fifth reader that forgets
   * to ask is still possible". This was it. The agent's collection screen
   * reads this list and shows each invoice with its amount, an UNPAID badge
   * and a "Take this payment" button — and for an invoice the trader had
   * formally objected to, the row was identical before and after the
   * objection. Measured: one obligation, UNPAID, no field mentioning it.
   *
   * So an agent at the stall, paid commission on what they collect, was one
   * tap from collecting money the State had promised not to pursue while the
   * objection is decided — the most direct form of the enforcement an
   * objection suspends.
   *
   * The invoice stays on this list. Disputed money is still owed, and that
   * module draws the line at queries that act against the taxpayer rather
   * than describe the ledger; hiding it would also make "nothing is
   * outstanding" true, which is what tells an agent to raise a second
   * assessment for the same debt. What changes is that the row now says it is
   * under objection, by the same shared fragment every other reader uses — so
   * this reader cannot come to a different answer than the rest.
   */
  return query(
    db,
    `SELECT i.id AS invoice_id, i.invoice_number, i.total_amount_kobo, i.amount_paid_kobo,
            i.status, i.expires_at, i.issued_at,
            ${UNDER_OPEN_OBJECTION_SQL} AS under_objection,
            a.assessment_number, a.period_label,
            ri.name AS revenue_item, ri.name_ha AS revenue_item_ha,
            rc.name AS revenue_category, rc.name_ha AS revenue_category_ha,
            t.id AS transaction_id, t.transaction_reference, t.status AS transaction_status,
            /*
             * In date, but raised in a month since closed: issued again into an
             * open month before it is paid. See INVOICE_PERIOD_CLOSED.
             */
            CASE WHEN t.status IN ('INVOICE_GENERATED', 'FAILED') THEN ${CHARGE_PERIOD_SHUT_SQL} END
              AS period_closed,
            /*
             * Owed but not collectable as it stands: past its deadline, or its
             * charge has ended (a reversal, an expiry), or its month has been
             * closed. Issued again, it is.
             */
            (NOT (${PAYABLE_INVOICE_SQL}
                  AND COALESCE(t.status, '') NOT IN ('REVERSED', 'REFUNDED', 'EXPIRED', 'CANCELLED'))
             OR (t.status IN ('INVOICE_GENERATED', 'FAILED') AND ${CHARGE_PERIOD_SHUT_SQL} IS NOT NULL))
              AS needs_reissue
       FROM invoices i
       JOIN assessments a ON a.id = i.assessment_id
       JOIN revenue_items ri ON ri.id = a.revenue_item_id
       JOIN revenue_categories rc ON rc.id = ri.category_id
       LEFT JOIN transactions t ON t.invoice_id = i.id
      WHERE i.taxpayer_id = $1 AND ${OWED_INVOICE_SQL}
      ORDER BY i.issued_at DESC`,
    [taxpayerId],
  );
}

/**
 * Withdraw a revenue item from the catalogue, or put it back (PRD §8).
 *
 * The catalogue is the legal basis for collection: an agent may take money for
 * an item because the state says that item is collectable. `revenue_items`
 * has always declared four statuses and every reader already honours them —
 * `listItems` and `getItem` both require ACTIVE, and `createAssessment` reads
 * through `getItem`, so a non-ACTIVE item cannot be assessed against. Nothing
 * wrote them. An item created in error, a levy a court struck down, a fee the
 * House repealed: all of them stayed collectable for as long as the platform
 * ran, because the only status the code could produce was the ACTIVE it was
 * inserted with.
 *
 * Withdrawal is forward-looking, deliberately. Invoices already raised stay
 * payable and receipts already issued stay valid — the money was owed under
 * the rule in force when it was assessed, and cancelling those is a separate
 * decision an officer makes invoice by invoice. What stops is *new* liability.
 *
 * SUSPENDED and RETIRED differ in whether anyone expects to come back:
 * suspension is a pause pending an answer, retirement is the end of the item.
 * Retirement is therefore terminal — a levy brought back after being retired
 * is a new levy, with its own code, its own rate and its own authority.
 */
export async function setRevenueItemStatus(params: {
  itemId: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'RETIRED';
  reason: string;
  actorId: string;
  actorRole: string;
}): Promise<{ code: string; name: string; from: string; to: string }> {
  return withTransaction(async (client) => {
    const item = await queryOne<{ code: string; name: string; status: string }>(
      client,
      'SELECT code, name, status FROM revenue_items WHERE id = $1 FOR UPDATE',
      [params.itemId],
    );
    if (!item) throw notFound('That revenue item');

    if (item.status === params.status) {
      throw conflict(
        'ITEM_STATUS_UNCHANGED',
        `${item.name} is already ${params.status.toLowerCase()}.`,
      );
    }

    if (item.status === 'RETIRED') {
      throw conflict(
        'ITEM_RETIRED',
        `${item.name} has been retired and cannot be brought back. Publish a new revenue item ` +
          'with its own code and rate if the charge is being reintroduced.',
      );
    }

    if (item.status === 'DRAFT' && params.status !== 'ACTIVE') {
      throw conflict(
        'ITEM_NOT_PUBLISHED',
        `${item.name} has never been published, so there is nothing to withdraw.`,
      );
    }

    await client.query(
      `UPDATE revenue_items
          SET status = $2, status_reason = $3, status_changed_at = now(),
              status_changed_by = $4, updated_at = now()
        WHERE id = $1`,
      [params.itemId, params.status, params.reason, params.actorId],
    );

    await recordAudit(client, {
      actorId: params.actorId,
      actorRole: params.actorRole,
      action: params.status === 'ACTIVE' ? 'catalogue.item_restored' : 'catalogue.item_withdrawn',
      entityType: 'revenue_item',
      entityId: params.itemId,
      oldValue: { status: item.status },
      newValue: { status: params.status, reason: params.reason },
    });

    return { code: item.code, name: item.name, from: item.status, to: params.status };
  });
}
