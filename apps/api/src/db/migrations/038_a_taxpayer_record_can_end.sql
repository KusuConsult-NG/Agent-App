-- A taxpayer record can end.
--
-- `taxpayers.status` has allowed SUSPENDED and CLOSED since the second
-- migration, and nothing could ever write either. A record was created ACTIVE
-- by an agent in the field and stayed that way for ever, so a business that
-- shut two years ago kept accruing assessments and kept being sent reminders,
-- and the person who inherited the phone number kept receiving them.
--
-- As with the three states migration 034 covered, the readers were already
-- built for this and only the writer was missing: `createAssessment` has always
-- refused a taxpayer whose status is not ACTIVE, with its own error code, and
-- that refusal has never once fired.
--
-- WHAT CLOSING IS NOT. It is not forgiveness. An invoice raised before the
-- record closed is still owed, still payable, and still counted in every
-- report of what the State is due — the platform has no write-off path and
-- this deliberately does not become one. What closing stops is the *future*:
-- no new assessment may be raised, and the reminder sweep stops chasing a
-- record nobody is behind any more.
--
-- WHY IT IS REVERSIBLE, WHEN CLOSING A USER ACCOUNT IS NOT. A closed officer
-- account is replaced by making another one. A taxpayer record cannot be
-- replaced: the TIN is UNIQUE, duplicate detection refuses a second record for
-- the same person at the door, and the compliance history that gates fertiliser
-- and seed eligibility lives on the row. Making CLOSED terminal here would mean
-- that closing a record in error forces a duplicate, which is the worse
-- outcome and the thing the rest of this platform works hardest to prevent.

ALTER TABLE taxpayers
  ADD COLUMN status_reason TEXT,
  ADD COLUMN status_changed_at TIMESTAMPTZ,
  ADD COLUMN status_changed_by UUID REFERENCES users(id);

COMMENT ON COLUMN taxpayers.status_reason IS
  'Why the record was suspended or closed — the officer''s words. Shown to the citizen on '
  'their own status page, because a person told the State has no record of them deserves to '
  'know what the State thinks happened.';

-- The queue an officer works: records closed while money was still owed.
--
-- Closing a record with arrears outstanding is allowed, because refusing it
-- would mean a deceased taxpayer's record can never be closed. But it must not
-- be a way to make a debt quietly stop being anybody's job, so the pairing is
-- surfaced rather than prevented, and this index is what makes that queue cheap
-- to ask for.
CREATE INDEX idx_taxpayers_ended ON taxpayers (status_changed_at DESC)
  WHERE status <> 'ACTIVE';
