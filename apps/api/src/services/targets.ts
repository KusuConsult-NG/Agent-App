/**
 * What was meant to come in, and what a run rate says will.
 *
 * Every revenue figure this platform produced answered "how much came in", and
 * none of them answered "is that enough". Nine items on the officer readiness
 * assessment read Missing for that one reason — target, achievement, gap,
 * growth against plan, declining categories, category targets, target
 * management, target versus actual by period, and forecasting.
 *
 * TWO THINGS, KEPT APART
 *
 * A **target** is a decision. Somebody set it, on a date, and the platform
 * stores it exactly as given.
 *
 * A **forecast** is arithmetic on history. It is not a target, it is not a
 * commitment, and every payload that carries one carries `basis` alongside it
 * saying what it was computed from and how confident that makes it. A forecast
 * presented as a figure without its basis is how a projection becomes a number
 * somebody budgets against, and the brief asks specifically that this be
 * labelled.
 *
 * WHY THE FORECAST IS DELIBERATELY SIMPLE
 *
 * It is run rate, shaped by the collection curve this revenue actually follows
 * within a period, and nothing more. No regression, no smoothing constants
 * nobody can explain to an auditor.
 *
 * The shaping matters and is the whole reason a plain run rate is not enough.
 * Nigerian levy collection is not uniform across a month: it clusters at the
 * start when demand notices land, and again at the end when a deadline bites.
 * A straight-line projection taken on the 10th therefore *under*-forecasts, and
 * one taken on the 28th over-forecasts, both by a wide margin. So the projection
 * asks what share of a comparable period had usually been collected by this
 * point, and divides by it.
 *
 * When there is not enough history to know that share, it says so — `basis`
 * drops to RUN_RATE and the confidence to LOW — rather than inventing a curve
 * from two weeks of data.
 */

import type { Db } from '../db/pool';
import { query, queryOne, withTransaction } from '../db/pool';
import { badRequest, conflict, notFound } from '../lib/errors';
import { recordAudit } from './audit';
import {
  scopeParams,
  transactionScopeSql,
  type ReportScope,
} from './report-scope';

/** Revenue is recognised only after independent verification (PRD §17, §95). */
const REVENUE_STATES = `('PAYMENT_VERIFIED','RECEIPT_GENERATED','RECONCILIATION_PENDING','SETTLED')`;

export const TARGET_SCOPES = ['STATE', 'LGA', 'CATEGORY', 'ITEM', 'AGENT'] as const;
export type TargetScope = (typeof TARGET_SCOPES)[number];

export const TARGET_PERIODS = ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL'] as const;
export type TargetPeriod = (typeof TARGET_PERIODS)[number];

export interface Actor {
  userId: string;
  role: string;
}

// ---------------------------------------------------------------------------
// Setting a target
// ---------------------------------------------------------------------------

export interface SetTargetInput {
  scope: TargetScope;
  lgaId?: string | null;
  categoryId?: string | null;
  revenueItemId?: string | null;
  agentId?: string | null;
  periodKind: TargetPeriod;
  periodStart: Date;
  periodEnd: Date;
  amountKobo: bigint;
  note?: string | null;
}

/**
 * Set a target, superseding whatever stood for the same thing and period.
 *
 * Superseding rather than updating, so "the target was lowered on the 24th"
 * stays answerable. The unique index only covers ACTIVE rows, which is what
 * lets the old figure remain beside the new one.
 *
 * Both statements run in one transaction: a supersede that committed without
 * its replacement would leave the period with no target at all, and a screen
 * showing 0% achievement against nothing.
 */
