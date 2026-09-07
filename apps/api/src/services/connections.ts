/**
 * What is connected to this person, and where each claim came from.
 *
 * Phase 2 of the informal-sector programme. Phase 1 collected from people the
 * State had already assessed; this finds people it should have assessed and
 * has not, using registers it already owns. No new law, no field enumeration,
 * and — the part that matters — no new data about anybody. Every edge here is
 * derived from a record PSIRS already holds.
 *
 * WHY THIS IS A GRAPH OF CLAIMS AND NOT A PROFILE.
 *
 * The naive version of "show me everything about this taxpayer" is a dossier,
 * and a dossier is both a legal exposure under the Nigeria Data Protection Act
 * 2023 and the thing that turns a revenue authority into something citizens
 * route around. The design constraint that follows is not a nicety: a revenue
 * authority may target collection to specific, tax-relevant activity, and may
 * not hold information because it might one day be useful.
 *
 * So every edge is a claim, and carries with it the answer to four questions a
 * citizen is entitled to ask: where did you get this, how sure are you, what
 * power lets you hold it, and what happens when I tell you it is wrong. Those
 * are columns, not documentation — see migration 055, which holds them as
 * database invariants because a rule that only holds through this file is not
 * an invariant.
 *
 * MATCH, NEVER MERGE.
 *
 * The vehicle register carries an explicit `taxpayer_id` on some rows and only
 * a free-text owner name and phone on others. Both produce an edge and they
 * are not the same edge: the first is the State's own record of who owns what,
 * believed at 100; the second is a phone number two records happen to share,
 * believed at 85 and carrying `SHARED_PHONE` so nobody has to guess why. A
 * shared phone is a lead. It is not a finding, and it may not become one by
 * somebody editing a number — the claim columns are immutable, so raising
 * confidence means withdrawing the edge and asserting a new one, which leaves
 * the history of what was believed intact.
 *
 * An ambiguous match produces nothing at all. A phone number registered
 * against two taxpayers identifies neither of them, and asserting both would
 * put a citizen on an enforcement list because somebody reused a handset.
 *
 * TWO USES, AND NO OTHERS.
 *
 * Coverage: assets that imply an income nobody has been assessed on. Three
 * commercial vehicles against a person with no income assessment is a lead an
 * officer should look at, and it is the highest-yield query available from
 * data already in the platform.
 *
 * Consistency: an assessment that contradicts observable assets is an
 * exception for a human to consider, never an automatic re-assessment.
 *
 * Both are reads of a named person's record, and both are logged with a stated
 * purpose. `readConnections` will not run without one — purpose-binding that
 * can be skipped is not purpose-binding, and a log nobody can be held to is
 * decoration.
 *
 * THE HALF THAT IS USUALLY MISSING.
 *
 * Assets get the attention; the liabilities are what let an officer act
 * without harassing anybody. One query answering "does the person in front of
 * me owe the State anything, anywhere" replaces four phone calls, and it is
 * also what stops a demand being made against somebody who is paid up.
 */

import type { Db } from '../db/pool';
import { query, queryOne, withTransaction } from '../db/pool';
import { scopeParams, type ReportScope } from './report-scope';
import { recordAudit } from './audit';
import { badRequest, notFound } from '../lib/errors';

/**
 * The lawful basis cited on edges this platform derives for itself.
 *
 * Named here rather than typed at a call site so that every internally derived
 * edge cites the same thing, and so that changing what is relied on is one
 * edit somebody can find. Edges from an outside register will cite that
 * register's own basis instead.
 */
const INTERNAL_BASIS =
  'Plateau State revenue administration — assessment and collection of taxes ' +
  'due to the State, on records the State itself holds';

/**
 * How strongly a match is believed, and why.
 *
 * The vocabulary is the platform's existing duplicate-check confidence model,
 * applied to a different question. Two values only, because two are what the
 * vehicle register can actually support: it either says who the taxpayer is or
 * it does not.
 */
