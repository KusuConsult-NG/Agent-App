-- The presumptive machinery: LGA classes, the schedule, and the nano test.
--
-- Phase 4 of the informal-sector programme. It builds the thing PSIRS has to
-- be able to defend in a room full of traders — a published table saying what
-- a tailor with two machines pays in Jos North and what the same tailor pays
-- in Wase, and why the second figure is lower without any officer having
-- exercised discretion.
--
-- WHAT MAKES THE LGA RELIEF LAWFUL, AND WHY IT IS SCHEMA AND NOT POLICY.
--
-- The relief is not a discount. A discount on a statutory rate needs a power
-- to grant it, invites the question of who else gets one, and evaporates the
-- moment somebody audits it. What happens here instead is that turnover in
-- Wase genuinely is lower than in Jos North, the schedule says so, and the
-- arithmetic follows — the rate is identical, the assumed turnover is not.
--
-- Two properties make that hold, and both are enforced here rather than left
-- to whoever maintains the table:
--
--   The index is exogenous. Distance to a major market, road access,
--   electrification, security incidence, poverty headcount — data PSIRS does
--   not produce. A class derived from an LGA's own collection figures would
--   pay an LGA to under-collect, which is the precise opposite of the point.
--   The inputs and their source are recorded on every row so the claim is
--   checkable rather than asserted.
--
--   The class is fixed for three years. A class that can move next year is a
--   class an LGA will lobby about, and relief that evaporates the moment an
--   LGA succeeds is a tax on succeeding. The three-year floor is a CHECK
--   constraint, so a well-meaning administrator cannot shorten it under
--   pressure without a migration somebody has to justify.
--
-- A SCHEDULE WITHOUT AN INSTRUMENT IS UNENFORCEABLE.
--
-- `instrument_reference` is NOT NULL. A schedule of assumed turnovers is an
-- exercise of a taxing power and needs the instrument that adopted it; one
-- adopted by nobody will not survive its first challenge, and a platform that
-- can hold an unenforceable schedule will eventually be found holding one. The
-- column costs nothing and makes the omission impossible rather than merely
-- unwise.
--
-- THE NANO TEST IS CONFIGURATION, NOT A CONSTANT.
--
-- The Nigeria Tax Act 2025 exempts a nano business — no fixed premises, no
-- employees, turnover at or below the ceiling. Read strictly the three limbs
-- are conjunctive, so a shop-based tailor turning over ₦3m is not nano and is
-- taxable; read loosely the turnover limb governs alone and she is exempt.
-- That single question moves the covered population by what could be an order
-- of magnitude, and it is a question for counsel rather than for an engineer.
--
-- So the platform holds either reading, records which one is in force, from
-- when, and on whose written opinion — and, because there is no default, it
-- can compute nothing until somebody has answered. That is the honest
-- behaviour: a guess here would silently decide who in Plateau State pays tax.

BEGIN;

-- ---------------------------------------------------------------------------
-- What class an LGA is, and on what evidence
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lga_classes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lga_id            UUID NOT NULL REFERENCES lgas(id),

  -- A is the strongest local economy and D the weakest. Four bands rather than
  -- a continuous index because a trader has to be able to look this up, and a
  -- score to two decimal places is not something anybody can check.
  class_code        TEXT NOT NULL CHECK (class_code IN ('A', 'B', 'C', 'D')),

  /*
   * The indicators and their values, kept so the classification can be argued
   * with. A class published as a bare letter is a letter somebody chose; a
   * class published with the road access, electrification and poverty figures
   * behind it is a finding an LGA can contest on the facts.
   */
  index_inputs      JSONB NOT NULL,
  index_source      TEXT NOT NULL,

  effective_from    DATE NOT NULL,
  effective_to      DATE,

  published_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_by      UUID NOT NULL REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Three years, and not a day less. The anti-gaming property, written where
  -- it cannot be relaxed by an UPDATE.
  CONSTRAINT lga_class_fixed_for_three_years
    CHECK (effective_to IS NULL OR effective_to >= effective_from + INTERVAL '3 years'),
  CONSTRAINT lga_class_period_ordered
    CHECK (effective_to IS NULL OR effective_to > effective_from)
);

-- One class per LGA at any moment. Overlapping classifications would make the
-- schedule lookup ambiguous, which is the one thing a published table may not
-- be.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE lga_classes DROP CONSTRAINT IF EXISTS lga_class_no_overlap;
ALTER TABLE lga_classes ADD CONSTRAINT lga_class_no_overlap
  EXCLUDE USING gist (
    lga_id WITH =,
    daterange(effective_from, effective_to, '[)') WITH &&
  );

