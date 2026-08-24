/**
 * Dashboards, revenue intelligence and reports (PRD §37, §38, §39, §48, §67, §91).
 *
 * Two rules run through this module:
 *
 *   * Only *recognised* revenue is counted. A transaction counts towards
 *     collections once its payment is verified — never at invoice stage, and
 *     never on an agent's say-so. `REVENUE_STATES` below is that definition,
 *     applied everywhere so no two dashboards can disagree.
 *
 *   * PRD §67's audit questions are answerable without touching production
 *     tables directly: each is a function here.
 */

import type { Db } from '../db/pool';
import { query, queryOne } from '../db/pool';
import {
  lgaScopeSql,
  scopeParams,
  transactionScopeSql,
  type ReportScope,
} from './report-scope';

/** Revenue is recognised only after independent verification (PRD §17, §95). */
const REVENUE_STATES = `('PAYMENT_VERIFIED','RECEIPT_GENERATED','RECONCILIATION_PENDING','SETTLED')`;

/**
 * The executive dashboard, narrowed to what the caller may see.
 *
 * `scope` defaults to statewide so existing statewide callers are unchanged,
 * but every route that can be reached by a territory-scoped role passes one.
 * The scope is returned in the payload as well as applied, because a figure of
 * zero from an unassigned supervisor and a figure of zero from a quiet week
 * look identical on screen and only one of them is somebody's configuration
 * mistake.
 */
export async function executiveDashboard(
  db: Db,
  scope: ReportScope = { kind: 'STATEWIDE' },
) {
  const { statewide, territoryIds, lgaIds } = scopeParams(scope);
  const scoped = [statewide, territoryIds];
  const tx = transactionScopeSql('t', 1, 2);
  const [totals, counts, byCategory, byLga, byAgent, byMda, trend, exceptions] = await Promise.all([
    queryOne(
      db,
      `SELECT
         COALESCE(SUM(amount_kobo) FILTER (WHERE created_at::date = CURRENT_DATE),0)::text AS today_kobo,
         COALESCE(SUM(amount_kobo) FILTER (WHERE created_at >= date_trunc('week', CURRENT_DATE)),0)::text AS week_kobo,
         COALESCE(SUM(amount_kobo) FILTER (WHERE created_at >= date_trunc('month', CURRENT_DATE)),0)::text AS month_kobo,
         COALESCE(SUM(amount_kobo) FILTER (WHERE created_at >= date_trunc('year', CURRENT_DATE)),0)::text AS ytd_kobo,
         COALESCE(SUM(amount_kobo),0)::text AS total_kobo
       FROM transactions t WHERE status IN ${REVENUE_STATES} AND ${tx}`,
      scoped,
    ),
    queryOne(
      db,
      // Taxpayers and agents are counted through the LGAs a scope covers, and
      // commissions through the transactions that earned them: a supervisor's
      // commission liability is what their own territory has accrued, not the
      // state's.
      `SELECT
         (SELECT count(*)::text FROM taxpayers tp
           WHERE tp.status = 'ACTIVE' AND ($1 OR tp.lga_id = ANY($3::uuid[]))) AS taxpayers,
         (SELECT count(*)::text FROM taxpayers tp
           WHERE tp.status = 'ACTIVE' AND tp.created_at >= date_trunc('month', CURRENT_DATE)
             AND ($1 OR tp.lga_id = ANY($3::uuid[]))) AS new_taxpayers_this_month,
         (SELECT count(*)::text FROM agents a
           WHERE a.operational_status = 'ACTIVE'
             AND ($1 OR a.territory_id = ANY($2::uuid[]))) AS active_agents,
         (SELECT count(*)::text FROM agents a
           WHERE a.clearance_status = 'READY_FOR_REVIEW'
             AND ($1 OR a.territory_id = ANY($2::uuid[]))) AS agents_awaiting_review,
         (SELECT count(*)::text FROM transactions t WHERE ${tx}) AS total_transactions,
         (SELECT count(*)::text FROM transactions t
           WHERE t.status IN ${REVENUE_STATES} AND ${tx}) AS successful_transactions,
         (SELECT count(*)::text FROM transactions t
           WHERE t.status IN ('FAILED','CANCELLED','EXPIRED') AND ${tx}) AS failed_transactions,
         (SELECT count(*)::text FROM transactions t
           WHERE t.status = 'RECONCILIATION_PENDING' AND ${tx}) AS pending_reconciliation,
         (SELECT COALESCE(SUM(c.amount_kobo),0)::text FROM commissions c
           LEFT JOIN transactions t ON t.id = c.transaction_id
           WHERE c.status IN ('PENDING','ELIGIBLE','APPROVED') AND ${tx}) AS commission_liability_kobo,
         (SELECT COALESCE(SUM(c.amount_kobo),0)::text FROM commissions c
           LEFT JOIN transactions t ON t.id = c.transaction_id
           WHERE c.status = 'PAID' AND ${tx}) AS commission_paid_kobo`,
      [statewide, territoryIds, lgaIds],
    ),
    query(
      db,
      `SELECT rc.name AS category, count(t.id)::text AS transactions,
              COALESCE(SUM(t.amount_kobo),0)::text AS amount_kobo
         FROM transactions t
         JOIN revenue_items ri ON ri.id = t.revenue_item_id
         JOIN revenue_categories rc ON rc.id = ri.category_id
        WHERE t.status IN ${REVENUE_STATES} AND ${tx}
        GROUP BY rc.name ORDER BY SUM(t.amount_kobo) DESC`,
      scoped,
    ),
    query(
      db,
      `SELECT l.name AS lga, l.zone, count(t.id)::text AS transactions,
              COALESCE(SUM(t.amount_kobo),0)::text AS amount_kobo
         FROM lgas l
         LEFT JOIN transactions t ON t.lga_id = l.id AND t.status IN ${REVENUE_STATES}
              AND ${tx}
        WHERE ${lgaScopeSql('l', 3, 4)}
        GROUP BY l.name, l.zone ORDER BY COALESCE(SUM(t.amount_kobo),0) DESC`,
      [statewide, territoryIds, statewide, lgaIds],
    ),
    query(
      db,
      `SELECT a.agent_code, u.full_name, count(t.id)::text AS transactions,
              COALESCE(SUM(t.amount_kobo),0)::text AS amount_kobo
         FROM agents a
         JOIN users u ON u.id = a.user_id
         LEFT JOIN transactions t ON t.agent_id = a.id AND t.status IN ${REVENUE_STATES}
              AND ${tx}
        WHERE a.operational_status = 'ACTIVE'
          AND ($1 OR a.territory_id = ANY($2::uuid[]))
        GROUP BY a.agent_code, u.full_name
        ORDER BY COALESCE(SUM(t.amount_kobo),0) DESC LIMIT 20`,
      scoped,
    ),
    query(
      db,
      `SELECT COALESCE(m.name, 'PSIRS (direct)') AS mda, count(t.id)::text AS transactions,
              COALESCE(SUM(t.amount_kobo),0)::text AS amount_kobo
         FROM transactions t
         JOIN revenue_items ri ON ri.id = t.revenue_item_id
         LEFT JOIN mdas m ON m.id = ri.mda_id
        WHERE t.status IN ${REVENUE_STATES} AND ${tx}
        GROUP BY m.name ORDER BY SUM(t.amount_kobo) DESC`,
      scoped,
    ),
    query(
      db,
      `SELECT to_char(day, 'YYYY-MM-DD') AS day,
              COALESCE(SUM(t.amount_kobo),0)::text AS amount_kobo,
              count(t.id)::text AS transactions
         FROM generate_series(CURRENT_DATE - interval '29 days', CURRENT_DATE, interval '1 day') AS day
         LEFT JOIN transactions t
                ON t.created_at::date = day::date AND t.status IN ${REVENUE_STATES}
               AND ${tx}
        GROUP BY day ORDER BY day`,
      scoped,
    ),
    queryOne(
      db,
      `SELECT
         (SELECT count(*)::text FROM fraud_flags f
           LEFT JOIN agents a ON a.id = f.agent_id
           WHERE f.status IN ('OPEN','UNDER_REVIEW')
             AND ($1 OR a.territory_id = ANY($2::uuid[]))) AS open_fraud_flags,
         (SELECT count(*)::text FROM reconciliation_records
           WHERE reconciled_at IS NULL
             AND status IN ('MISSING_PAYMENT','MISSING_PLATFORM_TRANSACTION','AMOUNT_MISMATCH','DUPLICATE_PAYMENT'))
           AS reconciliation_exceptions,
         (SELECT count(*)::text FROM approvals WHERE status IN ('REQUESTED','REVIEWED')) AS pending_approvals,
         (SELECT count(*)::text FROM support_tickets WHERE status IN ('OPEN','ASSIGNED','IN_PROGRESS')) AS open_tickets`,
      scoped,
    ),
  ]);

  return {
    collections: totals,
    counts,
    revenueByCategory: byCategory,
    revenueByLga: byLga,
    revenueByAgent: byAgent,
    revenueByMda: byMda,
    dailyTrend: trend,
    exceptions,
    scope,
  };
}

