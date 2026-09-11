-- A signed audit report that covered less than it claimed.
--
-- Six row-level report types are capped at 5,000 rows, ordered newest first.
-- `row_count` recorded 5,000, the checksum covered those rows, `period_start`
-- asserted the whole window, and an officer signed it — then exported a PDF
-- whose checksum line invites a reader to verify the figures. It verifies
-- faithfully, for the tail end of a period whose beginning was never in the
-- file. The rows dropped are the oldest in the window, which is where anything
-- long-running sits.
--
-- The authoritative record of this is inside `payload.coverage`, and therefore
-- inside the checksum, so it cannot be separated from the artefact or stripped
-- without the report failing verification. This column is the same fact
-- surfaced for listing and filtering, so the workbench can show which reports
-- are partial without unpacking every payload.
--
-- NULL, not TRUE, for reports generated before this existed. Whether they were
-- complete is genuinely unknown, and defaulting them to complete would assert
-- the very thing this migration exists to stop the platform asserting.
ALTER TABLE audit_reports ADD COLUMN coverage_complete BOOLEAN;

COMMENT ON COLUMN audit_reports.coverage_complete IS
  'TRUE when the query returned every matching row; FALSE when it hit the row cap and this report carries only the most recent of them; NULL for reports generated before coverage was recorded.';

CREATE INDEX idx_audit_reports_partial ON audit_reports(generated_at DESC)
  WHERE coverage_complete IS FALSE;
