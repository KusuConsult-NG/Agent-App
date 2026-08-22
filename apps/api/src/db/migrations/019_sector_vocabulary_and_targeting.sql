-- ---------------------------------------------------------------------------
-- 019: one economic-sector vocabulary
-- ---------------------------------------------------------------------------
-- The API and the database disagreed about what sectors exist.
--
-- `GET /taxpayers/sectors` serves ECONOMIC_SECTORS from the shared package —
-- thirty of them, with Hausa labels, feeding the registration dropdown in the
-- agent PWA. The CHECK constraint written in 016 allowed twenty-seven, and the
-- two lists had drifted apart: SELF_EMPLOYED, PRIVATE_EMPLOYEE,
-- TRANSPORT_HAULAGE and TRANSPORT_PASSENGER were offered to agents and refused
-- by the database, while TRANSPORT_LOGISTICS survived in the constraint after
-- being split into the two transport codes and could no longer be chosen.
--
-- An agent registering a self-employed trader — which is most of the informal
-- sector, and precisely who the compliance-to-incentive pipeline is meant to
-- reach — picked a valid option from the dropdown and hit a constraint
-- violation. Verified against the running database before this was written.
--
-- The shared list is the source of truth because it is what a person curated
-- and what both front-ends display. TRANSPORT_LOGISTICS is dropped rather than
-- kept as a legacy value: no row uses it, and leaving a code nothing can
-- select is how the next drift starts.

ALTER TABLE taxpayers
  DROP CONSTRAINT IF EXISTS taxpayers_economic_sector_check;

ALTER TABLE taxpayers
  ADD CONSTRAINT taxpayers_economic_sector_check
  CHECK (economic_sector IS NULL OR economic_sector IN (
    'AGRICULTURE','LIVESTOCK','FISHING','AGRICULTURE_PROCESSING','MINING',
    'MANUFACTURING','CONSTRUCTION','ARTISAN_CRAFT','RETAIL_TRADE',
    'WHOLESALE_TRADE','FOOD_BEVERAGE','HOTEL_HOSPITALITY',
    'TRANSPORT_PASSENGER','TRANSPORT_HAULAGE','MOTOR_VEHICLE',
    'ICT_TELECOMS','FINANCIAL_SERVICES','PROFESSIONAL_SERVICES',
    'HEALTHCARE','EDUCATION','ENTERTAINMENT_ARTS','GAMING_BETTING',
    'REAL_PROPERTY','CIVIL_SERVANT','PRIVATE_EMPLOYEE','SELF_EMPLOYED',
    'RELIGIOUS_NGO','INFORMAL_WORKER','STUDENT_UNEMPLOYED','OTHER'
  ));

-- ---------------------------------------------------------------------------
-- Sector targeting for incentive programmes
-- ---------------------------------------------------------------------------
-- A programme could be aimed at an LGA and at a taxpayer type, but not at what
-- somebody does for a living. So "fertiliser subsidy for compliant farmers"
-- could not be expressed: the programme would have to be opened to every
-- trader and artisan in the state and narrowed by hand afterwards.
--
-- Empty means no restriction, matching target_lga_ids, so every existing
-- programme keeps exactly the reach it has now.

ALTER TABLE incentive_programmes
  ADD COLUMN IF NOT EXISTS target_sectors TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN incentive_programmes.target_sectors IS
  'Economic sectors this programme is open to. Empty means all sectors.';

CREATE INDEX IF NOT EXISTS idx_programmes_sectors
  ON incentive_programmes USING GIN (target_sectors);