export async function setTarget(
  actor: Actor,
  input: SetTargetInput,
): Promise<{ id: string; superseded: string | null }> {
  if (input.periodEnd < input.periodStart) {
    throw badRequest('A target period cannot end before it starts.');
  }
  if (input.amountKobo <= 0n) {
    throw badRequest('A target has to be more than nothing.');
  }
  assertScopeIsCoherent(input);

  return withTransaction(async (client) => {
    const previous = await queryOne<{ id: string; amount_kobo: string }>(
      client,
      `UPDATE revenue_targets
          SET status = 'SUPERSEDED', updated_at = now()
        WHERE status = 'ACTIVE'
          AND scope = $1
          AND lga_id IS NOT DISTINCT FROM $2
          AND category_id IS NOT DISTINCT FROM $3
          AND revenue_item_id IS NOT DISTINCT FROM $4
          AND agent_id IS NOT DISTINCT FROM $5
          AND period_kind = $6 AND period_start = $7 AND period_end = $8
        RETURNING id, amount_kobo`,
      [
        input.scope,
        input.lgaId ?? null,
        input.categoryId ?? null,
        input.revenueItemId ?? null,
        input.agentId ?? null,
        input.periodKind,
        input.periodStart,
        input.periodEnd,
      ],
    );

    const row = await queryOne<{ id: string }>(
      client,
      `INSERT INTO revenue_targets (
         scope, lga_id, category_id, revenue_item_id, agent_id,
         period_kind, period_start, period_end, amount_kobo, note, set_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id`,
      [
        input.scope,
        input.lgaId ?? null,
        input.categoryId ?? null,
        input.revenueItemId ?? null,
        input.agentId ?? null,
        input.periodKind,
        input.periodStart,
        input.periodEnd,
        input.amountKobo.toString(),
        input.note?.trim() || null,
        actor.userId,
      ],
    );

    await recordAudit(client, {
      actorId: actor.userId,
      actorRole: actor.role,
      action: previous ? 'target.revise' : 'target.set',
      entityType: 'revenue_target',
      entityId: row!.id,
      oldValue: previous ? { amountKobo: previous.amount_kobo } : null,
      newValue: {
        scope: input.scope,
        periodKind: input.periodKind,
        periodStart: input.periodStart.toISOString().slice(0, 10),
        periodEnd: input.periodEnd.toISOString().slice(0, 10),
        amountKobo: input.amountKobo.toString(),
      },
      reason: input.note?.trim() || null,
    });

    return { id: row!.id, superseded: previous?.id ?? null };
  });
}

/**
 * The same rule the CHECK constraint holds, stated where the error is useful.
 *
 * The constraint is the guarantee; this is so an officer gets "an LGA target
 * has to name an LGA" rather than a constraint name.
 */
function assertScopeIsCoherent(input: SetTargetInput): void {
  const named = {
    lga: !!input.lgaId,
    category: !!input.categoryId,
    item: !!input.revenueItemId,
    agent: !!input.agentId,
  };
  switch (input.scope) {
    case 'STATE':
      if (named.lga || named.category || named.item || named.agent) {
        throw badRequest('A state target covers the whole state and names nothing else.');
      }
      break;
    case 'LGA':
      if (!named.lga) throw badRequest('An LGA target has to name an LGA.');
      if (named.category || named.item || named.agent) {
        throw badRequest('An LGA target names an LGA and nothing else.');
      }
      break;
    case 'CATEGORY':
      if (!named.category) throw badRequest('A category target has to name a category.');
      if (named.item || named.agent) {
        throw badRequest('A category target may narrow to an LGA, and to nothing else.');
      }
      break;
    case 'ITEM':
      if (!named.item) throw badRequest('An item target has to name a revenue item.');
      if (named.category || named.agent) {
        throw badRequest('An item target may narrow to an LGA, and to nothing else.');
      }
      break;
    case 'AGENT':
      if (!named.agent) throw badRequest('An agent target has to name an agent.');
      if (named.lga || named.category || named.item) {
        throw badRequest('An agent target names an agent and nothing else.');
      }
      break;
  }
}

export async function withdrawTarget(
  actor: Actor,
  targetId: string,
  reason: string,
): Promise<void> {
  await withTransaction(async (client) => {
    const row = await queryOne<{ id: string; status: string; amount_kobo: string }>(
      client,
      `SELECT id, status, amount_kobo FROM revenue_targets WHERE id = $1 FOR UPDATE`,
      [targetId],
    );
    if (!row) throw notFound('That target');
    if (row.status !== 'ACTIVE') {
      throw conflict('TARGET_NOT_ACTIVE', `That target is already ${row.status.toLowerCase()}.`);
    }
    await client.query(
      `UPDATE revenue_targets SET status = 'WITHDRAWN', updated_at = now() WHERE id = $1`,
      [targetId],
    );
    await recordAudit(client, {
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'target.withdraw',
      entityType: 'revenue_target',
      entityId: targetId,
      oldValue: { status: 'ACTIVE', amountKobo: row.amount_kobo },
      newValue: { status: 'WITHDRAWN' },
      reason,
    });
  });
}

// ---------------------------------------------------------------------------
// Target versus actual
// ---------------------------------------------------------------------------