const CONFIDENCE = {
  /** The register itself names the taxpayer. This is the State's own record. */
  TAXPAYER_ID: 100,
  /** Two records share a phone number. A lead, and not a finding. */
  SHARED_PHONE: 85,
} as const;

export type ConnectionPurpose = 'COVERAGE_LEAD' | 'CONSISTENCY_CHECK' | 'TAXPAYER_REQUEST';

export interface Connection {
  id: string;
  kind: string;
  subjectType: string;
  subjectId: string;
  subjectLabel: string;
  source: string;
  confidence: number;
  matchBasis: string;
  lawfulBasis: string;
  state: string;
  stateReason: string | null;
  obtainedAt: Date;
  obtainedByJob: string | null;
}

export interface Liability {
  kind: string;
  reference: string;
  description: string;
  amountKobo: string;
  since: Date | null;
  payable: boolean;
}

export interface ConnectionView {
  taxpayerId: string;
  name: string;
  tin: string | null;
  connections: Connection[];
  liabilities: Liability[];
  totalOwedKobo: string;
}

/* -------------------------------------------------------------------------- */
/* Building the graph                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Derive OWNS edges from the vehicle register.
 *
 * Runs as a job and is safe to run repeatedly: the partial unique index in
 * migration 055 makes a re-assertion of a live edge a no-op, so the graph does
 * not double when the schedule and an officer both trigger it.
 *
 * The two arms are deliberately separate queries rather than one with a CASE.
 * They are different claims with different consequences — one is the State
 * reading its own record, the other is an inference from a shared phone
 * number — and writing them together is how the distinction gets lost in a
 * later edit.
 */
export async function rebuildVehicleConnections(
  db: Db,
  params: { limit?: number } = {},
): Promise<{ asserted: number; fromRegistry: number; fromPhone: number; ambiguous: number }> {
  const limit = Math.min(Math.max(params.limit ?? 1000, 1), 10_000);

  /*
   * Arm one: the register names the taxpayer.
   *
   * ARCHIVED vehicles are skipped. A vehicle taken off the register is not an
   * asset the State should be reasoning about, and an edge asserted from one
   * would outlive the fact it was drawn from.
   */
  const registry = await query<{ id: string }>(
    db,
    `INSERT INTO taxpayer_connections
       (taxpayer_id, kind, subject_type, subject_id, subject_label,
        source, confidence, match_basis, lawful_basis, obtained_by_job)
     SELECT v.taxpayer_id, 'OWNS', 'VEHICLE', v.id,
            v.registration_number ||
              COALESCE(' — ' || NULLIF(trim(COALESCE(v.make,'') || ' ' || COALESCE(v.model,'')), ''), ''),
            'VEHICLE_REGISTRY', $2, 'TAXPAYER_ID', $3, 'connection-graph'
       FROM vehicles v
       JOIN taxpayers t ON t.id = v.taxpayer_id
      WHERE v.status <> 'ARCHIVED'
        AND t.status = 'ACTIVE'
      ORDER BY v.created_at
      LIMIT $1
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [limit, CONFIDENCE.TAXPAYER_ID, INTERNAL_BASIS],
  );

  /*
   * Arm two: no taxpayer on the register, but the owner's phone is one we
   * hold. Asserted at 85 and marked SHARED_PHONE, so that everything reading
   * this edge can tell it apart from the State's own record.
   *
   * The HAVING clause is the important line. A phone matching two taxpayers
   * identifies neither, and an edge asserted against both would put somebody
   * on an enforcement list because a handset was reused — which is precisely
   * the failure this design calls "merge" and refuses.
   */
  const phone = await query<{ id: string }>(
    db,
    `WITH unambiguous AS (
       SELECT v.id AS vehicle_id,
              v.registration_number,
              v.make,
              v.model,
              -- (ARRAY_AGG)[1] rather than min(): Postgres has no min() for
              -- uuid, and the HAVING below has already established there is
              -- exactly one match, so which element is taken cannot matter.
              (ARRAY_AGG(t.id))[1] AS taxpayer_id
         FROM vehicles v
         JOIN taxpayers t
           ON t.phone = v.owner_phone
          AND t.status = 'ACTIVE'
        WHERE v.taxpayer_id IS NULL
          AND v.owner_phone IS NOT NULL
          AND v.status <> 'ARCHIVED'
        GROUP BY v.id, v.registration_number, v.make, v.model
       HAVING count(DISTINCT t.id) = 1
        ORDER BY v.id
        LIMIT $1
     )
     INSERT INTO taxpayer_connections
       (taxpayer_id, kind, subject_type, subject_id, subject_label,
        source, confidence, match_basis, lawful_basis, obtained_by_job)
     SELECT u.taxpayer_id, 'OWNS', 'VEHICLE', u.vehicle_id,
            u.registration_number ||
              COALESCE(' — ' || NULLIF(trim(COALESCE(u.make,'') || ' ' || COALESCE(u.model,'')), ''), ''),
            'VEHICLE_REGISTRY', $2, 'SHARED_PHONE', $3, 'connection-graph'
       FROM unambiguous u
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [limit, CONFIDENCE.SHARED_PHONE, INTERNAL_BASIS],
  );

  /*
   * Counted and reported rather than silently dropped. An ambiguous match is
   * a data-quality problem somebody can fix — two taxpayers sharing a phone is
   * usually one duplicate record — and a number that never surfaces is a
   * problem nobody knows they have.
   */
  const ambiguous = await queryOne<{ count: string }>(
    db,
    `SELECT count(*)::text AS count
       FROM (
         SELECT v.id
           FROM vehicles v
           JOIN taxpayers t ON t.phone = v.owner_phone AND t.status = 'ACTIVE'
          WHERE v.taxpayer_id IS NULL
            AND v.owner_phone IS NOT NULL
            AND v.status <> 'ARCHIVED'
          GROUP BY v.id
         HAVING count(DISTINCT t.id) > 1
       ) ambiguous_matches`,
    [],
  );

  return {
    asserted: registry.length + phone.length,
    fromRegistry: registry.length,
    fromPhone: phone.length,
    ambiguous: Number.parseInt(ambiguous?.count ?? '0', 10),
  };
}

