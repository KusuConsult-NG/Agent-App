-- =============================================================================
-- The band the handset showed, beside the band the platform reached.
--
-- The agent's phone now works out a size at the stall, so a trader who asks
-- what has been written about them gets an answer with no signal and no wait.
-- It runs the same function the platform runs — one implementation in
-- @psirs/shared, imported by both — so in the ordinary case the two agree by
-- construction rather than by anybody remembering to keep them in step.
--
-- They can still differ, in exactly two ways, and both matter:
--
--   * The handset is running an old build. Agents update when they have signal
--     and a charger, which in Wase is not every week.
--   * The rule changed between capture and sync. An observation queued on
--     Tuesday and delivered on Friday is banded by Friday's rule.
--
-- In both cases somebody was told one thing at a stall and will read another
-- on a notice. That is a real event with a real complaint attached, and the
-- platform should be able to answer it rather than discover it. So the
-- handset's answer is kept: `band_at_capture` is what the agent was shown,
-- and the band the platform concludes from the facts is what stands.
--
-- Nullable, because most observations do not come from a handset at all — an
-- officer recording a market visit in the portal has nothing to record here.
-- =============================================================================

ALTER TABLE presumptive_observations
  ADD COLUMN IF NOT EXISTS band_at_capture TEXT
    CHECK (band_at_capture IS NULL OR band_at_capture IN ('MICRO', 'SMALL', 'MEDIUM'));

COMMENT ON COLUMN presumptive_observations.band_at_capture IS
  'The band the capturing handset showed the agent, when one did. The band '
  'that stands is concluded from the facts on this row; this exists so a '
  'taxpayer told one size at a stall and sent another by notice can be '
  'answered rather than argued with.';

/*
 * Immutable, like every other claim on this row.
 *
 * What an agent was told on a particular afternoon is a fact about that
 * afternoon. Editing it later would turn the one record of a mis-told band
 * into a record of somebody having tidied up.
 */
DROP TRIGGER IF EXISTS trg_observation_band_at_capture_immutable ON presumptive_observations;
CREATE TRIGGER trg_observation_band_at_capture_immutable
  BEFORE UPDATE ON presumptive_observations
  FOR EACH ROW EXECUTE FUNCTION prevent_column_mutation('band_at_capture');
