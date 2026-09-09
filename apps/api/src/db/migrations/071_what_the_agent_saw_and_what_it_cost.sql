-- Enumeration through associations, and the assessment that follows.
--
-- Phase 5 of the informal-sector programme, and the one that touches citizens
-- most directly. An agent records what they can see, a market association's
-- leader attests to it, and the platform computes a liability from the
-- schedule Phase 4 published. Three tables, and most of their design is about
-- what must not happen.
--
-- WHAT THE LEADER MAY AND MAY NOT DO.
--
-- Associations are the only people who know who the shoemakers of Bukuru are,
-- and that roll is the sampling frame PSIRS cannot build for itself. But the
-- literature on Nigerian marketplaces is blunt about what happens when leaders
-- mediate tax: the burden lands unevenly, and the people it lands on have no
-- route past the person imposing it.
--
-- So the leader attests to *observations* — what trade, what premises, how
-- many hands — and there is nowhere on this schema for them to record a band
-- or an amount. Not a rule in a service that could be relaxed; there is no
-- column. A leader who wanted to set a member's tax would have to change the
-- database. And a member can disagree with an attestation made about them,
-- which is a state on the observation rather than a complaint in a file.
--
-- No money moves through an association either. Nothing here creates a payable
-- against a group: the assessment is raised against the member's own taxpayer
-- record and the invoice is theirs. That is the difference between a witness
-- and a tax farmer, and under the 2026 Regulations the second is unlawful.
--
-- THE TWO INVARIANTS THE PLAN NAMED.
--
--   1. A presumptive assessment may not exist without the observation and the
--      schedule version it was computed from. Both are NOT NULL foreign keys,
--      so it is not a rule that can be forgotten — an assessment with no
--      evidence behind it cannot be inserted at all. And the figures must
--      agree with the schedule row they point at, which is what stops the
--      evidence being decorative.
--
--   2. A taxpayer at tier NANO may not carry a non-zero presumptive
--      assessment. The exemption is a trigger, not a policy: the coverage
--      metric will otherwise push officers to assess people the law exempts,
--      which is how these schemes turn regressive without anybody deciding
--      that they should.
--
-- AN ESTIMATE MUST BE CONTESTABLE.
--
-- Every presumptive assessment opens an objection window. While an objection
-- is open the debt is not chased — the arrears worklist excludes it — and the
-- officer who raised the assessment may not decide the objection, which is the
-- separation of duties the approvals table already applies to money.

BEGIN;

-- ---------------------------------------------------------------------------
-- What the association is for
-- ---------------------------------------------------------------------------
ALTER TABLE taxpayer_groups ADD COLUMN IF NOT EXISTS tax_role TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE taxpayer_groups DROP CONSTRAINT IF EXISTS taxpayer_groups_tax_role_check;
ALTER TABLE taxpayer_groups ADD CONSTRAINT taxpayer_groups_tax_role_check
  CHECK (tax_role IN ('ENUMERATION', 'ATTESTATION', 'NONE'));

COMMENT ON COLUMN taxpayer_groups.tax_role IS
  'ENUMERATION: the roll is used as a sampling frame. ATTESTATION: the leader '
  'also confirms observations about members. NONE: the group is registered for '
  'other purposes and plays no part in assessment. Never a collecting role — '
  'state money does not pass through an association.';


