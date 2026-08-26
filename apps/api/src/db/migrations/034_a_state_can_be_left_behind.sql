-- A state can be left behind.
--
-- Three states the schema has always allowed and nothing could produce:
--
--   revenue_items.status = 'RETIRED'          a repealed levy could not be
--                                             withdrawn from the catalogue
--   taxpayer_group_members.status = 'LEFT'    a member who left a cooperative
--                                             kept drawing its allocations
--   vehicles.status = 'ARCHIVED'              a sold or scrapped vehicle could
--                                             not be taken out of service
--
-- In each case the readers already respect the state — the catalogue lists
-- only ACTIVE items and assessment creation refuses anything else, allocations
-- and incentives count only ATTESTED members — so the whole of the gap was on
-- the writing side. What was missing besides the writer was somewhere to
-- record *why*: a status that changes with no reason beside it is an
-- unattributable decision, and every other reversible lever on this platform
-- (device suspension, bank change refusal, fraud dismissal) carries one.

ALTER TABLE revenue_items
  ADD COLUMN status_reason TEXT,
  ADD COLUMN status_changed_at TIMESTAMPTZ,
  ADD COLUMN status_changed_by UUID REFERENCES users(id);

COMMENT ON COLUMN revenue_items.status_reason IS
  'Why this item was suspended or retired — the officer''s words, shown wherever the item is.';

ALTER TABLE taxpayer_group_members
  ADD COLUMN left_at TIMESTAMPTZ,
  ADD COLUMN left_reason TEXT,
  ADD COLUMN recorded_left_by UUID REFERENCES users(id);

COMMENT ON COLUMN taxpayer_group_members.left_reason IS
  'Why the membership ended. A departure is recorded, never deleted: the person was a member '
  'when the allocations they already collected were awarded.';

ALTER TABLE vehicles
  ADD COLUMN status_reason TEXT,
  ADD COLUMN status_changed_at TIMESTAMPTZ,
  ADD COLUMN status_changed_by UUID REFERENCES users(id);

COMMENT ON COLUMN vehicles.status_reason IS
  'Why the vehicle was suspended or archived — sold, scrapped, or the plate under investigation.';

-- Retired items are read constantly by the catalogue's ACTIVE-only queries;
-- the partial index above already covers that. This one is for the officer
-- screen that lists what has been withdrawn.
CREATE INDEX idx_items_withdrawn ON revenue_items (status_changed_at DESC)
  WHERE status <> 'ACTIVE';

CREATE INDEX idx_group_members_left ON taxpayer_group_members (group_id, left_at DESC)
  WHERE status = 'LEFT';

-- receipts.status = 'VOID' goes.
--
-- The platform has exactly one way to invalidate a receipt — reversing the
-- payment underneath it — and `recordReversal` writes REVERSED. VOID is an
-- older name for the same idea that nothing ever wrote, kept alive only by the
-- `void_reason` / `voided_at` / `voided_by` columns the reversal fills in.
-- Leaving it in the constraint means the database would accept a receipt in a
-- state no code produces, no screen renders and no report counts, which is the
-- exact shape of defect `a-state-nothing-writes.test.ts` exists to catch — and
-- that test cannot see this one, because the word VOID appears in the agent
-- application's unrelated list of verification outcomes.
ALTER TABLE receipts DROP CONSTRAINT receipts_status_check;
ALTER TABLE receipts ADD CONSTRAINT receipts_status_check
  CHECK (status IN ('VALID', 'REVERSED', 'REFUNDED'));
