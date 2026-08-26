-- A refund cannot be for more than was paid.
--
-- The amount travels from the officer who requests a reversal to the officer
-- who executes it inside `approvals.payload`, a free-form JSON column with no
-- schema, and `recordReversal` read it straight into the refund row.
-- `refunds.amount_kobo` asks only that it be positive. Nothing compared it to
-- the payment being reversed, so a request naming ten million naira against a
-- two thousand naira collection was a well-formed request: the State recorded
-- that it owed the money and asked the gateway to return it.
--
-- The service refuses that now, and so does this. The rule is about money and
-- belongs where the money is, for the same reason every other financial
-- control in this schema does: a future path that inserts a refund some other
-- way inherits the rule rather than having to remember it.
--
-- Stated as a sum rather than a comparison, because one payment may in
-- principle carry more than one refund row and it is the total that must not
-- exceed what was paid. FAILED rows are excluded: a refund the gateway refused
-- returned nothing, so it holds none of the payment's headroom.

CREATE OR REPLACE FUNCTION enforce_refund_within_payment() RETURNS TRIGGER AS $$
DECLARE
  paid            BIGINT;
  already_refunded BIGINT;
BEGIN
  SELECT amount_kobo INTO paid FROM payments WHERE id = NEW.payment_id;
  IF paid IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM(amount_kobo), 0) INTO already_refunded
    FROM refunds
   WHERE payment_id = NEW.payment_id
     AND status <> 'FAILED'
     AND id <> NEW.id;

  IF NEW.amount_kobo + already_refunded > paid THEN
    RAISE EXCEPTION
      'Refund of % kobo exceeds the % kobo payment it is against (% kobo already refunded)',
      NEW.amount_kobo, paid, already_refunded
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER refunds_within_payment
  BEFORE INSERT OR UPDATE OF amount_kobo ON refunds
  FOR EACH ROW EXECUTE FUNCTION enforce_refund_within_payment();
