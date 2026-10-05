-- =============================================================================
-- 100: One current capture of each identity document
-- =============================================================================
--
-- An applicant's or referee's document is never replaced, only superseded, so
-- a cleared identity can be traced to the exact file a reviewer saw. Two
-- captures of the same document type arriving together both superseded the
-- same row and both inserted, leaving two "current" captures for the reviewer
-- to choose between. The service now takes a lock per owner and document type;
-- this makes one current capture per type a rule the database holds.
--
-- Any duplicates already present are resolved the way the service would have:
-- the newest capture stays current and the older ones are marked superseded.
-- Nothing is deleted, and storage_reference, checksum and byte_size are not
-- touched (trg_kyc_documents_immutable_bytes guards them).
-- =============================================================================

UPDATE kyc_documents d
   SET superseded_at = now()
 WHERE d.superseded_at IS NULL
   AND d.agent_id IS NOT NULL
   AND EXISTS (
         SELECT 1 FROM kyc_documents n
          WHERE n.agent_id = d.agent_id
            AND n.document_type = d.document_type
            AND n.superseded_at IS NULL
            AND (n.uploaded_at, n.id) > (d.uploaded_at, d.id));

UPDATE kyc_documents d
   SET superseded_at = now()
 WHERE d.superseded_at IS NULL
   AND d.referee_id IS NOT NULL
   AND EXISTS (
         SELECT 1 FROM kyc_documents n
          WHERE n.referee_id = d.referee_id
            AND n.document_type = d.document_type
            AND n.superseded_at IS NULL
            AND (n.uploaded_at, n.id) > (d.uploaded_at, d.id));

DROP INDEX IF EXISTS idx_kyc_docs_current;

CREATE UNIQUE INDEX IF NOT EXISTS idx_kyc_docs_one_current_per_agent
  ON kyc_documents (agent_id, document_type)
  WHERE superseded_at IS NULL AND agent_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_kyc_docs_one_current_per_referee
  ON kyc_documents (referee_id, document_type)
  WHERE superseded_at IS NULL AND referee_id IS NOT NULL;
