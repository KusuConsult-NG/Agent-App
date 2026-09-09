BEGIN;

/*
 * Two things an auditor needs that this platform could not give them: a sample
 * they can defend, and a report that stays the report.
 *
 * WHY A SAMPLE IS A ROW AND NOT A QUERY
 *
 * An auditor's finding is only worth what its selection method is worth. "I
 * looked at forty transactions from March" invites the obvious question -- which
 * forty, and who chose them -- and a query re-run three weeks later against a
 * table that has since changed cannot answer it. Worse, an auditor who draws
 * repeatedly until the sample looks interesting has done something that is
 * indistinguishable, afterwards, from having drawn once.
 *
 * So the draw is an event. The criteria, the method, the seed, the size of the
 * population it was drawn from and every item it selected are written down at
 * the moment of drawing, and none of them can be changed afterwards. What can
 * change is the auditor's finding on each item, which is the work.
 *
 * The seed is what makes it reproducible: the same seed against the same
 * population reproduces the same sample, so a reviewer can satisfy themselves
 * the draw was not steered. It is stored rather than derived, because a seed
 * you cannot see is not a seed anybody can check.
 */

CREATE SEQUENCE IF NOT EXISTS audit_sample_number_seq;

CREATE TABLE audit_samples (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sample_number   TEXT NOT NULL UNIQUE,
  title           TEXT NOT NULL,
  /*
   * RANDOM draws uniformly, SYSTEMATIC takes every nth row in a fixed order,
   * and HIGHEST_VALUE takes the largest -- which is not a sample at all in the
   * statistical sense, and is named so that nobody reports it as one. An
   * auditor doing a materiality pass wants the big ones and should be able to
   * say that is what they did.
   */
  method          TEXT NOT NULL CHECK (method IN ('RANDOM', 'SYSTEMATIC', 'HIGHEST_VALUE')),
  -- The filters as given: period, revenue category, LGA, agent, value band.
  criteria        JSONB NOT NULL,
  seed            TEXT NOT NULL,
  population_size INTEGER NOT NULL CHECK (population_size >= 0),
  sample_size     INTEGER NOT NULL CHECK (sample_size >= 0),
  status          TEXT NOT NULL DEFAULT 'DRAWN'
                    CHECK (status IN ('DRAWN', 'IN_REVIEW', 'COMPLETED')),
  drawn_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  drawn_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  note            TEXT,
  -- A sample cannot select more than the population it was drawn from.
  CONSTRAINT audit_samples_size_within_population CHECK (sample_size <= population_size)
);

CREATE INDEX idx_audit_samples_drawn ON audit_samples(drawn_at DESC);
CREATE INDEX idx_audit_samples_status ON audit_samples(status, drawn_at DESC);

CREATE TABLE audit_sample_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sample_id      UUID NOT NULL REFERENCES audit_samples(id) ON DELETE CASCADE,
  transaction_id UUID NOT NULL REFERENCES transactions(id),
  -- Position in the draw, so the sample can be reproduced in order.
  position       INTEGER NOT NULL CHECK (position > 0),
  /*
   * PENDING until the auditor has looked. CLEAN and EXCEPTION are the two
   * findings; NOT_AVAILABLE is the third outcome that a two-valued field would
   * have forced into one of the others -- a transaction whose supporting
   * paperwork cannot be produced is not clean, and calling it an exception
   * asserts a defect nobody has established.
   */
  outcome        TEXT NOT NULL DEFAULT 'PENDING'
                   CHECK (outcome IN ('PENDING', 'CLEAN', 'EXCEPTION', 'NOT_AVAILABLE')),
  finding        TEXT,
  case_id        UUID REFERENCES cases(id),
  reviewed_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sample_id, transaction_id),
  UNIQUE (sample_id, position)
);

CREATE INDEX idx_audit_sample_items_sample ON audit_sample_items(sample_id, position);
CREATE INDEX idx_audit_sample_items_transaction ON audit_sample_items(transaction_id);

