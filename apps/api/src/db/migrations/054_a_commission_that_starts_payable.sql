-- The half of migration 053's commission rule that was not there.
--
-- 053 refused a commission moving into a payable state on revenue that had not
-- settled, and it was written as an UPDATE trigger because that is the shape
-- the attack took: a row accrues PENDING and is then promoted. It closed that
-- door and left the other one open. Nothing stopped a commission being
-- INSERTed already ELIGIBLE.
--
--   INSERT INTO commissions (agent_id, transaction_id, policy_id,
--                            rate_basis_points, basis_amount_kobo, amount_kobo,
--                            status, eligible_at)
--   VALUES (..., 'ELIGIBLE', now());
--
-- requestPayout selects exactly that, so the row is payable the moment it
-- exists, and it never passed through the state the rule watches.
--
-- The existing INSERT trigger, enforce_commission_requires_verified_revenue,
-- asks a different question — that the transaction is at least payment-verified
-- — and RECONCILIATION_PENDING satisfies it, correctly: accrual at PENDING
-- before settlement is deliberate and is how every real commission begins. It
-- is the *starting status* that was unexamined.
--
-- Found by the revision-10 money review's own 6c, which asserted this and was
-- passing for the wrong reason: its fixture inserted against a transaction that
-- already had a commission, so the UNIQUE index on transaction_id refused the
-- row before any rule was consulted. A test that accepts either answer cannot
-- tell you which one it got. The assertion is now specific to the settlement
-- refusal, and the fixture inserts against a transaction that has no commission
-- row, so the index cannot answer for the rule.

BEGIN;

CREATE OR REPLACE FUNCTION enforce_payable_commission_requires_settlement() RETURNS TRIGGER AS $$
DECLARE
  txn_status TEXT;
  changing   BOOLEAN;
BEGIN
  -- On INSERT there is no OLD, and any payable starting status is a change
  -- from nothing. On UPDATE only a transition into a payable status counts, so
  -- a row already ELIGIBLE that is updated for some other reason is left alone.
  changing := CASE
    WHEN TG_OP = 'INSERT' THEN TRUE
    ELSE OLD.status IS DISTINCT FROM NEW.status
  END;

  IF NEW.status IN ('ELIGIBLE', 'APPROVED', 'PAID') AND changing THEN
    SELECT status INTO txn_status FROM transactions WHERE id = NEW.transaction_id;

    IF txn_status IS DISTINCT FROM 'SETTLED' THEN
      RAISE EXCEPTION
        'Commission cannot become %: its transaction is %, not SETTLED',
        NEW.status, coalesce(txn_status, 'missing')
        USING ERRCODE = 'restrict_violation',
              HINT = 'An agent is paid out of money the State has received. Until the bank '
                     'credit covering the collection is reconciled, the commission stays '
                     'PENDING — including a commission being written for the first time.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS commissions_payable_requires_settlement ON commissions;
CREATE TRIGGER commissions_payable_requires_settlement
  BEFORE INSERT OR UPDATE ON commissions
  FOR EACH ROW EXECUTE FUNCTION enforce_payable_commission_requires_settlement();

COMMIT;
