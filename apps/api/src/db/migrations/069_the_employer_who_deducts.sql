-- PAYE from informal employers: the payroll schedule, and its two invariants.
--
-- The largest single IGR line in almost every Nigerian state, and the one this
-- platform could not accept. `PIT-PAYE` has been in the catalogue since the
-- beginning with a tiered rate against it, so a *single* PAYE assessment could
-- always be raised — but an employer does not owe one amount, they owe the sum
-- of what they deducted from thirty or forty people, and there was nowhere to
-- record who those people were. Without that, PAYE is a number an employer
-- types and nobody can check, which is the same thing as not collecting it.
--
-- One school with forty teachers is worth a hundred tailors and takes one visit
-- instead of a hundred. That is the whole case for this phase, and the schedule
-- is what makes it bankable.
--
-- TWO INVARIANTS, IN THE DATABASE.
--
--   1. A filed schedule agrees with its own lines. The header total and the
--      employee count must equal the sum and count of the rows beneath them.
--      A schedule whose header says ₦2.4m and whose lines add to ₦1.9m is
--      unauditable, and the difference is exactly the shape of an employer
--      remitting less than they deducted — the specific fraud PAYE invites.
--
--   2. A filed schedule cannot be edited, and neither can its lines. This is
--      the same rule the platform applies to assessments and invoices, for the
--      same reason: it is the evidence for a liability. A correction is a new
--      schedule, and the superseded one is cancelled with a reason, so the
--      history of what was declared survives the correction.
--
-- The tax figure is never accepted from the filer. It is computed by the rate
-- engine from the declared emoluments, on the same principle the payment path
-- applies to a caller-supplied `status: VERIFIED` — the moment a number is
-- typeable, it is negotiable. The schema enforces the consequence: the column
-- exists, and the trigger below refuses a filing whose lines do not add up to
-- it, so a service that stopped computing would be caught here.

BEGIN;

