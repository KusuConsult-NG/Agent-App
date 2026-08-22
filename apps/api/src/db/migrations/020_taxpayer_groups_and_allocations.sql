-- ---------------------------------------------------------------------------
-- 020: informal-sector groups, and the allocation of physical benefits
-- ---------------------------------------------------------------------------
-- Two things the compliance-to-incentive pipeline was missing.
--
-- CAPTURE. Informal-sector taxpayers are not reached one at a time. A farmer
-- belongs to a cooperative, a trader to a market association, a driver to a
-- transport union, and that group — not the individual — is how the state
-- finds them, speaks to them and vouches for who they are. There was nowhere
-- to record any of it.
--
-- A group here identifies and attests. It does not transact: every liability
-- and every benefit stays attached to the individual taxpayer, so the audit
-- trail continues to name a person. A cooperative paying a bulk levy on behalf
-- of its members would be a different and much larger design, and is not this.
--
-- ALLOCATION. Fertiliser, seed and tractor days are not eligibility, they are
-- scarce physical things. Health insurance can be granted to everyone who
-- qualifies; a hundred bags of fertiliser cannot. That difference needs a
-- quantity, a round, a record of who actually received what, and a way to stop
-- the same farmer collecting twice — which is a database constraint here
-- rather than an application check, for the same reason the rest of this
-- platform's financial controls are.

-- ---------------------------------------------------------------------------
-- Groups
-- ---------------------------------------------------------------------------

-- Codes come from a sequence, never COUNT(*) + 1, for the same reason receipt
-- numbers do: a count races and reissues.
CREATE SEQUENCE IF NOT EXISTS group_code_seq START 1;