/* -------------------------------------------------------------------------- */
/* Reading it                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Everything the platform claims about one taxpayer, with the read logged.
 *
 * The purpose is a required argument and the log write happens in the same
 * transaction as the read. A logged read that can fail independently of the
 * read it describes is a log with holes in exactly the cases somebody would
 * care about.
 *
 * Withdrawn edges are excluded from the officer's view and kept in the table.
 * The State retracted the claim; continuing to show it would make the
 * withdrawal cosmetic. They remain visible to the citizen's own view, which is
 * the one audience with a reason to see what was once believed about them.
 */
export async function readConnections(
  db: Db,
  params: {
    taxpayerId: string;
    purpose: ConnectionPurpose;
    actorId: string | null;
    ipAddress?: string | null;
    includeWithdrawn?: boolean;
  },
): Promise<ConnectionView> {
  const taxpayer = await queryOne<{
    id: string;
    name: string;
    tin: string | null;
  }>(
    db,
    `SELECT id,
            COALESCE(NULLIF(trim(business_name), ''),
                     trim(coalesce(first_name,'') || ' ' || coalesce(last_name,''))) AS name,
            tin
       FROM taxpayers WHERE id = $1`,
    [params.taxpayerId],
  );
  if (!taxpayer) throw notFound('That taxpayer');

  return withTransaction(async (client) => {
    await client.query(
      `INSERT INTO taxpayer_connection_access_logs
         (taxpayer_id, accessed_by, purpose, ip_address)
       VALUES ($1, $2, $3, $4)`,
      [params.taxpayerId, params.actorId, params.purpose, params.ipAddress ?? null],
    );

    const connections = await query<{
      id: string;
      kind: string;
      subject_type: string;
      subject_id: string;
      subject_label: string;
      source: string;
      confidence: number;
      match_basis: string;
      lawful_basis: string;
      state: string;
      state_reason: string | null;
      obtained_at: Date;
      obtained_by_job: string | null;
    }>(
      client,
      `SELECT id, kind, subject_type, subject_id, subject_label, source, confidence,
              match_basis, lawful_basis, state, state_reason, obtained_at, obtained_by_job
         FROM taxpayer_connections
        WHERE taxpayer_id = $1
          AND ($2 OR state <> 'WITHDRAWN')
        ORDER BY confidence DESC, obtained_at DESC`,
      [params.taxpayerId, params.includeWithdrawn ?? false],
    );

    const liabilities = await liabilitiesFor(client, params.taxpayerId);

    return {
      taxpayerId: taxpayer.id,
      name: taxpayer.name,
      tin: taxpayer.tin,
      connections: connections.map((row) => ({
        id: row.id,
        kind: row.kind,
        subjectType: row.subject_type,
        subjectId: row.subject_id,
        subjectLabel: row.subject_label,
        source: row.source,
        confidence: row.confidence,
        matchBasis: row.match_basis,
        lawfulBasis: row.lawful_basis,
        state: row.state,
        stateReason: row.state_reason,
        obtainedAt: row.obtained_at,
        obtainedByJob: row.obtained_by_job,
      })),
      liabilities,
      totalOwedKobo: liabilities
        .reduce((total, item) => total + BigInt(item.amountKobo), 0n)
        .toString(),
    };
  });
}

