-- =============================================================================
-- 044: How many obligations the citizen was actually given
-- =============================================================================
--
-- The compliance score is a ratio now: what was paid, over what was asked for.
-- A ratio needs a denominator, and a taxpayer who has been asked for nothing
-- has none.
--
-- Zero assessments and zero paid assessments were previously the same row --
-- score 0 on both the payment and the period components -- so the citizen
-- portal told a trader who registered this morning that their "compliance
-- score needs improvement", about conduct there had not been any of yet.
--
-- Recording what was raised separates the two cases permanently, for every
-- reader of the table rather than only the one screen that noticed.
-- =============================================================================

ALTER TABLE taxpayer_compliance
  ADD COLUMN IF NOT EXISTS assessments_raised INTEGER NOT NULL DEFAULT 0
    CHECK (assessments_raised >= 0);

COMMENT ON COLUMN taxpayer_compliance.assessments_raised IS
  'Obligations ever raised against this taxpayer. Zero means no history rather than total default; the score components are ratios over this.';

-- Existing rows are stale by definition: they hold scores computed on the old
-- volume-based scale. Marking them stale is not possible without a column
-- nobody reads, so they are left to be recomputed on next sync, which every
-- read path already triggers. The default of 0 is honest in the meantime --
-- it says "we have not counted", and NOT_ASSESSED is the safe reading.
