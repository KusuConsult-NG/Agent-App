-- ============================================================================
-- An open objection suspends enforcement. It was suspending one thing.
--
-- A trader who thinks a presumptive estimate is wrong may object, and while
-- the objection is open the State does not come after the money. The arrears
-- worklist honours that: `collectable` excludes any invoice whose assessment
-- has an OPEN objection, with a comment saying why — "a citizen who formally
-- disputed an estimate and then got a call demanding payment has been told the
-- objection window means nothing."
--
-- Three other readers never got the message, because they all read
-- `taxpayer_compliance.outstanding_amount_kobo`, which is computed from
-- `status IN ('UNPAID','PARTIALLY_PAID')` and knows nothing about objections:
--
--   * `requires_no_arrears` incentive programmes disqualify the objector, so
--     exercising the right to object costs them a fertiliser entitlement;
--   * the compliance score docks 25 points for "outstanding liabilities";
--   * the public citizen portal answers HAS_ARREARS and tells them to
--     "contact your nearest PSIRS office or a revenue agent to pay".
--
-- Measured on a trader assessed at 4,800,000 kobo who then objected: the
-- arrears worklist dropped them, and outstanding stayed 4,800,000 with the
-- score stuck at 20. A cost for objecting is the one thing an objection window
-- may not have — least of all one the taxpayer never sees, imposed over a bill
-- the objection may be about to overturn.
--
-- WHY A SECOND COLUMN RATHER THAN A NARROWER FIRST ONE.
--
-- `outstanding_amount_kobo` is also summed per LGA in the receivables report,
-- where it answers "what is the State owed". Disputed money is still owed
-- until somebody decides the objection, so narrowing that column would make a
-- finance report understate the State's own book. The disputed part is
-- recorded beside it instead, computed in the same pass from the same rule, so
-- every reader can take the view its own question needs without a second
-- definition of "owed" appearing anywhere.
-- ============================================================================

ALTER TABLE taxpayer_compliance
  ADD COLUMN IF NOT EXISTS disputed_amount_kobo BIGINT NOT NULL DEFAULT 0
    CHECK (disputed_amount_kobo >= 0);

COMMENT ON COLUMN taxpayer_compliance.disputed_amount_kobo IS
  'The part of outstanding_amount_kobo sitting under an OPEN objection, and so '
  'suspended from enforcement. Always <= outstanding_amount_kobo: both are '
  'computed in one pass in syncTaxpayerComplianceAndIncentives. Readers that '
  'enforce — the incentive arrears gate, the compliance score, the citizen '
  'portal — must net this off. Readers that report what the State is owed must '
  'not.';
