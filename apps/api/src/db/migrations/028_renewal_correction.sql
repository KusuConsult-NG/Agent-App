-- A renewal must still be correctable after its transaction is reversed.
--
-- `enforce_renewal_requires_verified_payment` exists to stop a vehicle document
-- being attached to a renewal whose transaction was never paid — the second
-- inviolable rule, applied to vehicle papers (PRD §22). It is right, and it
-- stays.
--
-- But it fires on INSERT OR UPDATE and checks the transaction on every update
-- of a row that already carries a document_id. Once a reversal moves the
-- transaction to REVERSED or REFUNDED, *every* subsequent write to that renewal
-- row is refused — including the write that withdraws it. The control that
-- protects issuance was also blocking the correction, so a renewal whose money
-- had been returned was frozen at COMPLETED with no way to say otherwise.
--
-- The check now applies only when the document link is actually being set or
-- changed. Attaching a document to an unpaid renewal is refused exactly as
-- before; updates that leave document_id alone — cancelling, re-notifying the
-- authority — are allowed through.
CREATE OR REPLACE FUNCTION enforce_renewal_requires_verified_payment() RETURNS TRIGGER AS $$
DECLARE
  txn_status TEXT;
BEGIN
  IF NEW.document_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Not an issuance: the document link is untouched by this update.
  IF TG_OP = 'UPDATE' AND NEW.document_id IS NOT DISTINCT FROM OLD.document_id THEN
    RETURN NEW;
  END IF;

  IF NEW.transaction_id IS NULL THEN
    RAISE EXCEPTION 'Vehicle renewal document requires a paid transaction'
      USING ERRCODE = 'restrict_violation';
  END IF;

  SELECT status INTO txn_status FROM transactions WHERE id = NEW.transaction_id;
  IF txn_status NOT IN ('PAYMENT_VERIFIED', 'RECEIPT_GENERATED', 'RECONCILIATION_PENDING', 'SETTLED') THEN
    RAISE EXCEPTION
      'Vehicle renewal document cannot be issued while transaction is %', txn_status
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
