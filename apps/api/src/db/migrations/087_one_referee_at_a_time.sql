-- ---------------------------------------------------------------------------
-- One referee at a time, said by the database rather than only by a read.
--
-- PRD §29 makes a referee a control: somebody who is not the applicant
-- confirms the applicant's identity, and replacing one is a deliberate act
-- that leaves a record — the previous row is marked REPLACED and linked, not
-- quietly joined by a second invitation.
--
-- `nominateReferee` enforced that by reading `referees` for any row in an
-- active state and refusing `REFEREE_ALREADY_NOMINATED` if it found one. The
-- read takes no lock and the row it looks for does not exist yet, so two
-- nominations submitted together both found nothing and both inserted: two
-- outstanding invitations for one slot, with no replacement recorded against
-- either. `two-referees-one-application.test.ts` shows the count — two active
-- referees for one application.
--
-- WHY THAT MATTERS MORE THAN AN EXTRA ROW
--
-- The check immediately above it in that function is about an applicant
-- answering their own reference, and its comment says what the opening costs:
-- "nominate a referee on the alternate number, and the invitation goes to a
-- handset the applicant is holding, so they answer their own reference." Two
-- invitations in flight is two attempts at clearance from one nomination slot,
-- and whichever clears first satisfies the application. One at a time is what
-- makes the applicant choose.
--
-- Nothing in the schema held it: `referees` carried an index on `agent_id` and
-- an index on `status`, and no uniqueness over the pair. Migration 080's
-- header is the principle this follows — "a rule the service enforces and the
-- database does not is one UPDATE away from being undone".
--
-- THE PREDICATE IS THE SERVICE'S OWN, COPIED
--
-- The five states below are exactly the list `nominateReferee` reads, so this
-- writes down the decision already being made rather than a stricter one.
-- REPLACED, DECLINED, EXPIRED and REJECTED are outside it on purpose: an
-- application whose referee declined must be able to nominate another, which
-- is the whole reason the rule is one ACTIVE referee rather than one referee.
--
-- WHY THIS REFUSES TO RUN RATHER THAN TIDYING UP
--
-- A unique index cannot be created over rows that already violate it, and
-- choosing which of two outstanding invitations to cancel is a decision about
-- whose reference an application rests on. Marking the later one REPLACED
-- records a replacement nobody asked for; marking it DECLINED says a referee
-- refused when they were never asked. Both put a sentence about a real person
-- into a table that fraud review reads.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  clashing TEXT;
BEGIN
  SELECT string_agg(agent_id::text, ', ')
    INTO clashing
    FROM (
      SELECT agent_id
        FROM referees
       WHERE status IN ('INVITED', 'ACCEPTED', 'SUBMITTED', 'UNDER_REVIEW', 'CLEARED')
       GROUP BY agent_id
      HAVING count(*) > 1
    ) AS duplicated;

  IF clashing IS NOT NULL THEN
    RAISE EXCEPTION
      'These applications have more than one active referee: %. Each has to be '
      'resolved before this index can be created, and which invitation an '
      'application rests on is a decision about a real person''s reference '
      'rather than one a migration may make silently.',
      clashing;
  END IF;
END $$;

CREATE UNIQUE INDEX idx_referees_one_active
  ON referees (agent_id)
  WHERE status IN ('INVITED', 'ACCEPTED', 'SUBMITTED', 'UNDER_REVIEW', 'CLEARED');