/**
 * Every live target overlapping a window, with what has actually come in.
 *
 * The actual for each target is computed against that target's own period and
 * its own scope, not against the window the caller asked about — otherwise a
 * March target listed in a January-to-December query would be compared with the
 * whole year's collections and report 1,200% achievement.
 *
 * Written as one query with a correlated subquery rather than N queries,
 * because the annual view of a state's targets is several hundred rows and a
 * round trip each would make the screen unusable on a Jos connection.
 */
export async function targetProgress(
  db: Db,
  params: {
    from?: Date;
    to?: Date;
    scope?: TargetScope;
    periodKind?: TargetPeriod;
    lgaId?: string;
    includeInactive?: boolean;
  },
  scope: ReportScope = { kind: 'STATEWIDE' },
) {
  const { statewide, territoryIds, lgaIds } = scopeParams(scope);
  const from = params.from ?? startOfYear();
  const to = params.to ?? endOfYear();

  return query(
    db,
    `SELECT rt.id, rt.scope, rt.period_kind, rt.period_start, rt.period_end,
            rt.amount_kobo::text AS target_kobo, rt.note, rt.status, rt.created_at,
            l.name AS lga_name, rc.name AS category_name, ri.name AS item_name,
            a.agent_code, agent_user.full_name AS agent_name,
            setter.full_name AS set_by_name,

            /*
             * Collected against this target, on this target's own period.
             *
             * The predicates mirror the scope columns exactly: a NULL column
             * means "not narrowed by this", which is why each line is an OR
             * against IS NULL rather than a join.
             */
            (SELECT COALESCE(SUM(t.amount_kobo), 0)::text
               FROM transactions t
               JOIN revenue_items rti ON rti.id = t.revenue_item_id
              WHERE t.status IN ${REVENUE_STATES}
                AND t.created_at::date BETWEEN rt.period_start AND rt.period_end
                AND (rt.lga_id IS NULL OR t.lga_id = rt.lga_id)
                AND (rt.category_id IS NULL OR rti.category_id = rt.category_id)
                AND (rt.revenue_item_id IS NULL OR t.revenue_item_id = rt.revenue_item_id)
                AND (rt.agent_id IS NULL OR t.agent_id = rt.agent_id)
                AND ${transactionScopeSql('t', 1, 2)}
            ) AS collected_kobo,

            -- How far through the period we are, so a shortfall on day 3 of a
            -- month is not presented the same way as one on day 30.
            GREATEST(0, LEAST(
              (rt.period_end - rt.period_start) + 1,
              (CURRENT_DATE - rt.period_start) + 1
            )) AS days_elapsed,
            (rt.period_end - rt.period_start) + 1 AS days_in_period
       FROM revenue_targets rt
       LEFT JOIN lgas l                ON l.id = rt.lga_id
       LEFT JOIN revenue_categories rc ON rc.id = rt.category_id
       LEFT JOIN revenue_items ri      ON ri.id = rt.revenue_item_id
       LEFT JOIN agents a              ON a.id = rt.agent_id
       LEFT JOIN users agent_user      ON agent_user.id = a.user_id
       JOIN users setter               ON setter.id = rt.set_by
      WHERE ($6::boolean OR rt.status = 'ACTIVE')
        AND rt.period_start <= $4 AND rt.period_end >= $3
        AND ($5::text IS NULL OR rt.scope = $5)
        AND ($7::text IS NULL OR rt.period_kind = $7)
        AND ($8::uuid IS NULL OR rt.lga_id = $8)
        -- A territory-scoped officer sees state targets and their own LGAs',
        -- and not another LGA's. A target with no LGA is not any one
        -- territory's and is shown to everybody who can see targets at all.
        AND ($1 OR rt.lga_id IS NULL OR rt.lga_id = ANY($9::uuid[]))
      ORDER BY rt.period_start DESC, rt.scope, l.name NULLS FIRST, rc.name NULLS FIRST`,
    [
      statewide,
      territoryIds,
      from,
      to,
      params.scope ?? null,
      params.includeInactive ?? false,
      params.periodKind ?? null,
      params.lgaId ?? null,
      lgaIds,
    ],
  );
}

/**
 * The state target for a period beside the sum of what was apportioned below it.
 *
 * PSIRS sets a state figure and hands portions of it down, and the two do not
 * have to agree — the state number usually carries headroom. What an officer
 * needs is to see the gap rather than to be prevented from creating it, which
 * is why this is a report and not a constraint.
 */
