/**
 * What the State is already owed, ranked so somebody can go and get it.
 *
 * Phase 1 of the informal-sector programme, and the only phase that needs no
 * new law, no new schedule and no field enumeration: these people are already
 * registered, already assessed, and already in the database. The naira here is
 * the cheapest in the whole plan, and until this list is worked there is no
 * honest case for spending a field force on finding new taxpayers.
 *
 * The platform already knows the total — `taxpayer_compliance` carries an
 * `outstanding_amount_kobo` per taxpayer, computed for the compliance score.
 * What it has never had is the list: who, how much, how old, and what for,
 * ordered by the size of the debt. A score is for deciding about one person in
 * front of you. A worklist is for deciding who to go to first.
 *
 * WHAT COUNTS AS ARREARS HERE, AND WHY IT IS NOT "PAST THE DEADLINE".
 *
 * The obvious definition — an invoice past its `expires_at` — is the wrong one
 * in this schema, and dangerously so. `expires_at` is not a due date that the
 * debt survives; it is the end of the payment window. `initiatePayment` refuses
 * a lapsed invoice outright with INVOICE_EXPIRED, and `expireLapsedInvoices`
 * sweeps it to EXPIRED overnight. A worklist built on "past the deadline"
 * would therefore be a list of citizens the platform will not accept money
 * from: every call ends with the officer explaining that the bill they are
 * ringing about cannot be paid. It is also, after the sweep has run, very
 * nearly empty — the definition would quietly collapse to the few hours
 * between deadline and sweep.
 *
 * So arrears here means: assessed, still unpaid, and still payable. The list
 * is people an officer can ring today and who can pay while still on the
 * phone, which is the only version of this list that turns into revenue. It is
 * ranked by what each one owes, and within that by whose window shuts first,
 * because a debt about to lapse is a debt about to need re-assessing.
 *
 * The money on lapsed invoices has not gone anywhere, and it is reported in
 * the summary rather than dropped — but as its own figure, because it needs a
 * different action. Collecting it means raising a fresh assessment first. That
 * is a re-assessment queue, not a call list, and merging the two would have
 * officers making calls that cannot end in a payment.
 *
 * FOUR MORE THINGS THIS QUERY IS CAREFUL ABOUT.
 *
 * Money in flight is not arrears. An invoice sits UNPAID from the moment it is
 * raised until the gateway confirms, so a taxpayer who paid twenty minutes ago
 * is UNPAID right now. Demanding money from somebody holding a receipt is the
 * single worst thing this list could do — it is the failure that destroys the
 * standing of a revenue authority faster than under-collection ever will — so
 * an invoice with a payment attempt still running is excluded outright.
 *
 * Age is measured from the money, not from the paperwork. `updated_at` moves
 * every time anything happens to a row, including a part payment, which would
 * reset the age of a debt at the moment it got older. This is the same mistake
 * the reconciliation queues made — ageing from when the sweep last looked
 * rather than from when the money came in — and it is repeated here only in
 * the sense that it is deliberately not repeated.
 *
 * A merged record's debt is not its own. `MERGED` taxpayers were folded into
 * another record and their liabilities went with them; listing both would have
 * an officer chase the same money twice and a citizen answer for it twice.
 * Nothing in the platform writes that status today — duplicates are refused at
 * registration and no merge tool exists — so this guard is untested, and
 * deliberately so: a fixture writing a state the platform cannot produce would
 * register as coverage of a path that has never run. It is kept because the
 * day the merge tool lands, a worklist that had to be remembered is a worklist
 * that double-chases.
 *
 * A debt under objection is not chased. A presumptive assessment can be
 * contested, and the window that suspends enforcement is worth nothing unless
 * something honours it — a citizen who disputed an estimate and then took a
 * call demanding payment has learnt that the objection process is decorative.
 *
 * A closed record is somebody else's queue. `taxpayers/ended-with-arrears`
 * already exists for records taken off the register while still owing, and
 * that is a different conversation — reinstatement, not collection. They are
 * excluded here and counted separately, so the two lists cannot disagree about
 * who is on which.
 *
 * WHO MAY SEE IT. This is the most sensitive list the platform can produce: a
 * ranked register of citizens with the amount of money each one owes. It is
 * permission-gated, and it is scoped to the caller's own territories by the
 * same `ReportScope` every money-touching report takes — applied from the
 * caller's identity, never from a query parameter, so no combination of
 * filters can widen it. Every figure in the summary carries the same scope as
 * the rows; a count that quietly totalled the whole State would leak the size
 * of another supervisor's territory.
 */

