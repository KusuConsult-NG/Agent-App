-- ---------------------------------------------------------------------------
-- One identity number, one live record — said by the database rather than only
-- by the code that lost the race.
--
-- PRD §68 names this as a fraud vector in so many words: "Create duplicate
-- taxpayers for commission purposes." The platform's answer is
-- `findPotentialDuplicates`, where an identity-number match scores 100, and a
-- score of 100 is decisive — refused outright rather than warned about. One
-- human being gets one record, and nobody is paid twice for finding them.
--
-- That check runs OUTSIDE the registration transaction, deliberately, and the
-- comment above it says why: a blocked attempt aborts the transaction, so
-- journalling the check inside it would roll the evidence back with it, and a
-- pattern of repeated blocked attempts is exactly what fraud review needs to
-- see. So the check takes no lock, and the row it is looking for does not
-- exist yet. Two agents registering one person both find nothing and both
-- insert.
--
-- WHY NOTHING ELSE WAS CATCHING IT
--
-- `taxpayers.tin` is UNIQUE, which is the near miss. The TIN service derives a
-- number from the applicant's type, name and PHONE — so one person submitted
-- with two phone numbers is given two TINs and the unique column never sees
-- the collision. `identity_hash` had a plain partial index (002) and `phone` a
-- plain index. Nothing in the schema said that one identity number belongs to
-- one record.
--
-- Two phone numbers for one NIN is not an accident. It is what an agent paid
-- per registration would send, and `one-person-two-records.test.ts` shows the
-- result: two rows, two TINs, and `duplicatesConsidered: []` on both, because
-- neither attempt could see the other.
--
-- A TIN is UNIQUE and a taxpayer row cannot be deleted — `taxpayers_no_delete`
-- sees to that — so two TINs for one person is permanent.
--
-- THE PREDICATE IS THE APPLICATION'S OWN, COPIED
--
-- `findPotentialDuplicates` reads `WHERE status IN ('ACTIVE', 'DRAFT')`, so a
-- record that has been closed, suspended or merged is not somebody's identity
-- as far as registration is concerned, and registering them again is allowed.
-- A unique index over every row would refuse that, which takes registration
-- away from somebody whose old record was closed — a different rule from the
-- one the platform has, imposed by a migration.
--
-- So the index carries the same predicate. What it writes down is the decision
-- already being made, not a new one.
--
-- DRAFT IS IN THE PREDICATE AND NO ROW IS EVER DRAFT. `enum-coverage.ts`
-- declares `taxpayers.status: DRAFT` unreachable — "Registration is a single
-- act; an unsent capture waits in offline_drafts, not as a partial record" —
-- so a reader looking for those rows will not find any. It is here because
-- `findPotentialDuplicates` reads it, and because the day something does write
-- a DRAFT taxpayer, the index that includes it is the one that still prevents
-- two live records for one person. Copying the control's predicate is cheaper
-- than remembering to widen this later.
--
-- WHY THIS REFUSES TO RUN RATHER THAN TIDYING UP
--
-- A unique index cannot be created over rows that already violate it, and
-- every automatic fix here is worse than stopping. Closing one of two records
-- ends a real person's registration on a guess about which is the duplicate.
-- Merging them moves assessments, invoices and payments between taxpayers.
-- Keeping the earliest assumes the later one holds nothing the earlier does
-- not, and the phone, address and ward columns are exactly where it might.
--
-- A duplicate taxpayer is also evidence. `taxpayer_duplicate_checks` records
-- who registered what and whether they overrode a warning, and resolving the
-- rows quietly in a migration is the one action that would make a commission
-- fraud harder to see rather than easier.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  clashing TEXT;
BEGIN
  SELECT string_agg(identity_hash, ', ')
    INTO clashing
    FROM (
      SELECT identity_hash
        FROM taxpayers
       WHERE identity_hash IS NOT NULL
         AND status IN ('ACTIVE', 'DRAFT')
       GROUP BY identity_hash
      HAVING count(*) > 1
    ) AS duplicated;

  IF clashing IS NOT NULL THEN
    RAISE EXCEPTION
      'More than one live taxpayer carries each of these identity hashes: %. '
      'Each set is one person registered twice, which has to be resolved — '
      'merged, or one of them closed — before this index can be created. '
      'Which record is the duplicate is a decision about somebody''s '
      'registration and a commission that may have been paid on it, and a '
      'migration is not the place it gets made silently.',
      clashing;
  END IF;
END $$;

-- The hash, not the number: 002 stores identification numbers as salted
-- hashes plus a masked display form precisely so the platform can
-- de-duplicate on an identifier without holding a reusable copy of it
-- (PRD §62). Uniqueness over the hash is uniqueness over the number.
CREATE UNIQUE INDEX idx_taxpayers_identity_live
  ON taxpayers (identity_hash)
  WHERE identity_hash IS NOT NULL AND status IN ('ACTIVE', 'DRAFT');

-- `idx_taxpayers_identity` from 002 stays, and it is close to redundant: both
-- queries that read this column filter to statuses the partial index above
-- covers — `findPotentialDuplicates` to ACTIVE and DRAFT, and
-- `changeTaxpayerIdentity` to ACTIVE — so the planner can use the new index
-- for either. (The referee identity checks are on `referee_kyc`, a different
-- table.) What the old index still covers is a lookup of a closed, suspended
-- or merged record's identity, and nothing performs one today.
--
-- It stays anyway. Dropping it buys write speed on registration that nobody
-- has measured, and costs a sequential scan the first time somebody does need
-- to find a closed record by its identity. That trade is a decision about
-- indexes and this migration is about a fraud control; a redundant index is
-- also far easier to notice later than a missing one.