/** Revenue intelligence drill-down: State -> LGA -> Ward -> Community (PRD §73). */
export async function geographicIntelligence(
  db: Db,
  params: { lgaId?: string; wardId?: string; from?: Date; to?: Date },
  scope: ReportScope = { kind: 'STATEWIDE' },
) {
  const from = params.from ?? new Date(Date.now() - 365 * 86_400_000);
  const to = params.to ?? new Date();
  const { statewide, territoryIds, lgaIds } = scopeParams(scope);

  /*
   * A drill-down is a filter the caller supplies, and a scope is a filter they
   * do not get to supply. Asking for an LGA outside the scope must return that
   * LGA's rows filtered to nothing rather than the LGA's real figures — which
   * is what the territory predicate below does, and why it is applied to the
   * ward and community branches too rather than only to the top level.
   */

  if (params.wardId) {
    return query(
      db,
      `SELECT COALESCE(tp.community, 'Not recorded') AS level, 'COMMUNITY' AS level_type,
              count(t.id)::text AS transactions,
              COALESCE(SUM(t.amount_kobo),0)::text AS amount_kobo,
              count(DISTINCT t.taxpayer_id)::text AS taxpayers
         FROM transactions t JOIN taxpayers tp ON tp.id = t.taxpayer_id
        WHERE t.ward_id = $1 AND t.status IN ${REVENUE_STATES}
          AND t.created_at BETWEEN $2 AND $3
          AND ${transactionScopeSql('t', 4, 5)}
        GROUP BY tp.community ORDER BY SUM(t.amount_kobo) DESC`,
      [params.wardId, from, to, statewide, territoryIds],
    );
  }

  if (params.lgaId) {
    return query(
      db,
      `SELECT w.name AS level, 'WARD' AS level_type, w.id AS level_id,
              count(t.id)::text AS transactions,
              COALESCE(SUM(t.amount_kobo),0)::text AS amount_kobo,
              count(DISTINCT t.taxpayer_id)::text AS taxpayers
         FROM wards w
         LEFT JOIN transactions t ON t.ward_id = w.id AND t.status IN ${REVENUE_STATES}
              AND t.created_at BETWEEN $2 AND $3
              AND ${transactionScopeSql('t', 4, 5)}
        WHERE w.lga_id = $1 AND ($4 OR w.lga_id = ANY($6::uuid[]))
        GROUP BY w.name, w.id ORDER BY COALESCE(SUM(t.amount_kobo),0) DESC`,
      [params.lgaId, from, to, statewide, territoryIds, lgaIds],
    );
  }

  return query(
    db,
    `SELECT l.name AS level, 'LGA' AS level_type, l.id AS level_id, l.zone,
            count(t.id)::text AS transactions,
            COALESCE(SUM(t.amount_kobo),0)::text AS amount_kobo,
            count(DISTINCT t.taxpayer_id)::text AS taxpayers,
            count(DISTINCT t.agent_id)::text AS agents
       FROM lgas l
       LEFT JOIN transactions t ON t.lga_id = l.id AND t.status IN ${REVENUE_STATES}
            AND t.created_at BETWEEN $1 AND $2
            AND ${transactionScopeSql('t', 3, 4)}
      WHERE ${lgaScopeSql('l', 3, 5)}
      GROUP BY l.name, l.id, l.zone ORDER BY COALESCE(SUM(t.amount_kobo),0) DESC`,
    [from, to, statewide, territoryIds, lgaIds],
  );
}