-- A published classification is evidence about a place and does not change.
-- Reclassifying means publishing the next period, not editing this one.
DROP TRIGGER IF EXISTS trg_lga_class_immutable ON lga_classes;
CREATE TRIGGER trg_lga_class_immutable
  BEFORE UPDATE ON lga_classes
  FOR EACH ROW EXECUTE FUNCTION prevent_column_mutation(
    'lga_id', 'class_code', 'index_inputs', 'index_source',
    'effective_from', 'published_at', 'published_by');

DROP TRIGGER IF EXISTS trg_lga_class_no_delete ON lga_classes;
CREATE TRIGGER trg_lga_class_no_delete
  BEFORE DELETE ON lga_classes
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();


-- ---------------------------------------------------------------------------
-- The schedule itself
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS presumptive_schedules (
  id                             UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  economic_sector                TEXT NOT NULL,
  -- The three bands the catalogue already carries as PIT-PRESUMPTIVE items,
  -- so a band maps to a revenue item without a second vocabulary to keep in
  -- step with this one.
  size_band                      TEXT NOT NULL
                                 CHECK (size_band IN ('MICRO', 'SMALL', 'MEDIUM')),
  lga_class                      TEXT NOT NULL CHECK (lga_class IN ('A', 'B', 'C', 'D')),

  assumed_annual_turnover_kobo   BIGINT NOT NULL CHECK (assumed_annual_turnover_kobo > 0),

  /*
   * The instrument that adopted this figure. NOT NULL because a schedule of
   * assumed turnovers exercises a taxing power: one adopted by nobody is
   * unenforceable, and a table that can hold an unadopted row will eventually
   * be holding one when somebody challenges an assessment.
   */
  instrument_reference           TEXT NOT NULL CHECK (btrim(instrument_reference) <> ''),

  version                        INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  effective_from                 DATE NOT NULL,
  effective_to                   DATE,

  published_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_by                   UUID NOT NULL REFERENCES users(id),
  created_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT presumptive_period_ordered
    CHECK (effective_to IS NULL OR effective_to > effective_from)
);

ALTER TABLE presumptive_schedules DROP CONSTRAINT IF EXISTS presumptive_no_overlap;
ALTER TABLE presumptive_schedules ADD CONSTRAINT presumptive_no_overlap
  EXCLUDE USING gist (
    economic_sector WITH =,
    size_band WITH =,
    lga_class WITH =,
    daterange(effective_from, effective_to, '[)') WITH &&
  );

CREATE INDEX IF NOT EXISTS idx_presumptive_lookup
  ON presumptive_schedules (economic_sector, size_band, lga_class, effective_from DESC);

-- Versioned exactly like revenue_item_rates: what a taxpayer was assessed
-- against has to remain readable years later, so a published figure is never
-- edited. A new figure is a new row.
DROP TRIGGER IF EXISTS trg_presumptive_immutable ON presumptive_schedules;
CREATE TRIGGER trg_presumptive_immutable
  BEFORE UPDATE ON presumptive_schedules
  FOR EACH ROW EXECUTE FUNCTION prevent_column_mutation(
    'economic_sector', 'size_band', 'lga_class', 'assumed_annual_turnover_kobo',
    'instrument_reference', 'version', 'effective_from', 'published_at', 'published_by');

DROP TRIGGER IF EXISTS trg_presumptive_no_delete ON presumptive_schedules;
CREATE TRIGGER trg_presumptive_no_delete
  BEFORE DELETE ON presumptive_schedules
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();


-- ---------------------------------------------------------------------------
-- Which reading of the nano exemption is in force
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nano_exemption_policies (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  /*
   * CONJUNCTIVE: all three limbs must hold for the exemption — no fixed
   *   premises, no employees, and turnover at or below the ceiling. A
   *   shop-based tailor is therefore taxable.
   * TURNOVER_GOVERNED: the turnover limb governs alone. The same tailor is
   *   exempt.
   *
   * There is no default and no third option that splits the difference.
   * Whichever is adopted decides who in Plateau State pays tax at all, and a
   * platform that guessed would be making that decision quietly.
   */
  construction           TEXT NOT NULL
                         CHECK (construction IN ('CONJUNCTIVE', 'TURNOVER_GOVERNED')),
  turnover_ceiling_kobo  BIGINT NOT NULL CHECK (turnover_ceiling_kobo > 0),

  -- Counsel's written opinion, or the instrument. Required for the same reason
  -- the schedule's is: this is the construction of a statute, and "we decided"
  -- is not an answer to a taxpayer who disagrees.
  legal_basis            TEXT NOT NULL CHECK (btrim(legal_basis) <> ''),

  effective_from         DATE NOT NULL,
  effective_to           DATE,

  adopted_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  adopted_by             UUID NOT NULL REFERENCES users(id),

  CONSTRAINT nano_policy_period_ordered
    CHECK (effective_to IS NULL OR effective_to > effective_from)
);

