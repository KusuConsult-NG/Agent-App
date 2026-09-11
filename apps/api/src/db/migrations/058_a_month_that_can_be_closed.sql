-- Financial periods, and the writes a closed one refuses.
--
-- A settled month is still writable. Every figure PSIRS has reported to the
-- Accountant-General for March can be changed in April by a reversal, a
-- backdated settlement, or a commission adjustment — and nothing anywhere says
-- it happened after the books were reported. The readiness assessment lists
-- this as a control rather than a feature, and it is the right word: the
-- absence is not a missing screen, it is a missing guarantee.
--
-- WHAT CLOSING MEANS
--
-- A closed period refuses writes to the tables that decide what the State
-- collected in it. Not all writes to those tables — a payment for *today*
-- lands in an open period and is unaffected — but any write whose *effect
-- falls inside* a closed one.
--
-- WHY THE TRIGGERS AND NOT THE SERVICE
--
-- This report's standing test, from migration 040 and again in 053: a rule that
-- only holds when you go through the service layer is not an invariant. A
-- period lock enforced in TypeScript is a lock a compromised service account, a
-- future endpoint, or a DBA at a psql prompt walks straight through — and the
-- entire value of a closed month is that nobody can.
--
-- WHICH TABLES
--
-- The four that decide the figure: `transactions` (what was collected),
-- `payments` (what arrived), `commissions` (what it cost), `settlements` (what
-- reached the government account). Receipts follow their transaction and
-- reconciliation records are the working-out rather than the figure, so neither
-- is locked — a reconciliation run over a closed month is how you *discover* it
-- was wrong, and refusing it would make the lock hide the thing it exists to
-- surface.
--
-- REOPENING
--
-- A closed period reopens, because a genuine error found in June has to be
-- correctable in the March books rather than smuggled into June's. It is a
-- separate authority, it demands a reason, and it is recorded — so "March was
-- reopened on the 9th of June by Bala, because the Kanam settlement was
-- misposted" is a sentence the platform can produce.

BEGIN;

CREATE TABLE financial_periods (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The label is derived and stored, so a period can be quoted in a report
  -- without every caller re-deriving it and one of them getting it wrong.
  label         TEXT NOT NULL UNIQUE,
  period_start  DATE NOT NULL,
  period_end    DATE NOT NULL,

  status        TEXT NOT NULL DEFAULT 'OPEN'
                  CHECK (status IN ('OPEN', 'CLOSING', 'CLOSED')),

  /*
   * CLOSING is not decoration.
   *
   * Closing a month is preceded by reconciliation, and an officer who has
   * started that work needs the period to stop accepting *new* backdated
   * entries while they finish. CLOSING refuses the same writes CLOSED does;
   * the difference is that it is expected to move, and a screen can say
   * "being closed" rather than "closed".
   */

  closed_at     TIMESTAMPTZ,
  closed_by     UUID REFERENCES users(id),
  closing_note  TEXT,

  reopened_at   TIMESTAMPTZ,
  reopened_by   UUID REFERENCES users(id),
  reopen_reason TEXT,

  -- What the books said at the moment of closing. Stored rather than
  -- recomputed, because the whole point is to have a figure that cannot move
  -- afterwards to compare against.
  collected_kobo      BIGINT,
  settled_kobo        BIGINT,
  commission_kobo     BIGINT,
  transaction_count   INTEGER,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT period_ordered CHECK (period_end >= period_start),
  CONSTRAINT period_closed_has_a_closer CHECK (
    status <> 'CLOSED' OR (closed_at IS NOT NULL AND closed_by IS NOT NULL)),
  CONSTRAINT period_reopen_has_a_reason CHECK (
    reopened_at IS NULL OR (reopened_by IS NOT NULL
                            AND reopen_reason IS NOT NULL
                            AND length(btrim(reopen_reason)) > 0))
);

/*
 * Periods do not overlap.
 *
 * Two periods covering the same day is not a disagreement the lock can resolve:
 * one closed and one open over the 3rd of March means a write on that date is
 * both refused and allowed depending on which row the trigger reads first. An
 * exclusion constraint refuses the overlap outright, which is the only answer
 * that leaves the lock deterministic.
 */
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE financial_periods ADD CONSTRAINT financial_periods_do_not_overlap
  EXCLUDE USING gist (daterange(period_start, period_end, '[]') WITH &&);

CREATE INDEX financial_periods_closed_idx
  ON financial_periods (period_start, period_end)
  WHERE status IN ('CLOSING', 'CLOSED');

/*
 * A period is reopened, never deleted.
 *
 * Deleting a closed period would silently unlock the month, which is the one
 * way to get past this control without leaving a trace — precisely what it
 * exists to prevent.
 */
