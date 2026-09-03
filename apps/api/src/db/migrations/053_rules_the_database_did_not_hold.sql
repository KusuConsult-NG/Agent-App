-- Three money rules the service enforced and the database did not.
--
-- This report's own standard, stated in its method section and in migration
-- 040's comment: a guarantee is tested by bypassing the application entirely
-- and issuing SQL directly, because "a rule that only holds when you go through
-- the service layer is not an invariant". Three rules failed that test. Each is
-- correct in the service and each was one UPDATE away from being undone by a
-- compromised service account or a DBA at a psql prompt.
--
--   * A transaction reached SETTLED without any settlement having settled it,
--     and the commission promotion job then released the agent's money:
--         UPDATE transactions SET status = 'SETTLED', settled_at = now() - interval '80 hours';
--     Migration 052 closed the receipt against this — a receipt now checks the
--     settlement is RECONCILED — but SETTLED is also the gate on commission,
--     and that gate was still open.
--
--   * A commission moved PENDING -> ELIGIBLE, which is exactly what
--     requestPayout selects, on a transaction that had not settled:
--         UPDATE commissions SET status = 'ELIGIBLE', eligible_at = now();
--     The existing trigger fires only BEFORE INSERT and asks only that the
--     transaction was verified. Nothing watched the status afterwards.
--
--   * A REVOKED acknowledgement went back to ISSUED:
--         UPDATE documents SET status = 'ISSUED';
--     and public verification then answered VALID for a payment the State had
--     given back — the citizen-facing surface asserting the money is good,
--     which is the failure the acknowledgement was introduced to prevent.
--
-- None of these is reachable through a route. That is the point: the controls
-- above them are sound, and this is the layer that is supposed to hold when
-- something has got past them.

BEGIN;

-- Each trigger is dropped first. `CREATE OR REPLACE` exists for functions and
-- not for triggers, so a migration that only creates them cannot be run twice
-- — and the runner is not the only thing that ever applies one of these files.


-- ---------------------------------------------------------------------------
-- A transaction settles because a settlement settled it.
--
-- SETTLED means the State has the money. The evidence is a payment on this
-- transaction linked to a RECONCILED settlement — the same test the receipt
-- trigger applies, asked one step earlier, so the two cannot disagree about
-- what settlement means.
--
-- Written as a state-change guard rather than a blanket one: a row already
-- SETTLED that is updated for any other reason is left alone, so this refuses
-- the transition and not the record.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_settled_has_a_settlement() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'SETTLED' AND OLD.status IS DISTINCT FROM 'SETTLED' THEN
    IF NOT EXISTS (
      SELECT 1
        FROM payments p
        JOIN settlements s ON s.id = p.settlement_id
       WHERE p.transaction_id = NEW.id
         AND s.status = 'RECONCILED'
    ) THEN
      RAISE EXCEPTION
        'Transaction % cannot be SETTLED: no reconciled settlement covers it',
        NEW.transaction_reference
        USING ERRCODE = 'restrict_violation',
              HINT = 'SETTLED asserts the State received the money, and releases the agent''s '
                     'commission. Record the bank credit through the settlement route, which '
                     'checks it against the gateway''s statement first.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS transactions_settled_requires_settlement ON transactions;
CREATE TRIGGER transactions_settled_requires_settlement
  BEFORE UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION enforce_settled_has_a_settlement();

-- ---------------------------------------------------------------------------
-- Payable commission requires settled revenue.
--
-- PENDING and ON_HOLD say nothing about money leaving the building. ELIGIBLE,
-- APPROVED and PAID do: ELIGIBLE is what requestPayout selects, and everything
-- after it is a step towards a bank transfer. Those three require the
-- transaction to have settled.
--
-- The existing INSERT trigger is left as it is. It asks a different and still
-- correct question — that commission accrues only on verified revenue — and
-- accrual at PENDING before settlement is deliberate.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_payable_commission_requires_settlement() RETURNS TRIGGER AS $$
DECLARE
  txn_status TEXT;
BEGIN
  IF NEW.status IN ('ELIGIBLE', 'APPROVED', 'PAID')
     AND OLD.status IS DISTINCT FROM NEW.status THEN
    SELECT status INTO txn_status FROM transactions WHERE id = NEW.transaction_id;

    IF txn_status IS DISTINCT FROM 'SETTLED' THEN
      RAISE EXCEPTION
        'Commission cannot become %: its transaction is %, not SETTLED',
        NEW.status, coalesce(txn_status, 'missing')
        USING ERRCODE = 'restrict_violation',
              HINT = 'An agent is paid out of money the State has received. Until the bank '
                     'credit covering the collection is reconciled, the commission stays '
                     'PENDING.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS commissions_payable_requires_settlement ON commissions;
CREATE TRIGGER commissions_payable_requires_settlement
  BEFORE UPDATE ON commissions
  FOR EACH ROW EXECUTE FUNCTION enforce_payable_commission_requires_settlement();

-- ---------------------------------------------------------------------------
-- Revocation is the end of a document.
--
-- A receipt or an acknowledgement is revoked when the money behind it goes
-- back. Public verification reads `status`, so a revoked document returning to
-- ISSUED is the platform telling a citizen that a refunded payment is good —
-- and it is the one surface that answers without asking who is looking.
--
-- REVOKED is therefore terminal. SUPERSEDED is not: a reissued document
-- replaces its predecessor, which is an ordinary event.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_revocation_is_final() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'REVOKED' AND NEW.status <> 'REVOKED' THEN
    RAISE EXCEPTION
      'Document % is REVOKED and cannot be returned to %',
      OLD.document_number, NEW.status
      USING ERRCODE = 'restrict_violation',
            HINT = 'A document is revoked when the money behind it went back. Public '
                   'verification reads this column, so un-revoking one would tell a citizen '
                   'that a refunded payment is good. Issue a new document instead.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS documents_revocation_is_final ON documents;
CREATE TRIGGER documents_revocation_is_final
  BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION enforce_revocation_is_final();

COMMIT;
