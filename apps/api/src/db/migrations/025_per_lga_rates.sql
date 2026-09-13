-- ---------------------------------------------------------------------------
-- 025: a rate per Local Government Area
-- ---------------------------------------------------------------------------
-- Eleven items in the catalogue are on Part III of the Taxes and Levies
-- (Approved List for Collection) Act — the local government list. Shops and
-- kiosks, tenement rates, slaughter slabs, marriage registration, street
-- naming, right of occupancy on rural land, market levies, motor park levies,
-- domestic animal licences and signboard permits. The rate for any of them is
-- set by a Local Government Council's own bye-law, and Plateau has seventeen
-- Councils.
--
-- The catalogue carried one figure each. A daily market levy of ₦200 applied
-- in Jos North and in Wase alike, which cannot be right whatever the number
-- is: those are not the same market, and no single bye-law governs both.
--
-- WHAT THIS CHANGES. A rate may now name an LGA. A rate with lga_id set
-- applies only there; a rate with lga_id NULL is the statewide default, which
-- is what every existing row becomes. Resolution prefers the specific over
-- the general, so an LGA that has set its own figure uses it and one that has
-- not falls back — until the item has no default either, which is how the
-- Part III items are now seeded.
--
-- WHY THAT IS THE FIX RATHER THAN SEVENTEEN NEW NUMBERS. Nothing here knows
-- what Wase charges for a market stall. Seeding each LGA with the figure the
-- catalogue already carried leaves today's behaviour identical while making
-- the structure honest: seventeen separate decisions, individually settable,
-- correctable one Council at a time instead of all or none.
--
-- AND IT GIVES "NOT COLLECTABLE HERE" A REPRESENTATION. Part III excludes
-- street naming in the State Capital, and Jos is the capital. With per-LGA
-- rates that is expressible directly — no rate row for Jos North or Jos
-- South, and `resolveRate` already refuses an item with no rate in force
-- rather than inventing one. The same mechanism will express the rural-only
-- restriction on right of occupancy once PSIRS says which LGAs are rural.
--
-- WHY THE UNIQUE CONSTRAINT USES NULLS NOT DISTINCT. Version numbers count
-- per item per LGA. With the default NULL semantics two statewide rows both
-- carrying lga_id NULL would never collide, so an item could acquire two
-- version 3 defaults and `resolveRate` would pick between them by accident.

ALTER TABLE revenue_item_rates
  ADD COLUMN lga_id UUID REFERENCES lgas(id);

ALTER TABLE revenue_item_rates
  DROP CONSTRAINT revenue_item_rates_revenue_item_id_version_key;

ALTER TABLE revenue_item_rates
  ADD CONSTRAINT revenue_item_rates_item_lga_version_key
    UNIQUE NULLS NOT DISTINCT (revenue_item_id, lga_id, version);

-- The resolution query: one item, one LGA or the statewide default, in force
-- at a moment.
CREATE INDEX idx_revenue_item_rates_resolution
  ON revenue_item_rates(revenue_item_id, lga_id, effective_from DESC);

COMMENT ON COLUMN revenue_item_rates.lga_id IS
  'The LGA this rate applies to. NULL is the statewide default. A rate naming '
  'an LGA is preferred over the default; an item with neither cannot be assessed.';

-- The "one rate in force at a time" index has to become per-LGA as well.
--
-- It was UNIQUE(revenue_item_id) WHERE effective_to IS NULL, which is exactly
-- the right rule when an item has one rate and exactly wrong once it has
-- seventeen: the second Council to set a figure collided with the first. The
-- rule itself is worth keeping — two open-ended rates for the same item in the
-- same place is an item whose price depends on which row a query happens to
-- read first — so it is rebuilt with the LGA in the key.
DROP INDEX idx_rates_current;

CREATE UNIQUE INDEX idx_rates_current
  ON revenue_item_rates(revenue_item_id, lga_id) NULLS NOT DISTINCT
  WHERE effective_to IS NULL;