/*
 * What was drawn is what was drawn.
 *
 * Nothing about a sample is deleted, and everything about the draw itself is
 * fixed at the moment it happens; only the status, the completion time and the
 * auditor's note move afterwards. Without
 * this the whole apparatus is decorative: an auditor could widen the criteria
 * after seeing the results, or edit the population size to make a sample look
 * more representative than it was, and the row would still read as a record of
 * a draw that happened that way.
 */
CREATE OR REPLACE FUNCTION a_draw_is_not_redrawn() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'a sample is a record of what was examined and cannot be deleted'
      USING HINT = 'Complete it with a note saying what happened, or leave it as it stands.';
  END IF;

  IF NEW.sample_number IS DISTINCT FROM OLD.sample_number
     OR NEW.method IS DISTINCT FROM OLD.method
     OR NEW.criteria IS DISTINCT FROM OLD.criteria
     OR NEW.seed IS DISTINCT FROM OLD.seed
     OR NEW.population_size IS DISTINCT FROM OLD.population_size
     OR NEW.sample_size IS DISTINCT FROM OLD.sample_size
     OR NEW.drawn_by IS DISTINCT FROM OLD.drawn_by
     OR NEW.drawn_at IS DISTINCT FROM OLD.drawn_at THEN
    RAISE EXCEPTION 'a sample records a draw that already happened and cannot be redrawn'
      USING HINT = 'Draw a new sample instead; the old one stays as evidence of what was examined.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_samples_are_not_redrawn ON audit_samples;
CREATE TRIGGER audit_samples_are_not_redrawn
  BEFORE UPDATE OR DELETE ON audit_samples
  FOR EACH ROW EXECUTE FUNCTION a_draw_is_not_redrawn();

/*
 * And nothing joins or leaves a sample after it is drawn.
 *
 * An auditor who can drop the awkward item has not sampled anything. Rows are
 * inserted by the draw itself, inside the same transaction that creates the
 * sample row, which is why the guard keys on the parent already existing
 * rather than on a flag somebody sets.
 */
CREATE OR REPLACE FUNCTION a_sample_keeps_its_items() RETURNS TRIGGER AS $$
DECLARE
  drawn_when TIMESTAMPTZ;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'an item cannot be taken out of a sample that was already drawn'
      USING HINT = 'Record the outcome as NOT_AVAILABLE if the transaction cannot be examined.';
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT drawn_at INTO drawn_when FROM audit_samples WHERE id = NEW.sample_id;
    IF drawn_when IS NOT NULL AND drawn_when < now() - interval '1 minute' THEN
      RAISE EXCEPTION 'an item cannot be added to a sample that was already drawn'
        USING HINT = 'Draw a new sample.';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.sample_id IS DISTINCT FROM OLD.sample_id
     OR NEW.transaction_id IS DISTINCT FROM OLD.transaction_id
     OR NEW.position IS DISTINCT FROM OLD.position THEN
    RAISE EXCEPTION 'which transaction a sample selected cannot be changed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_sample_items_are_fixed ON audit_sample_items;
CREATE TRIGGER audit_sample_items_are_fixed
  BEFORE INSERT OR UPDATE OR DELETE ON audit_sample_items
  FOR EACH ROW EXECUTE FUNCTION a_sample_keeps_its_items();

/*
 * A report that stays the report.
 *
 * Every audit question on this platform was answerable -- as a query, run now,
 * returning whatever the tables say now. That is the right tool for looking
 * and the wrong one for reporting: a finding an auditor signs in March and a
 * reviewer opens in June have to be the same document, and a query re-run in
 * June is a different one by construction. Reversals land, corrections are
 * approved, a taxpayer is merged, and the report quietly changes its mind
 * about what it said.
 *
 * So generating a report freezes its rows into `payload` and takes a SHA-256
 * over the canonical form. The checksum is what makes the freeze checkable
 * rather than merely asserted: a reviewer can recompute it, and a payload
 * edited in the database no longer matches what was signed.
 *
 * Signing is separate from generating, and both are recorded. Generating is
 * mechanical; signing is an officer putting their name to the figures, which
 * is a different act and often a different person on a different day.
 */
CREATE SEQUENCE IF NOT EXISTS audit_report_number_seq;