-- ---------------------------------------------------------------------------
-- What somebody saw, at a moment
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS presumptive_observations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  taxpayer_id           UUID NOT NULL REFERENCES taxpayers(id),

  -- The facts. Every one is something a second person could check tomorrow,
  -- and there is deliberately no turnover, no band and no amount: those are
  -- conclusions, and conclusions belong to the server.
  premises              TEXT NOT NULL
                        CHECK (premises IN ('NONE', 'STALL', 'KIOSK', 'LOCK_UP_SHOP', 'BUILDING')),
  equipment_count       INTEGER NOT NULL CHECK (equipment_count >= 0),
  people_working        INTEGER NOT NULL CHECK (people_working >= 0),
  economic_sector       TEXT NOT NULL,
  lga_id                UUID NOT NULL REFERENCES lgas(id),

  observed_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  observed_by           UUID NOT NULL REFERENCES users(id),
  agent_id              UUID REFERENCES agents(id),
  latitude              NUMERIC(9,6),
  longitude             NUMERIC(9,6),

  /*
   * The association's part. A leader agrees or disagrees with what the agent
   * wrote; there is no column here for a band or an amount, so a leader who
   * wanted to set a member's tax would have to alter the schema. When they
   * disagree, what they say instead is recorded as observations of the same
   * kind — facts against facts, which a supervisor can go and settle.
   */
  group_id              UUID REFERENCES taxpayer_groups(id),
  attestation_state     TEXT NOT NULL DEFAULT 'NOT_SOUGHT'
                        CHECK (attestation_state IN
                               ('NOT_SOUGHT', 'PENDING', 'AGREED', 'DISAGREED')),
  attested_at           TIMESTAMPTZ,
  attested_by_name      TEXT,
  attested_premises     TEXT
                        CHECK (attested_premises IS NULL OR attested_premises IN
                               ('NONE', 'STALL', 'KIOSK', 'LOCK_UP_SHOP', 'BUILDING')),
  attested_equipment_count INTEGER CHECK (attested_equipment_count IS NULL OR attested_equipment_count >= 0),
  attested_people_working  INTEGER CHECK (attested_people_working IS NULL OR attested_people_working >= 0),

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_observations_taxpayer
  ON presumptive_observations (taxpayer_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_observations_disagreed
  ON presumptive_observations (group_id, observed_at DESC)
  WHERE attestation_state = 'DISAGREED';

-- What was seen does not change. A later visit is a later observation, and the
-- history of what was recorded about somebody survives being corrected.
DROP TRIGGER IF EXISTS trg_observation_immutable ON presumptive_observations;
CREATE TRIGGER trg_observation_immutable
  BEFORE UPDATE ON presumptive_observations
  FOR EACH ROW EXECUTE FUNCTION prevent_column_mutation(
    'taxpayer_id', 'premises', 'equipment_count', 'people_working',
    'economic_sector', 'lga_id', 'observed_at', 'observed_by', 'agent_id');

DROP TRIGGER IF EXISTS trg_observation_touch ON presumptive_observations;
CREATE TRIGGER trg_observation_touch
  BEFORE UPDATE ON presumptive_observations
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS trg_observation_no_delete ON presumptive_observations;
CREATE TRIGGER trg_observation_no_delete
  BEFORE DELETE ON presumptive_observations
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();

-- A disagreement has to say what the leader claims instead. "I disagree" with
-- nothing behind it leaves a supervisor with a queue item and no question to
-- settle, and leaves the member unable to see what is being said about them.
CREATE OR REPLACE FUNCTION enforce_attestation_is_specific() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.attestation_state IS DISTINCT FROM OLD.attestation_state THEN
    IF NEW.attestation_state IN ('AGREED', 'DISAGREED') THEN
      IF NEW.attested_at IS NULL OR btrim(COALESCE(NEW.attested_by_name, '')) = '' THEN
        RAISE EXCEPTION 'An attestation must record who made it and when'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    IF NEW.attestation_state = 'DISAGREED' THEN
      IF NEW.attested_premises IS NULL
         AND NEW.attested_equipment_count IS NULL
         AND NEW.attested_people_working IS NULL THEN
        RAISE EXCEPTION
          'A disagreement must say what the leader claims instead, or there is nothing to settle'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_attestation_specific ON presumptive_observations;
CREATE TRIGGER trg_attestation_specific
  BEFORE UPDATE ON presumptive_observations
  FOR EACH ROW EXECUTE FUNCTION enforce_attestation_is_specific();


-- ---------------------------------------------------------------------------
-- What it came to
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS presumptive_assessments (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  taxpayer_id                   UUID NOT NULL REFERENCES taxpayers(id),

  -- Invariant 1, as structure rather than as a rule somebody remembers. No
  -- observation and no schedule version, no assessment — it cannot be
  -- inserted.
  observation_id                UUID NOT NULL REFERENCES presumptive_observations(id),
  schedule_id                   UUID NOT NULL REFERENCES presumptive_schedules(id),
  nano_policy_id                UUID NOT NULL REFERENCES nano_exemption_policies(id),

  tax_tier                      TEXT NOT NULL CHECK (tax_tier IN ('NANO', 'PRESUMPTIVE')),
  size_band                     TEXT NOT NULL CHECK (size_band IN ('MICRO', 'SMALL', 'MEDIUM')),
  lga_class                     TEXT NOT NULL CHECK (lga_class IN ('A', 'B', 'C', 'D')),
  assumed_annual_turnover_kobo  BIGINT NOT NULL CHECK (assumed_annual_turnover_kobo > 0),
  annual_tax_kobo               BIGINT NOT NULL CHECK (annual_tax_kobo >= 0),

  -- Null for a nano operator: there is nothing to invoice, and an invoice for
  -- zero would be indistinguishable from a bill nobody paid.
  assessment_id                 UUID REFERENCES assessments(id),

  status                        TEXT NOT NULL DEFAULT 'ASSESSED'
                                CHECK (status IN ('ASSESSED', 'OBJECTED', 'WITHDRAWN')),

  -- Enforcement is suspended until this passes or an objection is decided.
  objection_window_ends_at      TIMESTAMPTZ NOT NULL,

  withdrawn_reason              TEXT,
  withdrawn_at                  TIMESTAMPTZ,
  withdrawn_by                  UUID REFERENCES users(id),

  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by                    UUID NOT NULL REFERENCES users(id),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_presumptive_assessment_taxpayer
  ON presumptive_assessments (taxpayer_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_assessment_per_observation
  ON presumptive_assessments (observation_id)
  WHERE status <> 'WITHDRAWN';

DROP TRIGGER IF EXISTS trg_presumptive_assessment_immutable ON presumptive_assessments;
CREATE TRIGGER trg_presumptive_assessment_immutable
  BEFORE UPDATE ON presumptive_assessments
  FOR EACH ROW EXECUTE FUNCTION prevent_column_mutation(
    'taxpayer_id', 'observation_id', 'schedule_id', 'nano_policy_id',
    'tax_tier', 'size_band', 'lga_class', 'assumed_annual_turnover_kobo',
    'annual_tax_kobo', 'assessment_id', 'objection_window_ends_at',
    'created_at', 'created_by');

DROP TRIGGER IF EXISTS trg_presumptive_assessment_touch ON presumptive_assessments;
CREATE TRIGGER trg_presumptive_assessment_touch
  BEFORE UPDATE ON presumptive_assessments
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS trg_presumptive_assessment_no_delete ON presumptive_assessments;
CREATE TRIGGER trg_presumptive_assessment_no_delete
  BEFORE DELETE ON presumptive_assessments
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();

/*
 * The figures must agree with the schedule row they point at, and with the
 * exemption.
 *
 * Invariant 1 without this is decorative: an assessment could carry a
 * foreign key to a schedule and a number that came from somewhere else
 * entirely, which is exactly the shape of a figure negotiated at a stall and
 * then filed against a plausible-looking reference.
 *
 * Invariant 2 is the second half: a nano operator owes nothing. Written as a
 * trigger rather than left to the service because the coverage metric pushes
 * the other way — an officer measured on how many people they bring into the
 * net has a standing reason to assess somebody the law exempts.
 */
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
    -- One per cent of the assumed turnover, to the kobo.
    IF NEW.annual_tax_kobo <> NEW.assumed_annual_turnover_kobo / 100 THEN
      RAISE EXCEPTION
        'A presumptive charge of % kobo is not one per cent of % kobo of assumed turnover',
        NEW.annual_tax_kobo, NEW.assumed_annual_turnover_kobo
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_presumptive_assessment_matches ON presumptive_assessments;
CREATE TRIGGER trg_presumptive_assessment_matches
  BEFORE INSERT OR UPDATE ON presumptive_assessments
  FOR EACH ROW EXECUTE FUNCTION enforce_presumptive_assessment_matches_schedule();


-- ---------------------------------------------------------------------------
-- Contesting it
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assessment_objections (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  presumptive_assessment_id UUID NOT NULL REFERENCES presumptive_assessments(id),

  /*
   * The two ways out named in the design, plus the two an officer will
   * actually meet. FACTS_WRONG contests the observation — the stall is
   * smaller than recorded. HAS_RECORDS is the taxpayer's right to leave the
   * regime entirely by producing books, which must be a right they can
   * exercise rather than a favour granted to them.
   */
  ground                    TEXT NOT NULL
                            CHECK (ground IN ('FACTS_WRONG', 'HAS_RECORDS',
                                              'NOT_TRADING', 'OTHER')),
  statement                 TEXT NOT NULL CHECK (btrim(statement) <> ''),

  raised_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  raised_by                 UUID NOT NULL REFERENCES users(id),

  status                    TEXT NOT NULL DEFAULT 'OPEN'
                            CHECK (status IN ('OPEN', 'UPHELD', 'REJECTED')),
  decided_at                TIMESTAMPTZ,
  decided_by                UUID REFERENCES users(id),
  decision_reason           TEXT,

  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_objections_open
  ON assessment_objections (presumptive_assessment_id)
  WHERE status = 'OPEN';

DROP TRIGGER IF EXISTS trg_objection_immutable ON assessment_objections;
CREATE TRIGGER trg_objection_immutable
  BEFORE UPDATE ON assessment_objections
  FOR EACH ROW EXECUTE FUNCTION prevent_column_mutation(
    'presumptive_assessment_id', 'ground', 'statement', 'raised_at', 'raised_by');

DROP TRIGGER IF EXISTS trg_objection_touch ON assessment_objections;
CREATE TRIGGER trg_objection_touch
  BEFORE UPDATE ON assessment_objections
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS trg_objection_no_delete ON assessment_objections;
CREATE TRIGGER trg_objection_no_delete
  BEFORE DELETE ON assessment_objections
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();

/*
 * The officer who raised the assessment may not decide the objection.
 *
 * The same separation of duties the approvals table applies to money, applied
 * to the estimate — and for the same reason. An objection decided by the
 * person being objected to is not a right of appeal, it is a form somebody
 * fills in. The right of appeal above the deciding officer is a process
 * question and lives with PSIRS; this is the part a database can hold.
 */
CREATE OR REPLACE FUNCTION enforce_objection_decided_by_another() RETURNS TRIGGER AS $$
DECLARE
  assessor UUID;
BEGIN
  IF NEW.status <> 'OPEN' AND OLD.status = 'OPEN' THEN
    IF NEW.decided_by IS NULL THEN
      RAISE EXCEPTION 'An objection decision must record who made it'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.decision_reason IS NULL OR btrim(NEW.decision_reason) = '' THEN
      RAISE EXCEPTION 'An objection decision must give a reason the taxpayer can read'
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT created_by INTO assessor
      FROM presumptive_assessments WHERE id = NEW.presumptive_assessment_id;

    IF assessor = NEW.decided_by THEN
      RAISE EXCEPTION
        'The officer who raised this assessment may not decide the objection to it'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF OLD.status <> 'OPEN' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'This objection has already been decided'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_objection_separation ON assessment_objections;
CREATE TRIGGER trg_objection_separation
  BEFORE UPDATE ON assessment_objections
  FOR EACH ROW EXECUTE FUNCTION enforce_objection_decided_by_another();

COMMIT;