CREATE TABLE IF NOT EXISTS taxpayer_groups (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  code              TEXT        NOT NULL UNIQUE,
  name              TEXT        NOT NULL,
  group_type        TEXT        NOT NULL CHECK (group_type IN (
                                  'FARMERS_COOPERATIVE', 'MARKET_ASSOCIATION',
                                  'TRANSPORT_UNION', 'ARTISAN_GUILD',
                                  'TRADERS_ASSOCIATION', 'FISHERIES_GROUP',
                                  'LIVESTOCK_ASSOCIATION', 'OTHER')),
  -- The sector its members work in, so a sector-targeted programme and a group
  -- describe the same population in the same words.
  economic_sector   TEXT,
  lga_id            UUID        NOT NULL REFERENCES lgas(id),
  ward_id           UUID        REFERENCES wards(id),
  community         TEXT,
  -- The leader is the person who attests to membership. They are recorded as a
  -- taxpayer where they are one, because a leader vouching for members while
  -- being unknown to the revenue system themselves is its own problem.
  leader_taxpayer_id UUID       REFERENCES taxpayers(id),
  leader_name       TEXT        NOT NULL,
  leader_phone      TEXT        NOT NULL,
  member_estimate   INTEGER,
  status            TEXT        NOT NULL DEFAULT 'PENDING'
                                CHECK (status IN ('PENDING', 'ACTIVE', 'SUSPENDED')),
  registered_by     UUID        REFERENCES users(id),
  approved_by       UUID        REFERENCES users(id),
  approved_at       TIMESTAMPTZ,
  suspension_reason TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_groups_lga ON taxpayer_groups (lga_id, status);
CREATE INDEX IF NOT EXISTS idx_groups_sector ON taxpayer_groups (economic_sector)
  WHERE economic_sector IS NOT NULL;

CREATE TRIGGER taxpayer_groups_touch BEFORE UPDATE ON taxpayer_groups
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------------------------------------------------------------------------
-- Membership
-- ---------------------------------------------------------------------------
-- A membership is a claim until the group's leader attests to it. Nothing
-- downstream — no programme, no allocation — may rely on an unattested claim,
-- which is what stops an agent inventing members to inflate a distribution.

CREATE TABLE IF NOT EXISTS taxpayer_group_members (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id          UUID        NOT NULL REFERENCES taxpayer_groups(id),
  taxpayer_id       UUID        NOT NULL REFERENCES taxpayers(id),
  member_reference  TEXT,
  status            TEXT        NOT NULL DEFAULT 'PENDING_ATTESTATION'
                                CHECK (status IN ('PENDING_ATTESTATION', 'ATTESTED',
                                                  'REJECTED', 'LEFT')),
  joined_on         DATE,
  attested_at       TIMESTAMPTZ,
  attested_by_name  TEXT,
  rejection_reason  TEXT,
  added_by          UUID        REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One membership per person per group. Re-joining reuses the row.
  UNIQUE (group_id, taxpayer_id)
);

CREATE INDEX IF NOT EXISTS idx_group_members_taxpayer
  ON taxpayer_group_members (taxpayer_id, status);
CREATE INDEX IF NOT EXISTS idx_group_members_group
  ON taxpayer_group_members (group_id, status);

CREATE TRIGGER group_members_touch BEFORE UPDATE ON taxpayer_group_members
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Attestation tokens, hashed exactly as referee invitations are: the plaintext
-- exists once, in the message sent to the leader.
CREATE TABLE IF NOT EXISTS group_attestation_invitations (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id              UUID        NOT NULL REFERENCES taxpayer_groups(id),
  invitation_token_hash TEXT        NOT NULL UNIQUE,
  channel               TEXT        NOT NULL DEFAULT 'SMS',
  expires_at            TIMESTAMPTZ NOT NULL,
  sent_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  opened_at             TIMESTAMPTZ,
  last_used_at          TIMESTAMPTZ,
  status                TEXT        NOT NULL DEFAULT 'SENT'
                                    CHECK (status IN ('SENT', 'OPENED', 'EXPIRED', 'REVOKED')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_group_attestation_group
  ON group_attestation_invitations (group_id, status);

-- ---------------------------------------------------------------------------
-- Programmes may require membership
-- ---------------------------------------------------------------------------
-- The capture mechanism, joined to the entitlement one: a fertiliser programme
-- can insist that a beneficiary is an attested member of a farming group,
-- which is what makes "we reach farmers through their cooperative" true of the
-- software and not just of the policy.

ALTER TABLE incentive_programmes
  ADD COLUMN IF NOT EXISTS requires_group_membership BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS target_group_types TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN incentive_programmes.requires_group_membership IS
  'When true, only attested members of a matching group are in scope.';

-- ---------------------------------------------------------------------------
-- Allocation rounds
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS incentive_allocation_rounds (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  programme_id      UUID        NOT NULL REFERENCES incentive_programmes(id),
  name              TEXT        NOT NULL,
  -- What is being handed out, and in what units. Free text would make two
  -- rounds of "bags" incomparable, so the unit is constrained.
  unit              TEXT        NOT NULL CHECK (unit IN (
                                  'BAG_50KG', 'BAG_25KG', 'LITRE', 'KILOGRAM',
                                  'TRACTOR_DAY', 'SEEDLING', 'UNIT')),
  total_quantity    NUMERIC(14,2) NOT NULL CHECK (total_quantity > 0),
  quantity_per_beneficiary NUMERIC(14,2) NOT NULL CHECK (quantity_per_beneficiary > 0),
  collection_point  TEXT,
  opens_at          TIMESTAMPTZ NOT NULL,
  closes_at         TIMESTAMPTZ,
  status            TEXT        NOT NULL DEFAULT 'DRAFT'
                                CHECK (status IN ('DRAFT', 'OPEN', 'CLOSED')),
  created_by        UUID        REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (closes_at IS NULL OR closes_at > opens_at),
  CHECK (quantity_per_beneficiary <= total_quantity)
);

CREATE INDEX IF NOT EXISTS idx_allocation_rounds_programme
  ON incentive_allocation_rounds (programme_id, status);

CREATE TRIGGER allocation_rounds_touch BEFORE UPDATE ON incentive_allocation_rounds
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------------------------------------------------------------------------
-- Awards
-- ---------------------------------------------------------------------------
-- One row per beneficiary per round, and the UNIQUE constraint is the point:
-- collecting twice is the obvious way to defraud a fertiliser programme, and
-- it is refused by the database rather than by whichever code path happens to
-- remember to check.

CREATE TABLE IF NOT EXISTS incentive_awards (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id          UUID        NOT NULL REFERENCES incentive_allocation_rounds(id),
  taxpayer_id       UUID        NOT NULL REFERENCES taxpayers(id),
  group_id          UUID        REFERENCES taxpayer_groups(id),
  quantity          NUMERIC(14,2) NOT NULL CHECK (quantity > 0),
  status            TEXT        NOT NULL DEFAULT 'AWARDED'
                                CHECK (status IN ('AWARDED', 'COLLECTED', 'FORFEITED')),
  -- Verifiable at the collection point the same way a receipt is verifiable.
  collection_code   TEXT        NOT NULL UNIQUE,
  compliance_score  INTEGER,
  awarded_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  awarded_by        UUID        REFERENCES users(id),
  collected_at      TIMESTAMPTZ,
  collected_by      UUID        REFERENCES users(id),
  forfeited_reason  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (round_id, taxpayer_id)
);

CREATE INDEX IF NOT EXISTS idx_awards_round ON incentive_awards (round_id, status);
CREATE INDEX IF NOT EXISTS idx_awards_taxpayer ON incentive_awards (taxpayer_id);

CREATE TRIGGER awards_touch BEFORE UPDATE ON incentive_awards
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- An award is a claim on a finite store. Awarding more than the round holds is
-- refused here, in the same transaction as the insert, so two officers issuing
-- at once cannot between them promise fertiliser that does not exist.
CREATE OR REPLACE FUNCTION enforce_round_quantity() RETURNS TRIGGER AS $$
DECLARE
  round_total   NUMERIC(14,2);
  round_status  TEXT;
  already       NUMERIC(14,2);
BEGIN
  SELECT total_quantity, status INTO round_total, round_status
    FROM incentive_allocation_rounds WHERE id = NEW.round_id FOR UPDATE;

  IF round_status <> 'OPEN' THEN
    RAISE EXCEPTION 'Allocation round is % — awards can only be made while it is OPEN', round_status
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT COALESCE(SUM(quantity), 0) INTO already
    FROM incentive_awards
   WHERE round_id = NEW.round_id AND status <> 'FORFEITED'
     AND (TG_OP = 'INSERT' OR id <> NEW.id);

  IF already + NEW.quantity > round_total THEN
    RAISE EXCEPTION 'Allocation round has % of % remaining; this award needs %',
      round_total - already, round_total, NEW.quantity
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER awards_within_round_quantity
  BEFORE INSERT ON incentive_awards
  FOR EACH ROW EXECUTE FUNCTION enforce_round_quantity();

-- Awards and memberships are evidence of who received public resources, so
-- they are append-only in the same way the rest of that evidence is.
CREATE TRIGGER awards_no_delete BEFORE DELETE ON incentive_awards
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();
CREATE TRIGGER group_members_no_delete BEFORE DELETE ON taxpayer_group_members
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();