/** Agent performance (PRD §39). */
export async function agentPerformance(
  db: Db,
  params: { agentId?: string; limit?: number } = {},
  scope: ReportScope = { kind: 'STATEWIDE' },
) {
  const { statewide, territoryIds } = scopeParams(scope);
  return query(
    db,
    `SELECT a.id AS agent_id, a.agent_code, u.full_name, l.name AS lga,
            a.operational_status,
            count(t.id) FILTER (WHERE t.status IN ${REVENUE_STATES})::text AS successful_transactions,
            count(t.id) FILTER (WHERE t.status IN ('FAILED','CANCELLED','EXPIRED'))::text AS failed_transactions,
            count(t.id) FILTER (WHERE t.status IN ('REVERSED','REFUNDED'))::text AS reversed_transactions,
            COALESCE(SUM(t.amount_kobo) FILTER (WHERE t.status IN ${REVENUE_STATES}),0)::text AS collected_kobo,
            COALESCE(ROUND(AVG(t.amount_kobo) FILTER (WHERE t.status IN ${REVENUE_STATES})),0)::text
              AS average_transaction_kobo,
            (SELECT count(*)::text FROM taxpayers tp WHERE tp.registered_by_agent_id = a.id) AS taxpayers_onboarded,
            (SELECT count(*)::text FROM taxpayers tp
              WHERE tp.registered_by_agent_id = a.id AND tp.tin_status = 'ASSIGNED') AS tins_registered,
            (SELECT count(*)::text FROM vehicle_renewals vr WHERE vr.agent_id = a.id AND vr.status = 'COMPLETED')
              AS vehicle_renewals,
            (SELECT COALESCE(SUM(c.amount_kobo),0)::text FROM commissions c
              WHERE c.agent_id = a.id AND c.status <> 'REVERSED') AS commission_earned_kobo,
            (SELECT count(*)::text FROM fraud_flags f
              WHERE f.agent_id = a.id AND f.status IN ('OPEN','UNDER_REVIEW')) AS open_fraud_flags,
            count(DISTINCT t.created_at::date)::text AS active_days
       FROM agents a
       JOIN users u ON u.id = a.user_id
       LEFT JOIN lgas l ON l.id = a.lga_id
       LEFT JOIN transactions t ON t.agent_id = a.id
      WHERE ($1::uuid IS NULL OR a.id = $1)
        AND ($3 OR a.territory_id = ANY($4::uuid[]))
      GROUP BY a.id, a.agent_code, u.full_name, l.name, a.operational_status
      ORDER BY COALESCE(SUM(t.amount_kobo) FILTER (WHERE t.status IN ${REVENUE_STATES}),0) DESC
      LIMIT $2`,
    [params.agentId ?? null, params.limit ?? 100, statewide, territoryIds],
  );
}

/** Agent home-screen figures (PRD §29, §56). */
export async function agentToday(db: Db, agentId: string) {
  const [today, wallet, recent] = await Promise.all([
    queryOne(
      db,
      `SELECT
         COALESCE(SUM(amount_kobo) FILTER (WHERE status IN ${REVENUE_STATES}),0)::text AS collected_kobo,
         count(*) FILTER (WHERE status IN ${REVENUE_STATES})::text AS successful,
         count(*)::text AS total,
         count(*) FILTER (WHERE status IN ('PAYMENT_PENDING','PAYMENT_INITIATED'))::text AS pending
       FROM transactions
      WHERE agent_id = $1 AND created_at::date = CURRENT_DATE`,
      [agentId],
    ),
    queryOne(
      db,
      `SELECT COALESCE(SUM(amount_kobo) FILTER (WHERE status <> 'REVERSED'),0)::text AS lifetime_kobo,
              COALESCE(SUM(amount_kobo) FILTER (WHERE status = 'ELIGIBLE'),0)::text AS available_kobo,
              COALESCE(SUM(c.amount_kobo) FILTER (
                WHERE c.status <> 'REVERSED' AND c.created_at::date = CURRENT_DATE),0)::text AS today_kobo
         FROM commissions c WHERE agent_id = $1`,
      [agentId],
    ),
    query(
      db,
      `SELECT t.transaction_reference, t.amount_kobo, t.status, t.created_at,
              ri.name AS revenue_item,
              COALESCE(tp.business_name, tp.first_name || ' ' || tp.last_name) AS taxpayer_name,
              r.receipt_number
         FROM transactions t
         JOIN revenue_items ri ON ri.id = t.revenue_item_id
         JOIN taxpayers tp ON tp.id = t.taxpayer_id
         LEFT JOIN receipts r ON r.transaction_id = t.id
        WHERE t.agent_id = $1
        ORDER BY t.created_at DESC LIMIT 10`,
      [agentId],
    ),
  ]);

  const onboarded = await queryOne(
    db,
    `SELECT count(*)::text AS today, (SELECT count(*)::text FROM taxpayers WHERE registered_by_agent_id = $1) AS total
       FROM taxpayers WHERE registered_by_agent_id = $1 AND created_at::date = CURRENT_DATE`,
    [agentId],
  );

  return { today, commission: wallet, taxpayersOnboarded: onboarded, recentTransactions: recent };
}