CREATE TABLE audit_reports (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_number  TEXT NOT NULL UNIQUE,
  report_type    TEXT NOT NULL CHECK (report_type IN (
                   'TRANSACTION_AUDIT', 'AGENT_ACTIVITY', 'REVENUE_COLLECTION',
                   'LGA_PERFORMANCE', 'PAYMENT_RECONCILIATION', 'COMMISSION',
                   'USER_ACTIVITY', 'ANOMALY', 'AUDIT_SAMPLE', 'FRAUD_FLAG',
                   'REVENUE_TARGET', 'PERIOD_CLOSING', 'DATA_CHANGE')),
  title          TEXT NOT NULL,
  parameters     JSONB NOT NULL,
  period_start   DATE,
  period_end     DATE,
  -- The rows as they stood when the report was generated.
  payload        JSONB NOT NULL,
  row_count      INTEGER NOT NULL CHECK (row_count >= 0),
  checksum       TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'GENERATED'
                   CHECK (status IN ('GENERATED', 'SIGNED', 'WITHDRAWN')),
  generated_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  generated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  signed_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  signed_at      TIMESTAMPTZ,
  signature_note TEXT,
  withdrawn_reason TEXT,
  CONSTRAINT audit_reports_period_is_ordered
    CHECK (period_start IS NULL OR period_end IS NULL OR period_start <= period_end),
  -- A signed report names a signer and a moment, or it is not signed.
  CONSTRAINT audit_reports_signature_is_complete CHECK (
    (status <> 'SIGNED') OR (signed_by IS NOT NULL AND signed_at IS NOT NULL)),
  CONSTRAINT audit_reports_withdrawal_has_a_reason CHECK (
    (status <> 'WITHDRAWN') OR withdrawn_reason IS NOT NULL)
);

CREATE INDEX idx_audit_reports_generated ON audit_reports(generated_at DESC);
CREATE INDEX idx_audit_reports_type ON audit_reports(report_type, generated_at DESC);

/*
 * The figures do not move, and a report is never destroyed.
 *
 * Withdrawal exists precisely so that nobody needs to delete one: a report
 * generated on the wrong parameters is marked WITHDRAWN with a reason and
 * stays readable, because "this report was issued and later withdrawn" is
 * itself something an audit needs to be able to establish.
 */
CREATE OR REPLACE FUNCTION a_signed_report_does_not_move() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'an audit report cannot be deleted'
      USING HINT = 'Withdraw it with a reason; the record of it having existed is the point.';
  END IF;

  IF NEW.payload IS DISTINCT FROM OLD.payload
     OR NEW.checksum IS DISTINCT FROM OLD.checksum
     OR NEW.row_count IS DISTINCT FROM OLD.row_count
     OR NEW.parameters IS DISTINCT FROM OLD.parameters
     OR NEW.report_type IS DISTINCT FROM OLD.report_type
     OR NEW.report_number IS DISTINCT FROM OLD.report_number
     OR NEW.generated_by IS DISTINCT FROM OLD.generated_by
     OR NEW.generated_at IS DISTINCT FROM OLD.generated_at THEN
    RAISE EXCEPTION 'the figures in an audit report cannot be changed after it was generated'
      USING HINT = 'Withdraw this report and generate a new one.';
  END IF;

  -- A signature is not taken back by editing the row.
  IF OLD.status = 'SIGNED' AND NEW.status = 'GENERATED' THEN
    RAISE EXCEPTION 'a signed report cannot be returned to unsigned'
      USING HINT = 'Withdraw it instead.';
  END IF;

  IF OLD.status = 'SIGNED'
     AND (NEW.signed_by IS DISTINCT FROM OLD.signed_by
          OR NEW.signed_at IS DISTINCT FROM OLD.signed_at) THEN
    RAISE EXCEPTION 'who signed an audit report, and when, cannot be rewritten';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_reports_do_not_move ON audit_reports;
CREATE TRIGGER audit_reports_do_not_move
  BEFORE UPDATE OR DELETE ON audit_reports
  FOR EACH ROW EXECUTE FUNCTION a_signed_report_does_not_move();

COMMIT;
