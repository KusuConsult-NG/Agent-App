-- One acknowledgement per collection, guaranteed by the database.
--
-- `receipts` has carried UNIQUE (transaction_id) and UNIQUE (payment_id) since
-- the schema was written, because a second receipt for one collection is a
-- second government assertion that the same money was received. The
-- acknowledgement introduced alongside it had no such guarantee: the only thing
-- stopping a redelivered webhook and an agent's poll from producing two was
-- application code and the order the two happened to arrive in.
--
-- That is the wrong side of this project's own line. Every other financial
-- control here is in the database precisely so it holds when the application is
-- wrong, when a service account is compromised, or when two callers arrive in
-- an order nobody anticipated — and an acknowledgement is what the taxpayer
-- holds for the day or two before the receipt exists. Two of them, with
-- different numbers, for the same money, is exactly the kind of thing that
-- makes a citizen doubt the one piece of evidence they were given.
--
-- Partial rather than total: `documents` holds every kind of document, and only
-- a payment acknowledgement against a transaction is constrained here. The
-- REVOKED exclusion matches what `issueAcknowledgement` looks for, so a revoked
-- acknowledgement can still be reissued.
CREATE UNIQUE INDEX IF NOT EXISTS documents_one_acknowledgement_per_transaction
  ON documents (entity_id)
  WHERE document_type = 'PAYMENT_ACKNOWLEDGEMENT'
    AND entity_type = 'transaction'
    AND status <> 'REVOKED';
