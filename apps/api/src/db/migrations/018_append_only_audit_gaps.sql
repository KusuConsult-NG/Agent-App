-- =============================================================================
-- 018 — Close three append-only gaps in the audit surface
-- =============================================================================
--
-- The platform's central claim is that financial and audit records cannot be
-- deleted: 85 triggers enforce it across transactions, payments, receipts,
-- commissions, audit_logs and the rest. Three tables that hold audit evidence
-- were missed, and each has a sibling that was not — which is what makes them
-- oversights rather than decisions.
--
--   document_access_logs      who opened which document, and from what address.
--                             `kyc_document_access_logs` is append-only; this
--                             one was not. Both answer the same question about
--                             different documents.
--
--   reconciliation_runs       that a reconciliation period was examined at all,
--                             and what it concluded. `reconciliation_records`
--                             — the individual matched lines — is append-only;
--                             the record that the sweep happened was not. The
--                             run row is the more valuable one to erase: it is
--                             where an ABORTED sweep is recorded, and an
--                             aborted sweep means nothing was compared for that
--                             period.
--
--   gateway_statement_lines   the gateway's own account of what it settled.
--                             This is the third leg of the three-way
--                             reconciliation — the side the platform does not
--                             author — and a mismatch is only visible while
--                             both sides survive.
--
-- Verified before writing this: nothing in the application or the test suite
-- deletes from any of the three, so nothing legitimate breaks.
--
-- WHAT IS DELIBERATELY LEFT DELETABLE
--
-- `programme_eligibility` and `taxpayer_compliance` are recomputed, not
-- recorded. Migration 017 clears eligibility rows precisely so that verdicts
-- reached under the old gate rule do not linger as stale refusals. Making them
-- append-only would break that and would misrepresent what they are: a cache of
-- a determination, not evidence of an event.
--
-- TRUNCATE still works on all of these. `prevent_delete` is a row-level DELETE
-- trigger and TRUNCATE does not fire row triggers, which is how the existing
-- append-only tables coexist with the test helper's reset.

CREATE TRIGGER trg_document_access_logs_no_delete
  BEFORE DELETE ON document_access_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();

CREATE TRIGGER trg_reconciliation_runs_no_delete
  BEFORE DELETE ON reconciliation_runs
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();

CREATE TRIGGER trg_gateway_statement_lines_no_delete
  BEFORE DELETE ON gateway_statement_lines
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();

-- An access log is a statement about something that already happened, so it
-- should not be editable either. The run and statement rows do change — a
-- reconciliation moves through states, and a statement line is matched — so
-- only the access log gets update protection.
CREATE TRIGGER trg_document_access_logs_no_update
  BEFORE UPDATE ON document_access_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_any_update();