// ---------------------------------------------------------------------------
// PRD §67 audit queries — answerable without touching production tables
// ---------------------------------------------------------------------------

export async function transactionsByAgent(
  db: Db,
  params: { agentId: string; from: Date; to: Date },
) {
  return query(
    db,
    `SELECT t.transaction_reference, t.amount_kobo, t.status, t.created_at, t.verified_at,
            ri.name AS revenue_item, l.name AS lga, r.receipt_number,
            p.gateway_reference, p.payment_method
       FROM transactions t
       JOIN revenue_items ri ON ri.id = t.revenue_item_id
       JOIN lgas l ON l.id = t.lga_id
       LEFT JOIN receipts r ON r.transaction_id = t.id
       LEFT JOIN payments p ON p.transaction_id = t.id AND p.status = 'VERIFIED'
      WHERE t.agent_id = $1 AND t.created_at BETWEEN $2 AND $3
      ORDER BY t.created_at`,
    [params.agentId, params.from, params.to],
  );
}

export async function reversedAfterSuccess(db: Db, params: { from?: Date; to?: Date } = {}) {
  return query(
    db,
    `SELECT t.transaction_reference, t.amount_kobo, t.status, t.reversed_at,
            a.agent_code, rf.refund_reference, rf.reason, rf.approved_by, rf.approved_at
       FROM transactions t
       LEFT JOIN agents a ON a.id = t.agent_id
       LEFT JOIN refunds rf ON rf.transaction_id = t.id
      WHERE t.status IN ('REVERSED','REFUNDED')
        AND EXISTS (SELECT 1 FROM transaction_events e
                     WHERE e.transaction_id = t.id AND e.to_status = 'PAYMENT_VERIFIED')
        AND ($1::timestamptz IS NULL OR t.reversed_at >= $1)
        AND ($2::timestamptz IS NULL OR t.reversed_at <= $2)
      ORDER BY t.reversed_at DESC`,
    [params.from ?? null, params.to ?? null],
  );
}

export async function rateChangeHistory(db: Db, params: { revenueItemId?: string } = {}) {
  return query(
    db,
    `SELECT ri.code, ri.name, r.version, r.rate_type, r.fixed_amount_kobo, r.rate_basis_points,
            r.minimum_amount_kobo, r.maximum_amount_kobo, r.effective_from, r.effective_to,
            u.full_name AS changed_by, r.created_at, ap.id AS approval_id,
            ap.requested_reason, ap.decision_reason
       FROM revenue_item_rates r
       JOIN revenue_items ri ON ri.id = r.revenue_item_id
       LEFT JOIN users u ON u.id = r.created_by
       LEFT JOIN approvals ap ON ap.id = r.approval_id
      WHERE ($1::uuid IS NULL OR r.revenue_item_id = $1)
      ORDER BY ri.code, r.version`,
    [params.revenueItemId ?? null],
  );
}

export async function taxpayerAccessLog(db: Db, taxpayerId: string) {
  return query(
    db,
    `SELECT a.created_at, a.action, a.result, u.full_name, u.role, a.ip_address, a.device_id
       FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
      WHERE a.entity_type = 'taxpayer' AND a.entity_id = $1
      ORDER BY a.created_at DESC LIMIT 500`,
    [taxpayerId],
  );
}

export async function receiptsByRevenueItem(db: Db, params: { revenueItemCode: string }) {
  return query(
    db,
    `SELECT r.receipt_number, r.amount_kobo, r.issued_at, r.status,
            t.transaction_reference, l.name AS lga, ag.agent_code
       FROM receipts r
       JOIN transactions t ON t.id = r.transaction_id
       JOIN revenue_items ri ON ri.id = t.revenue_item_id
       JOIN lgas l ON l.id = t.lga_id
       LEFT JOIN agents ag ON ag.id = t.agent_id
      WHERE ri.code = $1
      ORDER BY r.issued_at DESC LIMIT 1000`,
    [params.revenueItemCode],
  );
}

/** Key performance indicators (PRD §91). */
export async function kpis(db: Db) {
  return queryOne(
    db,
    `SELECT
       (SELECT COALESCE(SUM(amount_kobo),0)::text FROM transactions WHERE status IN ${REVENUE_STATES})
         AS total_collection_kobo,
       (SELECT count(*)::text FROM taxpayers WHERE created_at >= date_trunc('month', CURRENT_DATE))
         AS new_taxpayers_this_month,
       (SELECT count(*)::text FROM taxpayers WHERE tin_status IN ('ASSIGNED','EXISTING'))
         AS taxpayers_with_tin,
       (SELECT count(*)::text FROM agents WHERE operational_status = 'ACTIVE') AS active_agents,
       (SELECT CASE WHEN count(*) = 0 THEN '0'
               ELSE ROUND(100.0 * count(*) FILTER (WHERE status = 'VERIFIED') / count(*), 2)::text END
          FROM payments) AS payment_success_rate_percent,
       (SELECT CASE WHEN count(*) = 0 THEN '0'
               ELSE ROUND(100.0 * count(*) FILTER (WHERE status = 'MATCHED') / count(*), 2)::text END
          FROM reconciliation_records) AS reconciliation_rate_percent,
       (SELECT CASE WHEN count(*) = 0 THEN '0'
               ELSE ROUND(100.0 * (SELECT count(*) FROM receipts) / count(*), 2)::text END
          FROM transactions WHERE status IN ${REVENUE_STATES}) AS receipt_generation_rate_percent,
       (SELECT count(*)::text FROM transactions WHERE status = 'RECONCILIATION_PENDING')
         AS unreconciled_transactions,
       (SELECT count(*)::text FROM transactions WHERE status IN ('REVERSED','REFUNDED')) AS reversals,
       (SELECT count(*)::text FROM fraud_flags WHERE status IN ('OPEN','UNDER_REVIEW'))
         AS suspicious_transactions,
       (SELECT count(*)::text FROM taxpayer_duplicate_checks WHERE decision = 'PROCEEDED')
         AS duplicate_registrations_overridden,
       (SELECT count(*)::text FROM verification_attempts WHERE result IN ('INVALID','NOT_FOUND'))
         AS receipt_verification_failures,
       (SELECT ROUND(COALESCE(AVG(EXTRACT(EPOCH FROM (verified_at - created_at))), 0))::text
          FROM transactions WHERE verified_at IS NOT NULL) AS average_completion_seconds`,
  );
}

