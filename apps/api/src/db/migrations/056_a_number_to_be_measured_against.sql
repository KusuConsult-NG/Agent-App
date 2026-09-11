-- Revenue targets, so a figure can be judged rather than merely read.
--
-- Every revenue number this platform produces answers "how much came in". None
-- of them answers "is that enough", because nothing anywhere in the schema said
-- what enough was. That single absence is why nine separate items on the
-- officer readiness assessment read Missing: target, achievement, gap, growth
-- against plan, declining categories, category targets, forecast-versus-target,
-- and the whole of revenue target management. They are not nine features. They
-- are one table and the arithmetic that follows from it.
--
-- A revenue officer planning a quarter currently exports last quarter to a
-- spreadsheet, types a target beside it, and keeps the spreadsheet. The
-- platform then reports actuals that nobody can reconcile with the plan without
-- the spreadsheet, and when the officer transfers, the plan leaves with them.
--
-- WHAT A TARGET IS SET AGAINST
--
-- Five scopes, and they are deliberately not a hierarchy the database enforces:
--
--   STATE     the whole of Plateau State
--   LGA       one Local Government Area
--   CATEGORY  one revenue category, statewide or within one LGA
--   ITEM      one revenue item, at the same two levels
--   AGENT     one agent's own collection target
--
-- PSIRS sets a state target and apportions it downwards, and the apportionment
-- is a management decision rather than an arithmetic one: the sum of the LGA
-- targets is usually *not* the state target, because the state figure carries
-- headroom. A constraint requiring them to agree would be wrong about how the
-- Service actually plans, so there is none. `targetRollup` in the service
-- reports both figures and the difference, which is the thing an officer wants
-- to see anyway.
--
-- WHY PERIODS ARE STORED AS DATES AND NOT AS A LABEL
--
-- "Q1 2026" is four different date ranges depending on whether the fiscal year
-- starts in January. Storing `period_start` and `period_end` means a target can
-- be compared against actuals with the same BETWEEN every other query in this
-- module uses, and `period_kind` is a label for grouping rather than the
-- authority on what the period is.

BEGIN;

CREATE TABLE revenue_targets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  scope           TEXT NOT NULL CHECK (scope IN ('STATE', 'LGA', 'CATEGORY', 'ITEM', 'AGENT')),

  -- Which one, for the scopes that name something. All nullable, and the
  -- constraint below is what makes each scope carry exactly what it needs.
  lga_id          UUID REFERENCES lgas(id),
  category_id     UUID REFERENCES revenue_categories(id),
  revenue_item_id UUID REFERENCES revenue_items(id),
  agent_id        UUID REFERENCES agents(id),

  period_kind     TEXT NOT NULL
                    CHECK (period_kind IN ('DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL')),
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,

  amount_kobo     BIGINT NOT NULL CHECK (amount_kobo > 0),

  note            TEXT,
  status          TEXT NOT NULL DEFAULT 'ACTIVE'
                    CHECK (status IN ('ACTIVE', 'SUPERSEDED', 'WITHDRAWN')),

  set_by          UUID NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT target_period_ordered CHECK (period_end >= period_start),

  /*
   * Each scope carries exactly the identifiers it means, and no others.
   *
   * Without this, a row can say scope STATE and name an LGA, and every query
   * that filters on scope then disagrees with every query that filters on
   * lga_id. A CATEGORY or ITEM target may *additionally* name an LGA, because
   * "Market Levy in Jos North" is a real and common target; a STATE target may
   * name nothing; an AGENT target names only the agent.
   */
  CONSTRAINT target_scope_is_coherent CHECK (
    CASE scope
      WHEN 'STATE'    THEN lga_id IS NULL AND category_id IS NULL
                       AND revenue_item_id IS NULL AND agent_id IS NULL
      WHEN 'LGA'      THEN lga_id IS NOT NULL AND category_id IS NULL
                       AND revenue_item_id IS NULL AND agent_id IS NULL
      WHEN 'CATEGORY' THEN category_id IS NOT NULL
                       AND revenue_item_id IS NULL AND agent_id IS NULL
      WHEN 'ITEM'     THEN revenue_item_id IS NOT NULL
                       AND category_id IS NULL AND agent_id IS NULL
      WHEN 'AGENT'    THEN agent_id IS NOT NULL AND lga_id IS NULL
                       AND category_id IS NULL AND revenue_item_id IS NULL
    END
  )
);

/*
 * One live target per thing per period.
 *
 * Two active targets for Jos North in March is not a disagreement the platform
 * can resolve — every achievement percentage would depend on which row the
 * query happened to read first. Revising a target supersedes the old row rather
 * than adding a second, which also leaves the original readable: an auditor
 * asking whether a target was lowered after the quarter went badly needs the
 * figure that was lowered.
 *
 * `COALESCE` on the nullable identifiers because NULL is not equal to NULL in a
 * unique index, so without it two STATE targets for the same month would both
 * be accepted.
 */
CREATE UNIQUE INDEX revenue_targets_one_live_per_scope
  ON revenue_targets (
    scope,
    COALESCE(lga_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(category_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(revenue_item_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(agent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    period_kind, period_start, period_end
  )
  WHERE status = 'ACTIVE';

CREATE INDEX revenue_targets_period_idx ON revenue_targets (period_start, period_end)
  WHERE status = 'ACTIVE';
CREATE INDEX revenue_targets_lga_idx ON revenue_targets (lga_id) WHERE lga_id IS NOT NULL;

/*
 * A target is superseded or withdrawn, never deleted.
 *
 * The same standard the case history is held to, and for the same reason: what
 * the target was before somebody changed it is the question an auditor asks
 * about a target, and a DELETE is the one answer nobody can reconstruct.
 */
CREATE OR REPLACE FUNCTION revenue_targets_are_not_deleted() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'a revenue target is superseded or withdrawn, never deleted (%)', OLD.id
    USING HINT = 'Set status to SUPERSEDED or WITHDRAWN.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS revenue_targets_no_delete ON revenue_targets;
CREATE TRIGGER revenue_targets_no_delete
  BEFORE DELETE ON revenue_targets
  FOR EACH ROW EXECUTE FUNCTION revenue_targets_are_not_deleted();

COMMIT;
