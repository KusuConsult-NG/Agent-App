-- ---------------------------------------------------------------------------
-- A bill raised in error, withdrawn by two people.
--
-- An agent who charges a trader twice for one levy — the second press of a
-- button whose first press timed out, a charge raised against the wrong
-- record — leaves a debt nobody can take back. Three things cancel an
-- invoice: an objection upheld, a PAYE return withdrawn, and a reversal the
-- State caused. All three are about a bill somebody contested or paid. An
-- unpaid duplicate is neither, and `charge-raised-payment-not` in the agent's
-- tests describes exactly the debt it becomes: one "somebody has to argue
-- their way out of later". There was nowhere in the platform to argue.
--
-- Searched rather than assumed: every statement that sets an invoice to
-- CANCELLED is one of those three, or the reissue of migration 091, which
-- replaces a bill rather than withdrawing it.
--
-- So withdrawing one is an approval, like a reversal: requested by somebody
-- who may issue bills, decided by somebody else, and carried out only when
-- granted. Forgiving a debt is a lever on revenue, and the control on it is
-- the second person, whom the approvals table already guarantees is never the
-- first.
--
-- One open request per invoice, so two requests cannot both be granted and
-- the second carried out against a bill the first already withdrew.
-- ---------------------------------------------------------------------------

BEGIN;

ALTER TABLE approvals DROP CONSTRAINT IF EXISTS approvals_approval_type_check;
ALTER TABLE approvals ADD CONSTRAINT approvals_approval_type_check
  CHECK (approval_type IN (
    'AGENT_ACTIVATION', 'AGENT_SUSPENSION', 'COMMISSION_ADJUSTMENT',
    'COMMISSION_PAYOUT', 'REFUND', 'PAYMENT_REVERSAL',
    'REVENUE_RATE_CHANGE', 'MANUAL_CORRECTION', 'BANK_ACCOUNT_CHANGE',
    'TAXPAYER_ADJUSTMENT', 'AGENT_OVERRIDE_ACTIVATION', 'INVOICE_WITHDRAWAL'));

CREATE UNIQUE INDEX IF NOT EXISTS approvals_one_open_invoice_withdrawal
  ON approvals (entity_id)
  WHERE approval_type = 'INVOICE_WITHDRAWAL' AND status IN ('REQUESTED', 'REVIEWED');

COMMIT;