ALTER TABLE nano_exemption_policies DROP CONSTRAINT IF EXISTS nano_policy_no_overlap;
ALTER TABLE nano_exemption_policies ADD CONSTRAINT nano_policy_no_overlap
  EXCLUDE USING gist (daterange(effective_from, effective_to, '[)') WITH &&);

DROP TRIGGER IF EXISTS trg_nano_policy_immutable ON nano_exemption_policies;
CREATE TRIGGER trg_nano_policy_immutable
  BEFORE UPDATE ON nano_exemption_policies
  FOR EACH ROW EXECUTE FUNCTION prevent_column_mutation(
    'construction', 'turnover_ceiling_kobo', 'legal_basis',
    'effective_from', 'adopted_at', 'adopted_by');

DROP TRIGGER IF EXISTS trg_nano_policy_no_delete ON nano_exemption_policies;
CREATE TRIGGER trg_nano_policy_no_delete
  BEFORE DELETE ON nano_exemption_policies
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();


-- ---------------------------------------------------------------------------
-- Which regime a taxpayer is in
-- ---------------------------------------------------------------------------
ALTER TABLE taxpayers ADD COLUMN IF NOT EXISTS tax_tier TEXT;
ALTER TABLE taxpayers DROP CONSTRAINT IF EXISTS taxpayers_tax_tier_check;
ALTER TABLE taxpayers ADD CONSTRAINT taxpayers_tax_tier_check
  CHECK (tax_tier IS NULL OR tax_tier IN ('NANO', 'PRESUMPTIVE', 'BOOKS'));

COMMENT ON COLUMN taxpayers.tax_tier IS
  'NANO: exempt under the Act. PRESUMPTIVE: assessed off the published '
  'schedule. BOOKS: reliable records exist, assessed on them — a right the '
  'taxpayer can exercise, not a favour. NULL until determined.';

-- The group vocabulary, which was free text.
--
-- `taxpayer_groups.economic_sector` took whatever was typed while
-- `taxpayers.economic_sector` has been constrained since registration, so the
-- two could not be joined and a market association's trade was not something
-- the schedule could look up. Same vocabulary, same constraint.
UPDATE taxpayer_groups
   SET economic_sector = NULL
 WHERE economic_sector IS NOT NULL
   AND economic_sector NOT IN (
     'AGRICULTURE','LIVESTOCK','FISHING','AGRICULTURE_PROCESSING','MINING',
     'MANUFACTURING','CONSTRUCTION','ARTISAN_CRAFT','RETAIL_TRADE','WHOLESALE_TRADE',
     'FOOD_BEVERAGE','HOTEL_HOSPITALITY','TRANSPORT_PASSENGER','TRANSPORT_HAULAGE',
     'MOTOR_VEHICLE','ICT_TELECOMS','FINANCIAL_SERVICES','PROFESSIONAL_SERVICES',
     'HEALTHCARE','EDUCATION','ENTERTAINMENT_ARTS','GAMING_BETTING','REAL_PROPERTY',
     'CIVIL_SERVANT','PRIVATE_EMPLOYEE','SELF_EMPLOYED','RELIGIOUS_NGO',
     'INFORMAL_WORKER','STUDENT_UNEMPLOYED','OTHER');

ALTER TABLE taxpayer_groups DROP CONSTRAINT IF EXISTS taxpayer_groups_economic_sector_check;
ALTER TABLE taxpayer_groups ADD CONSTRAINT taxpayer_groups_economic_sector_check
  CHECK (economic_sector IS NULL OR economic_sector IN (
    'AGRICULTURE','LIVESTOCK','FISHING','AGRICULTURE_PROCESSING','MINING',
    'MANUFACTURING','CONSTRUCTION','ARTISAN_CRAFT','RETAIL_TRADE','WHOLESALE_TRADE',
    'FOOD_BEVERAGE','HOTEL_HOSPITALITY','TRANSPORT_PASSENGER','TRANSPORT_HAULAGE',
    'MOTOR_VEHICLE','ICT_TELECOMS','FINANCIAL_SERVICES','PROFESSIONAL_SERVICES',
    'HEALTHCARE','EDUCATION','ENTERTAINMENT_ARTS','GAMING_BETTING','REAL_PROPERTY',
    'CIVIL_SERVANT','PRIVATE_EMPLOYEE','SELF_EMPLOYED','RELIGIOUS_NGO',
    'INFORMAL_WORKER','STUDENT_UNEMPLOYED','OTHER'));

COMMIT;
