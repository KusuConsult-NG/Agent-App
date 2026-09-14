-- A receipt says the State received the money. It has to be true.
--
-- Until now a receipt was issued the moment the *gateway* confirmed a payment.
-- That is not the same thing. A payment the gateway has confirmed is money the
-- gateway holds; it reaches the Plateau State Government account in a batch a
-- day or two later, and if it never arrives — a gateway failure, a disputed
-- batch, a credit that never lands — the State has issued a government receipt
-- for money it does not have. For a vehicle particulars document the cost is
-- worse still: the State granted a legal instrument, valid at a checkpoint for
-- a year, in exchange for nothing.
--
-- Section 95 says no transaction may appear successful unless independently
-- confirmed by the payment/revenue infrastructure. The gateway is the payment
-- half. The government account is the revenue half, and it is the half that
-- decides whether the State was actually paid.
--
-- WHAT THE CITIZEN GETS IN THE MEANTIME. Not nothing — that would take a
-- citizen's money and leave them with no evidence of it, at a market stall,
-- with an agent who has nothing to show them. They get an ACKNOWLEDGEMENT OF
-- PAYMENT: a verifiable document that says the gateway has confirmed their
-- payment, that the State has not yet received it, and that a receipt follows.
-- It is deliberately a different document type with different wording, because
-- an acknowledgement that looked like a receipt would be the whole problem
-- again in a different font.

ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_document_type_check;
ALTER TABLE documents ADD CONSTRAINT documents_document_type_check
  CHECK (document_type IN (
    'RECEIPT', 'INVOICE', 'ASSESSMENT', 'VEHICLE_RENEWAL',
    'TIN_CONFIRMATION', 'PAYMENT_EVIDENCE', 'PAYMENT_ACKNOWLEDGEMENT'));

COMMENT ON COLUMN documents.document_type IS
  'PAYMENT_ACKNOWLEDGEMENT is issued when the gateway confirms and says plainly that the State '
  'has not yet received the money. RECEIPT is issued only once it has. The two are separate '
  'types rather than one document in two states, because public verification has to be able to '
  'tell a citizen which of the two they are holding.';

-- ==============================================================================
-- A receipt now requires the money to have reached the government account.
--
-- The trigger already refused a receipt for a payment the gateway had not
-- confirmed. It now also refuses one for a payment the State has not been paid:
-- `settlement_id` is set by `recordSettlement` when a bank credit covering the
-- collection has been reconciled, and a settlement whose credit does not match
-- the collections it covers settles none of them.
--
-- This is a BEFORE INSERT trigger rather than an application check for the
-- reason every other financial control here is: it holds even against a
-- compromised service account, and there is no code path — route, admin screen
-- or service function — that can talk its way past it.
-- ==============================================================================
CREATE OR REPLACE FUNCTION enforce_receipt_requires_verified_payment() RETURNS TRIGGER AS $$
DECLARE
  pay payments%ROWTYPE;
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

-- ==============================================================================
-- Vehicle particulars now require the same.
--
-- The renewal document is what a driver shows at a checkpoint. Issuing it on
-- the gateway's word meant the State could grant a year of legal cover for a
-- payment that never arrived, and take a year to find out. The permitted
-- transaction states narrow accordingly: RECEIPT_GENERATED and SETTLED are
-- reached only after settlement, and PAYMENT_VERIFIED and
-- RECONCILIATION_PENDING — the two states that mean the gateway has confirmed
-- and the State has not been paid — are no longer among them.
-- ==============================================================================
CREATE OR REPLACE FUNCTION enforce_renewal_requires_verified_payment() RETURNS TRIGGER AS $$
DECLARE
  txn_status TEXT;
BEGIN
  IF NEW.document_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.document_id IS NOT DISTINCT FROM OLD.document_id THEN
    RETURN NEW;
  END IF;

  IF NEW.transaction_id IS NULL THEN
    RAISE EXCEPTION 'Vehicle renewal document requires a paid transaction'
      USING ERRCODE = 'restrict_violation';
  END IF;

  SELECT status INTO txn_status FROM transactions WHERE id = NEW.transaction_id;

  IF txn_status NOT IN ('RECEIPT_GENERATED', 'SETTLED') THEN
    RAISE EXCEPTION
      'Vehicle particulars cannot be issued: transaction is %, and the money has not reached a government account',
      txn_status
      USING ERRCODE = 'restrict_violation',
            HINT = 'Particulars are issued when the settlement covering the renewal is reconciled.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ==============================================================================
-- A transaction's history has to be readable in the order it happened.
--
-- `transaction_events` was ordered by `created_at`, which in PostgreSQL is
-- transaction time: every event written inside one database transaction carries
-- the same timestamp to the microsecond, and `id` is a random UUID, so nothing
-- broke the tie. It never showed before because each transition happened in its
-- own request. Settlement writes two — RECEIPT_GENERATED and then SETTLED — and
-- an auditor reading the chain got them in whichever order the planner felt
-- like, including the one that says the State receipted the money after it had
-- already banked it.
--
-- That ordering is the whole point of this change. "The receipt was issued
-- because the settlement landed" is a claim about sequence, and a history that
-- cannot express sequence cannot support it.
--
-- An identity column is monotonic within a transaction as well as across one,
-- so ordering by (created_at, sequence) gives clock order between transactions
-- and insertion order inside one. Existing rows are numbered in the only order
-- that is still recoverable for them, which is their timestamp.
-- ==============================================================================
ALTER TABLE transaction_events
  ADD COLUMN IF NOT EXISTS sequence BIGINT GENERATED BY DEFAULT AS IDENTITY;

COMMENT ON COLUMN transaction_events.sequence IS
  'Insertion order. created_at is transaction time and ties for every event written in one '
  'database transaction, so read a history with ORDER BY created_at, sequence.';

DROP INDEX IF EXISTS idx_txn_events_txn;
CREATE INDEX idx_txn_events_txn ON transaction_events(transaction_id, created_at, sequence);
