-- ---------------------------------------------------------------------------
-- The month a closed period locks is the month its close counted.
--
-- Migration 058 locks a closed period against writes, and decides which
-- period a row falls in with `created_at::date` — the database session's
-- calendar, which is UTC. The figures a close freezes count by Plateau's
-- calendar (`lib/calendar-day.ts`), so for the hour after midnight in Jos on
-- the first of every month the two disagreed about which month a row was in.
--
-- Measured with April closed over its own figures:
--
--   2026-04-30T23:30Z   1 May in Jos, and May's money. Refused any change —
--                       "2026-04 is closed; the transactions in it cannot be
--                       changed" — so it could not be settled, verified or
--                       reversed while May was still open.
--   2026-03-31T23:30Z   1 April in Jos, and in April's frozen figure. Still
--                       changeable, because the lock took it for March's.
--
-- So the lock guarded a row the close did not count and left open a row the
-- close did. It now reads the same calendar as the close.
--
-- A column that is already a calendar day — `settlements.settlement_date`, the
-- bank's own date — is read as it is. A DATE has no zone to convert, and
-- converting one would move it to the day before.
-- ---------------------------------------------------------------------------

BEGIN;

CREATE OR REPLACE FUNCTION refuse_write_to_a_shut_period() RETURNS TRIGGER AS $$
DECLARE
  column_name TEXT := TG_ARGV[0];
  -- 'instant' for a timestamptz, read on Plateau's calendar; 'day' for a DATE.
  column_kind TEXT := COALESCE(TG_ARGV[1], 'day');
  read_day    TEXT;
  new_date    DATE;
  old_date    DATE;
  shut        TEXT;
BEGIN
  read_day := CASE column_kind
    WHEN 'instant' THEN
      format('SELECT (($1).%I AT TIME ZONE %L)::date', column_name, 'Africa/Lagos')
    ELSE
      format('SELECT ($1).%I::date', column_name)
  END;

  IF TG_OP <> 'INSERT' THEN
    EXECUTE read_day INTO old_date USING OLD;
    shut := period_is_shut(old_date);
    IF shut IS NOT NULL THEN
      RAISE EXCEPTION '% is closed; the % in it cannot be changed', shut, TG_TABLE_NAME
        USING HINT = 'Reopen the period, with a reason.';
    END IF;
  END IF;

  IF TG_OP <> 'DELETE' THEN
    EXECUTE read_day INTO new_date USING NEW;
    shut := period_is_shut(new_date);
    IF shut IS NOT NULL THEN
      RAISE EXCEPTION '% is closed; % cannot be written into it', shut, TG_TABLE_NAME
        USING HINT = 'Reopen the period, with a reason, or date the entry in an open one.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS transactions_respect_closed_periods ON transactions;
CREATE TRIGGER transactions_respect_closed_periods
  BEFORE INSERT OR UPDATE OR DELETE ON transactions
  FOR EACH ROW EXECUTE FUNCTION refuse_write_to_a_shut_period('created_at', 'instant');

DROP TRIGGER IF EXISTS payments_respect_closed_periods ON payments;
CREATE TRIGGER payments_respect_closed_periods
  BEFORE INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION refuse_write_to_a_shut_period('initiated_at', 'instant');

DROP TRIGGER IF EXISTS commissions_respect_closed_periods ON commissions;
CREATE TRIGGER commissions_respect_closed_periods
  BEFORE INSERT OR UPDATE OR DELETE ON commissions
  FOR EACH ROW EXECUTE FUNCTION refuse_write_to_a_shut_period('created_at', 'instant');

DROP TRIGGER IF EXISTS settlements_respect_closed_periods ON settlements;
CREATE TRIGGER settlements_respect_closed_periods
  BEFORE INSERT OR UPDATE OR DELETE ON settlements
  FOR EACH ROW EXECUTE FUNCTION refuse_write_to_a_shut_period('settlement_date', 'day');

COMMIT;
