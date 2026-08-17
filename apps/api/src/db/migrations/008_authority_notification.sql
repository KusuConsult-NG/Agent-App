-- =============================================================================
-- 008_authority_notification.sql — record whether the vehicle authority was told
--
-- PRD §82 makes the vehicle registration authority the source of truth for a
-- vehicle record; this platform records the service and then tells the
-- authority the renewal happened.
--
-- Until now that notification was fire-and-forget: the adapter returned a
-- result and the calling code discarded it. With a real registry that is a hole
-- with money on both sides of it. The taxpayer has paid, holds a government
-- receipt and a valid renewal document — and the authority, which is what a
-- roadside check consults, never heard. Nobody would know, because nothing was
-- written down.
--
-- So the outcome becomes a fact on the renewal row:
--
--   PENDING   not yet attempted
--   ACCEPTED  the authority acknowledged it
--   FAILED    the authority could not be told — retryable, and visible
--
-- The renewal itself stays COMPLETED either way. The taxpayer paid; a failure
-- to notify is the government's problem to resolve, not a reason to withhold
-- the document they are entitled to.
-- =============================================================================

ALTER TABLE vehicle_renewals
  ADD COLUMN authority_notification_status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (authority_notification_status IN ('PENDING', 'ACCEPTED', 'FAILED')),
  ADD COLUMN authority_notification_reference TEXT,
  ADD COLUMN authority_notification_reason TEXT,
  ADD COLUMN authority_notification_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN authority_notified_at TIMESTAMPTZ;

COMMENT ON COLUMN vehicle_renewals.authority_notification_status IS
  'Whether the vehicle registration authority has acknowledged this renewal. '
  'FAILED is retryable and does not invalidate the renewal.';

-- Partial index: the operational question is always "what still needs telling",
-- never "list every renewal ever acknowledged".
CREATE INDEX idx_renewals_authority_outstanding
  ON vehicle_renewals(created_at)
  WHERE authority_notification_status <> 'ACCEPTED';

-- -----------------------------------------------------------------------------
-- Vehicle records captured while the registry was unreachable
-- -----------------------------------------------------------------------------
-- `vehicles.source` already distinguishes AUTHORITY_LOOKUP from MANUAL_ENTRY,
-- but that conflates two different manual entries: one where the authority said
-- it holds no such vehicle, and one where the authority could not be asked. The
-- second should be re-checked once the registry is reachable again; the first
-- should not.
ALTER TABLE vehicles
  ADD COLUMN authority_lookup_outcome TEXT NOT NULL DEFAULT 'NOT_ATTEMPTED'
    CHECK (authority_lookup_outcome IN ('NOT_ATTEMPTED', 'FOUND', 'NOT_FOUND', 'UNAVAILABLE'));

COMMENT ON COLUMN vehicles.authority_lookup_outcome IS
  'Outcome of the last lookup at the vehicle registration authority. '
  'UNAVAILABLE means the authority could not be asked — NOT that the vehicle '
  'is unregistered — so the record is a candidate for re-verification.';

CREATE INDEX idx_vehicles_awaiting_authority
  ON vehicles(created_at)
  WHERE authority_lookup_outcome = 'UNAVAILABLE';

-- Existing rows: infer from what was already recorded rather than guessing.
UPDATE vehicles
   SET authority_lookup_outcome = CASE
         WHEN authority_verified_at IS NOT NULL THEN 'FOUND'
         WHEN source = 'MANUAL_ENTRY' THEN 'NOT_FOUND'
         ELSE 'NOT_ATTEMPTED'
       END;
