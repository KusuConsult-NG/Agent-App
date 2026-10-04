-- ---------------------------------------------------------------------------
-- A closed month locks the figures it froze, not the bills still open in it.
--
-- Migration 058 locks a closed period against writes, and for transactions it
-- locked every row created in the month, whatever the write. A month is
-- closed over its collections; it is not, and cannot be, closed over the bills
-- raised in it that are still running. Every bill has thirty days to be paid,
-- so the last month's bills are always open when it is closed, and the close
-- does not wait for them — only for unresolved exceptions and pending
-- payments.
--
-- Measured with last month closed and one of its bills still unpaid and in
-- date:
--
--   paying it          refused, 409 — "LAST is closed; the transactions in
--                      it cannot be changed" — at the first transition, so a
--                      bill the taxpayer was still entitled to pay could not
--                      be taken by anybody.
--   letting it lapse   the expiry sweep threw on it and stopped. It expires in
--                      deadline order, so the one locked bill held back every
--                      lapsed bill behind it, this month's included.
--   withdrawing it     an objection upheld, a PAYE return withdrawn, a bill
--                      raised in error, a bill issued again: each closes the
--                      charge, and each was refused the same way.
--
-- What the close counted is a transaction in a revenue-recognised state:
-- `periodFigures` counts those, at their amounts, in the month they were
-- raised. A row the close counted stays frozen exactly as before — any write
-- to it is refused until the month is reopened, a receipt or a reversal
-- included. A row it did not count — a bill still waiting to be paid — may
-- now change, provided it stays out of the count: it may expire, be
-- cancelled, withdrawn or issued again, or have an attempt start or fail, but
-- it may not move into revenue, nor change its amount or its month.
--
-- Paying a bill from a shut month would move it into revenue, so it is still
-- refused here; the payment path now refuses it first, before any money moves,
-- and says to issue the bill again into an open month (`reissueInvoice`).
--
-- The revenue states are written out below and must match
-- `REVENUE_RECOGNISED_STATES` in packages/shared/src/state.ts; a test compares
-- the two. Inserts and deletes are refused exactly as before.
-- ---------------------------------------------------------------------------

BEGIN;

CREATE OR REPLACE FUNCTION refuse_change_to_a_shut_months_revenue() RETURNS TRIGGER AS $$
DECLARE
  revenue  CONSTANT TEXT[] := ARRAY['PAYMENT_VERIFIED', 'RECEIPT_GENERATED', 'RECONCILIATION_PENDING', 'SETTLED'];
  old_shut TEXT;
  new_shut TEXT;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    old_shut := period_is_shut((OLD.created_at AT TIME ZONE 'Africa/Lagos')::date);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    new_shut := period_is_shut((NEW.created_at AT TIME ZONE 'Africa/Lagos')::date);
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF new_shut IS NOT NULL THEN
      RAISE EXCEPTION '% is closed; transactions cannot be written into it', new_shut
        USING HINT = 'Reopen the period, with a reason, or date the entry in an open one.';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF old_shut IS NOT NULL THEN
      RAISE EXCEPTION '% is closed; the transactions in it cannot be changed', old_shut
        USING HINT = 'Reopen the period, with a reason.';
    END IF;
    RETURN OLD;
  END IF;

  IF COALESCE(old_shut, new_shut) IS NOT NULL AND (
       OLD.status = ANY (revenue)                        -- counted: frozen whole
       OR NEW.status = ANY (revenue)                     -- would join the count
       OR OLD.amount_kobo IS DISTINCT FROM NEW.amount_kobo
       OR OLD.total_amount_kobo IS DISTINCT FROM NEW.total_amount_kobo
       OR OLD.created_at IS DISTINCT FROM NEW.created_at
     ) THEN
    RAISE EXCEPTION '% is closed; the transactions in it cannot be changed', COALESCE(old_shut, new_shut)
      USING HINT = 'Reopen the period, with a reason.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS transactions_respect_closed_periods ON transactions;
CREATE TRIGGER transactions_respect_closed_periods
  BEFORE INSERT OR UPDATE OR DELETE ON transactions
  FOR EACH ROW EXECUTE FUNCTION refuse_change_to_a_shut_months_revenue();

COMMIT;
