-- ============================================================================
-- One per cent, computed three ways, agreeing on two of them.
--
-- `presumptive_assessments.annual_tax_kobo` is what the trader is told they
-- owe: it is the figure on the notice, the figure the trace explains at the
-- stall, the figure an objection is decided against, and the figure the
-- arrears worklist reads. The money the trader is actually billed is a
-- different number, computed by the rate engine from the revenue catalogue
-- when the invoice is raised.
--
-- Three implementations of "one per cent of the assumed turnover" existed:
--
--   presumptive.ts   (assumed * 100n) / 10_000n     truncates
--   this trigger     assumed / 100                  truncates (BIGINT division)
--   rate engine      applyBasisPoints(assumed, 100) rounds half up
--
-- Two agreed with each other and both disagreed with the one that bills. On a
-- schedule figure of 480,000,050 kobo — which this column permits, being a
-- BIGINT of kobo with no whole-naira constraint — the notice said 4,800,000
-- and the invoice said 4,800,001.
--
-- A kobo is not the point. The point is that the number on the notice was
-- derived independently of the number in the ledger, so nothing kept them
-- together, and the gap widens with whatever else the catalogue row carries:
-- a newly published rate version, a statutory minimum, an LGA-specific rate.
-- Measured with a 2% rate version published through the ordinary catalogue
-- route, the notice said 4,800,000 kobo and the trader was billed 9,600,001.
--
-- The invoice is the operative document — it is what the taxpayer owes and
-- what the ledger carries — so the two that describe it move to match it,
-- rather than the ledger moving to match them. `applyBasisPoints` is already
-- the platform's one money primitive for a percentage: commission and every
-- percentage rate in the catalogue go through it, and a presumptive charge is
-- not special enough to round its own way.
--
-- `(x + 50) / 100` is round-half-up in exact integer arithmetic, for the
-- positive x this column's CHECK already guarantees. Written that way rather
-- than through round(x / 100.0) because a figure this one is a money figure
-- and has no business passing through a float.
--
-- The service now refuses outright where the raised charge and the recorded
-- figure still disagree — for a rate change or a statutory minimum, which no
-- rounding rule can reconcile.
-- ============================================================================

CREATE OR REPLACE FUNCTION enforce_presumptive_assessment_matches_schedule() RETURNS TRIGGER AS $$
DECLARE
  sched presumptive_schedules%ROWTYPE;
BEGIN
  SELECT * INTO sched FROM presumptive_schedules WHERE id = NEW.schedule_id;

  IF sched.size_band <> NEW.size_band OR sched.lga_class <> NEW.lga_class THEN
    RAISE EXCEPTION
      'This assessment says band % class % and cites a schedule row for band % class %',
      NEW.size_band, NEW.lga_class, sched.size_band, sched.lga_class
      USING ERRCODE = 'check_violation';
  END IF;

  IF sched.assumed_annual_turnover_kobo <> NEW.assumed_annual_turnover_kobo THEN
    RAISE EXCEPTION
      'This assessment assumes % kobo of turnover and cites a schedule row saying %',
      NEW.assumed_annual_turnover_kobo, sched.assumed_annual_turnover_kobo
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.tax_tier = 'NANO' THEN
    IF NEW.annual_tax_kobo <> 0 THEN
      RAISE EXCEPTION
        'A nano business is exempt and cannot carry a presumptive charge of % kobo',
        NEW.annual_tax_kobo
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.assessment_id IS NOT NULL THEN
      RAISE EXCEPTION 'A nano business has nothing to invoice'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    -- One per cent of the assumed turnover, to the kobo, rounded the way the
    -- ledger rounds it.
    IF NEW.annual_tax_kobo <> (NEW.assumed_annual_turnover_kobo + 50) / 100 THEN
      RAISE EXCEPTION
        'A presumptive charge of % kobo is not one per cent of % kobo of assumed turnover',
        NEW.annual_tax_kobo, NEW.assumed_annual_turnover_kobo
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
