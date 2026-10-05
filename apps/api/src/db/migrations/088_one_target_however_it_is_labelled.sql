-- ---------------------------------------------------------------------------
-- One live target per thing per period, whatever the period is called.
--
-- Migration 056 set out to make two live targets impossible and said exactly
-- what the second one costs:
--
--     Two active targets for Jos North in March is not a disagreement the
--     platform can resolve — every achievement percentage would depend on
--     which row the query happened to read first.
--
-- `revenue_targets_one_live_per_scope` keyed that on `period_kind` alongside
-- the dates. Nothing that reads a target filters on `period_kind`:
--
--   `withTarget`    SELECT amount_kobo ... period_start = $1 AND period_end = $2
--                   ... LIMIT 1   — the forecast's target, and no ORDER BY
--   `targetRollup`  count(*) and SUM(amount_kobo) over the same columns
--                   — one LGA counted twice, and two figures added together
--
-- So a MONTHLY target for 1–31 March and a QUARTERLY one for 1–31 March are
-- two rows the index allows and every reader treats as one. The forecast then
-- names whichever Postgres handed back first, the rollup names their sum and
-- reports one LGA as two, and nothing anywhere says the figure was a choice.
-- That is the disagreement 056 was written to prevent, reached through the
-- index written to prevent it.
--
-- WHY THE DATES ARE THE PERIOD AND THE LABEL IS NOT
--
-- 056's own header: "`period_kind` is a label for grouping rather than the
-- authority on what the period is." The route takes `periodKind`,
-- `periodStart` and `periodEnd` as three independent fields and nothing
-- checks the first against the other two, deliberately — a fiscal year that
-- does not start in January makes "Q1" four different date ranges. The
-- consequence is that where two rows carry the same scope and the same dates,
-- one of the two labels is simply wrong, and there is no reading under which
-- both figures are the target. Nothing is being collapsed here that a
-- constraint should have been keeping apart.
--
-- The column stays: `listTargets` filters on it and the audit workbench
-- reports it, which is what a label is for.
--
-- WHY THIS REFUSES TO RUN RATHER THAN CHOOSING
--
-- A unique index cannot be created over rows that already violate it, and
-- picking which of two live figures is the target for a period is a decision
-- about what a service committed to collect. Superseding the later row says a
-- revision was made that nobody made; superseding the earlier one assumes the
-- second was the correction rather than the mistake. Either way an
-- achievement percentage somebody has already reported upwards changes
-- underneath them, so this stops and names the groups instead.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  clashing INTEGER;
BEGIN
  SELECT count(*)
    INTO clashing
    FROM (
      SELECT 1
        FROM revenue_targets
       WHERE status = 'ACTIVE'
       GROUP BY scope,
                COALESCE(lga_id, '00000000-0000-0000-0000-000000000000'::uuid),
                COALESCE(category_id, '00000000-0000-0000-0000-000000000000'::uuid),
                COALESCE(revenue_item_id, '00000000-0000-0000-0000-000000000000'::uuid),
                COALESCE(agent_id, '00000000-0000-0000-0000-000000000000'::uuid),
                period_start, period_end
      HAVING count(*) > 1
    ) AS duplicated;

  IF clashing > 0 THEN
    RAISE EXCEPTION
      '% scope/period group(s) hold more than one ACTIVE revenue target, '
      'differing only in period_kind. Supersede or withdraw the wrong label '
      'in each before this index can be narrowed: which of two figures a '
      'period committed to is a decision about what the Service undertook to '
      'collect, and not one a migration may make quietly.',
      clashing;
  END IF;
END $$;

-- Recreated under the same name, so error-handler.ts's sentence for it still
-- reaches an officer who sets a second target for a period.
DROP INDEX IF EXISTS revenue_targets_one_live_per_scope;
CREATE UNIQUE INDEX revenue_targets_one_live_per_scope
  ON revenue_targets (
    scope,
    COALESCE(lga_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(category_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(revenue_item_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(agent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    period_start, period_end
  )
  WHERE status = 'ACTIVE';
