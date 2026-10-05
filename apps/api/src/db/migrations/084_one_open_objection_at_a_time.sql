-- ---------------------------------------------------------------------------
-- The unique index a comment said was already there.
--
-- `raiseObjection` reads for an open objection, refuses with
-- `OBJECTION_ALREADY_OPEN` if it finds one, and inserts if it does not. The
-- comment above that read says:
--
--   One open objection at a time. The unique index refuses the second, but a
--   constraint violation reaches an officer as a failure rather than as the
--   fact that somebody already raised this.
--
-- There is no unique index. Migration 071 created
-- `idx_objections_open (presumptive_assessment_id) WHERE status = 'OPEN'` as a
-- plain index, so nothing at the database refuses the second. The rule lives
-- only in a non-locking read, which two simultaneous submissions both pass —
-- and this repository's own words for that, from migration 080's header, are
-- that "a rule the service enforces and the database does not is one UPDATE
-- away from being undone".
--
-- An open objection suspends enforcement and takes the taxpayer out of
-- arrears. Two of them against one estimate means two officers can each decide
-- a dispute the other is also deciding, and whichever decision lands second
-- overwrites the assessment status the first set.
--
-- WHY THIS REFUSES TO RUN RATHER THAN TIDYING UP
--
-- A unique index cannot be created over rows that already violate it, and the
-- obvious fixes are all worse than stopping. Marking a duplicate UPHELD or
-- REJECTED records a decision nobody made, on somebody's dispute. Deleting one
-- destroys a citizen's objection, which the immutability trigger on this table
-- exists to prevent. Keeping the earliest and discarding the rest assumes the
-- duplicates say the same thing, and the `ground` and `statement` columns are
-- exactly where they might not.
--
-- So this names them and stops. Resolving two open objections against one
-- estimate is a decision about two people's disputes, and a migration is not
-- the place it gets made silently.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  clashing TEXT;
BEGIN
  SELECT string_agg(presumptive_assessment_id::text, ', ')
    INTO clashing
    FROM (
      SELECT presumptive_assessment_id
        FROM assessment_objections
       WHERE status = 'OPEN'
       GROUP BY presumptive_assessment_id
      HAVING count(*) > 1
    ) AS duplicated;

  IF clashing IS NOT NULL THEN
    RAISE EXCEPTION
      'These presumptive assessments have more than one open objection: %. '
      'Each has to be decided before this index can be created, and which of '
      'two disputes is the real one is not a decision a migration may make.',
      clashing;
  END IF;
END $$;

DROP INDEX IF EXISTS idx_objections_open;

-- Partial, as it was: an assessment may be objected to again after the first
-- objection has been decided, which is the point of the `WHERE`.
CREATE UNIQUE INDEX idx_objections_open
  ON assessment_objections (presumptive_assessment_id)
  WHERE status = 'OPEN';
