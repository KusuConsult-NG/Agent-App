-- A fraud flag can be about a settlement.
--
-- `fraud_flags.entity_type` listed six kinds of thing and settlement was not
-- among them, so the one rule that flags a settlement — the batch the gateway
-- paid in came up short against the collections it was supposed to cover —
-- filed itself as 'TRANSACTION' and put a settlement id in `entity_id`. The
-- row satisfied the constraint and described the wrong object: any join from
-- `entity_id` to `transactions` for a flag of that type finds nothing, and an
-- officer reading the queue is told a transaction is in question when it is a
-- bank credit.
--
-- The variance is the largest single thing this platform can notice about
-- money — a whole day's collections from one gateway — so it should be able to
-- say what it is about.

ALTER TABLE fraud_flags DROP CONSTRAINT IF EXISTS fraud_flags_entity_type_check;

ALTER TABLE fraud_flags ADD CONSTRAINT fraud_flags_entity_type_check
  CHECK (entity_type IN (
    'TRANSACTION', 'AGENT', 'TAXPAYER', 'DEVICE', 'REFEREE', 'COMMISSION', 'SETTLEMENT'));