/** CSV export for any report result set (PRD §48). */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]!);
  const escape = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    const text = value instanceof Date ? value.toISOString() : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => escape(row[header])).join(',')),
  ].join('\n');
}

// ===========================================================================
// Revenue summary: where the money comes from, and whose it is.
//
// The executive dashboard reports totals and a few breakdowns. What an
// administrator could not see was the two questions government actually asks
// of a revenue platform: which arm of government a naira belongs to, and
// which places produce it.
//
// The first was unanswerable because every catalogue item was mapped to
// PSIRS-HQ — true of who collects the money and useless for who it is
// collected for. The second was unanswerable because no collection had ever
// recorded where it happened: the column existed, the endpoint accepted it,
// and no client had ever sent one.
// ===========================================================================

/**
 * Revenue by the MDA it is collected for.
 *
 * Includes MDAs with nothing against them, deliberately. An arm of government
 * collecting nothing through this platform is a finding — it means either its
 * revenue is being collected outside the system or its items were never
 * catalogued — and it is visible only if the MDA appears with a zero rather
 * than being absent from the list.
 */
export async function revenueByMda(
  db: Db,
  params: { from?: Date; to?: Date } = {},
  scope: ReportScope = { kind: 'STATEWIDE' },
) {
  const from = params.from ?? new Date(Date.now() - 365 * 86_400_000);
  const to = params.to ?? new Date();
  const { statewide, territoryIds } = scopeParams(scope);
  return query(
    db,
    `SELECT m.name AS mda, m.code,
            count(DISTINCT ri.id)::text AS revenue_items,
            count(t.id)::text AS transactions,
            COALESCE(SUM(t.amount_kobo),0)::text AS amount_kobo
       FROM mdas m
       LEFT JOIN revenue_items ri ON ri.mda_id = m.id
       LEFT JOIN transactions t ON t.revenue_item_id = ri.id
            AND t.status IN ${REVENUE_STATES}
            AND t.created_at BETWEEN $1 AND $2
            AND ${transactionScopeSql('t', 3, 4)}
      GROUP BY m.name, m.code
      ORDER BY COALESCE(SUM(t.amount_kobo),0) DESC, m.name`,
    [from, to, statewide, territoryIds],
  );
}

/**
 * Where revenue is generated, down to the community.
 *
 * `geographicIntelligence` drills one level at a time from a click. This is
 * the flat answer to "show me the generating areas" — every ward that has
 * produced anything, with the agents and collection points behind it — which
 * is the shape an administrator reads rather than navigates.
 */
export async function revenueGenerationAreas(
  db: Db,
  params: { from?: Date; to?: Date; limit?: number } = {},
  scope: ReportScope = { kind: 'STATEWIDE' },
) {
  const from = params.from ?? new Date(Date.now() - 365 * 86_400_000);
  const to = params.to ?? new Date();
  const { statewide, territoryIds } = scopeParams(scope);
  return query(
    db,
    `SELECT l.name AS lga, l.zone,
            COALESCE(w.name, 'Ward not recorded') AS ward,
            count(t.id)::text AS transactions,
            COALESCE(SUM(t.amount_kobo),0)::text AS amount_kobo,
            count(DISTINCT t.agent_id)::text AS agents,
            count(DISTINCT t.taxpayer_id)::text AS taxpayers,
            -- How much of this was collected somewhere the platform can put
            -- on a map. A ward earning well with no located collections is
            -- not suspicious; it is unmapped, and the two must not be read
            -- as the same thing.
            count(t.latitude)::text AS located_transactions
       FROM transactions t
       JOIN lgas l ON l.id = t.lga_id
       LEFT JOIN wards w ON w.id = t.ward_id
      WHERE t.status IN ${REVENUE_STATES}
        AND t.created_at BETWEEN $1 AND $2
        AND ${transactionScopeSql('t', 3, 4)}
      GROUP BY l.name, l.zone, w.name
      ORDER BY SUM(t.amount_kobo) DESC
      LIMIT $5`,
    [from, to, statewide, territoryIds, params.limit ?? 100],
  );
}

/**
 * Each agent, and the ground they actually cover.
 *
 * `agentPerformance` answers how much an agent collected. This answers where
 * — which LGAs and wards, and how far apart the collection points are — so an
 * administrator can see the shape of a round rather than only its total.
 *
 * The spread is reported because it is useful for planning: an agent working
 * one market and an agent covering forty kilometres of road are doing
 * different jobs on the same commission, and nothing distinguished them.
 */
