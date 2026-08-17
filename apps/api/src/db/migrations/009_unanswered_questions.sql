-- =============================================================================
-- 009_unanswered_questions.sql — record why a check has no answer yet
--
-- The TIN service and the bank name-enquiry service can now say they could not
-- be reached, rather than being forced to report a verdict. That is only worth
-- having if the "we could not ask" state is durable and someone can act on it,
-- which is what these columns are for.
--
-- Both existing status columns already have the right *value* to hold an
-- unanswered check — taxpayers.tin_status = 'REQUESTED' and
-- bank_accounts.verification_status = 'PENDING' both mean "still in flight" —
-- so no CHECK constraint is widened here. What was missing is the reason. An
-- officer looking at a pending bank account could not tell whether the bank
-- said something unhelpful or was simply down, and a taxpayer sitting in
-- REQUESTED could not be told apart from one whose registration the TIN service
-- had actually accepted.
--
-- Deliberately NOT added: an UNAVAILABLE value in either CHECK constraint.
-- 'FAILED' must keep meaning "the service considered this and said no". Adding
-- a third state that half the queries would forget to handle is how an
-- unreachable service quietly starts counting as a rejection again.
-- =============================================================================

ALTER TABLE taxpayers
  ADD COLUMN tin_reason TEXT,
  ADD COLUMN tin_attempts INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN taxpayers.tin_reason IS
  'Why this taxpayer has no TIN yet: the TIN service declined, or it could not '
  'be reached. Read with tin_status — REQUESTED plus a reason naming an outage '
  'is work outstanding, not a decision.';

-- The operational question is always "who is still waiting for a TIN", never
-- "list every taxpayer who has one".
CREATE INDEX idx_taxpayers_tin_outstanding
  ON taxpayers(created_at)
  WHERE tin_status IN ('REQUESTED', 'FAILED');

ALTER TABLE bank_accounts
  ADD COLUMN verification_reason TEXT,
  -- What the bank actually returned. Kept whether or not it matched: on a
  -- mismatch it is the evidence for the decision, and the agent needs to see it
  -- to spot a mistyped digit.
  ADD COLUMN verification_resolved_name TEXT,
  ADD COLUMN verification_attempts INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN bank_accounts.verification_reason IS
  'Why the account is not verified: the bank holds no such account, it belongs '
  'to someone else, or the bank could not be reached. With status PENDING this '
  'distinguishes an outage from a check nobody has run.';

CREATE INDEX idx_bank_accounts_unverified
  ON bank_accounts(created_at)
  WHERE verification_status <> 'VERIFIED';
