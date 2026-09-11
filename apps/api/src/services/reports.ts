/**
 * Dashboards, revenue intelligence and reports (PRD §37, §38, §39, §48, §67, §91).
 *
 * Two rules run through this module:
 *
 *   * Only *recognised* revenue is counted. A transaction counts towards
 *     collections once its payment is verified — never at invoice stage, and
 *     never on an agent's say-so. `REVENUE_STATES_SQL` in `lib/revenue-states`
 *     is that definition, applied everywhere so no two dashboards can
 *     disagree — a promise this module kept and the audit workbench, which
 *     had written the list out again by hand, did not.
 *
 *   * PRD §67's audit questions are answerable without touching production
 *     tables directly: each is a function here.
 */

import type { Db } from '../db/pool';
import { query, queryOne } from '../db/pool';
import { REVENUE_STATES_SQL } from '../lib/revenue-states';
import { outstandingExceptionSql } from './reconciliation';
import {
  lgaScopeSql,
  scopeParams,
  transactionScopeSql,
  type ReportScope,
} from './report-scope';


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
  const [
    totals,
    counts,
    byCategory,
    byLga,
    byAgent,
    byMda,
    byChannel,
    byTaxpayerType,
    byItem,
    trend,
    exceptions,
  ] = await Promise.all([
    queryOne(
      db,
      /*
       * Each period beside the one before it.
       *
       * A collections figure on its own is a number an officer reads; the same
       * figure beside last month's is one they can act on. Ten items on the
       * officer readiness assessment read Missing for the want of the second
       * column — yesterday's revenue, previous-period comparison, growth,
       * decline, declining categories, growth per place, growth per agent.
       *
       * THE COMPARISONS ARE LIKE FOR LIKE, WHICH IS THE WHOLE DIFFICULTY.
       *
       * "This month against last month" on the 8th of March compares eight days
       * with thirty-one and reports a catastrophe every month. So each previous
       * period is cut at the same point through itself: last month means the
       * first eight days of February, and the year-to-date comparison is the
       * same calendar window a year earlier. The unshortened previous month is
       * returned too, as `previous_month_whole_kobo`, because at month end an
       * officer wants the real figure and by then the two agree.
       *
       * Growth is basis points, and NULL rather than zero when the previous
       * period collected nothing: "grew by 0%" and "there is nothing to compare
       * against" are different answers and only one of them is true of a new
       * LGA's first month.
       */
      `WITH windows AS (
         SELECT
           CURRENT_DATE                                   AS today,
           CURRENT_DATE - 1                               AS yesterday,
           date_trunc('week', CURRENT_DATE)::date         AS week_start,
           (date_trunc('week', CURRENT_DATE) - interval '7 days')::date  AS prev_week_start,
           date_trunc('month', CURRENT_DATE)::date        AS month_start,
           (date_trunc('month', CURRENT_DATE) - interval '1 month')::date AS prev_month_start,
           (date_trunc('month', CURRENT_DATE) - interval '1 day')::date   AS prev_month_end,
           date_trunc('year', CURRENT_DATE)::date         AS year_start,
           (date_trunc('year', CURRENT_DATE) - interval '1 year')::date   AS prev_year_start,
           (CURRENT_DATE - date_trunc('week', CURRENT_DATE)::date)  AS days_into_week,
           (CURRENT_DATE - date_trunc('month', CURRENT_DATE)::date) AS days_into_month
       ),
       sums AS (
         SELECT
           COALESCE(SUM(t.amount_kobo) FILTER (WHERE t.created_at::date = w.today),0) AS today,
           COALESCE(SUM(t.amount_kobo) FILTER (WHERE t.created_at::date = w.yesterday),0) AS yesterday,

           COALESCE(SUM(t.amount_kobo) FILTER (WHERE t.created_at::date >= w.week_start),0) AS week,
           COALESCE(SUM(t.amount_kobo) FILTER (
             WHERE t.created_at::date >= w.prev_week_start
               AND t.created_at::date <= w.prev_week_start + w.days_into_week),0) AS prev_week,

           COALESCE(SUM(t.amount_kobo) FILTER (WHERE t.created_at::date >= w.month_start),0) AS month,
           COALESCE(SUM(t.amount_kobo) FILTER (
             WHERE t.created_at::date >= w.prev_month_start
               AND t.created_at::date <= LEAST(
                     w.prev_month_start + w.days_into_month, w.prev_month_end)),0) AS prev_month,
           COALESCE(SUM(t.amount_kobo) FILTER (
             WHERE t.created_at::date BETWEEN w.prev_month_start AND w.prev_month_end),0)
             AS prev_month_whole,

           COALESCE(SUM(t.amount_kobo) FILTER (WHERE t.created_at::date >= w.year_start),0) AS ytd,
           COALESCE(SUM(t.amount_kobo) FILTER (
             WHERE t.created_at::date >= w.prev_year_start
               AND t.created_at::date <= (w.today - interval '1 year')::date),0) AS prev_ytd,

           COALESCE(SUM(t.amount_kobo),0) AS total
         FROM transactions t CROSS JOIN windows w
        WHERE t.status IN ${REVENUE_STATES_SQL} AND ${tx}
       )
       SELECT
         today::text            AS today_kobo,
         yesterday::text        AS yesterday_kobo,
         week::text             AS week_kobo,
         prev_week::text        AS previous_week_kobo,
         month::text            AS month_kobo,
         prev_month::text       AS previous_month_kobo,
         prev_month_whole::text AS previous_month_whole_kobo,
         ytd::text              AS ytd_kobo,
         prev_ytd::text         AS previous_ytd_kobo,
         total::text            AS total_kobo,
         -- Basis points, NULL when there is nothing to compare against.
         (((today - yesterday) * 10000) / NULLIF(yesterday, 0))::bigint       AS day_growth_bp,
         (((week - prev_week) * 10000) / NULLIF(prev_week, 0))::bigint        AS week_growth_bp,
         (((month - prev_month) * 10000) / NULLIF(prev_month, 0))::bigint     AS month_growth_bp,
         (((ytd - prev_ytd) * 10000) / NULLIF(prev_ytd, 0))::bigint           AS year_growth_bp
       FROM sums`,
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
           WHERE t.status IN ${REVENUE_STATES_SQL} AND ${tx}) AS successful_transactions,
         (SELECT count(*)::text FROM transactions t
           WHERE t.status IN ('FAILED','CANCELLED','EXPIRED') AND ${tx}) AS failed_transactions,
         (SELECT count(*)::text FROM transactions t
           WHERE t.status = 'RECONCILIATION_PENDING' AND ${tx}) AS pending_reconciliation,
         (SELECT COALESCE(SUM(c.amount_kobo),0)::text FROM commissions c
           LEFT JOIN transactions t ON t.id = c.transaction_id
           WHERE c.status IN ('PENDING','ELIGIBLE','APPROVED') AND ${tx}) AS commission_liability_kobo,
         (SELECT COALESCE(SUM(c.amount_kobo),0)::text FROM commissions c
           LEFT JOIN transactions t ON t.id = c.transaction_id
           WHERE c.status = 'PAID' AND ${tx}) AS commission_paid_kobo,

         /*
          * Money the State took and gave back, as headline figures.
          *
          * Both were countable per agent and nowhere at the top, so an
          * administrator asking "how much did we reverse this month" had to
          * add up a performance table. Reversal and refund are kept apart
          * because they are different events: a reversal voids the receipt,
          * a refund moves money out of the government account, and a
          * transaction can be one without the other.
          */
         (SELECT count(*)::text FROM transactions t
           WHERE t.status = 'REVERSED' AND ${tx}) AS reversed_transactions,
         (SELECT COALESCE(SUM(t.amount_kobo),0)::text FROM transactions t
           WHERE t.status = 'REVERSED' AND ${tx}) AS reversed_kobo,
         (SELECT count(*)::text FROM transactions t
           WHERE t.status = 'REFUNDED' AND ${tx}) AS refunded_transactions,
         (SELECT COALESCE(SUM(r.amount_kobo),0)::text FROM refunds r
           JOIN transactions t ON t.id = r.transaction_id
           WHERE r.status = 'COMPLETED' AND ${tx}) AS refunded_kobo,

         (SELECT count(*)::text FROM agents a
           WHERE a.operational_status = 'SUSPENDED'
             AND ($1 OR a.territory_id = ANY($2::uuid[]))) AS agents_suspended,

         /*
          * Agents online, from the sessions the platform already keeps.
          *
          * sessions.last_used_at is written on every authenticated request,
          * so presence is a fact the platform holds and had never read. Fifteen
          * minutes rather than five: a field agent registering a taxpayer works
          * offline between syncs, and a five-minute window would report them
          * absent while they are standing in the market.
          *
          * This is "recently active", not "logged in" — a distinction worth
          * keeping, because a revoked session with a recent timestamp is not
          * somebody working.
          */
         (SELECT count(DISTINCT a.id)::text
            FROM agents a
            JOIN sessions s ON s.user_id = a.user_id
           WHERE s.revoked_at IS NULL
             AND s.last_used_at > now() - interval '15 minutes'
             AND ($1 OR a.territory_id = ANY($2::uuid[]))) AS agents_online,

         /*
          * What is assessed and unpaid — the floor under "expected revenue".
          *
          * Deliberately the floor and not a projection: this is money already
          * invoiced and owed, which is a fact, and the forecast is a separate
          * figure that says out loud that it is arithmetic.
          */
         (SELECT COALESCE(SUM(i.total_amount_kobo - i.amount_paid_kobo),0)::text
            FROM invoices i
            JOIN taxpayers tp ON tp.id = i.taxpayer_id
           WHERE i.status IN ('UNPAID','PARTIALLY_PAID')
             AND ($1 OR tp.lga_id = ANY($3::uuid[]))) AS expected_revenue_kobo`,
      [statewide, territoryIds, lgaIds],
    ),
    query(
      db,
      /*
       * Each category this month, last month, and what that says.
       *
       * `growth_bp` is what makes a declining category visible: the dashboard
       * ranked by size, so a category that halved was still near the top and
       * looked healthy. `contribution_bp` is its share of the month, which is
       * the figure an officer actually quotes.
       *
       * The all-time total stays as `amount_kobo` because several screens read
       * it, and the monthly pair is added beside it rather than replacing it.
       */
      `WITH bounds AS (
         SELECT date_trunc('month', CURRENT_DATE)::date AS month_start,
                (date_trunc('month', CURRENT_DATE) - interval '1 month')::date AS prev_start,
                (date_trunc('month', CURRENT_DATE) - interval '1 day')::date AS prev_end,
                (CURRENT_DATE - date_trunc('month', CURRENT_DATE)::date) AS days_in
       ),
       rows AS (
         SELECT rc.name AS category, rc.name_ha AS category_ha,
                count(t.id) AS transactions,
                COALESCE(SUM(t.amount_kobo),0) AS amount,
                COALESCE(SUM(t.amount_kobo) FILTER (
                  WHERE t.created_at::date >= b.month_start),0) AS this_month,
                COALESCE(SUM(t.amount_kobo) FILTER (
                  WHERE t.created_at::date >= b.prev_start
                    AND t.created_at::date <= LEAST(b.prev_start + b.days_in, b.prev_end)),0)
                  AS prev_month
           FROM transactions t
           JOIN revenue_items ri ON ri.id = t.revenue_item_id
           JOIN revenue_categories rc ON rc.id = ri.category_id
           CROSS JOIN bounds b
          WHERE t.status IN ${REVENUE_STATES_SQL} AND ${tx}
          GROUP BY rc.name, rc.name_ha
       )
       SELECT category, category_ha,
              transactions::text,
              amount::text AS amount_kobo,
              this_month::text AS month_kobo,
              prev_month::text AS previous_month_kobo,
              (((this_month - prev_month) * 10000) / NULLIF(prev_month, 0))::bigint AS growth_bp,
              ((this_month * 10000) / NULLIF(SUM(this_month) OVER (), 0))::bigint AS contribution_bp
         FROM rows
        ORDER BY amount DESC`,
      scoped,
    ),
    query(
      db,
      `SELECT l.name AS lga, l.zone, count(t.id)::text AS transactions,
              COALESCE(SUM(t.amount_kobo),0)::text AS amount_kobo
         FROM lgas l
         LEFT JOIN transactions t ON t.lga_id = l.id AND t.status IN ${REVENUE_STATES_SQL}
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
         LEFT JOIN transactions t ON t.agent_id = a.id AND t.status IN ${REVENUE_STATES_SQL}
              AND ${tx}
        WHERE a.operational_status = 'ACTIVE'
          AND ($1 OR a.territory_id = ANY($2::uuid[]))
        GROUP BY a.agent_code, u.full_name
        ORDER BY COALESCE(SUM(t.amount_kobo),0) DESC LIMIT 20`,
      scoped,
    ),
    query(
      db,
      `SELECT COALESCE(m.name, 'PSIRS (direct)') AS mda,
              COALESCE(m.name_ha, 'PSIRS (kai tsaye)') AS mda_ha,
              count(t.id)::text AS transactions,
              COALESCE(SUM(t.amount_kobo),0)::text AS amount_kobo
         FROM transactions t
         JOIN revenue_items ri ON ri.id = t.revenue_item_id
         LEFT JOIN mdas m ON m.id = ri.mda_id
        WHERE t.status IN ${REVENUE_STATES_SQL} AND ${tx}
        GROUP BY m.name, m.name_ha ORDER BY SUM(t.amount_kobo) DESC`,
      scoped,
    ),
    /*
     * How the money arrived.
     *
     * transactions.channel has been written on every row since the platform
     * started and nothing had ever grouped by it, so "how much came through
     * agents against the taxpayer portal" was unanswerable — which is the
     * question behind every decision about where to put agents.
     */
    query(
      db,
      `SELECT t.channel,
              count(t.id)::text AS transactions,
              COALESCE(SUM(t.amount_kobo),0)::text AS amount_kobo
         FROM transactions t
        WHERE t.status IN ${REVENUE_STATES_SQL} AND ${tx}
        GROUP BY t.channel ORDER BY SUM(t.amount_kobo) DESC`,
      scoped,
    ),

    /*
     * Individuals against businesses.
     *
     * Two populations with different collection economics and different
     * compliance behaviour, reported as one number.
     */
    query(
      db,
      `SELECT tp.taxpayer_type,
              count(t.id)::text AS transactions,
              count(DISTINCT t.taxpayer_id)::text AS taxpayers,
              COALESCE(SUM(t.amount_kobo),0)::text AS amount_kobo,
              COALESCE(ROUND(AVG(t.amount_kobo)),0)::text AS average_kobo
         FROM transactions t
         JOIN taxpayers tp ON tp.id = t.taxpayer_id
        WHERE t.status IN ${REVENUE_STATES_SQL} AND ${tx}
        GROUP BY tp.taxpayer_type ORDER BY SUM(t.amount_kobo) DESC`,
      scoped,
    ),

    /*
     * One level below the category, which is where an officer's work is.
     *
     * "Local Government Levies" is a heading; "Shops and Kiosks Levy" is the
     * thing somebody is responsible for. The dashboard stopped at the heading.
     */
    query(
      db,
      `SELECT ri.name AS item, ri.name_ha AS item_ha, ri.code,
              rc.name AS category, rc.name_ha AS category_ha,
              count(t.id)::text AS transactions,
              COALESCE(SUM(t.amount_kobo),0)::text AS amount_kobo
         FROM transactions t
         JOIN revenue_items ri ON ri.id = t.revenue_item_id
         JOIN revenue_categories rc ON rc.id = ri.category_id
        WHERE t.status IN ${REVENUE_STATES_SQL} AND ${tx}
        GROUP BY ri.name, ri.name_ha, ri.code, rc.name, rc.name_ha
        ORDER BY SUM(t.amount_kobo) DESC LIMIT 25`,
      scoped,
    ),

    query(
      db,
      `SELECT to_char(day, 'YYYY-MM-DD') AS day,
              COALESCE(SUM(t.amount_kobo),0)::text AS amount_kobo,
              count(t.id)::text AS transactions
         FROM generate_series(CURRENT_DATE - interval '29 days', CURRENT_DATE, interval '1 day') AS day
         LEFT JOIN transactions t
                ON t.created_at::date = day::date AND t.status IN ${REVENUE_STATES_SQL}
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
         -- Scoped through the transaction that produced it. A record with no
         -- transaction — a payment at the gateway with nothing on the platform
         -- behind it — belongs to no territory, and by the same rule the
         -- scope module applies to an unattributed collection it is outside
         -- every territory scope rather than inside all of them. The statewide
         -- picture stays where report:read:all can see it.
         --
         -- The two counts below are deliberately not scoped: a supervisor
         -- holds approval:review and support:read:all, so the approval queue
         -- and the ticket queue really are theirs to see whole.
         (SELECT count(*)::text FROM reconciliation_records rr
           LEFT JOIN transactions t ON t.id = rr.transaction_id
           WHERE ${outstandingExceptionSql('rr')}
             AND ${tx})
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
    revenueByChannel: byChannel,
    revenueByTaxpayerType: byTaxpayerType,
    revenueByItem: byItem,
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
    const { previousFrom, previousTo } = precedingWindow(from, to);
    return query(
      db,
      `SELECT COALESCE(tp.community, 'Not recorded') AS level, 'COMMUNITY' AS level_type,
              count(t.id)::text AS transactions,
              COALESCE(SUM(t.amount_kobo),0)::text AS amount_kobo,
              count(DISTINCT t.taxpayer_id)::text AS taxpayers,
              COALESCE(ROUND(AVG(t.amount_kobo)),0)::text AS average_kobo,
              (SELECT COALESCE(SUM(p.amount_kobo),0)::text
                 FROM transactions p JOIN taxpayers ptp ON ptp.id = p.taxpayer_id
                WHERE p.ward_id = $1 AND p.status IN ${REVENUE_STATES_SQL}
                  AND ptp.community IS NOT DISTINCT FROM tp.community
                  AND p.created_at BETWEEN $6 AND $7
                  AND ${transactionScopeSql('p', 4, 5)}) AS previous_amount_kobo,
              (SELECT count(*)::text FROM taxpayers reg
                WHERE reg.ward_id = $1 AND reg.status = 'ACTIVE'
                  AND reg.community IS NOT DISTINCT FROM tp.community) AS registered_taxpayers
         FROM transactions t JOIN taxpayers tp ON tp.id = t.taxpayer_id
        WHERE t.ward_id = $1 AND t.status IN ${REVENUE_STATES_SQL}
          AND t.created_at BETWEEN $2 AND $3
          AND ${transactionScopeSql('t', 4, 5)}
        GROUP BY tp.community ORDER BY SUM(t.amount_kobo) DESC`,
      [params.wardId, from, to, statewide, territoryIds, previousFrom, previousTo],
    ).then((rows) => rows.map(withGrowthAndCompliance));
  }

  if (params.lgaId) {
    const { previousFrom, previousTo } = precedingWindow(from, to);
    return query(
      db,
      `SELECT w.name AS level, 'WARD' AS level_type, w.id AS level_id,
              count(t.id)::text AS transactions,
              COALESCE(SUM(t.amount_kobo),0)::text AS amount_kobo,
              count(DISTINCT t.taxpayer_id)::text AS taxpayers,
              COALESCE(ROUND(AVG(t.amount_kobo)),0)::text AS average_kobo,
              (SELECT COALESCE(SUM(p.amount_kobo),0)::text
                 FROM transactions p
                WHERE p.ward_id = w.id AND p.status IN ${REVENUE_STATES_SQL}
                  AND p.created_at BETWEEN $7 AND $8
                  AND ${transactionScopeSql('p', 4, 5)}) AS previous_amount_kobo,
              (SELECT count(*)::text FROM taxpayers tp
                WHERE tp.ward_id = w.id AND tp.status = 'ACTIVE') AS registered_taxpayers
         FROM wards w
         LEFT JOIN transactions t ON t.ward_id = w.id AND t.status IN ${REVENUE_STATES_SQL}
              AND t.created_at BETWEEN $2 AND $3
              AND ${transactionScopeSql('t', 4, 5)}
        WHERE w.lga_id = $1 AND ($4 OR w.lga_id = ANY($6::uuid[]))
        GROUP BY w.name, w.id ORDER BY COALESCE(SUM(t.amount_kobo),0) DESC`,
      [params.lgaId, from, to, statewide, territoryIds, lgaIds, previousFrom, previousTo],
    ).then((rows) => rows.map(withGrowthAndCompliance));
  }

  /*
   * The state view, with three columns the brief asked for and this had not.
   *
   * `average_kobo` — a place collecting ₦2m from 40 transactions and one
   * collecting it from 4,000 are different problems, and the totals look
   * identical.
   *
   * `growth_bp` — the same window immediately before this one. "Ward B's
   * collections increased 48% after agent deployment" is the brief's own
   * example of what makes this screen worth opening, and nothing computed it.
   *
   * `compliance_bp` — the share of registered taxpayers in the place who paid
   * anything at all in the window. This is the figure behind the brief's other
   * example: 4,000 registered taxpayers and 35% payment activity. It is
   * deliberately "paid anything", not a compliance score, because the score is
   * per taxpayer and averaging scores across a place answers a subtly different
   * question than the one an officer is asking.
   */
  const { previousFrom, previousTo } = precedingWindow(from, to);

  return query(
    db,
    `SELECT l.name AS level, 'LGA' AS level_type, l.id AS level_id, l.zone,
            count(t.id)::text AS transactions,
            COALESCE(SUM(t.amount_kobo),0)::text AS amount_kobo,
            count(DISTINCT t.taxpayer_id)::text AS taxpayers,
            count(DISTINCT t.agent_id)::text AS agents,
            COALESCE(ROUND(AVG(t.amount_kobo)),0)::text AS average_kobo,
            (SELECT COALESCE(SUM(p.amount_kobo),0)::text
               FROM transactions p
              WHERE p.lga_id = l.id AND p.status IN ${REVENUE_STATES_SQL}
                AND p.created_at BETWEEN $6 AND $7
                AND ${transactionScopeSql('p', 3, 4)}) AS previous_amount_kobo,
            (SELECT count(*)::text FROM taxpayers tp
              WHERE tp.lga_id = l.id AND tp.status = 'ACTIVE') AS registered_taxpayers
       FROM lgas l
       LEFT JOIN transactions t ON t.lga_id = l.id AND t.status IN ${REVENUE_STATES_SQL}
            AND t.created_at BETWEEN $1 AND $2
            AND ${transactionScopeSql('t', 3, 4)}
      WHERE ${lgaScopeSql('l', 3, 5)}
      GROUP BY l.name, l.id, l.zone ORDER BY COALESCE(SUM(t.amount_kobo),0) DESC`,
    [from, to, statewide, territoryIds, lgaIds, previousFrom, previousTo],
  ).then((rows) => rows.map(withGrowthAndCompliance));
}