export async function targetRollup(
  db: Db,
  params: { periodStart: Date; periodEnd: Date },
) {
  return queryOne(
    db,
    `SELECT
       (SELECT COALESCE(SUM(amount_kobo),0)::text FROM revenue_targets
         WHERE status = 'ACTIVE' AND scope = 'STATE'
           AND period_start = $1 AND period_end = $2) AS state_target_kobo,
       (SELECT COALESCE(SUM(amount_kobo),0)::text FROM revenue_targets
         WHERE status = 'ACTIVE' AND scope = 'LGA'
           AND period_start = $1 AND period_end = $2) AS lga_targets_kobo,
       (SELECT count(*)::text FROM revenue_targets
         WHERE status = 'ACTIVE' AND scope = 'LGA'
           AND period_start = $1 AND period_end = $2) AS lgas_with_a_target,
       (SELECT count(*)::text FROM lgas WHERE status = 'ACTIVE') AS lgas_total,
       (SELECT COALESCE(SUM(amount_kobo),0)::text FROM revenue_targets
         WHERE status = 'ACTIVE' AND scope IN ('CATEGORY','ITEM')
           AND period_start = $1 AND period_end = $2) AS category_targets_kobo,
       (SELECT COALESCE(SUM(amount_kobo),0)::text FROM revenue_targets
         WHERE status = 'ACTIVE' AND scope = 'AGENT'
           AND period_start = $1 AND period_end = $2) AS agent_targets_kobo`,
    [params.periodStart, params.periodEnd],
  );
}

// ---------------------------------------------------------------------------
// Forecasting
// ---------------------------------------------------------------------------

export type ForecastBasis = 'SEASONAL' | 'RUN_RATE' | 'INSUFFICIENT_HISTORY';
export type ForecastConfidence = 'LOW' | 'MEDIUM' | 'HIGH';

export interface Forecast {
  /** Always present, always labelled. This is not a commitment. */
  is_forecast: true;
  basis: ForecastBasis;
  confidence: ForecastConfidence;
  period_start: string;
  period_end: string;
  days_elapsed: number;
  days_in_period: number;
  collected_kobo: string;
  projected_kobo: string;
  /**
   * The share of a comparable period usually collected by this point, as basis
   * points. Null when there was not enough history to compute one, which is
   * exactly when `basis` is RUN_RATE.
   */
  seasonal_share_bp: number | null;
  comparable_periods: number;
  target_kobo: string | null;
  projected_achievement_bp: number | null;
  explanation_key: string;
}

/**
 * What this month is likely to end at, and what that estimate rests on.
 *
 * Steps, in order, because each one can fail into the next:
 *
 *   1. Collect what this period has taken so far.
 *   2. Look at the same calendar period in previous years and ask what share of
 *      each had been collected by the same day-of-period. Median of those, not
 *      mean — one anomalous year (a levy amnesty, a lockdown) drags a mean and
 *      barely moves a median.
 *   3. Project: collected ÷ share.
 *   4. With fewer than two comparable periods, skip the share and use a straight
 *      run rate, and say so.
 *
 * The seasonal step is what stops this being useless. A straight-line projection
 * on the 10th of a month, where collection clusters around demand notices and
 * again at the deadline, is wrong by a wide margin in a predictable direction —
 * and a forecast that is predictably wrong is worse than none, because somebody
 * will plan against it.
 */
