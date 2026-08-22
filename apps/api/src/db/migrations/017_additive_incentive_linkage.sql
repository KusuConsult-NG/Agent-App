-- =============================================================================
-- 017 — Additive social incentive linkage
-- =============================================================================
--
-- PRD §40 carries a safeguard the platform is supposed to enforce:
--
--   "The platform should not automatically deny essential public services
--    merely because a person is not tax-compliant, unless such linkage is
--    specifically authorized by applicable law or policy."
--
-- Four social programmes were seeded with compliance thresholds that denied.
-- The health insurance scheme required no arrears and a score of 40, so a
-- citizen behind on their taxes was recorded as ineligible for subsidised
-- state health cover; the bursary required a score of 50. Both were created by
-- raw SQL, which never reaches the guard in `createProgramme`, and both are
-- typed HEALTH_INSURANCE / EDUCATION_BURSARY while the guard matched the
-- strings HEALTHCARE / EDUCATION — so it would not have fired even through the
-- service. The safeguard was bypassed twice over, and nobody had recorded a
-- decision to bypass it.
--
-- The intent behind these programmes was always "a reward for paying and not
-- defaulting", which is a different thing from "a penalty for being behind".
-- This migration makes the platform able to express the difference.
--
-- ELIGIBILITY_GATE   compliance decides whether a citizen qualifies at all.
--                    Correct for a scarce discretionary benefit — a housing
--                    loan the state can only extend to so many people.
--
-- ADDITIVE_BENEFIT   compliance never denies. It decides how much. A citizen
--                    who holds a TIN is in; paying on time moves them from the
--                    base entitlement to the full one. Nothing is withdrawn
--                    from anybody, so §40 is satisfied without needing a
--                    statute to point at.
--
-- Structural criteria still apply in both modes — a closed programme, the wrong
-- taxpayer type, an address outside the target LGAs, no TIN. Those are scope,
-- not a compliance penalty.

-- ---------------------------------------------------------------------------
-- 1. How a programme links benefit to compliance
-- ---------------------------------------------------------------------------
-- Defaults to ELIGIBILITY_GATE so every existing programme keeps the behaviour
-- it already had. Becoming additive is an explicit decision, made per
-- programme, and visible in the row.

ALTER TABLE incentive_programmes
  ADD COLUMN IF NOT EXISTS linkage_mode TEXT NOT NULL DEFAULT 'ELIGIBILITY_GATE';

ALTER TABLE incentive_programmes
  DROP CONSTRAINT IF EXISTS incentive_programmes_linkage_mode_check;

ALTER TABLE incentive_programmes
  ADD CONSTRAINT incentive_programmes_linkage_mode_check
  CHECK (linkage_mode IN ('ELIGIBILITY_GATE', 'ADDITIVE_BENEFIT'));

COMMENT ON COLUMN incentive_programmes.linkage_mode IS
  'ELIGIBILITY_GATE: compliance decides whether the citizen qualifies. '
  'ADDITIVE_BENEFIT: compliance decides the benefit tier and never denies '
  'the benefit outright (PRD §40).';

-- ---------------------------------------------------------------------------
-- 2. Which tier an evaluation awarded
-- ---------------------------------------------------------------------------
-- Nullable, because a gated programme has no tier: it is a yes or a no. On an
-- additive programme this is where the compliance signal actually lands, so a
-- citizen can be told "you have cover, and clearing your arrears upgrades it"
-- rather than simply "no".

ALTER TABLE programme_eligibility
  ADD COLUMN IF NOT EXISTS benefit_tier TEXT;

ALTER TABLE programme_eligibility
  DROP CONSTRAINT IF EXISTS programme_eligibility_benefit_tier_check;

ALTER TABLE programme_eligibility
  ADD CONSTRAINT programme_eligibility_benefit_tier_check
  CHECK (benefit_tier IS NULL OR benefit_tier IN ('BASE', 'FULL'));

-- ---------------------------------------------------------------------------
-- 3. Health insurance and the bursary become additive
-- ---------------------------------------------------------------------------
-- Both are essential public services under §40. Neither has a recorded legal
-- basis for denying access on tax grounds, and the policy decision taken is
-- that they are incentives rather than gates.
--
-- The thresholds are deliberately left in place rather than zeroed. Under
-- ADDITIVE_BENEFIT they no longer deny anybody — they are what separates the
-- base entitlement from the full one, which is exactly the reward the
-- programmes were meant to offer. Zeroing them would remove the incentive
-- along with the penalty.

UPDATE incentive_programmes
   SET linkage_mode = 'ADDITIVE_BENEFIT'
 WHERE code IN ('PLASHIA', 'SCHOLARSHIP-BURSARY');

-- Any eligibility already recorded against those programmes was decided under
-- the gate rule and may say "not eligible" for a reason that no longer denies.
-- Clearing them forces a fresh evaluation rather than leaving a stale refusal
-- attached to a citizen's record.
DELETE FROM programme_eligibility
 WHERE programme_id IN (
   SELECT id FROM incentive_programmes WHERE code IN ('PLASHIA', 'SCHOLARSHIP-BURSARY')
 );
