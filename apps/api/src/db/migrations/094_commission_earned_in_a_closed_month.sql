-- ---------------------------------------------------------------------------
-- Commission earned in a closed month can still be paid.
--
-- Migration 058 locked every commission row created in a closed month against
-- any write, as it did transactions (see 093). A commission is created when
-- the payment it is earned on is verified, and it is paid weeks later: it
-- becomes ELIGIBLE once the money has settled and the hold period has passed,
-- APPROVED when the agent asks for a payout, PAID when the bank pays it. All
-- of that happens after the month it was earned in, and very often after that
-- month has been closed.
--
-- Measured with last month closed over one ELIGIBLE commission and one
-- PENDING one due for promotion:
--
--   promotion   threw — "LAST is closed; the commissions in it cannot be
--               changed" — and promotes every due commission in one database
--               transaction, so no commission anywhere in the State became
--               payable while that row existed.
--   payout      the agent's request threw the same way, and a payout takes
--               every ELIGIBLE commission the agent has, so they could be paid
--               nothing at all — not this month's work either.
--
-- What the close froze is the month's commission figure: `periodFigures`
-- sums the amount of every commission created in the month that is not
-- REVERSED. Earning, holding, approving and paying a commission change none
-- of that. So that is what is locked now: a write to a commission in a shut
-- month is refused when it would move the row into or out of REVERSED, or
-- change its amount or its month. Clawing a commission back is therefore
-- still a correction to the closed month, and needs it reopened, as the
-- reversal of the payment behind it already does.
--
-- The amount and month are already held by the immutability trigger; they are
-- checked here as well so this lock is right on its own. Inserts and deletes
-- are refused exactly as before.
-- ---------------------------------------------------------------------------

BEGIN;

CREATE OR REPLACE FUNCTION refuse_change_to_a_shut_months_commission() RETURNS TRIGGER AS $$
DECLARE
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
      RAISE EXCEPTION '% is closed; commissions cannot be written into it', new_shut
        USING HINT = 'Reopen the period, with a reason, or date the entry in an open one.';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF old_shut IS NOT NULL THEN
      RAISE EXCEPTION '% is closed; the commissions in it cannot be changed', old_shut
        USING HINT = 'Reopen the period, with a reason.';
    END IF;
    RETURN OLD;
  END IF;

  IF COALESCE(old_shut, new_shut) IS NOT NULL AND (
       (OLD.status = 'REVERSED') IS DISTINCT FROM (NEW.status = 'REVERSED')
       OR OLD.amount_kobo IS DISTINCT FROM NEW.amount_kobo
       OR OLD.created_at IS DISTINCT FROM NEW.created_at
     ) THEN
    RAISE EXCEPTION '% is closed; the commissions in it cannot be changed', COALESCE(old_shut, new_shut)
      USING HINT = 'Reopen the period, with a reason.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS commissions_respect_closed_periods ON commissions;
CREATE TRIGGER commissions_respect_closed_periods
  BEFORE INSERT OR UPDATE OR DELETE ON commissions
  FOR EACH ROW EXECUTE FUNCTION refuse_change_to_a_shut_months_commission();

COMMIT;