export async function agentCollectionMap(
  db: Db,
  params: { from?: Date; to?: Date; limit?: number } = {},
  scope: ReportScope = { kind: 'STATEWIDE' },
) {
  const from = params.from ?? new Date(Date.now() - 365 * 86_400_000);
  const to = params.to ?? new Date();
  const { statewide, territoryIds } = scopeParams(scope);
  return query(
    db,
    `SELECT a.agent_code, u.full_name,
            COALESCE(ter.name, 'No territory') AS territory,
            count(t.id)::text AS transactions,
            COALESCE(SUM(t.amount_kobo),0)::text AS amount_kobo,
            count(DISTINCT t.lga_id)::text AS lgas_worked,
            count(DISTINCT t.ward_id)::text AS wards_worked,
            count(t.latitude)::text AS located_transactions,
            ROUND(AVG(t.latitude)::numeric, 5)::text AS centre_latitude,
            ROUND(AVG(t.longitude)::numeric, 5)::text AS centre_longitude
       FROM transactions t
       JOIN agents a ON a.id = t.agent_id
       JOIN users u ON u.id = a.user_id
       LEFT JOIN territories ter ON ter.id = t.territory_id
      WHERE t.status IN ${REVENUE_STATES}
        AND t.created_at BETWEEN $1 AND $2
        AND ${transactionScopeSql('t', 3, 4)}
      GROUP BY a.agent_code, u.full_name, ter.name
      ORDER BY SUM(t.amount_kobo) DESC
      LIMIT $5`,
    [from, to, statewide, territoryIds, params.limit ?? 100],
  );
}

/**
 * How much revenue can be put on a map at all.
 *
 * Worth its own figure rather than being inferred from a table: until the
 * agent application began sending coordinates, this was zero for every
 * transaction ever taken, and a mapping feature that silently reports on
 * nothing is worse than one that says it has nothing to report.
 */
export async function collectionMappingCoverage(
  db: Db,
  params: { from?: Date; to?: Date } = {},
  scope: ReportScope = { kind: 'STATEWIDE' },
) {
  const from = params.from ?? new Date(Date.now() - 365 * 86_400_000);
  const to = params.to ?? new Date();
  const { statewide, territoryIds } = scopeParams(scope);
  return queryOne(
    db,
    `SELECT count(*)::text AS transactions,
            count(latitude)::text AS located,
            count(*) FILTER (WHERE ward_id IS NOT NULL)::text AS ward_known,
            COALESCE(SUM(amount_kobo) FILTER (WHERE latitude IS NOT NULL),0)::text
              AS located_amount_kobo,
            COALESCE(SUM(amount_kobo),0)::text AS total_amount_kobo
       FROM transactions t
      WHERE t.status IN ${REVENUE_STATES}
        AND t.created_at BETWEEN $1 AND $2
        AND ${transactionScopeSql('t', 3, 4)}`,
    [from, to, statewide, territoryIds],
  );
}

/**
 * What each Local Government Council is owed.
 *
 * PSIRS collects local government revenue on the Councils' behalf, which makes
 * remittance a first-class question the platform could not answer: it knew
 * what it had collected and had no view of any one Council's share.
 * `settlements` tracks money arriving from the gateway into a government
 * account and stops there.
 *
 * WHAT MAKES A COLLECTION A COUNCIL'S. An item whose rate is set per Council
 * is a Council's revenue — that is what per-Council rating means, and it is a
 * fact in the database rather than a list in code that would drift. A State
 * item collected in a Council's area stays the State's: an infrastructure
 * levy raised in Wase is not Wase's money, and counting it would overstate
 * that Council's share by exactly what the State took there.
 *
 * WHICH COUNCIL. The LGA on the transaction, which comes from the taxpayer
 * and is the same LGA the amount was priced on. Money collected in one
 * Council's area is that Council's and never another's.
 *
 * EVERY COUNCIL APPEARS, including one that collected nothing. A remittance
 * run has to account for all seventeen, and a Council missing from the list
 * looks exactly like a Council nobody ran the report for.
 */
export async function localGovernmentRemittance(
  db: Db,
  params: { from?: Date; to?: Date } = {},
  scope: ReportScope = { kind: 'STATEWIDE' },
) {
  const from = params.from ?? new Date(Date.now() - 365 * 86_400_000);
  const to = params.to ?? new Date();
  const { statewide, territoryIds } = scopeParams(scope);
  return query(
    db,
    `WITH council_revenue AS (
       SELECT t.lga_id, ri.id AS item_id, ri.code, ri.name,
              count(t.id) AS transactions,
              SUM(t.amount_kobo) AS amount_kobo
         FROM transactions t
         JOIN revenue_items ri ON ri.id = t.revenue_item_id
        WHERE t.status IN ${REVENUE_STATES}
          AND t.created_at BETWEEN $1 AND $2
          AND ${transactionScopeSql('t', 3, 4)}
          -- An item rated per Council is a Council's revenue. This is the
          -- database's own record of the arrangement rather than a list here
          -- that would drift away from the catalogue.
          AND EXISTS (
            SELECT 1 FROM revenue_item_rates r
             WHERE r.revenue_item_id = ri.id AND r.lga_id IS NOT NULL
          )
        GROUP BY t.lga_id, ri.id, ri.code, ri.name
     )
     SELECT l.name AS lga, l.zone,
            COALESCE(SUM(cr.transactions),0)::text AS transactions,
            COALESCE(SUM(cr.amount_kobo),0)::text AS amount_kobo,
            COALESCE(
              json_agg(
                json_build_object(
                  'code', cr.code,
                  'name', cr.name,
                  'transactions', cr.transactions::text,
                  'amount_kobo', cr.amount_kobo::text
                ) ORDER BY cr.amount_kobo DESC
              ) FILTER (WHERE cr.item_id IS NOT NULL),
              '[]'::json
            ) AS items
       FROM lgas l
       LEFT JOIN council_revenue cr ON cr.lga_id = l.id
      GROUP BY l.name, l.zone
      ORDER BY COALESCE(SUM(cr.amount_kobo),0) DESC, l.name`,
    [from, to, statewide, territoryIds],
  );
}

// ===========================================================================
// Role homes.
//
// Every officer landed on the same executive dashboard. It is a good screen
// and it is the wrong first screen for four of the five roles that saw it: an
// auditor opening the platform does not need this morning's collections, and a
// finance officer does not need the agent clearance queue. What each of them
// needs is the work waiting for them.
//
// One query set per role rather than one screen with everything on it. A
// dashboard that shows every role everything is how a finance officer learns
// to scroll past the reconciliation exceptions.
// ===========================================================================

