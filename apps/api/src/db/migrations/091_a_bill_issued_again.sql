-- ---------------------------------------------------------------------------
-- A bill issued again, for the debt it was always for.
--
-- An invoice that passes its deadline cannot be paid. The payment path refuses
-- it with INVOICE_EXPIRED, and its advice — "Raise a new assessment for the
-- taxpayer" — was the only road to the money still owed. That road re-runs
-- the rate engine against today's catalogue instead of carrying the figure the
-- State already determined, and it leaves the first bill standing beside the
-- second: two demands for one liability. A payment reversed by the taxpayer's
-- own bank was the same dead end by another way. The bill is owed again and
-- its transaction is REVERSED, which nothing can pay, and the comment beside
-- that reversal called it "a gap, and one this does not close".
--
-- Measured before this migration: a lapsed bill, and an attempt to pay it,
-- refused; nothing in the platform could replace it except a second
-- assessment for the same levy and period.
--
-- So a bill that can no longer be paid can be issued again: a fresh invoice
-- and transaction against the SAME assessment, for the same amounts, with a
-- new payment window. The old invoice is cancelled and names its replacement.
-- The liability — the assessment, its period, its objection, its PAYE
-- schedule — is untouched, because none of that changed. Only the demand did.
--
-- The database holds the parts that make that safe, rather than trusting the
-- one service that does it:
--
--   1. `reissued_as` names the replacement and, once written, never changes.
--   2. A replaced invoice is CANCELLED, so nothing counting what is owed can
--      count the debt twice.
--   3. The replacement is for the same assessment, the same taxpayer and the
--      same amounts, it is itself unpaid and unreplaced, and the invoice it
--      replaces had nothing paid against it. A reissue renews a demand; it
--      cannot alter one, double one, or swallow money already taken.
--   4. An assessment has at most one live invoice. Deferred to the end of the
--      transaction, because the replacement has to exist before the invoice
--      it replaces can name it.
--
-- And revenue officers may do it, as agents already could (see the grant at
-- the end).
-- ---------------------------------------------------------------------------

BEGIN;

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS reissued_as UUID REFERENCES invoices(id);

COMMENT ON COLUMN invoices.reissued_as IS
  'The invoice issued in place of this one, for the same assessment and amounts. Set once, when this invoice is cancelled by a reissue.';

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_replaced_is_cancelled;
ALTER TABLE invoices ADD CONSTRAINT invoices_replaced_is_cancelled
  CHECK (reissued_as IS NULL OR status = 'CANCELLED');

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_one_live_per_assessment;
ALTER TABLE invoices ADD CONSTRAINT invoices_one_live_per_assessment
  EXCLUDE USING btree (assessment_id WITH =) WHERE (reissued_as IS NULL)
  DEFERRABLE INITIALLY DEFERRED;

CREATE OR REPLACE FUNCTION enforce_invoice_reissue() RETURNS TRIGGER AS $$
DECLARE
  replacement RECORD;
BEGIN
  IF OLD.reissued_as IS NOT DISTINCT FROM NEW.reissued_as THEN
    RETURN NEW;
  END IF;

  IF OLD.reissued_as IS NOT NULL THEN
    RAISE EXCEPTION 'Invoice % was replaced by another invoice, and a replacement is never changed',
      OLD.invoice_number
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.amount_paid_kobo <> 0 OR OLD.status IN ('PAID', 'PARTIALLY_PAID') THEN
    RAISE EXCEPTION 'Invoice % has money paid against it and cannot be issued again',
      OLD.invoice_number
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.reissued_as = OLD.id THEN
    RAISE EXCEPTION 'Invoice % cannot replace itself', OLD.invoice_number
      USING ERRCODE = 'restrict_violation';
  END IF;

  SELECT assessment_id, taxpayer_id, amount_kobo, service_charge_kobo, total_amount_kobo,
         amount_paid_kobo, status, reissued_as
    INTO replacement
    FROM invoices WHERE id = NEW.reissued_as;

  IF replacement.assessment_id IS DISTINCT FROM OLD.assessment_id
     OR replacement.taxpayer_id IS DISTINCT FROM OLD.taxpayer_id
     OR replacement.amount_kobo IS DISTINCT FROM OLD.amount_kobo
     OR replacement.service_charge_kobo IS DISTINCT FROM OLD.service_charge_kobo
     OR replacement.total_amount_kobo IS DISTINCT FROM OLD.total_amount_kobo THEN
    RAISE EXCEPTION 'Invoice % can only be replaced by an invoice for the same assessment, taxpayer and amounts',
      OLD.invoice_number
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF replacement.status <> 'UNPAID' OR replacement.amount_paid_kobo <> 0
     OR replacement.reissued_as IS NOT NULL THEN
    RAISE EXCEPTION 'Invoice % can only be replaced by a new, unpaid invoice', OLD.invoice_number
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS invoices_reissue_guard ON invoices;
CREATE TRIGGER invoices_reissue_guard BEFORE UPDATE OF reissued_as ON invoices
  FOR EACH ROW EXECUTE FUNCTION enforce_invoice_reissue();

-- Who may do it. Agents have held `invoice:create` since migration 059 with
-- nothing consulting it; the reissue route is what it now guards. Revenue
-- officers are granted it for the lapsed bills on their arrears list. They
-- hold no `assessment:create`, and this gives them no way to raise one: a
-- reissue carries the amount already determined, and the trigger above
-- refuses anything else. The same shape as migrations 067 and 075, so a
-- deployment whose role map is already data receives the grant too.
INSERT INTO role_permissions (role, permission, reason) VALUES
  ('revenue_officer', 'invoice:create', 'Issuing a lapsed bill again; see migration 091')
ON CONFLICT (role, permission) DO NOTHING;

COMMIT;
