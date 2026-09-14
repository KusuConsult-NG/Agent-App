-- A receipt asked whether a settlement existed, not whether it settled anything.
--
-- Migration 040 made a government receipt require settlement as well as gateway
-- confirmation, and said why in its own comment: the check is a trigger rather
-- than an application rule "because it holds even against a compromised service
-- account, and there is no code path — route, admin screen or service function
-- — that can talk its way past it."
--
-- It stopped one join short. The test was `pay.settlement_id IS NULL`: the
-- presence of a link, never the state of the thing linked to. `settlements`
-- admits PENDING, RECEIVED, RECONCILED and DISPUTED, and only RECONCILED means
-- the bank credit covered the collections. So two rows defeated the cardinal
-- rule:
--
--   INSERT INTO settlements (..., received_amount_kobo, status)
--        VALUES (..., 0, 'PENDING');
--   UPDATE payments SET settlement_id = <that row> WHERE id = <collection>;
--
-- and the receipt inserted cleanly — for a settlement that received nothing.
-- `payments_immutable` does not freeze `settlement_id`, so the second statement
-- is an ordinary UPDATE.
--
-- The same gap admitted a case nobody had to forge at all. A batch the bank
-- paid short is recorded DISPUTED, and `recordSettlement` deliberately settles
-- none of its collections — "a disputed batch receipts nothing" is asserted in
-- the suite and holds in the service. At the database it did not: the payments
-- in a disputed batch carry a `settlement_id` like any other, so a receipt for
-- one was insertable by anything that bypassed the service layer. The rule the
-- trigger's own HINT states — "until a bank credit covering this collection is
-- reconciled" — was the rule it did not enforce.
--
-- A determined writer with database credentials can still forge a settlement
-- that says RECONCILED. That is not what this closes. What it closes is every
-- settlement state that means the money is not there — none received, part
-- received, still in dispute — so that reaching a receipt now requires stating
-- in the row itself that the State was paid in full, rather than merely
-- pointing at a batch that exists.

BEGIN;

CREATE OR REPLACE FUNCTION enforce_receipt_requires_verified_payment() RETURNS TRIGGER AS $$
DECLARE
  pay payments%ROWTYPE;
  stl settlements%ROWTYPE;
BEGIN
  SELECT * INTO pay FROM payments WHERE id = NEW.payment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Receipt % references a payment that does not exist', NEW.receipt_number
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF pay.status <> 'VERIFIED' THEN
    RAISE EXCEPTION
      'Receipt cannot be issued: payment % is %, not VERIFIED',
      pay.payment_reference, pay.status
      USING ERRCODE = 'restrict_violation',
            HINT = 'A government receipt requires independent gateway confirmation.';
  END IF;

  IF pay.verified_at IS NULL OR pay.gateway_reference IS NULL THEN
    RAISE EXCEPTION 'Receipt cannot be issued: payment % lacks verification evidence',
      pay.payment_reference
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF pay.settlement_id IS NULL THEN
    RAISE EXCEPTION
      'Receipt cannot be issued: payment % has not been settled into a government account',
      pay.payment_reference
      USING ERRCODE = 'restrict_violation',
            HINT = 'A government receipt asserts the State received the money. Until a bank '
                   'credit covering this collection is reconciled, the gateway holds it and the '
                   'taxpayer holds an acknowledgement of payment.';
  END IF;

  -- The settlement has to have settled something.
  SELECT * INTO stl FROM settlements WHERE id = pay.settlement_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Receipt cannot be issued: payment % points at a settlement that does not exist',
      pay.payment_reference
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF stl.status <> 'RECONCILED' THEN
    RAISE EXCEPTION
      'Receipt cannot be issued: settlement % is %, not RECONCILED',
      stl.settlement_reference, stl.status
      USING ERRCODE = 'restrict_violation',
            HINT = 'A settlement settles its collections only when the credit received covers '
                   'them. While it is pending or disputed the money is not the State''s to '
                   'receipt, and the taxpayer holds an acknowledgement instead.';
  END IF;

  IF pay.transaction_id <> NEW.transaction_id THEN
    RAISE EXCEPTION 'Receipt payment/transaction mismatch for receipt %', NEW.receipt_number
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.amount_kobo <> pay.amount_kobo THEN
    RAISE EXCEPTION
      'Receipt amount % does not match payment amount % for receipt %',
      NEW.amount_kobo, pay.amount_kobo, NEW.receipt_number
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