export async function forecast(
  db: Db,
  params: {
    periodStart: Date;
    periodEnd: Date;
    lgaId?: string | null;
    categoryId?: string | null;
    revenueItemId?: string | null;
  },
  scope: ReportScope = { kind: 'STATEWIDE' },
): Promise<Forecast> {
  const { statewide, territoryIds } = scopeParams(scope);
  const filters = [
    params.lgaId ?? null,
    params.categoryId ?? null,
    params.revenueItemId ?? null,
  ];

  const day = 86_400_000;
  const daysInPeriod =
    Math.round((params.periodEnd.getTime() - params.periodStart.getTime()) / day) + 1;
  const daysElapsed = Math.max(
    0,
    Math.min(
      daysInPeriod,
      Math.round((Date.now() - params.periodStart.getTime()) / day) + 1,
    ),
  );

  const collected = await collectedBetween(db, params.periodStart, params.periodEnd, filters, {
    statewide,
    territoryIds,
  });

  /*
   * A period that has not started, or has finished.
   *
   * Neither is a forecast: one has nothing to extrapolate from and the other
   * has an answer already. Returning the actual with a HIGH confidence and the
   * elapsed days equal to the period says exactly that, and saves every caller
   * a special case.
   */
  if (daysElapsed >= daysInPeriod || daysElapsed <= 0) {
    return withTarget(db, params, {
      is_forecast: true,
      basis: daysElapsed <= 0 ? 'INSUFFICIENT_HISTORY' : 'RUN_RATE',
      confidence: daysElapsed >= daysInPeriod ? 'HIGH' : 'LOW',
      period_start: iso(params.periodStart),
      period_end: iso(params.periodEnd),
      days_elapsed: daysElapsed,
      days_in_period: daysInPeriod,
      collected_kobo: collected.toString(),
      projected_kobo: collected.toString(),
      seasonal_share_bp: null,
      comparable_periods: 0,
      target_kobo: null,
      projected_achievement_bp: null,
      explanation_key:
        daysElapsed <= 0 ? 'forecastNotStarted' : 'forecastPeriodComplete',
    });
  }

  // Step 2: the same calendar period in each of the last three years.
  const shares: number[] = [];
  for (let yearsBack = 1; yearsBack <= 3; yearsBack += 1) {
    const start = shiftYears(params.periodStart, -yearsBack);
    const end = shiftYears(params.periodEnd, -yearsBack);
    const partialEnd = new Date(start.getTime() + (daysElapsed - 1) * day);

    const whole = await collectedBetween(db, start, end, filters, { statewide, territoryIds });
    if (whole <= 0n) continue;
    const sofar = await collectedBetween(db, start, partialEnd, filters, {
      statewide,
      territoryIds,
    });
    // Basis points, so the share stays an integer and never a float that
    // rounds two callers to different answers.
    shares.push(Number((sofar * 10_000n) / whole));
  }

  if (shares.length < 2) {
    // Run rate, and honest about it.
    const projected = (collected * BigInt(daysInPeriod)) / BigInt(daysElapsed);
    return withTarget(db, params, {
      is_forecast: true,
      basis: 'RUN_RATE',
      confidence: 'LOW',
      period_start: iso(params.periodStart),
      period_end: iso(params.periodEnd),
      days_elapsed: daysElapsed,
      days_in_period: daysInPeriod,
      collected_kobo: collected.toString(),
      projected_kobo: projected.toString(),
      seasonal_share_bp: null,
      comparable_periods: shares.length,
      target_kobo: null,
      projected_achievement_bp: null,
      explanation_key: 'forecastRunRate',
    });
  }

  const share = median(shares);
  /*
   * A share at or near zero would divide the projection into the billions.
   *
   * It means the comparable periods collected almost nothing by this point,
   * which is a real pattern for an annual levy due in December — and it makes
   * the seasonal method useless rather than merely uncertain, because a small
   * numerator over a tiny denominator is noise multiplied. Below 5% the run
   * rate is the honest fallback.
   */
  if (share < 500) {
    const projected = (collected * BigInt(daysInPeriod)) / BigInt(daysElapsed);
    return withTarget(db, params, {
      is_forecast: true,
      basis: 'RUN_RATE',
      confidence: 'LOW',
      period_start: iso(params.periodStart),
      period_end: iso(params.periodEnd),
      days_elapsed: daysElapsed,
      days_in_period: daysInPeriod,
      collected_kobo: collected.toString(),
      projected_kobo: projected.toString(),
      seasonal_share_bp: share,
      comparable_periods: shares.length,
      target_kobo: null,
      projected_achievement_bp: null,
      explanation_key: 'forecastTooEarlyInCurve',
    });
  }

  const projected = (collected * 10_000n) / BigInt(share);
  return withTarget(db, params, {
    is_forecast: true,
    basis: 'SEASONAL',
    // Three comparable years and past the quarter mark is as confident as this
    // method gets; anything less is MEDIUM.
    confidence: shares.length >= 3 && daysElapsed * 4 >= daysInPeriod ? 'HIGH' : 'MEDIUM',
    period_start: iso(params.periodStart),
    period_end: iso(params.periodEnd),
    days_elapsed: daysElapsed,
    days_in_period: daysInPeriod,
    collected_kobo: collected.toString(),
    projected_kobo: projected.toString(),
    seasonal_share_bp: share,
    comparable_periods: shares.length,
    target_kobo: null,
    projected_achievement_bp: null,
    explanation_key: 'forecastSeasonal',
  });
}

