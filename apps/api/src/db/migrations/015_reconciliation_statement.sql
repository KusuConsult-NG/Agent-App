-- Reconciliation could not tell an outage from an empty gateway.
--
-- `runReconciliation` asks the gateway for its account of a period, then reads
-- any payment the statement does not mention as money the gateway has no
-- record of:
--
--     if (!line) {
--       if (['SUCCESSFUL','VERIFIED'].includes(payment.payment_status)) {
--         status = 'MISSING_PAYMENT';
--
-- The Remita adapter's fetchStatement returned a bare `[]`. Not as a stub that
-- would obviously fail — as a value that flows straight through the matching
-- loop and turns every successful payment in the window into an exception
-- reading "Platform records a successful payment the gateway has no record
-- of". The first production run would have accused the entire day's takings at
-- once, and an exception queue that is wrong about everything trains a finance
-- officer to close it without reading.
--
-- This is the one control that proves government actually received the money,
-- rather than the platform believing it did, so it is exactly the wrong place
-- to guess. `gateway_statement_lines` — the table built to hold the evidence a
-- dispute would be re-argued from — was never written by any code at all.
--
-- Two states were missing, both of them the difference between a finding and
-- an absence of one:
--
--   * ABORTED, on a run: the statement could not be retrieved, so nothing was
--     compared and nothing is claimed. A run that records zero exceptions
--     because it never looked must not be indistinguishable from a clean one.
--
--   * UNCHECKED, on a record: this reference was not in the statement because
--     the gateway could not be asked about it. That is not a discrepancy. It
--     is an unanswered question, and it stays visible as one until answered.

ALTER TABLE reconciliation_records DROP CONSTRAINT reconciliation_records_status_check;
ALTER TABLE reconciliation_records ADD CONSTRAINT reconciliation_records_status_check
  CHECK (status IN (
    'PENDING', 'MATCHED', 'MISSING_PAYMENT', 'MISSING_PLATFORM_TRANSACTION',
    'AMOUNT_MISMATCH', 'DUPLICATE_PAYMENT', 'REVERSED',
    'PENDING_SETTLEMENT', 'RESOLVED', 'UNCHECKED'));

COMMENT ON COLUMN reconciliation_records.status IS
  'UNCHECKED means the gateway could not be asked about this reference on this '
  'run. It is never an exception: we did not ask, which is not the same as '
  'being told there is no record.';

ALTER TABLE reconciliation_runs DROP CONSTRAINT reconciliation_runs_status_check;
ALTER TABLE reconciliation_runs ADD CONSTRAINT reconciliation_runs_status_check
  CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED', 'ABORTED'));

ALTER TABLE reconciliation_runs
  -- How the gateway's account was obtained: a bulk statement, or one status
  -- query per reference. An auditor reading a run needs to know which.
  ADD COLUMN statement_source TEXT,
  ADD COLUMN statement_line_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN unchecked_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN abort_reason TEXT;

COMMENT ON COLUMN reconciliation_runs.status IS
  'ABORTED means the gateway statement could not be retrieved, so no comparison '
  'was made. Zero exceptions on an ABORTED run means nothing was checked, not '
  'that everything matched.';

-- A run that was scheduled rather than requested has no user behind it, so
-- started_by is null. This is how the sweep finds its own last successful run.
CREATE INDEX idx_recon_runs_completed ON reconciliation_runs(completed_at DESC)
  WHERE status = 'COMPLETED';