CREATE TABLE IF NOT EXISTS paye_schedules (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employer_taxpayer_id   UUID NOT NULL REFERENCES taxpayers(id),

  -- The month being remitted for. Stored as two integers rather than a date
  -- because a PAYE period is a calendar month and nothing else, and a date
  -- column invites a filing dated the 17th that nobody can reconcile.
  period_year            INTEGER NOT NULL CHECK (period_year BETWEEN 2020 AND 2100),
  period_month           INTEGER NOT NULL CHECK (period_month BETWEEN 1 AND 12),

  status                 TEXT NOT NULL DEFAULT 'FILED'
                         CHECK (status IN ('FILED', 'CANCELLED')),

  employee_count         INTEGER NOT NULL CHECK (employee_count > 0),
  gross_emoluments_kobo  BIGINT  NOT NULL CHECK (gross_emoluments_kobo > 0),
  tax_due_kobo           BIGINT  NOT NULL CHECK (tax_due_kobo >= 0),

  -- What the tax was computed against, kept so an assessment can be re-checked
  -- years later against the bands that were in force when it was made.
  rate_version_id        UUID REFERENCES revenue_item_rates(id),
  assessment_id          UUID REFERENCES assessments(id),

  cancelled_reason       TEXT,
  cancelled_at           TIMESTAMPTZ,
  cancelled_by           UUID REFERENCES users(id),
  superseded_by_id       UUID REFERENCES paye_schedules(id),

  filed_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  filed_by               UUID NOT NULL REFERENCES users(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One live filing per employer per month. Cancelled rows are excluded so a
-- correction — cancel, then file again — is possible, while a second filing
-- for a month already returned is refused rather than silently doubling what
-- the employer appears to owe.
CREATE UNIQUE INDEX IF NOT EXISTS idx_paye_one_live_filing
  ON paye_schedules (employer_taxpayer_id, period_year, period_month)
  WHERE status <> 'CANCELLED';

CREATE INDEX IF NOT EXISTS idx_paye_employer
  ON paye_schedules (employer_taxpayer_id, period_year DESC, period_month DESC);

CREATE TABLE IF NOT EXISTS paye_schedule_lines (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id            UUID NOT NULL REFERENCES paye_schedules(id) ON DELETE RESTRICT,

  employee_name          TEXT NOT NULL,
  -- The employee's own tax identity where the employer knows it. Nullable on
  -- purpose: an employer who cannot name every TIN must still be able to file
  -- and pay, because a return refused for a missing identifier is a return
  -- nobody makes and tax nobody remits. The gap is reportable instead.
  employee_tin           TEXT,
  employee_phone         TEXT,

  gross_emolument_kobo   BIGINT NOT NULL CHECK (gross_emolument_kobo > 0),
  tax_kobo               BIGINT NOT NULL CHECK (tax_kobo >= 0),

  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_paye_lines_schedule
  ON paye_schedule_lines (schedule_id);

-- An employee's tax cannot exceed what they were paid. A cheap check, and the
-- one that catches a units mistake — kobo entered as naira — before it reaches
-- somebody's payslip.
ALTER TABLE paye_schedule_lines
  DROP CONSTRAINT IF EXISTS paye_line_tax_within_emolument;
ALTER TABLE paye_schedule_lines
  ADD CONSTRAINT paye_line_tax_within_emolument
  CHECK (tax_kobo <= gross_emolument_kobo);


-- ---------------------------------------------------------------------------
-- Invariant 1: the header agrees with the lines.
--
-- Deferred to the end of the transaction, because the schedule row has to
-- exist before its lines can reference it. A constraint checked per statement
-- would make the correct insertion order impossible; this checks the state the
-- transaction actually commits, which is the state anybody later reads.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_paye_schedule_matches_its_lines() RETURNS TRIGGER AS $$
DECLARE
  line_count   INTEGER;
  line_total   BIGINT;
  line_tax     BIGINT;
  schedule_row paye_schedules%ROWTYPE;
BEGIN
  SELECT * INTO schedule_row FROM paye_schedules WHERE id = NEW.id;
  -- Cancelled during the same transaction it was created in: nothing is owed
  -- and nothing needs to add up.
  IF schedule_row.status = 'CANCELLED' THEN RETURN NEW; END IF;

  SELECT count(*), COALESCE(SUM(gross_emolument_kobo), 0), COALESCE(SUM(tax_kobo), 0)
    INTO line_count, line_total, line_tax
    FROM paye_schedule_lines WHERE schedule_id = NEW.id;

  IF line_count = 0 THEN
    RAISE EXCEPTION 'A PAYE schedule must name the employees it covers'
      USING ERRCODE = 'check_violation';
  END IF;

  IF line_count <> schedule_row.employee_count THEN
    RAISE EXCEPTION
      'This PAYE schedule says % employees and names % (schedule %)',
      schedule_row.employee_count, line_count, schedule_row.id
      USING ERRCODE = 'check_violation';
  END IF;

  IF line_total <> schedule_row.gross_emoluments_kobo THEN
    RAISE EXCEPTION
      'This PAYE schedule declares % kobo of emoluments and its lines add to % (schedule %)',
      schedule_row.gross_emoluments_kobo, line_total, schedule_row.id
      USING ERRCODE = 'check_violation';
  END IF;

  IF line_tax <> schedule_row.tax_due_kobo THEN
    RAISE EXCEPTION
      'This PAYE schedule declares % kobo of tax and its lines add to % (schedule %)',
      schedule_row.tax_due_kobo, line_tax, schedule_row.id
      USING ERRCODE = 'check_violation';
  END IF;

  /*
   * And the assessment says the same thing.
   *
   * This is what makes the service's precomputed-amount path safe. The
   * assessment engine normally derives every figure from a rate; PAYE is the
   * one liability it cannot, because the total is the sum of thirty separate
   * band computations rather than one. So the service hands it a number — and
   * this is the check that stops that being a hole. The number must equal the
   * schedule total, which must equal the sum of the lines, which are the named
   * people the money was deducted from. A service that invented an amount, or
   * computed against the wrong bands, fails here rather than committing.
   */
  IF schedule_row.assessment_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM assessments a
       WHERE a.id = schedule_row.assessment_id
         AND a.amount_kobo = schedule_row.tax_due_kobo
    ) THEN
      RAISE EXCEPTION
        'The assessment raised for PAYE schedule % does not carry the % kobo the schedule computed',
        schedule_row.id, schedule_row.tax_due_kobo
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_paye_schedule_adds_up ON paye_schedules;
CREATE CONSTRAINT TRIGGER trg_paye_schedule_adds_up
  AFTER INSERT OR UPDATE ON paye_schedules
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_paye_schedule_matches_its_lines();


-- ---------------------------------------------------------------------------
-- Invariant 2: a filing is evidence, so it does not change.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_paye_schedule_immutable ON paye_schedules;
CREATE TRIGGER trg_paye_schedule_immutable
  BEFORE UPDATE ON paye_schedules
  FOR EACH ROW EXECUTE FUNCTION prevent_column_mutation(
    'employer_taxpayer_id', 'period_year', 'period_month', 'employee_count',
    'gross_emoluments_kobo', 'tax_due_kobo', 'rate_version_id', 'assessment_id',
    'filed_at', 'filed_by');

DROP TRIGGER IF EXISTS trg_paye_schedule_touch ON paye_schedules;
CREATE TRIGGER trg_paye_schedule_touch
  BEFORE UPDATE ON paye_schedules
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- A backstop, and currently unreachable: the lines' foreign key is ON DELETE
-- RESTRICT and a schedule cannot exist without lines, so nothing can get here
-- while both of those hold. Kept for the migration that one day relaxes one of
-- them, and noted as unreachable so it is not mistaken for the guard doing the
-- work today.
DROP TRIGGER IF EXISTS trg_paye_schedule_no_delete ON paye_schedules;
CREATE TRIGGER trg_paye_schedule_no_delete
  BEFORE DELETE ON paye_schedules
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();

-- The lines are the evidence. Nothing edits or removes one after the fact: an
-- employer who deducted from somebody and later deleted the row is the case
-- this table exists to make impossible.
DROP TRIGGER IF EXISTS trg_paye_line_no_update ON paye_schedule_lines;
CREATE TRIGGER trg_paye_line_no_update
  BEFORE UPDATE ON paye_schedule_lines
  FOR EACH ROW EXECUTE FUNCTION prevent_any_update();

DROP TRIGGER IF EXISTS trg_paye_line_no_delete ON paye_schedule_lines;
CREATE TRIGGER trg_paye_line_no_delete
  BEFORE DELETE ON paye_schedule_lines
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();

-- A cancellation is an act by somebody, for a reason — the same rule the
-- connection graph applies, and for the same reason: this row is the record of
-- what an employer declared, and withdrawing it anonymously leaves nobody
-- answerable for the change.
CREATE OR REPLACE FUNCTION enforce_paye_cancellation_is_accountable() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'CANCELLED' AND OLD.status IS DISTINCT FROM 'CANCELLED' THEN
    IF NEW.cancelled_by IS NULL
       OR NEW.cancelled_reason IS NULL
       OR btrim(NEW.cancelled_reason) = '' THEN
      RAISE EXCEPTION 'A PAYE schedule may not be cancelled without a reason and an officer'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF OLD.status = 'CANCELLED' AND NEW.status <> 'CANCELLED' THEN
    RAISE EXCEPTION 'A cancelled PAYE schedule cannot be reinstated; file a new one'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_paye_cancellation_accountable ON paye_schedules;
CREATE TRIGGER trg_paye_cancellation_accountable
  BEFORE UPDATE ON paye_schedules
  FOR EACH ROW EXECUTE FUNCTION enforce_paye_cancellation_is_accountable();

COMMIT;
