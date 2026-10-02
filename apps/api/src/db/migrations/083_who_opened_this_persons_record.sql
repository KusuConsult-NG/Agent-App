-- ---------------------------------------------------------------------------
-- Who opened this person's record.
--
-- The platform has been able to answer "who read this identity document"
-- (kyc_document_access_logs), "who downloaded this receipt"
-- (document_access_logs) and "who ran a coverage query against this citizen,
-- and under what claimed purpose" (taxpayer_connection_access_logs) since
-- each of those features was built. It could not answer the plainest version
-- of the question: who opened the record itself.
--
-- `GET /government/audit/queries/taxpayer-access` is labelled "Who has looked
-- at one taxpayer's record" on the oversight screen, documented in API.md as
-- "All users who accessed taxpayer record X", and cited in the readiness
-- assessment as the evidence that sensitive-data access is logged. It reads
-- `audit_logs` where `entity_type = 'taxpayer'`, and those rows are written
-- only when the record is *changed*: registered, TIN requested, identity
-- corrected, status changed, obligations set. A read writes nothing at all.
--
-- So an officer who opened a neighbour's record — the whole row: date of
-- birth, phone, alternate phone, email, address, occupation, TIN, and fifty
-- assessments, transactions and receipts — read it and closed it appeared
-- nowhere, and the auditor asking who had looked was shown a list of changes
-- under a heading that promised looks.
--
-- Modelled on taxpayer_connection_access_logs, with two differences. There is
-- no `purpose`: the connections graph has two permitted uses and recording
-- which was claimed is what makes that limit checkable, whereas opening a
-- taxpayer's record is ordinary daily work for a revenue officer and demanding
-- a declared purpose for each one would produce a column of whichever value
-- was cheapest to leave selected. And `surface` instead, because what was
-- disclosed differs: the register entry, the payment history, or the
-- obligations are three different amounts of somebody's life.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS taxpayer_record_access_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  taxpayer_id  UUID NOT NULL REFERENCES taxpayers(id),
  accessed_by  UUID REFERENCES users(id),
  -- The role held AT THE TIME, not joined from `users` the way the connection
  -- log does it. An officer who read a record as a revenue officer and is an
  -- auditor by the time the question is asked read it as a revenue officer,
  -- and a log that answers otherwise is answering a different question.
  actor_role   TEXT,
  -- What was actually shown. The register entry is the whole row — date of
  -- birth, phone, alternate phone, email, address, occupation, TIN — plus the
  -- last fifty assessments, transactions and receipts. The payment history is
  -- what they have paid and when. The other two are narrower. They are
  -- different amounts of somebody's life and the log says which was taken.
  surface      TEXT NOT NULL
               CHECK (surface IN ('TAXPAYER_RECORD', 'PAYMENT_HISTORY',
                                  'TAX_OBLIGATIONS', 'INCENTIVE_STANDING')),
  ip_address   INET,
  -- The handset, where there was one. `audit_logs` carries this for a change
  -- and nothing carried it for a read, so "which device has been opening this
  -- person's record" — the question an agent-fraud investigation asks — could
  -- be answered about the records that handset wrote and not the records it
  -- read. Untyped by a foreign key, as `audit_logs.device_id` is: the evidence
  -- must survive a device row being removed.
  device_id    UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_taxpayer_record_access_taxpayer
  ON taxpayer_record_access_logs (taxpayer_id, created_at DESC);

-- The other direction: "what has this officer been looking at", which is how
-- the question usually starts.
CREATE INDEX IF NOT EXISTS idx_taxpayer_record_access_officer
  ON taxpayer_record_access_logs (accessed_by, created_at DESC);

DROP TRIGGER IF EXISTS trg_taxpayer_record_access_no_update ON taxpayer_record_access_logs;
CREATE TRIGGER trg_taxpayer_record_access_no_update
  BEFORE UPDATE ON taxpayer_record_access_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_any_update();

DROP TRIGGER IF EXISTS trg_taxpayer_record_access_no_delete ON taxpayer_record_access_logs;
CREATE TRIGGER trg_taxpayer_record_access_no_delete
  BEFORE DELETE ON taxpayer_record_access_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();
