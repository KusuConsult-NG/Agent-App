BEGIN;

/*
 * A fraud flag can be about an officer.
 *
 * `fraud_flags.entity_type` listed seven kinds of thing and every one of them
 * was something an agent or a taxpayer does. The engine could say an agent was
 * collecting too fast, that a phone number was shared, that a settlement came
 * up short -- and it could say nothing at all about the people with the
 * strongest levers in the building. An officer who reverses payments, corrects
 * taxpayer records and approves adjustments all day was invisible to it, which
 * is the wrong way round: the field can steal a receipt, the back office can
 * rewrite what a receipt says.
 *
 * The three rules that arrive with this migration -- unusual officer activity,
 * frequent manual interventions, and repeated regeneration of a document that
 * is supposed to be issued once -- all file against a user, so the row has to
 * be able to hold one.
 *
 * DOCUMENT joins the list for the same reason: a receipt printed a fourth time
 * is a fact about that document, and filing it against the transaction would
 * put a flag on money that is not in question.
 */
ALTER TABLE fraud_flags DROP CONSTRAINT IF EXISTS fraud_flags_entity_type_check;

ALTER TABLE fraud_flags ADD CONSTRAINT fraud_flags_entity_type_check
  CHECK (entity_type IN (
    'TRANSACTION', 'AGENT', 'TAXPAYER', 'DEVICE', 'REFEREE', 'COMMISSION',
    'SETTLEMENT', 'USER', 'DOCUMENT'));

COMMIT;
