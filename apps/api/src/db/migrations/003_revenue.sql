-- =============================================================================
-- 003_revenue.sql — the revenue catalogue and assessment chain
--
-- PRD §8: "The revenue catalogue must be configurable rather than hard-coded."
-- PRD §9: "Historical rates must never be overwritten."
--
-- The hierarchy is Authority -> MDA -> Category -> Item -> versioned Rate.
-- Rates live in their own table with effective dates; an assessment stores the
-- id of the exact rate version it used, so a ₦10,000 transaction stays a
-- ₦10,000 transaction forever after the rate rises to ₦15,000.
-- =============================================================================

CREATE TABLE revenue_authorities (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  code        TEXT NOT NULL UNIQUE,
  tier        TEXT NOT NULL CHECK (tier IN ('STATE', 'LOCAL_GOVERNMENT', 'FEDERAL')),
  status      TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE mdas (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id  UUID NOT NULL REFERENCES revenue_authorities(id),
  name          TEXT NOT NULL,
  code          TEXT NOT NULL UNIQUE,
  status        TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (authority_id, name)
);

CREATE TABLE revenue_categories (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id  UUID NOT NULL REFERENCES revenue_authorities(id),
  name          TEXT NOT NULL,
  code          TEXT NOT NULL UNIQUE,
  description   TEXT,
  status        TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (authority_id, name)
);

CREATE INDEX idx_categories_authority ON revenue_categories(authority_id);

-- The revenue item: a single payable thing (PRD §9). Attributes that describe
-- *what* it is live here; attributes that describe *how much* live in the rate
-- versions, because only the latter change over time.
CREATE TABLE revenue_items (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id        UUID NOT NULL REFERENCES revenue_categories(id),
  mda_id             UUID REFERENCES mdas(id),
  code               TEXT NOT NULL UNIQUE,
  name               TEXT NOT NULL,
  description        TEXT,
  applicable_taxpayer_types TEXT[] NOT NULL DEFAULT '{INDIVIDUAL,BUSINESS}',
  -- Empty array means state-wide; otherwise the item applies only in the
  -- listed LGAs (PRD §9 "Applicable location").
  applicable_lga_ids UUID[] NOT NULL DEFAULT '{}',
  frequency          TEXT NOT NULL DEFAULT 'ANNUAL'
                       CHECK (frequency IN ('ONE_OFF', 'DAILY', 'MONTHLY', 'QUARTERLY', 'ANNUAL')),
  required_documents TEXT[] NOT NULL DEFAULT '{}',
  assessment_rules   JSONB NOT NULL DEFAULT '{}'::jsonb,
  payment_account_id UUID REFERENCES bank_accounts(id),
  receipt_template   TEXT NOT NULL DEFAULT 'STANDARD',
  self_assessable    BOOLEAN NOT NULL DEFAULT FALSE,
  commission_eligible BOOLEAN NOT NULL DEFAULT TRUE,
  status             TEXT NOT NULL DEFAULT 'ACTIVE'
                       CHECK (status IN ('DRAFT', 'ACTIVE', 'SUSPENDED', 'RETIRED')),
  created_by         UUID REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER revenue_items_touch BEFORE UPDATE ON revenue_items
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER revenue_items_no_delete BEFORE DELETE ON revenue_items
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();

CREATE INDEX idx_items_category ON revenue_items(category_id) WHERE status = 'ACTIVE';
CREATE INDEX idx_items_mda ON revenue_items(mda_id);

-- Versioned rates (PRD §9). A rate row is never edited: changing a rate inserts
-- a new version and closes the previous one by setting effective_to. Approving
-- a rate change goes through maker-checker (PRD §69).
CREATE TABLE revenue_item_rates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  revenue_item_id UUID NOT NULL REFERENCES revenue_items(id),
  version         INTEGER NOT NULL,
  rate_type       TEXT NOT NULL CHECK (rate_type IN ('FIXED', 'PERCENTAGE', 'TIERED', 'FORMULA')),
  -- FIXED: the payable amount. PERCENTAGE/TIERED/FORMULA leave this null and
  -- use rate_basis_points / tiers / formula respectively.
  fixed_amount_kobo BIGINT CHECK (fixed_amount_kobo IS NULL OR fixed_amount_kobo >= 0),
  rate_basis_points INTEGER CHECK (rate_basis_points IS NULL OR rate_basis_points >= 0),
  tiers           JSONB,
  formula         TEXT,
  minimum_amount_kobo BIGINT CHECK (minimum_amount_kobo IS NULL OR minimum_amount_kobo >= 0),
  maximum_amount_kobo BIGINT CHECK (maximum_amount_kobo IS NULL OR maximum_amount_kobo >= 0),
  effective_from  TIMESTAMPTZ NOT NULL,
  effective_to    TIMESTAMPTZ,
  approval_id     UUID REFERENCES approvals(id),
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (revenue_item_id, version),
  CONSTRAINT rate_period_valid CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT rate_band_valid CHECK (
    minimum_amount_kobo IS NULL OR maximum_amount_kobo IS NULL
    OR maximum_amount_kobo >= minimum_amount_kobo),
  CONSTRAINT rate_definition_present CHECK (
    (rate_type = 'FIXED' AND fixed_amount_kobo IS NOT NULL)
    OR (rate_type = 'PERCENTAGE' AND rate_basis_points IS NOT NULL)
    OR (rate_type = 'TIERED' AND tiers IS NOT NULL)
    OR (rate_type = 'FORMULA' AND formula IS NOT NULL))
);

-- A rate version is historical evidence the moment it exists: never edited,
-- never deleted. Closing a version writes effective_to only.
CREATE TRIGGER revenue_rates_no_delete BEFORE DELETE ON revenue_item_rates
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();
CREATE TRIGGER revenue_rates_immutable BEFORE UPDATE ON revenue_item_rates
  FOR EACH ROW EXECUTE FUNCTION prevent_column_mutation(
    'revenue_item_id', 'version', 'rate_type', 'fixed_amount_kobo', 'rate_basis_points',
    'tiers', 'formula', 'minimum_amount_kobo', 'maximum_amount_kobo', 'effective_from');

CREATE INDEX idx_rates_item_effective ON revenue_item_rates(revenue_item_id, effective_from DESC);
-- At most one open-ended rate version per item.
CREATE UNIQUE INDEX idx_rates_current ON revenue_item_rates(revenue_item_id)
  WHERE effective_to IS NULL;

-- -----------------------------------------------------------------------------
-- Assessments (PRD §14)
-- -----------------------------------------------------------------------------

CREATE TABLE assessments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_number  TEXT NOT NULL UNIQUE,
  taxpayer_id        UUID NOT NULL REFERENCES taxpayers(id),
  revenue_item_id    UUID NOT NULL REFERENCES revenue_items(id),
  -- The exact rate version used. This is what makes a historical assessment
  -- reproducible: recomputing it from this row must yield the same figure.
  rate_version_id    UUID NOT NULL REFERENCES revenue_item_rates(id),
  assessment_type    TEXT NOT NULL DEFAULT 'AGENT_ASSISTED'
                       CHECK (assessment_type IN ('AGENT_ASSISTED', 'SELF_ASSESSMENT', 'OFFICER')),
  -- Inputs the amount was derived from (turnover, quantity, vehicle class...).
  -- Retained so an auditor can re-run the calculation years later.
  computation_inputs JSONB NOT NULL DEFAULT '{}'::jsonb,
  computation_trace  JSONB NOT NULL DEFAULT '{}'::jsonb,
  base_amount_kobo   BIGINT NOT NULL CHECK (base_amount_kobo >= 0),
  discount_kobo      BIGINT NOT NULL DEFAULT 0 CHECK (discount_kobo >= 0),
  -- PRD §6: any service charge must be explicitly defined and displayed before
  -- payment. It is a separate column so it can never be silently folded into
  -- the government's revenue figure.
  service_charge_kobo BIGINT NOT NULL DEFAULT 0 CHECK (service_charge_kobo >= 0),
  amount_kobo        BIGINT NOT NULL CHECK (amount_kobo >= 0),
  period_start       DATE,
  period_end         DATE,
  period_label       TEXT,
  lga_id             UUID NOT NULL REFERENCES lgas(id),
  ward_id            UUID REFERENCES wards(id),
  status             TEXT NOT NULL DEFAULT 'ACTIVE'
                       CHECK (status IN ('DRAFT', 'ACTIVE', 'INVOICED', 'SETTLED', 'CANCELLED', 'EXPIRED')),
  created_by         UUID NOT NULL REFERENCES users(id),
  agent_id           UUID REFERENCES agents(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT assessment_total_consistent CHECK (
    amount_kobo = base_amount_kobo - discount_kobo + service_charge_kobo),
  CONSTRAINT assessment_period_valid CHECK (
    period_start IS NULL OR period_end IS NULL OR period_end >= period_start)
);

CREATE TRIGGER assessments_touch BEFORE UPDATE ON assessments
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER assessments_no_delete BEFORE DELETE ON assessments
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();
-- PRD §7.2: agents cannot "change transaction amounts after authorization".
-- The amount and its provenance are frozen at creation.
CREATE TRIGGER assessments_immutable BEFORE UPDATE ON assessments
  FOR EACH ROW EXECUTE FUNCTION prevent_column_mutation(
    'assessment_number', 'taxpayer_id', 'revenue_item_id', 'rate_version_id',
    'base_amount_kobo', 'discount_kobo', 'service_charge_kobo', 'amount_kobo',
    'computation_inputs', 'created_by', 'agent_id');

CREATE INDEX idx_assessments_taxpayer ON assessments(taxpayer_id, created_at DESC);
CREATE INDEX idx_assessments_agent ON assessments(agent_id, created_at DESC);
CREATE INDEX idx_assessments_item ON assessments(revenue_item_id);
CREATE INDEX idx_assessments_lga ON assessments(lga_id);

-- -----------------------------------------------------------------------------
-- Invoices (PRD §15)
-- -----------------------------------------------------------------------------

CREATE TABLE invoices (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number    TEXT NOT NULL UNIQUE,
  assessment_id     UUID NOT NULL REFERENCES assessments(id),
  taxpayer_id       UUID NOT NULL REFERENCES taxpayers(id),
  amount_kobo       BIGINT NOT NULL CHECK (amount_kobo > 0),
  service_charge_kobo BIGINT NOT NULL DEFAULT 0 CHECK (service_charge_kobo >= 0),
  total_amount_kobo BIGINT NOT NULL CHECK (total_amount_kobo > 0),
  amount_paid_kobo  BIGINT NOT NULL DEFAULT 0 CHECK (amount_paid_kobo >= 0),
  verification_code TEXT NOT NULL UNIQUE,
  issued_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ,
  status            TEXT NOT NULL DEFAULT 'UNPAID'
                      CHECK (status IN ('UNPAID', 'PARTIALLY_PAID', 'PAID', 'EXPIRED', 'CANCELLED')),
  agent_id          UUID REFERENCES agents(id),
  created_by        UUID NOT NULL REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT invoice_total_consistent CHECK (total_amount_kobo = amount_kobo + service_charge_kobo),
  CONSTRAINT invoice_not_overpaid CHECK (amount_paid_kobo <= total_amount_kobo)
);

CREATE TRIGGER invoices_touch BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER invoices_no_delete BEFORE DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();
CREATE TRIGGER invoices_immutable BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION prevent_column_mutation(
    'invoice_number', 'assessment_id', 'taxpayer_id', 'amount_kobo',
    'service_charge_kobo', 'total_amount_kobo', 'verification_code', 'issued_at');

CREATE INDEX idx_invoices_taxpayer ON invoices(taxpayer_id, created_at DESC);
CREATE INDEX idx_invoices_status ON invoices(status) WHERE status IN ('UNPAID', 'PARTIALLY_PAID');
CREATE INDEX idx_invoices_agent ON invoices(agent_id);

-- Sequences backing human-readable, gap-tolerant document numbers. Uniqueness
-- comes from the sequence, not from a count of existing rows — a count would
-- race under concurrency and could reissue a receipt number (PRD §31).
CREATE SEQUENCE assessment_number_seq;
CREATE SEQUENCE invoice_number_seq;
CREATE SEQUENCE receipt_number_seq;
CREATE SEQUENCE transaction_reference_seq;
CREATE SEQUENCE agent_code_seq;
CREATE SEQUENCE application_number_seq;
CREATE SEQUENCE referee_code_seq;
CREATE SEQUENCE document_number_seq;
CREATE SEQUENCE payout_reference_seq;
CREATE SEQUENCE ticket_number_seq;