CREATE OR REPLACE FUNCTION financial_periods_are_not_deleted() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'a financial period is reopened, never deleted (%)', OLD.label
    USING HINT = 'Reopen it, with a reason.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS financial_periods_no_delete ON financial_periods;
CREATE TRIGGER financial_periods_no_delete
  BEFORE DELETE ON financial_periods
  FOR EACH ROW EXECUTE FUNCTION financial_periods_are_not_deleted();

-- ---------------------------------------------------------------------------
-- The lock itself
-- ---------------------------------------------------------------------------

/**
 * Is this date inside a period that has stopped accepting entries?
 *
 * STABLE rather than IMMUTABLE: it reads a table, and the answer changes when
 * somebody closes a month. Marked so the planner can still cache it within a
 * statement, which matters because it runs once per affected row.
 */
CREATE OR REPLACE FUNCTION period_is_shut(the_date DATE) RETURNS TEXT AS $$
  SELECT label FROM financial_periods
   WHERE status IN ('CLOSING', 'CLOSED')
     AND the_date BETWEEN period_start AND period_end
   LIMIT 1;
$$ LANGUAGE sql STABLE;

/**
 * Refuse a write whose effect falls inside a shut period.
 *
 * Both sides are checked on an UPDATE. Moving a row *out of* a closed month is
 * as much a change to that month's figures as moving one in — shift a
 * government credit from March into April and March's settled figure drops
 * without a single deletion — so checking only the new date would let somebody
 * empty a closed period one row at a time.
 *
 * THE OLD SIDE IS CHECKED FIRST, AND THAT IS ABOUT THE MESSAGE.
 *
 * For an ordinary UPDATE of a row sitting inside a closed month, both sides are
 * shut and either check would refuse it. Which one fires decides what the
 * officer reads. Checking the old side first gives "the transactions in it
 * cannot be changed", which is what happened; checking the new side first gives
 * "cannot be written into it", which describes an insert and leaves somebody
 * looking for a row they are not creating. Inserts still get the second message
 * because they have no old side.
 *
 * The date column differs per table, so it arrives as a trigger argument rather
 * than being guessed from the row.
 */
CREATE OR REPLACE FUNCTION refuse_write_to_a_shut_period() RETURNS TRIGGER AS $$
DECLARE
  column_name TEXT := TG_ARGV[0];
  new_date    DATE;
  old_date    DATE;
  shut        TEXT;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    EXECUTE format('SELECT ($1).%I::date', column_name) INTO old_date USING OLD;
    shut := period_is_shut(old_date);
    IF shut IS NOT NULL THEN
      RAISE EXCEPTION '% is closed; the % in it cannot be changed', shut, TG_TABLE_NAME
        USING HINT = 'Reopen the period, with a reason.';
    END IF;
  END IF;

  IF TG_OP <> 'DELETE' THEN
    EXECUTE format('SELECT ($1).%I::date', column_name) INTO new_date USING NEW;
    shut := period_is_shut(new_date);
    IF shut IS NOT NULL THEN
      RAISE EXCEPTION '% is closed; % cannot be written into it', shut, TG_TABLE_NAME
        USING HINT = 'Reopen the period, with a reason, or date the entry in an open one.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

/*
 * The four tables that decide what the State collected in a month.
 *
 * Receipts follow their transaction and are locked through it. Reconciliation
 * records are deliberately *not* locked: a reconciliation run over a closed
 * month is how you discover it was wrong, and refusing it would make the lock
 * hide the thing it exists to surface.
 */
DROP TRIGGER IF EXISTS transactions_respect_closed_periods ON transactions;
CREATE TRIGGER transactions_respect_closed_periods
  BEFORE INSERT OR UPDATE OR DELETE ON transactions
  FOR EACH ROW EXECUTE FUNCTION refuse_write_to_a_shut_period('created_at');

DROP TRIGGER IF EXISTS payments_respect_closed_periods ON payments;
CREATE TRIGGER payments_respect_closed_periods
  BEFORE INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION refuse_write_to_a_shut_period('initiated_at');

DROP TRIGGER IF EXISTS commissions_respect_closed_periods ON commissions;
CREATE TRIGGER commissions_respect_closed_periods
  BEFORE INSERT OR UPDATE OR DELETE ON commissions
  FOR EACH ROW EXECUTE FUNCTION refuse_write_to_a_shut_period('created_at');

DROP TRIGGER IF EXISTS settlements_respect_closed_periods ON settlements;
CREATE TRIGGER settlements_respect_closed_periods
  BEFORE INSERT OR UPDATE OR DELETE ON settlements
  FOR EACH ROW EXECUTE FUNCTION refuse_write_to_a_shut_period('settlement_date');

COMMIT;