/** What is waiting for whoever runs the platform. */
export async function adminHome(db: Db) {
  return queryOne(
    db,
    `SELECT
       (SELECT count(*)::text FROM agents WHERE clearance_status = 'READY_FOR_REVIEW')
         AS agents_awaiting_review,
       (SELECT count(*)::text FROM agents WHERE clearance_status = 'REQUIRES_INFO')
         AS agents_needing_information,
       (SELECT count(*)::text FROM agent_devices WHERE status = 'PENDING')
         AS devices_awaiting_approval,
       (SELECT count(*)::text FROM users WHERE role <> 'agent' AND status = 'ACTIVE')
         AS active_officers,
       (SELECT count(*)::text FROM users u
         WHERE u.role = 'supervisor' AND u.status = 'ACTIVE'
           AND NOT EXISTS (SELECT 1 FROM user_territories ut WHERE ut.user_id = u.id))
         AS supervisors_without_a_territory,
       -- An item nobody has priced cannot be collected. This is the
       -- administrator's queue, not a fault.
       (SELECT count(*)::text FROM revenue_items ri
         WHERE NOT EXISTS (SELECT 1 FROM revenue_item_rates r WHERE r.revenue_item_id = ri.id))
         AS revenue_items_awaiting_a_rate,
       (SELECT count(*)::text FROM mdas m
         WHERE NOT EXISTS (SELECT 1 FROM revenue_items ri WHERE ri.mda_id = m.id))
         AS mdas_with_no_revenue_item,
       (SELECT count(*)::text FROM support_tickets WHERE status IN ('OPEN','ASSIGNED'))
         AS open_tickets`,
  );
}

/** The taxpayer register, which is the revenue officer's charge. */
export async function revenueOfficerHome(db: Db) {
  return queryOne(
    db,
    `SELECT
       (SELECT count(*)::text FROM taxpayers WHERE status = 'ACTIVE') AS taxpayers,
       (SELECT count(*)::text FROM taxpayers
         WHERE status = 'ACTIVE' AND created_at >= date_trunc('week', CURRENT_DATE))
         AS registered_this_week,
       -- A taxpayer without a TIN cannot be tracked across years, so this is
       -- the queue that matters most here.
       (SELECT count(*)::text FROM taxpayers WHERE tin_status IN ('PENDING','FAILED'))
         AS tins_outstanding,
       (SELECT count(*)::text FROM taxpayers WHERE tin_status = 'FAILED') AS tins_failed,
       (SELECT count(*)::text FROM approvals
         WHERE status IN ('REQUESTED','REVIEWED') AND approval_type = 'TAXPAYER_CORRECTION')
         AS corrections_awaiting_review,
       (SELECT count(*)::text FROM invoices WHERE status = 'UNPAID' AND
         (expires_at IS NULL OR expires_at > now())) AS invoices_unpaid,
       (SELECT count(*)::text FROM invoices WHERE status = 'EXPIRED') AS invoices_expired,
       (SELECT COALESCE(SUM(total_amount_kobo),0)::text FROM invoices WHERE status = 'UNPAID')
         AS unpaid_kobo`,
  );
}

/** Money in, money out, and money held for somebody else. */
export async function financeOfficerHome(db: Db) {
  return queryOne(
    db,
    `SELECT
       (SELECT count(*)::text FROM reconciliation_records
         WHERE reconciled_at IS NULL AND status IN
           ('MISSING_PAYMENT','MISSING_PLATFORM_TRANSACTION','AMOUNT_MISMATCH','DUPLICATE_PAYMENT'))
         AS reconciliation_exceptions,
       (SELECT count(*)::text FROM settlements WHERE reconciled_at IS NULL) AS settlements_unreconciled,
       (SELECT COALESCE(SUM(expected_amount_kobo - received_amount_kobo),0)::text
          FROM settlements WHERE reconciled_at IS NULL) AS settlement_variance_kobo,
       (SELECT COALESCE(SUM(amount_kobo),0)::text FROM commissions
         WHERE status IN ('PENDING','ELIGIBLE','APPROVED')) AS commission_liability_kobo,
       (SELECT count(*)::text FROM commission_payouts WHERE status = 'REQUESTED')
         AS payouts_awaiting_approval,
       (SELECT count(*)::text FROM refunds WHERE status IN ('PENDING','APPROVED'))
         AS refunds_outstanding,
       -- Money the State is holding on somebody else's behalf. It belongs on
       -- this screen more than on any other.
       (SELECT COALESCE(SUM(t.amount_kobo),0)::text
          FROM transactions t
         WHERE t.status IN ${REVENUE_STATES}
           AND EXISTS (SELECT 1 FROM revenue_item_rates r
                        WHERE r.revenue_item_id = t.revenue_item_id AND r.lga_id IS NOT NULL))
         AS owed_to_councils_kobo`,
  );
}

/**
 * What an auditor came to look at.
 *
 * Read-only by construction: every figure here is a count of something to
 * examine, and nothing on this screen leads to an action that changes a
 * record.
 */
export async function auditorHome(db: Db) {
  return queryOne(
    db,
    `SELECT
       (SELECT count(*)::text FROM audit_logs) AS audit_entries,
       (SELECT count(*)::text FROM audit_logs WHERE created_at >= CURRENT_DATE) AS entries_today,
       (SELECT count(*)::text FROM audit_logs WHERE result = 'DENIED'
          AND created_at >= CURRENT_DATE - interval '7 days') AS refused_this_week,
       (SELECT count(*)::text FROM transactions WHERE status IN ('REVERSED','REFUNDED'))
         AS reversed_or_refunded,
       (SELECT count(*)::text FROM fraud_flags WHERE status IN ('OPEN','UNDER_REVIEW'))
         AS fraud_flags_open,
       (SELECT count(*)::text FROM revenue_item_rates
         WHERE created_at >= CURRENT_DATE - interval '30 days') AS rate_changes_this_month,
       (SELECT count(*)::text FROM verification_attempts
          WHERE created_at >= CURRENT_DATE - interval '7 days') AS receipt_checks_this_week,
       (SELECT count(*)::text FROM taxpayers WHERE status = 'ACTIVE') AS taxpayers_on_record`,
  );
}