/**
 * The window of the same length immediately before this one.
 *
 * "Growth" needs a comparable, and the only defensible comparable for an
 * arbitrary window the caller chose is the window of equal length that ended
 * the day before it began. A fixed "last month" would compare a three-day
 * query against a whole month.
 */
function precedingWindow(from: Date, to: Date): { previousFrom: Date; previousTo: Date } {
  const spanDays = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1);
  return {
    previousFrom: new Date(from.getTime() - spanDays * 86_400_000),
    previousTo: new Date(from.getTime() - 86_400_000),
  };
}

/**
 * Growth and compliance, computed once for every geography row.
 *
 * In TypeScript rather than in each of the three SQL branches, because the
 * ward and community queries need the same two columns and repeating a
 * `NULLIF` division in three places is how two of them end up disagreeing.
 * Basis points throughout, and null rather than zero when there is nothing to
 * divide by — "grew 0%" and "there was nothing here before" are different
 * answers, and only one is true of a newly deployed ward.
 */
function withGrowthAndCompliance(row: Record<string, unknown>): Record<string, unknown> {
  const current = BigInt((row.amount_kobo as string) ?? '0');
  const previous = BigInt((row.previous_amount_kobo as string) ?? '0');
  const registered = Number((row.registered_taxpayers as string) ?? '0');
  const paying = Number((row.taxpayers as string) ?? '0');

  return {
    ...row,
    growth_bp:
      previous > 0n ? Number(((current - previous) * 10_000n) / previous) : null,
    compliance_bp: registered > 0 ? Math.round((paying / registered) * 10_000) : null,
  };
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
            count(t.id) FILTER (WHERE t.status IN ${REVENUE_STATES_SQL})::text AS successful_transactions,
            count(t.id) FILTER (WHERE t.status IN ('FAILED','CANCELLED','EXPIRED'))::text AS failed_transactions,
            count(t.id) FILTER (WHERE t.status IN ('REVERSED','REFUNDED'))::text AS reversed_transactions,
            COALESCE(SUM(t.amount_kobo) FILTER (WHERE t.status IN ${REVENUE_STATES_SQL}),0)::text AS collected_kobo,
            COALESCE(ROUND(AVG(t.amount_kobo) FILTER (WHERE t.status IN ${REVENUE_STATES_SQL})),0)::text
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
            count(DISTINCT t.created_at::date)::text AS active_days,
            /*
             * The two columns that turn a ranking into a management tool.
             *
             * categories_processed — an agent working one levy and an agent
             * working six are different deployments, and the collection totals
             * hide it.
             *
             * previous_month_kobo — the same days of last month, so an agent
             * whose collections halved is visible rather than merely lower down
             * a list that is sorted by size. Cut at the same point through the
             * month for the reason the dashboard's comparisons are: eight days
             * against thirty-one reports a catastrophe every month.
             */
            (SELECT count(DISTINCT ri.category_id)::text
               FROM transactions ct
               JOIN revenue_items ri ON ri.id = ct.revenue_item_id
              WHERE ct.agent_id = a.id AND ct.status IN ${REVENUE_STATES_SQL})
              AS categories_processed,
            COALESCE(SUM(t.amount_kobo) FILTER (
              WHERE t.status IN ${REVENUE_STATES_SQL}
                AND t.created_at::date >= date_trunc('month', CURRENT_DATE)::date),0)::text
              AS month_kobo,
            COALESCE(SUM(t.amount_kobo) FILTER (
              WHERE t.status IN ${REVENUE_STATES_SQL}
                AND t.created_at::date >= (date_trunc('month', CURRENT_DATE) - interval '1 month')::date
                AND t.created_at::date <= LEAST(
                      (date_trunc('month', CURRENT_DATE) - interval '1 month')::date
                        + (CURRENT_DATE - date_trunc('month', CURRENT_DATE)::date),
                      (date_trunc('month', CURRENT_DATE) - interval '1 day')::date)),0)::text
              AS previous_month_kobo
       FROM agents a
       JOIN users u ON u.id = a.user_id
       LEFT JOIN lgas l ON l.id = a.lga_id
       LEFT JOIN transactions t ON t.agent_id = a.id
      WHERE ($1::uuid IS NULL OR a.id = $1)
        AND ($3 OR a.territory_id = ANY($4::uuid[]))
      GROUP BY a.id, a.agent_code, u.full_name, l.name, a.operational_status
      ORDER BY COALESCE(SUM(t.amount_kobo) FILTER (WHERE t.status IN ${REVENUE_STATES_SQL}),0) DESC
      LIMIT $2`,
    [params.agentId ?? null, params.limit ?? 100, statewide, territoryIds],
  ).then((rows) =>
    rows.map((row) => {
      const month = BigInt(row.month_kobo as string);
      const previous = BigInt(row.previous_month_kobo as string);
      return {
        ...row,
        // Null rather than zero: an agent deployed this month has nothing to
        // compare against, which is not the same as flat.
        growth_bp: previous > 0n ? Number(((month - previous) * 10_000n) / previous) : null,
      };
    }),
  );
}

/**
 * Agent home-screen figures (PRD §29, §56).
 *
 * @statewide Keyed on one agent, which is narrower than any territory.
 *
 * Every row here is already filtered to `agent_id`, and an agent works one
 * territory. Adding the territory predicate on top would change nothing except
 * in the case where it would get it wrong: a transaction whose `territory_id`
 * is null sits outside every territory scope by design, and zeroing an agent's
 * own day because of an unattributed collection is a worse answer than not
 * filtering at all.
 */
export async function agentToday(db: Db, agentId: string) {
  const [today, wallet, recent] = await Promise.all([
    queryOne(
      db,
      `SELECT
         COALESCE(SUM(amount_kobo) FILTER (WHERE status IN ${REVENUE_STATES_SQL}),0)::text AS collected_kobo,
         count(*) FILTER (WHERE status IN ${REVENUE_STATES_SQL})::text AS successful,
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
              ri.name AS revenue_item, ri.name_ha AS revenue_item_ha,
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
  scope: ReportScope = { kind: 'STATEWIDE' },
) {
  const { statewide, territoryIds } = scopeParams(scope);
  return query(
    db,
    `SELECT t.transaction_reference, t.amount_kobo, t.status, t.created_at, t.verified_at,
            ri.name AS revenue_item, ri.name_ha AS revenue_item_ha,
            l.name AS lga, r.receipt_number,
            p.gateway_reference, p.payment_method
       FROM transactions t
       JOIN revenue_items ri ON ri.id = t.revenue_item_id
       JOIN lgas l ON l.id = t.lga_id
       LEFT JOIN receipts r ON r.transaction_id = t.id
       LEFT JOIN payments p ON p.transaction_id = t.id AND p.status = 'VERIFIED'
      WHERE t.agent_id = $1 AND t.created_at BETWEEN $2 AND $3
        AND ${transactionScopeSql('t', 4, 5)}
      ORDER BY t.created_at`,
    [params.agentId, params.from, params.to, statewide, territoryIds],
  );
}