/** Attach the target for the same period and scope, where one has been set. */
async function withTarget(
  db: Db,
  params: {
    periodStart: Date;
    periodEnd: Date;
    lgaId?: string | null;
    categoryId?: string | null;
    revenueItemId?: string | null;
  },
  result: Forecast,
): Promise<Forecast> {
  const target = await queryOne<{ amount_kobo: string }>(
    db,
    `SELECT amount_kobo FROM revenue_targets
      WHERE status = 'ACTIVE'
        AND period_start = $1 AND period_end = $2
        AND lga_id IS NOT DISTINCT FROM $3
        AND category_id IS NOT DISTINCT FROM $4
        AND revenue_item_id IS NOT DISTINCT FROM $5
        AND agent_id IS NULL
      LIMIT 1`,
    [
      params.periodStart,
      params.periodEnd,
      params.lgaId ?? null,
      params.categoryId ?? null,
      params.revenueItemId ?? null,
    ],
  );
  if (!target) return result;

  const targetKobo = BigInt(target.amount_kobo);
  return {
    ...result,
    target_kobo: target.amount_kobo,
    projected_achievement_bp:
      targetKobo > 0n ? Number((BigInt(result.projected_kobo) * 10_000n) / targetKobo) : null,
  };
}

async function collectedBetween(
  db: Db,
  from: Date,
  to: Date,
  filters: (string | null)[],
  scope: { statewide: boolean; territoryIds: string[] },
): Promise<bigint> {
  const row = await queryOne<{ total: string }>(
    db,
    `SELECT COALESCE(SUM(t.amount_kobo), 0)::text AS total
       FROM transactions t
       JOIN revenue_items ri ON ri.id = t.revenue_item_id
      WHERE t.status IN ${REVENUE_STATES}
        AND t.created_at::date BETWEEN $1 AND $2
        AND ($3::uuid IS NULL OR t.lga_id = $3)
        AND ($4::uuid IS NULL OR ri.category_id = $4)
        AND ($5::uuid IS NULL OR t.revenue_item_id = $5)
        AND ${transactionScopeSql('t', 6, 7)}`,
    [from, to, filters[0], filters[1], filters[2], scope.statewide, scope.territoryIds],
  );
  return BigInt(row?.total ?? '0');
}

/**
 * Median, not mean.
 *
 * One anomalous year — an amnesty, a lockdown, a levy introduced mid-year —
 * drags a mean a long way and moves a median hardly at all. With three
 * observations that difference is the whole quality of the estimate.
 */
function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
}

const iso = (date: Date) => date.toISOString().slice(0, 10);

/**
 * The same calendar dates, N years earlier.
 *
 * Built from the UTC parts rather than by subtracting milliseconds, so a leap
 * year does not shift the window by a day — which over three comparisons is
 * enough to move a month boundary and compare March against late February.
 */
function shiftYears(date: Date, years: number): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear() + years, date.getUTCMonth(), date.getUTCDate()),
  );
}

function startOfYear(): Date {
  return new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1));
}

function endOfYear(): Date {
  return new Date(Date.UTC(new Date().getUTCFullYear(), 11, 31));
}

/**
 * The calendar period a label names, resolved on the server.
 *
 * A client computing "this month" from its own clock is a client that can be
 * wrong about it — a handset with a bad clock, a browser in another timezone —
 * and a target set against the wrong dates is silently wrong for a month.
 */
export function resolvePeriod(
  kind: TargetPeriod,
  anchor: Date = new Date(),
): { start: Date; end: Date } {
  const year = anchor.getUTCFullYear();
  const month = anchor.getUTCMonth();
  const date = anchor.getUTCDate();

  switch (kind) {
    case 'DAILY':
      return { start: new Date(Date.UTC(year, month, date)), end: new Date(Date.UTC(year, month, date)) };
    case 'WEEKLY': {
      // Monday-based, which is how a Nigerian collection week is counted.
      const weekday = (anchor.getUTCDay() + 6) % 7;
      const start = new Date(Date.UTC(year, month, date - weekday));
      return { start, end: new Date(start.getTime() + 6 * 86_400_000) };
    }
    case 'MONTHLY':
      return { start: new Date(Date.UTC(year, month, 1)), end: new Date(Date.UTC(year, month + 1, 0)) };
    case 'QUARTERLY': {
      const quarter = Math.floor(month / 3) * 3;
      return {
        start: new Date(Date.UTC(year, quarter, 1)),
        end: new Date(Date.UTC(year, quarter + 3, 0)),
      };
    }
    case 'ANNUAL':
      return { start: new Date(Date.UTC(year, 0, 1)), end: new Date(Date.UTC(year, 11, 31)) };
  }
}