/**
 * Everything this person owes the State, across the places it is recorded.
 *
 * `payable` is carried per row for the same reason the arrears worklist keeps
 * lapsed debt off its call list: an officer looking at a total needs to know
 * which part of it can be taken today and which part needs a fresh assessment
 * first, or the conversation ends with the platform refusing money the citizen
 * has just agreed to pay.
 */
export async function liabilitiesFor(db: Db, taxpayerId: string): Promise<Liability[]> {
  const invoices = await query<{
    invoice_number: string;
    item_name: string;
    owed_kobo: string;
    issued_at: Date;
    payable: boolean;
  }>(
    db,
    `SELECT i.invoice_number,
            ri.name AS item_name,
            (i.total_amount_kobo - i.amount_paid_kobo)::text AS owed_kobo,
            i.issued_at,
            (i.expires_at IS NULL OR i.expires_at > now()) AS payable
       FROM invoices i
       JOIN assessments a    ON a.id = i.assessment_id
       JOIN revenue_items ri ON ri.id = a.revenue_item_id
      WHERE i.taxpayer_id = $1
        AND i.status IN ('UNPAID', 'PARTIALLY_PAID', 'EXPIRED')
        AND i.total_amount_kobo > i.amount_paid_kobo
      ORDER BY i.issued_at`,
    [taxpayerId],
  );

  return invoices.map((row) => ({
    kind: 'INVOICE',
    reference: row.invoice_number,
    description: row.item_name,
    amountKobo: row.owed_kobo,
    since: row.issued_at,
    payable: row.payable,
  }));
}

/* -------------------------------------------------------------------------- */
/* Coverage leads                                                             */
/* -------------------------------------------------------------------------- */

export interface CoverageLead {
  taxpayerId: string;
  name: string;
  tin: string | null;
  phone: string;
  lgaId: string;
  lgaName: string;
  /** How many commercial vehicles are connected to them. */
  commercialVehicles: number;
  /** The registrations, so an officer can check before ringing. */
  registrations: string[];
  /**
   * The weakest confidence among the edges behind this lead. A lead built
   * entirely on shared phone numbers is a different proposition from one the
   * register itself supports, and an officer must be able to see which they
   * have before acting.
   */
  lowestConfidence: number;
  /** True when at least one vehicle was charged the commercial renewal rate. */
  chargedCommercialRate: boolean;
  /** What they have paid the State in the last year, in kobo. */
  paidLastYearKobo: string;
}

