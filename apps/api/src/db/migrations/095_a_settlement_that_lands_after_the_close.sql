-- ---------------------------------------------------------------------------
-- A settlement that lands after its month is closed can still be recorded.
--
-- A month may be closed over money that is in transit — confirmed by the
-- gateway, not yet credited by the bank — deliberately: "a month that refused
-- to close over it would refuse every month", and
-- `a-month-closed-over-a-reversal.test.ts` holds that. But recording the
-- credit when it lands writes to the month's rows. `recordSettlement` links
-- each payment to its batch, and banking moves the transaction on from
-- RECONCILIATION_PENDING to a receipt and SETTLED. Both were refused.
--
-- Measured with a payment verified last month and last month then closed:
-- the settlement threw — "… is closed; the payments in it cannot be
-- changed" — and could not be recorded at all. No receipt for the taxpayer,
-- no commission for the agent (it waits for SETTLED), and the bank credit
-- sitting unrecorded until somebody reopened a month to enter next month's
-- money.
--
-- None of it changes a figure the close froze. The month's collected figure
-- counts transactions in revenue-recognised states, and banking moves a
-- transaction from one of those states to another; the settled figure counts
-- settlements by the bank's own date, which falls in the open month; payments
-- carry no frozen figure at all.
--
-- So, for a transaction in a shut month, migration 093's rule gains one
-- exception: a row the close counted may be carried forward to another
-- revenue-recognised state. Any other write to it — an edit that leaves its
-- status alone, a move out of revenue — is still refused. And for a payment in
-- a shut month, a write is refused only when it would take a VERIFIED payment
-- out of VERIFIED, which is a reversal of money the month counted and needs
-- the month reopened, as it did; its amount and date are already immutable.
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
       OLD.amount_kobo IS DISTINCT FROM NEW.amount_kobo
       OR OLD.total_amount_kobo IS DISTINCT FROM NEW.total_amount_kobo
       OR OLD.created_at IS DISTINCT FROM NEW.created_at
       OR CASE
            -- Counted: frozen, except carried forward along the money's path.
            WHEN OLD.status = ANY (revenue)
              THEN NOT (NEW.status = ANY (revenue) AND NEW.status <> OLD.status)
            -- Not counted: free to change, but not into the count.
            ELSE NEW.status = ANY (revenue)
          END
     ) THEN
    RAISE EXCEPTION '% is closed; the transactions in it cannot be changed', COALESCE(old_shut, new_shut)
      USING HINT = 'Reopen the period, with a reason.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION refuse_change_to_a_shut_months_payment() RETURNS TRIGGER AS $$
DECLARE
  old_shut TEXT;
  new_shut TEXT;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    old_shut := period_is_shut((OLD.initiated_at AT TIME ZONE 'Africa/Lagos')::date);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    new_shut := period_is_shut((NEW.initiated_at AT TIME ZONE 'Africa/Lagos')::date);
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF new_shut IS NOT NULL THEN
      RAISE EXCEPTION '% is closed; payments cannot be written into it', new_shut
        USING HINT = 'Reopen the period, with a reason, or date the entry in an open one.';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF old_shut IS NOT NULL THEN
      RAISE EXCEPTION '% is closed; the payments in it cannot be changed', old_shut
        USING HINT = 'Reopen the period, with a reason.';
    END IF;
    RETURN OLD;
  END IF;

  IF COALESCE(old_shut, new_shut) IS NOT NULL AND (
       (OLD.status = 'VERIFIED' AND NEW.status IS DISTINCT FROM 'VERIFIED')
       OR OLD.amount_kobo IS DISTINCT FROM NEW.amount_kobo
       OR OLD.initiated_at IS DISTINCT FROM NEW.initiated_at
     ) THEN
    RAISE EXCEPTION '% is closed; the payments in it cannot be changed', COALESCE(old_shut, new_shut)
      USING HINT = 'Reopen the period, with a reason.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payments_respect_closed_periods ON payments;
CREATE TRIGGER payments_respect_closed_periods
  BEFORE INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION refuse_change_to_a_shut_months_payment();

COMMIT;
