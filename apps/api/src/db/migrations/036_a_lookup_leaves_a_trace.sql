-- A citizen lookup leaves a trace.
--
-- `/citizen?tin=` and `/citizen?phone=` are unauthenticated and answer with a
-- taxpayer's status and what they owe. That is the right design — a citizen
-- should not need an account to ask what the state thinks of them, and the
-- route is careful about what it returns (no identity numbers, no address, no
-- officer notes, and the outstanding figure only on a TIN match).
--
-- What it did not do was leave a record. Receipt verification writes every
-- attempt to `verification_attempts`, including the ones that find nothing,
-- because somebody trying receipt numbers until one answers is the pattern
-- worth seeing. The same argument applies with more force here: a TIN is
-- guessable in a way a receipt number is not, and the answer names a person's
-- liabilities. Ten a minute per IP is a rate limit, not a record.
--
-- Two additions, and the second matters as much as the first.
--
-- TAXPAYER joins the lookup types, so the existing table holds this too and
-- one query answers "what has this address been probing".
--
-- `lookup_value_hashed` marks a row whose value is a one-way hash rather than
-- the thing typed. A receipt number is not personal data and is stored as
-- typed; a TIN or a phone number is, and a log of who asked about whom would
-- be a new place for PII to sit. Hashing keeps repetition visible — the same
-- TIN probed two hundred times is still two hundred identical hashes — while
-- making the log useless to anybody who steals it.

ALTER TABLE verification_attempts DROP CONSTRAINT verification_attempts_lookup_type_check;
ALTER TABLE verification_attempts ADD CONSTRAINT verification_attempts_lookup_type_check
  CHECK (lookup_type IN ('RECEIPT', 'DOCUMENT', 'INVOICE', 'TAXPAYER'));

ALTER TABLE verification_attempts
  ADD COLUMN lookup_value_hashed BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN verification_attempts.lookup_value IS
  'What was typed, or a one-way hash of it when lookup_value_hashed is true.';

-- Finding a spike of misses from one address is the whole point, and the
-- existing index on created_at alone makes that a scan of everything.
CREATE INDEX idx_verification_ip_recent
  ON verification_attempts (ip_address, created_at DESC)
  WHERE ip_address IS NOT NULL;