export interface CoverageLeads {
  summary: {
    leads: number;
    vehicles: number;
    /**
     * Vehicles whose owner could not be identified at all. Reported because it
     * is the size of the gap this query cannot see into, and a lead count
     * without it reads as completeness.
     */
    unmatchedVehicles: number;
  };
  rows: CoverageLead[];
}

/**
 * Commercial vehicles owned by people with no income assessment.
 *
 * The highest-yield query available from data the platform already holds, and
 * the reason Phase 2 comes before the presumptive machinery: somebody running
 * three commercial vehicles has an income, and if PSIRS has never assessed
 * them for it, that is revenue sitting in a table nobody queried.
 *
 * WHAT "COMMERCIAL" MEANS HERE, AND WHAT IT CANNOT MEAN.
 *
 * `vehicles.vehicle_type` is free text — the column takes whatever the vehicle
 * authority returns, and no constraint governs it. So a text match on it is a
 * heuristic, and a lead list built on one alone would silently miss every
 * vehicle whose type the authority spells differently.
 *
 * The firmer signal is what the State itself charged: a renewal raised against
 * the commercial rate is the State's own act, not an inference. Both are used,
 * and `chargedCommercialRate` tells the officer which they are looking at.
 *
 * WHAT "NO INCOME ASSESSMENT" MEANS. No assessment, ever, against any item in
 * the Personal Income Tax category. Not "no assessment this year" — a lead
 * list that re-raised somebody assessed eleven months ago would send officers
 * after people already in the system.
 */
