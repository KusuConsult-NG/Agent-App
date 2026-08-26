-- Whose fault the reversal was.
--
-- A taxpayer's compliance score subtracts up to ten points for reversed or
-- refunded transactions, and the score is not decorative: `incentives.ts`
-- gates programme eligibility on it, so points decide whether a farmer is
-- offered subsidised fertiliser and seed.
--
-- The count made no distinction about cause. Every reversal counted — including
-- the ones where PSIRS charged somebody twice and gave one back, where an agent
-- raised an assessment against the wrong record, or where a rate was applied
-- that the House had repealed. In each of those the state made the mistake,
-- corrected it, and then took points off the citizen for having been on the
-- receiving end of it. A taxpayer who is refunded because of a clerical error
-- has behaved impeccably.
--
-- So a reversal now records who it is attributable to, and only a reversal
-- attributable to the TAXPAYER touches the score:
--
--   TAXPAYER    the payment failed on their side after the fact — a card
--               chargeback, a bank recall, an instrument that did not clear
--   GOVERNMENT  PSIRS or its agent made the error being corrected
--   GATEWAY     the payment infrastructure settled something it should not have
--
-- The default is GOVERNMENT rather than TAXPAYER, deliberately: an officer who
-- does not say must not be able to cost a citizen their seed subsidy by
-- omission. Blaming the taxpayer has to be something somebody chose to record.

ALTER TABLE refunds
  ADD COLUMN attributable_to TEXT NOT NULL DEFAULT 'GOVERNMENT'
    CHECK (attributable_to IN ('TAXPAYER', 'GOVERNMENT', 'GATEWAY'));

COMMENT ON COLUMN refunds.attributable_to IS
  'Who the reversal is attributable to. Only TAXPAYER affects the compliance score, '
  'and the default is GOVERNMENT so that saying nothing never costs a citizen points.';

CREATE INDEX idx_refunds_attributable ON refunds (transaction_id, attributable_to);