import type { Db } from '../db/pool';
import { UNDER_OPEN_OBJECTION_SQL } from '../lib/enforcement-suspended';
import { query, queryOne } from '../db/pool';
import { scopeParams, type ReportScope } from './report-scope';

/** One taxpayer's total debt, with enough context to act on it. */
export interface ArrearsRow {
  taxpayerId: string;
  taxpayerType: string;
  tin: string | null;
  name: string;
  phone: string;
  preferredLanguage: string | null;
  lgaId: string;
  lgaName: string;
  ward: string | null;
  /** Total still owed across every payable unpaid invoice, in kobo. */
  outstandingKobo: string;
  /** How many invoices make it up. */
  invoiceCount: number;
  /** Days since the oldest of those invoices was issued. */
  oldestDaysOutstanding: number;
  /**
   * Days until the soonest of these invoices stops being payable, after which
   * collecting needs a fresh assessment. Null when none of them expires.
   * This is the officer's ordering within a day's calls: the debt about to
   * fall off the edge is the one worth ringing first.
   */
  daysUntilLapse: number | null;
  /** The revenue items owed for, most valuable first, at most five. */
  owedFor: string[];
  /** When they last paid anything at all — null if they never have. */
  lastPaymentAt: Date | null;
  /** True when at least one invoice has been part paid. */
  partiallyPaid: boolean;
}

export interface ArrearsSummary {
  /** Taxpayers on the list. */
  taxpayers: number;
  /** Total owed by them, in kobo. */
  totalKobo: string;
  /**
   * Owed by records that have been closed, and so are not on this list at all.
   * Reported rather than hidden: it is money the State is owed, and an officer
   * comparing this total against the compliance table should not have to guess
   * why the two differ.
   */
  endedElsewhereKobo: string;
  /**
   * Owed on invoices that have passed their payment deadline. Real money, and
   * excluded from the list above for a reason an officer needs told: the
   * platform will refuse a payment against these, so collecting means raising
   * a fresh assessment first. Kept as its own figure so nobody mistakes it for
   * money a phone call can bring in.
   */
  lapsedKobo: string;
  /** How many invoices that lapsed money sits on. */
  lapsedInvoices: number;
  /**
   * Invoices excluded because a payment is still running against them. Shown
   * so that a total which looks low can be explained without opening a
   * database session.
   */
  inFlightInvoices: number;
}

export interface ArrearsWorklist {
  summary: ArrearsSummary;
  rows: ArrearsRow[];
}

/**
 * Payment states that mean "somebody is trying to pay this right now".
 *
 * INITIATED and PENDING are in flight. SUCCESSFUL is the gateway saying it
 * took the money before the platform has confirmed it, which is emphatically
 * not a debt to chase. VERIFIED is excluded for a different reason — the
 * invoice would already be PAID — but naming it here costs nothing and means a
 * future status change cannot quietly put a paid-up citizen back on a demand
 * list.
 */
const IN_FLIGHT_PAYMENT_STATUSES = ['INITIATED', 'PENDING', 'SUCCESSFUL', 'VERIFIED'] as const;

const MINIMUM_KOBO = 10_000n; // ₦100 — below this the visit costs more than the debt.

export interface ArrearsParams {
  /** Ignore debts smaller than this, in kobo. Defaults to ₦100. */
  minimumKobo?: bigint;
  /**
   * Only debts whose payment window closes within this many days.
   *
   * The urgency filter, and it runs on the deadline rather than on how long
   * ago the bill was issued. Those are the same fact in this schema — the
   * validity window is a fixed thirty days, so "issued twenty-seven days ago"
   * and "lapses in three days" are one number seen from either end — but the
   * deadline is the end the platform acts on: it is what the reminder ladder
   * counts down to and what the payment path enforces. A taxpayer whose
   * invoices carry no expiry at all never lapses, and so is not in this
   * answer when an officer asks for the ones running out.
   */
  lapsingWithinDays?: number;
  /** Restrict to one LGA within the caller's scope. */
  lgaId?: string;
  limit?: number;
}

