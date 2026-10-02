-- The rule that stops the State refunding more than it took, made race-safe.
--
-- `enforce_refund_within_payment` (migration 032) sums the refunds already
-- against a payment and refuses an insert that would take the total past what
-- was paid. It reads the payment row and the existing refunds without locking
-- anything.
--
-- Under READ COMMITTED, which is this platform's default, two transactions
-- inserting a refund against the same payment cannot see each other's
-- uncommitted row. Each sums the refunds and finds none. Each passes. Both
-- commit. The total refunded is twice the payment, and the gateway is asked to
-- return the money twice.
--
-- It takes nothing exotic to get there. `recordReversal` locks the APPROVAL it
-- is executing, not the payment, and `approvals` carries no uniqueness on
-- `(entity_id, approval_type)` — so two reversal approvals for one transaction
-- can both exist, both be granted, and both be executed at the same moment.
-- Every guard in that function reads state that neither transaction has
-- committed yet: the verified payment is still verified to both, and the
-- amount each is checked against is the same payment. A reversal returns the
-- payment in full, by rule, so the two refunds are each for the whole of it.
--
-- `enforce_round_quantity`, twelve migrations earlier, has the same shape and
-- takes `FOR UPDATE` on its parent row — "so two officers issuing at once
-- cannot between them promise fertiliser that does not exist". This is that
-- sentence about money leaving a government account.
--
-- Locking the payment row is what serialises the two. The second insert blocks
-- until the first commits, then re-reads the refunds in a fresh statement,
-- sees the committed one, and is refused with the message it always had. The
-- only behaviour that changes is the behaviour under contention: sequentially
-- the rule already worked, which is why its own test passed.

CREATE OR REPLACE FUNCTION enforce_refund_within_payment() RETURNS TRIGGER AS $$
DECLARE
  paid            BIGINT;
  already_refunded BIGINT;
BEGIN
  -- FOR UPDATE, and before the sum. The lock is on the payment because that is
  -- the thing being spent against; holding it is what makes the sum below a
  -- statement about every refund rather than about this transaction's own.
  SELECT amount_kobo INTO paid FROM payments WHERE id = NEW.payment_id FOR UPDATE;
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
