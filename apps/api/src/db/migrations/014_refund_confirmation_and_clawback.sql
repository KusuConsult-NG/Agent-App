-- Two things a reversal claimed but never did.
--
-- 1. REFUNDS WERE RECORDED AS COMPLETED WITHOUT ANY MONEY MOVING.
--
-- `executeReversal` inserted the refund row directly as COMPLETED, with
-- completed_at set, and never asked the payment gateway to return anything to
-- the taxpayer. The gateway contract had no refund method at all. So the
-- receipt was voided, the transaction marked REVERSED, and public verification
-- told anyone who checked that "the payment has since been reversed or
-- refunded" — while the money sat exactly where it was.
--
-- That is PRD §95 turned inside out. The rule that shaped this whole platform
-- is that nothing may appear successful unless the payment infrastructure
-- independently confirmed it, and a refund is the same promise pointing the
-- other way: a citizen who paid twice is told they have their money back.
--
-- The status column already allowed PENDING and FAILED; only the code refused
-- to use them. What it lacked was somewhere to record why an attempt failed
-- and how many have been made, so an unconfirmed refund can be retried rather
-- than quietly forgotten.
--
-- 2. CLAWBACK WAS RECORDED AND NEVER RECOVERED.
--
-- Reversing a transaction whose commission had already been paid marked the
-- commission REVERSED and reported a clawback figure, which was true and
-- inert: `requestPayout` sums only ELIGIBLE rows, so the next payout handed
-- over the full amount and the overpayment stayed with the agent. The comment
-- in the service called the overpayment "recoverable" when nothing recovered
-- it, and COMMISSION_ADJUSTMENT existed only as an approval type with no code
-- behind it.
--
-- Recovery is now netted off the next payout, which needs somewhere to record
-- that a given overpayment has been recovered — so it is deducted once and
-- not on every payout thereafter.

ALTER TABLE refunds
  ADD COLUMN failure_reason TEXT,
  ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN last_attempt_at TIMESTAMPTZ;

COMMENT ON COLUMN refunds.status IS
  'PENDING until the gateway confirms the money was returned. COMPLETED is a '
  'statement that a citizen has their money back, so nothing may set it without '
  'the gateway saying so.';

-- The queue the retry job reads: refunds owed to a taxpayer and not yet made.
CREATE INDEX idx_refunds_outstanding ON refunds(created_at)
  WHERE status IN ('PENDING', 'PROCESSING', 'FAILED');

ALTER TABLE commissions
  ADD COLUMN recovered_at TIMESTAMPTZ,
  ADD COLUMN recovered_by_payout_id UUID REFERENCES commission_payouts(id);

COMMENT ON COLUMN commissions.recovered_at IS
  'Set when a reversed commission that had already been paid was netted off a '
  'later payout. Only ever set on a row that was PAID before it was REVERSED.';

-- An overpayment is recovered once. Without this a concurrent payout could
-- deduct the same clawback twice, which takes money the agent does not owe.
CREATE UNIQUE INDEX idx_commissions_recovered_once ON commissions(id)
  WHERE recovered_at IS NOT NULL;

CREATE INDEX idx_commissions_outstanding_clawback ON commissions(agent_id)
  WHERE status = 'REVERSED' AND paid_at IS NOT NULL AND recovered_at IS NULL;