export async function coverageLeads(
  db: Db,
  params: { lgaId?: string; minimumVehicles?: number; limit?: number } = {},
  scope: ReportScope = { kind: 'STATEWIDE' },
): Promise<CoverageLeads> {
  const { statewide, lgaIds } = scopeParams(scope);
  const minimumVehicles = Math.max(params.minimumVehicles ?? 1, 1);
  const limit = Math.min(Math.max(params.limit ?? 100, 1), 500);

  const base = `
    WITH commercial AS (
      SELECT c.taxpayer_id,
             c.subject_id AS vehicle_id,
             c.subject_label,
             c.confidence,
             EXISTS (
               SELECT 1
                 FROM vehicle_renewals vr
                 JOIN transactions tr   ON tr.id = vr.transaction_id
                 JOIN assessments a     ON a.id = tr.assessment_id
                 JOIN revenue_items ri  ON ri.id = a.revenue_item_id
                WHERE vr.vehicle_id = c.subject_id
                  AND ri.code = 'VEH-RENEW-COMMERCIAL'
             ) AS charged_commercial
        FROM taxpayer_connections c
        JOIN vehicles v ON v.id = c.subject_id
       WHERE c.subject_type = 'VEHICLE'
         AND c.kind = 'OWNS'
         /*
          * A disputed or withdrawn edge is not evidence. Chasing somebody on a
          * claim they have already told the State is wrong is how an
          * enforcement list turns into a complaint file.
          */
         AND c.state IN ('ASSERTED', 'CONFIRMED_BY_TAXPAYER')
         AND v.status <> 'ARCHIVED'
         AND (
           EXISTS (
             SELECT 1
               FROM vehicle_renewals vr
               JOIN transactions tr  ON tr.id = vr.transaction_id
               JOIN assessments a    ON a.id = tr.assessment_id
               JOIN revenue_items ri ON ri.id = a.revenue_item_id
              WHERE vr.vehicle_id = v.id
                AND ri.code = 'VEH-RENEW-COMMERCIAL'
           )
           OR v.vehicle_type   ~* '(commercial|taxi|hackney|bus|haulage|truck|tricycle|keke|okada)'
           OR v.vehicle_class  ~* '(commercial|taxi|hackney|bus|haulage|truck|tricycle|keke|okada)'
         )
    )`;

  const rows = await query<{
    taxpayer_id: string;
    name: string;
    tin: string | null;
    phone: string;
    lga_id: string;
    lga_name: string;
    commercial_vehicles: string;
    registrations: string[];
    lowest_confidence: number;
    charged_commercial_rate: boolean;
    paid_last_year_kobo: string;
  }>(
    db,
    `${base}
     SELECT t.id AS taxpayer_id,
            COALESCE(NULLIF(trim(t.business_name), ''),
                     trim(coalesce(t.first_name,'') || ' ' || coalesce(t.last_name,''))) AS name,
            t.tin,
            t.phone,
            t.lga_id,
            l.name AS lga_name,
            count(*)::text                       AS commercial_vehicles,
            (ARRAY_AGG(c.subject_label ORDER BY c.subject_label))[1:10] AS registrations,
            min(c.confidence)                    AS lowest_confidence,
            bool_or(c.charged_commercial)        AS charged_commercial_rate,
            COALESCE((
              SELECT SUM(tr.amount_kobo)
                FROM transactions tr
               WHERE tr.taxpayer_id = t.id
                 AND tr.status IN ('PAYMENT_CONFIRMED', 'RECEIPTED', 'SETTLED')
                 AND tr.created_at > now() - interval '1 year'
            ), 0)::text                          AS paid_last_year_kobo
       FROM commercial c
       JOIN taxpayers t ON t.id = c.taxpayer_id
       JOIN lgas l      ON l.id = t.lga_id
      WHERE t.status = 'ACTIVE'
        AND ($1 OR t.lga_id = ANY($2::uuid[]))
        AND ($3::uuid IS NULL OR t.lga_id = $3::uuid)
        /*
         * Never assessed for income tax. Written as NOT EXISTS over the whole
         * history rather than a date window: somebody assessed last year is
         * already known to the system, and putting them on a list headed
         * "people we have never assessed" wastes the visit and discredits the
         * list.
         */
        AND NOT EXISTS (
              SELECT 1
                FROM assessments a
                JOIN revenue_items ri     ON ri.id = a.revenue_item_id
                JOIN revenue_categories rc ON rc.id = ri.category_id
               WHERE a.taxpayer_id = t.id
                 AND rc.code = 'PIT'
            )
      GROUP BY t.id, t.first_name, t.last_name, t.business_name, t.tin, t.phone,
               t.lga_id, l.name
     HAVING count(*) >= $4::int
      ORDER BY count(*) DESC, min(c.confidence) DESC
      LIMIT $5`,
    [statewide, lgaIds, params.lgaId ?? null, minimumVehicles, limit],
  );

  /*
   * The vehicles this query cannot see into: on the register, not archived,
   * and connected to nobody. Reported so that a lead count is never mistaken
   * for the size of the problem — an officer told "14 leads" and not told
   * "and 300 vehicles whose owner we could not identify" has been given a
   * number that means less than it appears to.
   */
  const unmatched = await queryOne<{ count: string }>(
    db,
    `SELECT count(*)::text AS count
       FROM vehicles v
      WHERE v.status <> 'ARCHIVED'
        AND NOT EXISTS (
              SELECT 1 FROM taxpayer_connections c
               WHERE c.subject_type = 'VEHICLE'
                 AND c.subject_id = v.id
                 AND c.state <> 'WITHDRAWN'
            )`,
    [],
  );

  return {
    summary: {
      leads: rows.length,
      vehicles: rows.reduce((total, row) => total + Number.parseInt(row.commercial_vehicles, 10), 0),
      unmatchedVehicles: Number.parseInt(unmatched?.count ?? '0', 10),
    },
    rows: rows.map((row) => ({
      taxpayerId: row.taxpayer_id,
      name: row.name,
      tin: row.tin,
      phone: row.phone,
      lgaId: row.lga_id,
      lgaName: row.lga_name,
      commercialVehicles: Number.parseInt(row.commercial_vehicles, 10),
      registrations: row.registrations ?? [],
      lowestConfidence: row.lowest_confidence,
      chargedCommercialRate: row.charged_commercial_rate,
      paidLastYearKobo: row.paid_last_year_kobo,
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* Moving an edge                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Record what somebody decided about a claim.
 *
 * The only way an edge changes. Confirmation, dispute and withdrawal all go
 * through here so that the audit entry and the state change cannot happen
 * separately, and so the reason — which migration 055 requires — is written by
 * the same call that requires it.
 *
 * A citizen disputing a claim about themselves and an officer withdrawing one
 * are the same operation with different actors, and deliberately so: the
 * record should show that the claim was contested, not who was allowed to
 * contest it.
 */
export async function recordConnectionDecision(
  db: Db,
  params: {
    connectionId: string;
    state: 'CONFIRMED_BY_TAXPAYER' | 'DISPUTED' | 'WITHDRAWN';
    reason: string;
    actorId: string;
    actorRole: string;
  },
): Promise<Connection> {
  if (!params.reason.trim()) {
    throw badRequest(
      'Say why this claim is being changed. It is a record about a person, and ' +
        'a change nobody explained cannot be defended to them.',
    );
  }

  return withTransaction(async (client) => {
    const before = await queryOne<{ state: string; taxpayer_id: string }>(
      client,
      'SELECT state, taxpayer_id FROM taxpayer_connections WHERE id = $1 FOR UPDATE',
      [params.connectionId],
    );
    if (!before) throw notFound('That connection');

    const updated = await queryOne<{
      id: string;
      kind: string;
      subject_type: string;
      subject_id: string;
      subject_label: string;
      source: string;
      confidence: number;
      match_basis: string;
      lawful_basis: string;
      state: string;
      state_reason: string | null;
      obtained_at: Date;
      obtained_by_job: string | null;
    }>(
      client,
      `UPDATE taxpayer_connections
          SET state = $2, state_reason = $3, state_changed_at = now(), state_changed_by = $4
        WHERE id = $1
      RETURNING id, kind, subject_type, subject_id, subject_label, source, confidence,
                match_basis, lawful_basis, state, state_reason, obtained_at, obtained_by_job`,
      [params.connectionId, params.state, params.reason.trim(), params.actorId],
    );

    await recordAudit(client, {
      actorId: params.actorId,
      actorRole: params.actorRole,
      action: 'connection.state_changed',
      entityType: 'taxpayer_connection',
      entityId: params.connectionId,
      oldValue: { state: before.state },
      newValue: { state: params.state },
      reason: params.reason.trim(),
    });

    const row = updated!;
    return {
      id: row.id,
      kind: row.kind,
      subjectType: row.subject_type,
      subjectId: row.subject_id,
      subjectLabel: row.subject_label,
      source: row.source,
      confidence: row.confidence,
      matchBasis: row.match_basis,
      lawfulBasis: row.lawful_basis,
      state: row.state,
      stateReason: row.state_reason,
      obtainedAt: row.obtained_at,
      obtainedByJob: row.obtained_by_job,
    };
  });
}

/**
 * Who has looked at this person's graph, and why.
 *
 * The citizen-facing half of the access log. A log that only the operator can
 * read is a log that protects the operator; this is the same rows, shown to
 * the person they are about.
 */
export async function connectionAccessHistory(
  db: Db,
  taxpayerId: string,
  limit = 50,
): Promise<{ purpose: string; at: Date; officerRole: string | null }[]> {
  const rows = await query<{ purpose: string; created_at: Date; role: string | null }>(
    db,
    `SELECT l.purpose, l.created_at, u.role
       FROM taxpayer_connection_access_logs l
       LEFT JOIN users u ON u.id = l.accessed_by
      WHERE l.taxpayer_id = $1
      ORDER BY l.created_at DESC
      LIMIT $2`,
    [taxpayerId, Math.min(Math.max(limit, 1), 200)],
  );
  /*
   * The role, not the officer's name. The citizen is entitled to know that
   * their record was read and under what claimed purpose; naming the
   * individual invites reprisal in a small LGA and adds nothing to the
   * accountability the log provides, which runs to the auditor with the
   * officer's identity intact.
   */
  return rows.map((row) => ({
    purpose: row.purpose,
    at: row.created_at,
    officerRole: row.role,
  }));
}