export async function arrearsWorklist(
  db: Db,
  params: ArrearsParams = {},
  scope: ReportScope = { kind: 'STATEWIDE' },
): Promise<ArrearsWorklist> {
  const { statewide, lgaIds } = scopeParams(scope);
  const minimum = params.minimumKobo ?? MINIMUM_KOBO;
  const lapsingWithinDays = params.lapsingWithinDays ?? null;
  const limit = Math.min(Math.max(params.limit ?? 100, 1), 500);

  /*
   * `collectable` is the shared definition of a debt worth chasing, and every
   * figure below is derived from it. Writing the predicate once is what stops
   * the summary and the list disagreeing — the failure this codebase has hit
   * before, where two queries answered the same question differently because
   * one of them had been edited.
   */
  const base = `
    WITH collectable AS (
      SELECT i.id,
             i.taxpayer_id,
             i.total_amount_kobo - i.amount_paid_kobo AS owed_kobo,
             i.amount_paid_kobo > 0                   AS part_paid,
             i.issued_at,
             i.expires_at,
             ri.name                                  AS item_name
        FROM invoices i
        JOIN assessments a    ON a.id = i.assessment_id
        JOIN revenue_items ri ON ri.id = a.revenue_item_id
       WHERE i.status IN ('UNPAID', 'PARTIALLY_PAID')
         AND i.total_amount_kobo > i.amount_paid_kobo
         /*
          * Still payable. Past its expiry the payment path refuses the money
          * (INVOICE_EXPIRED), so a lapsed invoice on a call list is a call
          * that cannot end in a payment. That money is counted in the summary
          * instead, where it is labelled for what it is.
          */
         AND (i.expires_at IS NULL OR i.expires_at > now())
         AND NOT EXISTS (
               SELECT 1
                 FROM payments p
                 JOIN transactions tr ON tr.id = p.transaction_id
                WHERE tr.invoice_id = i.id
                  AND p.status = ANY($1::text[])
             )
         /*
          * And nothing under objection.
          *
          * A presumptive assessment can be contested, and while the objection
          * is open enforcement is suspended. That suspension is only real if
          * something acts on it: a citizen who formally disputed an estimate
          * and then got a call demanding payment has been told the objection
          * window means nothing. This is where it means something.
          */
         AND NOT ${UNDER_OPEN_OBJECTION_SQL}
    )`;

  const rows = await query<{
    taxpayer_id: string;
    taxpayer_type: string;
    tin: string | null;
    name: string;
    phone: string;
    preferred_language: string | null;
    lga_id: string;
    lga_name: string;
    community: string | null;
    outstanding_kobo: string;
    invoice_count: string;
    oldest_days_outstanding: string;
    days_until_lapse: string | null;
    owed_for: string[];
    last_payment_at: Date | null;
    partially_paid: boolean;
  }>(
    db,
    `${base}
     SELECT t.id AS taxpayer_id,
            t.taxpayer_type,
            t.tin,
            COALESCE(NULLIF(trim(t.business_name), ''),
                     trim(coalesce(t.first_name,'') || ' ' || coalesce(t.last_name,''))) AS name,
            t.phone,
            t.preferred_language,
            t.lga_id,
            l.name AS lga_name,
            t.community,
            SUM(c.owed_kobo)::text                                    AS outstanding_kobo,
            count(*)::text                                            AS invoice_count,
            GREATEST(0, (EXTRACT(EPOCH FROM (now() - MIN(c.issued_at))) / 86400)::int)::text
                                                                      AS oldest_days_outstanding,
            (EXTRACT(EPOCH FROM (MIN(c.expires_at) - now())) / 86400)::int::text
                                                                      AS days_until_lapse,
            (ARRAY_AGG(DISTINCT c.item_name))[1:5]                    AS owed_for,
            tc.last_payment_at,
            bool_or(c.part_paid)                                      AS partially_paid
       FROM collectable c
       JOIN taxpayers t ON t.id = c.taxpayer_id
       JOIN lgas l      ON l.id = t.lga_id
       LEFT JOIN taxpayer_compliance tc ON tc.taxpayer_id = t.id
      WHERE t.status = 'ACTIVE'
        AND ($2 OR t.lga_id = ANY($3::uuid[]))
        AND ($4::uuid IS NULL OR t.lga_id = $4::uuid)
      GROUP BY t.id, t.taxpayer_type, t.tin, t.phone, t.preferred_language,
               t.lga_id, l.name, t.community, t.first_name, t.last_name,
               t.business_name, tc.last_payment_at
     HAVING SUM(c.owed_kobo) >= $5::bigint
        AND ($6::int IS NULL
             OR MIN(c.expires_at) <= now() + ($6::int || ' days')::interval)
      ORDER BY SUM(c.owed_kobo) DESC, MIN(c.expires_at) ASC NULLS LAST
      LIMIT $7`,
    [
      IN_FLIGHT_PAYMENT_STATUSES,
      statewide,
      lgaIds,
      params.lgaId ?? null,
      minimum.toString(),
      lapsingWithinDays,
      limit,
    ],
  );

  /*
   * The summary counts the whole scoped population, not the page.
   *
   * A total that only added up the rows returned would fall every time
   * somebody narrowed the limit, which makes it useless for the one thing a
   * summary is for: knowing whether the list in front of you is most of the
   * money or a corner of it.
   *
   * The lapsed and in-flight figures are counted over the same population,
   * from `invoices` directly rather than from `collectable` — which by
   * definition excludes both — but through the same taxpayer scope, so no
   * figure on this response describes anybody the caller may not see.
   */
  const summary = await queryOne<{
    taxpayers: string;
    total_kobo: string;
    ended_kobo: string;
    lapsed_kobo: string;
    lapsed_invoices: string;
    in_flight: string;
  }>(
    db,
    `${base},
     scoped_taxpayers AS (
       -- MERGED is excluded here rather than left to the ACTIVE test above,
       -- because this CTE deliberately keeps the non-ACTIVE records for the
       -- ended-elsewhere figure. A merged shell is neither collectable nor
       -- ended with arrears; it is the same debt already counted once.
       SELECT t.id, t.status
         FROM taxpayers t
        WHERE t.status <> 'MERGED'
          AND ($2 OR t.lga_id = ANY($3::uuid[]))
          AND ($4::uuid IS NULL OR t.lga_id = $4::uuid)
     ),
     lapsed AS (
       SELECT i.id, i.total_amount_kobo - i.amount_paid_kobo AS owed_kobo
         FROM invoices i
         JOIN scoped_taxpayers st ON st.id = i.taxpayer_id
        WHERE i.status IN ('UNPAID', 'PARTIALLY_PAID', 'EXPIRED')
          AND i.total_amount_kobo > i.amount_paid_kobo
          AND i.expires_at IS NOT NULL
          AND i.expires_at <= now()
     ),
     in_flight AS (
       SELECT i.id
         FROM invoices i
         JOIN scoped_taxpayers st ON st.id = i.taxpayer_id
        WHERE i.status IN ('UNPAID', 'PARTIALLY_PAID')
          AND i.total_amount_kobo > i.amount_paid_kobo
          AND EXISTS (
                SELECT 1
                  FROM payments p
                  JOIN transactions tr ON tr.id = p.transaction_id
                 WHERE tr.invoice_id = i.id
                   AND p.status = ANY($1::text[])
              )
     )
     SELECT
       (SELECT count(DISTINCT c.taxpayer_id) FROM collectable c
          JOIN scoped_taxpayers st ON st.id = c.taxpayer_id
         WHERE st.status = 'ACTIVE')::text AS taxpayers,
       (SELECT COALESCE(SUM(c.owed_kobo), 0) FROM collectable c
          JOIN scoped_taxpayers st ON st.id = c.taxpayer_id
         WHERE st.status = 'ACTIVE')::text AS total_kobo,
       (SELECT COALESCE(SUM(c.owed_kobo), 0) FROM collectable c
          JOIN scoped_taxpayers st ON st.id = c.taxpayer_id
         WHERE st.status <> 'ACTIVE')::text AS ended_kobo,
       (SELECT COALESCE(SUM(owed_kobo), 0) FROM lapsed)::text AS lapsed_kobo,
       (SELECT count(*) FROM lapsed)::text                    AS lapsed_invoices,
       (SELECT count(*) FROM in_flight)::text                 AS in_flight`,
    [IN_FLIGHT_PAYMENT_STATUSES, statewide, lgaIds, params.lgaId ?? null],
  );

  return {
    summary: {
      taxpayers: Number.parseInt(summary?.taxpayers ?? '0', 10),
      totalKobo: summary?.total_kobo ?? '0',
      endedElsewhereKobo: summary?.ended_kobo ?? '0',
      lapsedKobo: summary?.lapsed_kobo ?? '0',
      lapsedInvoices: Number.parseInt(summary?.lapsed_invoices ?? '0', 10),
      inFlightInvoices: Number.parseInt(summary?.in_flight ?? '0', 10),
    },
    rows: rows.map((row) => ({
      taxpayerId: row.taxpayer_id,
      taxpayerType: row.taxpayer_type,
      tin: row.tin,
      name: row.name,
      phone: row.phone,
      preferredLanguage: row.preferred_language,
      lgaId: row.lga_id,
      lgaName: row.lga_name,
      ward: row.community,
      outstandingKobo: row.outstanding_kobo,
      invoiceCount: Number.parseInt(row.invoice_count, 10),
      oldestDaysOutstanding: Number.parseInt(row.oldest_days_outstanding, 10),
      daysUntilLapse: row.days_until_lapse === null ? null : Number.parseInt(row.days_until_lapse, 10),
      owedFor: row.owed_for ?? [],
      lastPaymentAt: row.last_payment_at,
      partiallyPaid: row.partially_paid,
    })),
  };
}
