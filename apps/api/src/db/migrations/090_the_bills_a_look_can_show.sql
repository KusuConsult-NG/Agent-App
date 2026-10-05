-- ---------------------------------------------------------------------------
-- A fifth thing a look can show: what somebody still owes.
--
-- Migration 083 began logging who reads a taxpayer's record, on the four
-- routes it found the two front ends using, and said why it took all four:
-- "logging only one of them would have left a whole population unlogged."
-- There was a fifth. `GET /revenue/taxpayers/:id/obligations` answers with a
-- named person's unpaid bills — each levy, each amount, each invoice number —
-- and the field application's collection screen reads it straight after a
-- search, without passing through the profile route that logs. It is also the
-- widest-open of the five on purpose: any agent in the State may read it, so
-- that a trader who walks up to a different agent can still be served.
--
-- Measured: an officer read it and the access log stayed empty. So the route
-- any agent anywhere can use to see what any trader owes was the one route
-- that left no trace of who looked.
--
-- It is logged as its own surface rather than folded into TAX_OBLIGATIONS,
-- which is the register of what somebody is liable for. What they owe right
-- now is a different disclosure, and a complaint about one is not a complaint
-- about the other.
-- ---------------------------------------------------------------------------

BEGIN;

ALTER TABLE taxpayer_record_access_logs
  DROP CONSTRAINT IF EXISTS taxpayer_record_access_logs_surface_check;
ALTER TABLE taxpayer_record_access_logs
  ADD CONSTRAINT taxpayer_record_access_logs_surface_check
  CHECK (surface IN ('TAXPAYER_RECORD', 'PAYMENT_HISTORY', 'TAX_OBLIGATIONS',
                     'INCENTIVE_STANDING', 'OUTSTANDING_BILLS'));

COMMIT;