export async function reversedAfterSuccess(
  db: Db,
  params: { from?: Date; to?: Date } = {},
  scope: ReportScope = { kind: 'STATEWIDE' },
) {
  const { statewide, territoryIds } = scopeParams(scope);
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
        AND ${transactionScopeSql('t', 3, 4)}
      ORDER BY t.reversed_at DESC`,
    [params.from ?? null, params.to ?? null, statewide, territoryIds],
  );
}

export async function rateChangeHistory(db: Db, params: { revenueItemId?: string } = {}) {
  return query(
    db,
    `SELECT ri.code, ri.name, ri.name_ha, r.version, r.rate_type, r.fixed_amount_kobo, r.rate_basis_points,
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

export async function receiptsByRevenueItem(
  db: Db,
  params: { revenueItemCode: string },
  scope: ReportScope = { kind: 'STATEWIDE' },
) {
  const { statewide, territoryIds } = scopeParams(scope);
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
        AND ${transactionScopeSql('t', 2, 3)}
      ORDER BY r.issued_at DESC LIMIT 1000`,
    [params.revenueItemCode, statewide, territoryIds],
  );
}

/**
 * Key performance indicators (PRD §91).
 *
 * @statewide A statewide indicator set, guarded on report:read:all.
 *
 * These count taxpayers, agents, payments and reconciliation records as well
 * as transactions, and only the last of those carries a territory. Scoping the
 * ones that can be scoped would produce a figure that is partly one territory
 * and partly the state — not a smaller truth but a different and false one.
 * The route requires report:read:all, so no territory-scoped officer reaches
 * it, and the route-level test holds that.
 */
export async function kpis(db: Db) {
  return queryOne(
    db,
    `SELECT
       (SELECT COALESCE(SUM(amount_kobo),0)::text FROM transactions WHERE status IN ${REVENUE_STATES_SQL})
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
          FROM transactions WHERE status IN ${REVENUE_STATES_SQL}) AS receipt_generation_rate_percent,
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
/**
 * Characters a spreadsheet reads as "this cell is a program".
 *
 * Excel, LibreOffice and Google Sheets all evaluate a cell beginning with one
 * of these. Tab and carriage return are here because they are stripped before
 * that decision is made, so a leading tab hides the character that follows it.
 */
const FORMULA_LEAD = /^[\t\r]*[=+\-@]/;

/** A value that is genuinely a number, which must survive the export as one. */
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]!);
  const escape = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    let text = value instanceof Date ? value.toISOString() : String(value);

    /*
     * RFC 4180 escaping was here and is correct as far as the file format
     * goes. It is not what breaks: quoting a cell does not stop a spreadsheet
     * evaluating what is inside the quotes, so a taxpayer registered under the
     * name =HYPERLINK("https://…"&A1,"Click for refund") exported cleanly and
     * then offered to send the row beside it — a TIN and what that person paid
     * — to an address of the attacker's choosing, from inside the revenue
     * office, on one click.
     *
     * A leading apostrophe is the interoperable answer: every spreadsheet
     * treats the rest of the cell as literal text and shows the value without
     * it. Numbers are exempted because a report nobody can add up is not a
     * report, and -1500 is an adjustment, not an attack.
     */
    if (FORMULA_LEAD.test(text) && !PLAIN_NUMBER.test(text)) {
      text = `'${text}`;
    }

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
    `SELECT m.name AS mda, m.name_ha AS mda_ha, m.code,
            count(DISTINCT ri.id)::text AS revenue_items,
            count(t.id)::text AS transactions,
            COALESCE(SUM(t.amount_kobo),0)::text AS amount_kobo
       FROM mdas m
       LEFT JOIN revenue_items ri ON ri.mda_id = m.id
       LEFT JOIN transactions t ON t.revenue_item_id = ri.id
            AND t.status IN ${REVENUE_STATES_SQL}
            AND t.created_at BETWEEN $1 AND $2
            AND ${transactionScopeSql('t', 3, 4)}
      GROUP BY m.name, m.name_ha, m.code
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
      WHERE t.status IN ${REVENUE_STATES_SQL}
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
            COALESCE(ter.name_ha, 'Babu yanki') AS territory_ha,
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
      WHERE t.status IN ${REVENUE_STATES_SQL}
        AND t.created_at BETWEEN $1 AND $2
        AND ${transactionScopeSql('t', 3, 4)}
      GROUP BY a.agent_code, u.full_name, ter.name, ter.name_ha
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
      WHERE t.status IN ${REVENUE_STATES_SQL}
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
       SELECT t.lga_id, ri.id AS item_id, ri.code, ri.name, ri.name_ha,
              count(t.id) AS transactions,
              SUM(t.amount_kobo) AS amount_kobo
         FROM transactions t
         JOIN revenue_items ri ON ri.id = t.revenue_item_id
        WHERE t.status IN ${REVENUE_STATES_SQL}
          AND t.created_at BETWEEN $1 AND $2
          AND ${transactionScopeSql('t', 3, 4)}
          -- An item rated per Council is a Council's revenue. This is the
          -- database's own record of the arrangement rather than a list here
          -- that would drift away from the catalogue.
          AND EXISTS (
            SELECT 1 FROM revenue_item_rates r
             WHERE r.revenue_item_id = ri.id AND r.lga_id IS NOT NULL
          )
        GROUP BY t.lga_id, ri.id, ri.code, ri.name, ri.name_ha
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

/**
 * The taxpayer register, which is the revenue officer's charge.
 *
 * @statewide A home screen for a role that holds report:read:all.
 *
 * Counts across taxpayers, approvals and invoices. Invoices carry no territory
 * and taxpayers carry an LGA rather than one, so a scope here would have to be
 * spelled differently in each subquery — which is exactly how a filter comes to
 * be right in one place and absent in the next. If a territory-scoped role is
 * ever added to `/government/home`, this needs a scope before that happens.
 */
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

/**
 * Money in, money out, and money held for somebody else.
 *
 * @statewide Settlement, commission and refund positions are state finance.
 *
 * Reconciliation records, settlements, commission payouts and refunds are
 * handled centrally and belong to no territory. Splitting the state's cash
 * position by territory would invent a number nobody holds.
 */
export async function financeOfficerHome(db: Db) {
  return queryOne(
    db,
    `SELECT
       (SELECT count(*)::text FROM reconciliation_records rr
         WHERE ${outstandingExceptionSql('rr')})
         AS reconciliation_exceptions,
       (SELECT count(*)::text FROM settlements WHERE reconciled_at IS NULL) AS settlements_unreconciled,
       (SELECT COALESCE(SUM(expected_amount_kobo - received_amount_kobo),0)::text
          FROM settlements WHERE reconciled_at IS NULL) AS settlement_variance_kobo,
       (SELECT COALESCE(SUM(amount_kobo),0)::text FROM commissions
         WHERE status IN ('PENDING','ELIGIBLE','APPROVED')) AS commission_liability_kobo,
       (SELECT count(*)::text FROM commission_payouts WHERE status = 'REQUESTED')
         AS payouts_awaiting_approval,
       -- Every refund the taxpayer has not had. This read PENDING and
       -- APPROVED: APPROVED is not a status the column allows, so it counted
       -- nothing, and PROCESSING and FAILED were both missing — which left the
       -- refund the gateway had already refused, the one most in need of
       -- somebody's attention, appearing on no screen a person reads.
       (SELECT count(*)::text FROM refunds WHERE status IN ('PENDING','PROCESSING','FAILED'))
         AS refunds_outstanding,
       -- Money the State is holding on somebody else's behalf. It belongs on
       -- this screen more than on any other.
       (SELECT COALESCE(SUM(t.amount_kobo),0)::text
          FROM transactions t
         WHERE t.status IN ${REVENUE_STATES_SQL}
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
 *
 * @statewide The audit trail is one trail, and an auditor holds report:read:all.
 *
 * Audit entries, refusals and verification attempts record what the platform
 * did rather than where money came from, and several carry no geography at
 * all. An audit view that silently omitted part of the trail would be worse
 * than no view — the opposite of the usual argument for scoping.
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

/**
 * The taxpayers a revenue officer has to chase.
 *
 * @statewide The queue behind revenueOfficerHome, and scoped the same way.
 *
 * It must not diverge from the counts above it: a home screen whose number and
 * whose list disagree is worse than either on its own.
 */
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
        WHERE ${outstandingExceptionSql('r')}
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

/**
 * What an auditor would open first. Reads only.
 *
 * @statewide The queue behind auditorHome, and scoped the same way.
 *
 * Refusals and reversals out of the one audit trail, and it must not diverge
 * from the counts it sits under.
 */
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

// ===========================================================================
// Revenue by what it was collected for, and who has not paid it
// ===========================================================================

export interface CategoryBreakdownParams {
  from?: Date;
  to?: Date;
  lgaId?: string;
  agentId?: string;
  categoryId?: string;
}

/**
 * What each levy actually brought in (PRD §57).
 *
 * The executive dashboard already grouped revenue by category, but only
 * statewide, only for all time, and only down to the category — so "Development
 * Levy collected X" was answerable and "Development Levy in Jos North last
 * month, by item, and how much of it this agent brought in" was not. Those are
 * the questions a revenue officer actually has when deciding where to send
 * people next week.
 *
 * Two levels are returned because they answer different questions. The category
 * total is what a commissioner reads; the item lines under it are what a
 * revenue officer works from, because a category that looks healthy can be one
 * item carrying six.
 *
 * Only verified revenue is counted, on the same states every other figure in
 * this file uses. Money the gateway has confirmed and the State has not yet
 * received is included deliberately — it is revenue recognised, and excluding
 * it would make this report disagree with the dashboard beside it — and the
 * settled figure is returned alongside so the difference is visible rather than
 * buried.
 */
export async function revenueByCategory(
  db: Db,
  params: CategoryBreakdownParams = {},
  scope: ReportScope = { kind: 'STATEWIDE' },
) {
  const conditions: string[] = [`t.status IN ${REVENUE_STATES_SQL}`];
  const values: unknown[] = [];
  const add = (clause: string, value: unknown) => {
    values.push(value);
    conditions.push(clause.replace('$$', `$${values.length}`));
  };

  if (params.from) add('t.created_at >= $$', params.from);
  if (params.to) add('t.created_at <= $$', params.to);
  if (params.lgaId) add('t.lga_id = $$', params.lgaId);
  if (params.agentId) add('t.agent_id = $$', params.agentId);
  if (params.categoryId) add('ri.category_id = $$', params.categoryId);

  /*
   * The caller's scope, not a filter they chose.
   *
   * `lgaId` above is a drill-down the officer asked for; this is the limit of
   * what they may be shown, and it is applied after so no combination of
   * query parameters can widen it. Both queries below share these values, so
   * the category totals and the per-item rows cannot disagree about which
   * transactions they counted.
   */
  const { statewide, territoryIds } = scopeParams(scope);
  values.push(statewide, territoryIds);
  conditions.push(transactionScopeSql('t', values.length - 1, values.length));

  const where = conditions.join(' AND ');

  const [categories, items] = await Promise.all([
    query<{
      category_id: string;
      category: string;
      category_ha: string | null;
      transactions: string;
      amount_kobo: string;
      settled_kobo: string;
      taxpayers: string;
    }>(
      db,
      `SELECT rc.id AS category_id, rc.name AS category, rc.name_ha AS category_ha,
              count(t.id)::text AS transactions,
              COALESCE(SUM(t.amount_kobo),0)::text AS amount_kobo,
              COALESCE(SUM(t.amount_kobo) FILTER (WHERE t.status = 'SETTLED'),0)::text
                AS settled_kobo,
              count(DISTINCT t.taxpayer_id)::text AS taxpayers
         FROM transactions t
         JOIN revenue_items ri ON ri.id = t.revenue_item_id
         JOIN revenue_categories rc ON rc.id = ri.category_id
        WHERE ${where}
        GROUP BY rc.id, rc.name, rc.name_ha
        ORDER BY SUM(t.amount_kobo) DESC`,
      values,
    ),
    query<{
      category_id: string;
      category: string;
      category_ha: string | null;
      revenue_item_id: string;
      revenue_item: string;
      revenue_item_ha: string | null;
      code: string;
      transactions: string;
      amount_kobo: string;
      settled_kobo: string;
      taxpayers: string;
    }>(
      db,
      `SELECT rc.id AS category_id, rc.name AS category, rc.name_ha AS category_ha,
              ri.id AS revenue_item_id, ri.name AS revenue_item, ri.name_ha AS revenue_item_ha,
              ri.code,
              count(t.id)::text AS transactions,
              COALESCE(SUM(t.amount_kobo),0)::text AS amount_kobo,
              COALESCE(SUM(t.amount_kobo) FILTER (WHERE t.status = 'SETTLED'),0)::text
                AS settled_kobo,
              count(DISTINCT t.taxpayer_id)::text AS taxpayers
         FROM transactions t
         JOIN revenue_items ri ON ri.id = t.revenue_item_id
         JOIN revenue_categories rc ON rc.id = ri.category_id
        WHERE ${where}
        GROUP BY rc.id, rc.name, rc.name_ha, ri.id, ri.name, ri.name_ha, ri.code
        ORDER BY SUM(t.amount_kobo) DESC`,
      values,
    ),
  ]);

  const total = categories.reduce((sum, row) => sum + BigInt(row.amount_kobo), 0n);
  const settled = categories.reduce((sum, row) => sum + BigInt(row.settled_kobo), 0n);

  return {
    totalKobo: total.toString(),
    settledKobo: settled.toString(),
    /*
     * Stated rather than left to be worked out. The gap between what has been
     * collected and what the State actually holds is the number this platform
     * exists to keep honest, and a report that showed only the first would be
     * the old behaviour in a new place.
     */
    awaitingSettlementKobo: (total - settled).toString(),
    categories,
    items,
  };
}

export interface DefaultersParams {
  categoryId?: string;
  revenueItemId?: string;
  lgaId?: string;
  limit?: number;
}

/**
 * Who owes what, per levy (PRD §57).
 *
 * An officer can already open one taxpayer and see their obligations. Nothing
 * answered the question the other way round — which taxpayers assessed under
 * Market Levy have not paid — which is the one that produces a day's work for a
 * collection round rather than a name to look up.
 *
 * Ordered by what is owed, because a list of defaulters sorted by anything else
 * is a list somebody has to sort before they can use it.
 */
export async function defaultersByCategory(
  db: Db,
  params: DefaultersParams = {},
  scope: ReportScope = { kind: 'STATEWIDE' },
) {
  const limit = Math.min(params.limit ?? 100, 500);
  const conditions: string[] = [
    `i.status IN ('UNPAID','PARTIALLY_PAID')`,
    'i.total_amount_kobo > i.amount_paid_kobo',
  ];
  const values: unknown[] = [];
  const add = (clause: string, value: unknown) => {
    values.push(value);
    conditions.push(clause.replace('$$', `$${values.length}`));
  };

  if (params.categoryId) add('ri.category_id = $$', params.categoryId);
  if (params.revenueItemId) add('ri.id = $$', params.revenueItemId);
  if (params.lgaId) add('tp.lga_id = $$', params.lgaId);

  /*
   * Scoped on the transaction's territory, like every other report here.
   *
   * A defaulter list is a list of people who can be pressed for money, so an
   * unscoped one hands a supervisor exactly the material an unofficial
   * collection is made from — for an area that is not theirs. The predicate is
   * the shared one rather than a hand-written `tp.lga_id` test, because a
   * scope spelled differently in one report from all the others is how this
   * came to be missing in the first place.
   */
  const { statewide, territoryIds } = scopeParams(scope);
  values.push(statewide, territoryIds);
  conditions.push(transactionScopeSql('t', values.length - 1, values.length));

  values.push(limit);

  const rows = await query<{
    taxpayer_id: string;
    name: string;
    tin: string | null;
    phone: string;
    lga: string;
    category: string;
    category_ha: string | null;
    revenue_item: string;
    revenue_item_ha: string | null;
    invoices: string;
    outstanding_kobo: string;
    oldest_due: Date | null;
  }>(
    db,
    `SELECT tp.id AS taxpayer_id,
            COALESCE(tp.business_name,
                     trim(COALESCE(tp.first_name,'') || ' ' || COALESCE(tp.last_name,''))) AS name,
            tp.tin, tp.phone, l.name AS lga,
            rc.name AS category, rc.name_ha AS category_ha,
            ri.name AS revenue_item, ri.name_ha AS revenue_item_ha,
            count(DISTINCT i.id)::text AS invoices,
            SUM(i.total_amount_kobo - i.amount_paid_kobo)::text AS outstanding_kobo,
            min(i.expires_at) AS oldest_due
       FROM invoices i
       JOIN transactions t ON t.invoice_id = i.id
       JOIN revenue_items ri ON ri.id = t.revenue_item_id
       JOIN revenue_categories rc ON rc.id = ri.category_id
       JOIN taxpayers tp ON tp.id = i.taxpayer_id
       JOIN lgas l ON l.id = tp.lga_id
      WHERE ${conditions.join(' AND ')}
      GROUP BY tp.id, tp.business_name, tp.first_name, tp.last_name,
               tp.tin, tp.phone, l.name, rc.name, rc.name_ha, ri.name, ri.name_ha
      ORDER BY SUM(i.total_amount_kobo - i.amount_paid_kobo) DESC
      LIMIT $${values.length}`,
    values,
  );

  const total = rows.reduce((sum, row) => sum + BigInt(row.outstanding_kobo), 0n);
  return {
    outstandingKobo: total.toString(),
    defaulters: rows.length,
    rows,
  };
}

/**
 * The taxpayer base, as a population rather than as a count.
 *
 * The dashboard reported two numbers about taxpayers — how many, and how many
 * were registered this month — and a revenue officer plans against neither. The
 * questions they actually ask are: how many of these people are still paying,
 * how often, how much, and where are the ones who have stopped.
 *
 * ACTIVE MEANS PAID RECENTLY, NOT `status = 'ACTIVE'`
 *
 * `taxpayers.status` says whether a record is live — whether the person is
 * still on the register at all. It says nothing about whether they are paying,
 * so a register full of people who last paid in 2024 reports 100% active. The
 * cohort split here is on payment behaviour within a window, which is what the
 * word means to the officer asking.
 *
 * Ninety days rather than a year, because most Plateau levies are collected at
 * least quarterly, and a taxpayer who has missed a quarter is the one worth
 * knowing about while there is still time to visit them.
 */
export async function taxpayerAnalytics(
  db: Db,
  params: { lgaId?: string; wardId?: string; categoryId?: string } = {},
  scope: ReportScope = { kind: 'STATEWIDE' },
) {
  const { statewide, lgaIds } = scopeParams(scope);
  const filters = [params.lgaId ?? null, params.wardId ?? null, statewide, lgaIds];

  const [cohorts, byLga, byCategory, frequency] = await Promise.all([
    queryOne(
      db,
      `WITH base AS (
         SELECT tp.id, tp.taxpayer_type, tp.created_at,
                (SELECT max(t.created_at) FROM transactions t
                  WHERE t.taxpayer_id = tp.id AND t.status IN ${REVENUE_STATES_SQL}) AS last_paid_at,
                (SELECT COALESCE(SUM(t.amount_kobo),0) FROM transactions t
                  WHERE t.taxpayer_id = tp.id AND t.status IN ${REVENUE_STATES_SQL}) AS paid_kobo,
                (SELECT count(*) FROM transactions t
                  WHERE t.taxpayer_id = tp.id AND t.status IN ${REVENUE_STATES_SQL}) AS payments
           FROM taxpayers tp
          WHERE tp.status = 'ACTIVE'
            AND ($1::uuid IS NULL OR tp.lga_id = $1)
            AND ($2::uuid IS NULL OR tp.ward_id = $2)
            AND ($3 OR tp.lga_id = ANY($4::uuid[]))
       )
       SELECT
         count(*)::text AS total,
         count(*) FILTER (WHERE taxpayer_type = 'INDIVIDUAL')::text AS individuals,
         count(*) FILTER (WHERE taxpayer_type = 'BUSINESS')::text AS businesses,
         count(*) FILTER (WHERE created_at >= date_trunc('month', CURRENT_DATE))::text
           AS new_this_month,
         count(*) FILTER (WHERE created_at >= date_trunc('month', CURRENT_DATE) - interval '1 month'
                            AND created_at < date_trunc('month', CURRENT_DATE))::text
           AS new_last_month,
         -- Paying within the window, not merely on the register.
         count(*) FILTER (WHERE last_paid_at > now() - interval '90 days')::text AS active,
         count(*) FILTER (WHERE last_paid_at IS NULL
                            OR last_paid_at <= now() - interval '90 days')::text AS inactive,
         count(*) FILTER (WHERE last_paid_at IS NULL)::text AS never_paid,
         COALESCE(ROUND(AVG(paid_kobo) FILTER (WHERE payments > 0)),0)::text AS average_lifetime_kobo,
         COALESCE(ROUND(AVG(payments)::numeric, 2),0)::text AS average_payments_each,
         COALESCE(SUM(paid_kobo),0)::text AS lifetime_kobo
       FROM base`,
      filters,
    ),

    query(
      db,
      `SELECT l.name AS lga,
              count(tp.id)::text AS taxpayers,
              count(tp.id) FILTER (WHERE tp.created_at >= date_trunc('month', CURRENT_DATE))::text
                AS new_this_month,
              count(tp.id) FILTER (WHERE EXISTS (
                SELECT 1 FROM transactions t
                 WHERE t.taxpayer_id = tp.id AND t.status IN ${REVENUE_STATES_SQL}
                   AND t.created_at > now() - interval '90 days'))::text AS active,
              COALESCE(SUM(tc.outstanding_amount_kobo),0)::text AS outstanding_kobo,
              COALESCE(ROUND(AVG(tc.score)),0)::text AS average_compliance_score
         FROM lgas l
         /*
          * The ward filter belongs on the join, not on the WHERE.
          *
          * Applied as a predicate it would drop every LGA that has no taxpayer
          * in that ward, which is all but one of them — and the point of this
          * table is that an LGA with an empty register still appears, because
          * that is the one worth noticing.
          */
         LEFT JOIN taxpayers tp
                ON tp.lga_id = l.id AND tp.status = 'ACTIVE'
               AND ($2::uuid IS NULL OR tp.ward_id = $2)
         LEFT JOIN taxpayer_compliance tc ON tc.taxpayer_id = tp.id
        WHERE ($1::uuid IS NULL OR l.id = $1)
          AND ($3 OR l.id = ANY($4::uuid[]))
        GROUP BY l.name ORDER BY count(tp.id) DESC`,
      filters,
    ),

    /*
     * Which levies the register is actually engaged with.
     *
     * Grouped through the assessments raised against each taxpayer rather than
     * through their transactions, so a taxpayer assessed and not paying still
     * appears — which is the whole point of asking.
     */
    query(
      db,
      `SELECT rc.name AS category, rc.name_ha AS category_ha,
              count(DISTINCT asm.taxpayer_id)::text AS taxpayers,
              count(DISTINCT asm.taxpayer_id) FILTER (
                WHERE asm.status IN ('SETTLED'))::text AS taxpayers_paid
         FROM assessments asm
         JOIN taxpayers tp ON tp.id = asm.taxpayer_id
         JOIN revenue_items ri ON ri.id = asm.revenue_item_id
         JOIN revenue_categories rc ON rc.id = ri.category_id
        WHERE tp.status = 'ACTIVE'
          AND ($1::uuid IS NULL OR tp.lga_id = $1)
          AND ($2::uuid IS NULL OR tp.ward_id = $2)
          AND ($3 OR tp.lga_id = ANY($4::uuid[]))
        GROUP BY rc.name, rc.name_ha ORDER BY count(DISTINCT asm.taxpayer_id) DESC`,
      filters,
    ),

    /*
     * How often somebody who pays, pays.
     *
     * Bucketed rather than averaged: a mean over a population where most people
     * paid once and a few paid twelve times describes nobody in it.
     */
    query(
      db,
      `WITH counts AS (
         SELECT t.taxpayer_id, count(*) AS payments,
                COALESCE(ROUND(AVG(t.amount_kobo)),0) AS average_kobo
           FROM transactions t
           JOIN taxpayers tp ON tp.id = t.taxpayer_id
          WHERE t.status IN ${REVENUE_STATES_SQL}
            AND t.created_at > now() - interval '365 days'
            AND ($1::uuid IS NULL OR tp.lga_id = $1)
            AND ($2::uuid IS NULL OR tp.ward_id = $2)
            AND ($3 OR tp.lga_id = ANY($4::uuid[]))
          GROUP BY t.taxpayer_id
       )
       SELECT CASE
                WHEN payments = 1 THEN 'ONCE'
                WHEN payments BETWEEN 2 AND 3 THEN 'TWO_TO_THREE'
                WHEN payments BETWEEN 4 AND 11 THEN 'FOUR_TO_ELEVEN'
                ELSE 'TWELVE_OR_MORE'
              END AS band,
              count(*)::text AS taxpayers,
              COALESCE(ROUND(AVG(average_kobo)),0)::text AS average_payment_kobo
         FROM counts
        GROUP BY band`,
      filters,
    ),
  ]);

  return { cohorts, byLga, byCategory, paymentFrequency: frequency, scope };
}

/**
 * Commission grouped the two ways finance actually asks for it.
 *
 * Per agent and per payout batch existed. "What did Jos North cost us in
 * commission last quarter" did not, and it is the figure a Council asks about
 * when the remittance lands.
 */
export async function commissionByPlaceAndPeriod(
  db: Db,
  params: { from?: Date; to?: Date } = {},
  scope: ReportScope = { kind: 'STATEWIDE' },
) {
  const { statewide, territoryIds } = scopeParams(scope);
  const from = params.from ?? new Date(Date.now() - 365 * 86_400_000);
  const to = params.to ?? new Date();

  const [byLga, byPeriod] = await Promise.all([
    query(
      db,
      `SELECT l.name AS lga,
              count(c.id)::text AS commissions,
              COALESCE(SUM(c.amount_kobo),0)::text AS accrued_kobo,
              COALESCE(SUM(c.amount_kobo) FILTER (WHERE c.status = 'PAID'),0)::text AS paid_kobo,
              COALESCE(SUM(c.amount_kobo) FILTER (
                WHERE c.status IN ('PENDING','ELIGIBLE','APPROVED')),0)::text AS outstanding_kobo,
              COALESCE(SUM(c.amount_kobo) FILTER (WHERE c.status = 'REVERSED'),0)::text
                AS reversed_kobo
         FROM commissions c
         JOIN transactions t ON t.id = c.transaction_id
         JOIN lgas l ON l.id = t.lga_id
        WHERE c.created_at BETWEEN $1 AND $2 AND ${transactionScopeSql('t', 3, 4)}
        GROUP BY l.name ORDER BY SUM(c.amount_kobo) DESC`,
      [from, to, statewide, territoryIds],
    ),
    query(
      db,
      `SELECT to_char(date_trunc('month', c.created_at), 'YYYY-MM') AS period,
              count(c.id)::text AS commissions,
              COALESCE(SUM(c.amount_kobo),0)::text AS accrued_kobo,
              COALESCE(SUM(c.amount_kobo) FILTER (WHERE c.status = 'PAID'),0)::text AS paid_kobo,
              COALESCE(SUM(c.amount_kobo) FILTER (
                WHERE c.status IN ('PENDING','ELIGIBLE','APPROVED')),0)::text AS outstanding_kobo
         FROM commissions c
         JOIN transactions t ON t.id = c.transaction_id
        WHERE c.created_at BETWEEN $1 AND $2 AND ${transactionScopeSql('t', 3, 4)}
        GROUP BY date_trunc('month', c.created_at)
        ORDER BY date_trunc('month', c.created_at) DESC`,
      [from, to, statewide, territoryIds],
    ),
  ]);

  return { byLga, byPeriod };
}