/**
 * The actual work waiting, not a count of it.
 *
 * A home screen that reports "3 agents awaiting clearance" and sends the
 * officer somewhere else to see which three is an index, not a workplace. The
 * counts above answer "is there anything"; these answer "what", so the top of
 * each queue can be acted on where it is found.
 *
 * Deliberately shallow — the first few of each. A home screen is not the queue
 * screen and should not try to be; what it owes is the next thing to do.
 */
export async function adminWorkItems(db: Db) {
  const [agents, devices, supervisors] = await Promise.all([
    query(
      db,
      `SELECT a.id, a.agent_code, u.full_name, l.name AS lga, a.clearance_status,
              to_char(a.updated_at, 'YYYY-MM-DD') AS waiting_since
         FROM agents a JOIN users u ON u.id = a.user_id
         LEFT JOIN lgas l ON l.id = a.lga_id
        WHERE a.clearance_status = 'READY_FOR_REVIEW'
        ORDER BY a.updated_at LIMIT 5`,
    ),
    query(
      db,
      `SELECT d.id, d.device_identifier, d.device_name, u.full_name, a.agent_code,
              to_char(d.registered_at, 'YYYY-MM-DD') AS registered
         FROM agent_devices d
         JOIN agents a ON a.id = d.agent_id
         JOIN users u ON u.id = a.user_id
        WHERE d.status = 'PENDING'
        ORDER BY d.registered_at LIMIT 5`,
    ),
    query(
      db,
      `SELECT u.id, u.full_name, u.phone
         FROM users u
        WHERE u.role = 'supervisor' AND u.status = 'ACTIVE'
          AND NOT EXISTS (SELECT 1 FROM user_territories ut WHERE ut.user_id = u.id)
        ORDER BY u.full_name LIMIT 5`,
    ),
  ]);
  return { agents, devices, supervisors };
}

/** The taxpayers a revenue officer has to chase. */
export async function revenueOfficerWorkItems(db: Db) {
  const [failedTins, expiring] = await Promise.all([
    query(
      db,
      `SELECT t.id, coalesce(t.business_name, t.first_name || ' ' || t.last_name) AS name,
              t.phone, t.tin_status, t.tin_reason
         FROM taxpayers t
        WHERE t.tin_status = 'FAILED'
        ORDER BY t.created_at LIMIT 5`,
    ),
    query(
      db,
      `SELECT i.id, i.invoice_number, i.total_amount_kobo::text AS amount_kobo,
              to_char(i.expires_at, 'YYYY-MM-DD') AS expires_on,
              coalesce(tp.business_name, tp.first_name || ' ' || tp.last_name) AS taxpayer
         FROM invoices i JOIN taxpayers tp ON tp.id = i.taxpayer_id
        WHERE i.status = 'UNPAID' AND i.expires_at IS NOT NULL
          AND i.expires_at BETWEEN now() AND now() + interval '7 days'
        ORDER BY i.expires_at LIMIT 5`,
    ),
  ]);
  return { failedTins, expiring };
}

/** What a finance officer settles today. */
export async function financeOfficerWorkItems(db: Db) {
  const [exceptions, payouts] = await Promise.all([
    query(
      db,
      `SELECT r.id, r.status, r.gateway_reference, r.detail,
              r.expected_amount_kobo::text AS expected_kobo,
              r.received_amount_kobo::text AS received_kobo,
              r.variance_kobo::text AS variance_kobo,
              to_char(r.created_at, 'YYYY-MM-DD') AS raised
         FROM reconciliation_records r
        WHERE r.reconciled_at IS NULL
          AND r.status IN ('MISSING_PAYMENT','MISSING_PLATFORM_TRANSACTION',
                           'AMOUNT_MISMATCH','DUPLICATE_PAYMENT')
        ORDER BY r.created_at LIMIT 5`,
    ),
    query(
      db,
      `SELECT p.id, p.payout_reference, p.amount_kobo::text AS amount_kobo,
              p.commission_count::text AS commissions, u.full_name AS agent,
              to_char(p.requested_at, 'YYYY-MM-DD') AS requested
         FROM commission_payouts p
         JOIN agents a ON a.id = p.agent_id
         JOIN users u ON u.id = a.user_id
        WHERE p.status = 'REQUESTED'
        ORDER BY p.requested_at LIMIT 5`,
    ),
  ]);
  return { exceptions, payouts };
}

/** What an auditor would open first. Reads only. */
export async function auditorWorkItems(db: Db) {
  const [refusals, reversals] = await Promise.all([
    query(
      db,
      `SELECT id, action, entity_type, actor_role, reason,
              to_char(created_at, 'YYYY-MM-DD HH24:MI') AS at
         FROM audit_logs
        WHERE result = 'DENIED'
        ORDER BY created_at DESC LIMIT 5`,
    ),
    query(
      db,
      `SELECT t.transaction_reference, t.status, t.amount_kobo::text AS amount_kobo,
              to_char(t.updated_at, 'YYYY-MM-DD') AS at,
              coalesce(tp.business_name, tp.first_name || ' ' || tp.last_name) AS taxpayer
         FROM transactions t JOIN taxpayers tp ON tp.id = t.taxpayer_id
        WHERE t.status IN ('REVERSED','REFUNDED')
        ORDER BY t.updated_at DESC LIMIT 5`,
    ),
  ]);
  return { refusals, reversals };
}
