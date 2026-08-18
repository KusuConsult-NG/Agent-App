-- Identity document capture: the access log, and the columns capture needs.
--
-- `kyc_documents` has existed since 002 and nothing has ever written to it,
-- because there was no way to get a file into the platform: no upload
-- endpoint, no multipart handling, no capture in the field application. An
-- agent's identity was cleared on the strength of a number alone.
--
-- Two things are added here.
--
-- 1. An access log of its own. `document_access_logs` cannot be reused: its
--    document_id is a foreign key to `documents`, which holds issued receipts
--    and certificates. These are somebody's identity papers — a photograph of
--    a national ID card, or of their face — and who looked at them is a more
--    sensitive question than who downloaded a receipt, not a less sensitive
--    one. NDPR requires that question be answerable.
--
-- 2. The provenance of each file. Whether an image came from the camera in the
--    field or was picked out of a gallery is exactly the difference between a
--    document captured from the person in front of the agent and one that was
--    forwarded, and a reviewer deciding whether to clear an agent should be
--    able to see which they are looking at.

CREATE TABLE kyc_document_access_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id  UUID NOT NULL REFERENCES kyc_documents(id),
  accessed_by  UUID REFERENCES users(id),
  access_type  TEXT NOT NULL CHECK (access_type IN ('UPLOAD', 'VIEW', 'DOWNLOAD', 'REVIEW')),
  ip_address   INET,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_kyc_doc_access_document ON kyc_document_access_logs(document_id, created_at DESC);

-- Append-only, like every other record of who saw what.
CREATE TRIGGER trg_kyc_document_access_logs_no_delete
  BEFORE DELETE ON kyc_document_access_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();

CREATE TRIGGER trg_kyc_document_access_logs_no_update
  BEFORE UPDATE ON kyc_document_access_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_any_update();

ALTER TABLE kyc_documents
  ADD COLUMN capture_source TEXT NOT NULL DEFAULT 'UNKNOWN'
    CHECK (capture_source IN ('CAMERA', 'FILE', 'UNKNOWN')),
  ADD COLUMN uploaded_by UUID REFERENCES users(id),
  ADD COLUMN original_filename TEXT,
  -- Recapturing a document supersedes the previous one rather than replacing
  -- it, exactly as agent_kyc already does for verification attempts: what a
  -- reviewer cleared has to stay readable afterwards.
  ADD COLUMN superseded_at TIMESTAMPTZ;

CREATE INDEX idx_kyc_docs_current ON kyc_documents(agent_id, document_type)
  WHERE superseded_at IS NULL;

COMMENT ON COLUMN kyc_documents.capture_source IS
  'CAMERA when taken in the field at capture time, FILE when chosen from the device.';

-- The stored bytes are evidence. Replacing them would leave a cleared identity
-- resting on a file nobody reviewed, so a new capture supersedes rather than
-- overwrites — the same rule agent_kyc already follows for attempts.
CREATE TRIGGER trg_kyc_documents_immutable_bytes
  BEFORE UPDATE ON kyc_documents
  FOR EACH ROW EXECUTE FUNCTION prevent_column_mutation('storage_reference', 'checksum', 'byte_size');
