-- ---------------------------------------------------------------------------
-- 021: a date of birth must describe a living person
-- ---------------------------------------------------------------------------
-- `date_of_birth` was a bare DATE on both taxpayers and agents, and the
-- request schemas above it checked only that the string looked like a date.
-- A slipped year therefore passed every layer: an agent could register a
-- taxpayer born in 2099 and the row would be accepted.
--
-- This matters beyond tidiness. Date of birth is one of the fields the
-- duplicate-detection weighting compares when deciding whether two
-- registrations are the same person, and it is printed on the taxpayer's
-- identity card. A row nobody can be born into corrupts both, and neither the
-- form nor the API would have stopped it.
--
-- The rule is deliberately narrow. It refuses only dates that cannot describe
-- a person alive today, and takes no view on how old a taxpayer must be to be
-- registered — the platform has no such policy, and inventing one here would
-- refuse rows the law allows.
--
-- CURRENT_DATE is not immutable, which is normally a reason to keep it out of
-- a CHECK. It is safe here because the bound only ever moves forward: a birth
-- date accepted today is still in the past tomorrow, so a dump taken now
-- restores cleanly against any later date. The reverse — a fixed upper bound
-- that goes stale — would not.
--
-- WHY THE CONSTRAINTS ARE LEFT NOT VALID. A NOT VALID check still binds every
-- INSERT and UPDATE from here on, which is the defect being fixed; what it
-- skips is the scan of rows that already exist. That distinction matters at
-- deployment. These tables will be populated from legacy PSIRS records whose
-- birth dates nobody has audited, and a VALIDATE that trips over one of them
-- fails the migration and blocks the release — trading a data-quality problem
-- for an outage. Instead the migration counts the unusable rows and says so,
-- so the operator learns the number without the deploy depending on it.
-- Once those rows are corrected, `ALTER TABLE ... VALIDATE CONSTRAINT` can be
-- run at leisure; it takes only a SHARE UPDATE EXCLUSIVE lock and needs no
-- further migration.

ALTER TABLE taxpayers
  ADD CONSTRAINT taxpayers_birth_date_recordable
  CHECK (
    date_of_birth IS NULL
    OR (date_of_birth <= CURRENT_DATE AND date_of_birth >= DATE '1900-01-01')
  ) NOT VALID;

ALTER TABLE agents
  ADD CONSTRAINT agents_birth_date_recordable
  CHECK (
    date_of_birth IS NULL
    OR (date_of_birth <= CURRENT_DATE AND date_of_birth >= DATE '1900-01-01')
  ) NOT VALID;

DO $$
DECLARE
  bad_taxpayers BIGINT;
  bad_agents BIGINT;
BEGIN
  SELECT count(*) INTO bad_taxpayers FROM taxpayers
   WHERE date_of_birth IS NOT NULL
     AND (date_of_birth > CURRENT_DATE OR date_of_birth < DATE '1900-01-01');
  SELECT count(*) INTO bad_agents FROM agents
   WHERE date_of_birth IS NOT NULL
     AND (date_of_birth > CURRENT_DATE OR date_of_birth < DATE '1900-01-01');

  IF bad_taxpayers = 0 AND bad_agents = 0 THEN
    -- Nothing to correct, so the constraints can be trusted for the whole
    -- table straight away.
    ALTER TABLE taxpayers VALIDATE CONSTRAINT taxpayers_birth_date_recordable;
    ALTER TABLE agents VALIDATE CONSTRAINT agents_birth_date_recordable;
    RAISE NOTICE 'birth dates: every existing row is recordable; both constraints validated';
  ELSE
    RAISE WARNING 'birth dates: % taxpayer row(s) and % agent row(s) hold a date nobody can be born on. New writes are already refused. Correct those rows, then run: ALTER TABLE taxpayers VALIDATE CONSTRAINT taxpayers_birth_date_recordable; ALTER TABLE agents VALIDATE CONSTRAINT agents_birth_date_recordable;',
      bad_taxpayers, bad_agents;
  END IF;
END $$;
