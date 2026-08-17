-- =============================================================================
-- 002_identity.sql — Layer 1 of the trust model (Addendum §48)
--
-- "Who is the taxpayer? Who is the agent? Who is the referee?"
--
-- Includes the full agent clearance pipeline: an individual becomes an
-- authorised revenue agent only by passing KYC, referee clearance, training,
-- bank verification, agreement acceptance, device registration and government
-- review — enforced here in the schema, not by hiding buttons (Addendum §14).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Taxpayers (PRD §10, §12)
-- -----------------------------------------------------------------------------

CREATE TABLE taxpayers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  taxpayer_type     TEXT NOT NULL CHECK (taxpayer_type IN ('INDIVIDUAL', 'BUSINESS')),
  -- TIN is assigned by the authoritative PSIRS TIN service, never invented by
  -- an agent (PRD §11, §82). It is nullable while registration is in flight and
  -- unique once present.
  tin               TEXT UNIQUE,
  tin_status        TEXT NOT NULL DEFAULT 'NOT_REQUESTED' CHECK (tin_status IN (
                      'NOT_REQUESTED', 'REQUESTED', 'ASSIGNED', 'FAILED', 'EXISTING')),
  tin_requested_at  TIMESTAMPTZ,
  tin_assigned_at   TIMESTAMPTZ,
  tin_reference     TEXT,

  first_name        TEXT,
  middle_name       TEXT,
  last_name         TEXT,
  date_of_birth     DATE,
  gender            TEXT CHECK (gender IN ('MALE', 'FEMALE', 'UNSPECIFIED')),

  business_name     TEXT,
  business_type     TEXT,
  registration_number TEXT,
  nature_of_business  TEXT,

  phone             TEXT NOT NULL,
  alternate_phone   TEXT,
  email             CITEXT,
  address           TEXT NOT NULL,
  lga_id            UUID NOT NULL REFERENCES lgas(id),
  ward_id           UUID REFERENCES wards(id),
  community         TEXT,
  occupation        TEXT,
  business_activity TEXT,

  -- Identification numbers are stored as salted hashes plus a masked display
  -- form. PRD §62 data minimisation: the platform can match and de-duplicate on
  -- an identifier without holding a reusable copy of it.
  identity_type     TEXT,
  identity_hash     TEXT,
  identity_masked   TEXT,

  photo_document_id UUID,
  consent_given     BOOLEAN NOT NULL DEFAULT FALSE,
  consent_at        TIMESTAMPTZ,
  declaration_accepted BOOLEAN NOT NULL DEFAULT FALSE,

  status            TEXT NOT NULL DEFAULT 'ACTIVE'
                      CHECK (status IN ('DRAFT', 'ACTIVE', 'SUSPENDED', 'MERGED', 'CLOSED')),
  merged_into_id    UUID REFERENCES taxpayers(id),
  user_id           UUID REFERENCES users(id),
  registered_by_agent_id UUID,
  source            TEXT NOT NULL DEFAULT 'AGENT'
                      CHECK (source IN ('AGENT', 'SELF_SERVICE', 'MIGRATION', 'PSIRS_SYNC')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- An individual needs a name; a business needs a business name.
  CONSTRAINT taxpayer_name_present CHECK (
    (taxpayer_type = 'INDIVIDUAL' AND first_name IS NOT NULL AND last_name IS NOT NULL)
    OR (taxpayer_type = 'BUSINESS' AND business_name IS NOT NULL)
  )
);

CREATE TRIGGER taxpayers_touch BEFORE UPDATE ON taxpayers
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER taxpayers_no_delete BEFORE DELETE ON taxpayers
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();

CREATE INDEX idx_taxpayers_phone ON taxpayers(phone);
CREATE INDEX idx_taxpayers_tin ON taxpayers(tin) WHERE tin IS NOT NULL;
CREATE INDEX idx_taxpayers_lga ON taxpayers(lga_id);
CREATE INDEX idx_taxpayers_identity ON taxpayers(identity_hash) WHERE identity_hash IS NOT NULL;
CREATE INDEX idx_taxpayers_names ON taxpayers(lower(coalesce(first_name, '')), lower(coalesce(last_name, '')));
CREATE INDEX idx_taxpayers_business ON taxpayers(lower(coalesce(business_name, '')));

-- Every potential duplicate surfaced at registration time is recorded, whether
-- the agent proceeded or not (PRD §11). A pattern of overriding duplicate
-- warnings is itself a fraud signal (PRD §32).
CREATE TABLE taxpayer_duplicate_checks (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_payload  JSONB NOT NULL,
  matched_taxpayer_id UUID REFERENCES taxpayers(id),
  match_score        NUMERIC(5, 2) NOT NULL,
  match_reasons      TEXT[] NOT NULL,
  decision           TEXT NOT NULL CHECK (decision IN ('BLOCKED', 'PROCEEDED', 'LINKED_EXISTING')),
  created_taxpayer_id UUID REFERENCES taxpayers(id),
  performed_by       UUID REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_dupcheck_matched ON taxpayer_duplicate_checks(matched_taxpayer_id);
CREATE INDEX idx_dupcheck_actor ON taxpayer_duplicate_checks(performed_by, created_at DESC);

-- -----------------------------------------------------------------------------
-- Bank accounts (commission only — never government revenue, PRD §6, §16)
-- -----------------------------------------------------------------------------

CREATE TABLE bank_accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type      TEXT NOT NULL CHECK (owner_type IN ('AGENT', 'GOVERNMENT')),
  owner_id        UUID NOT NULL,
  bank_name       TEXT NOT NULL,
  bank_code       TEXT,
  account_name    TEXT NOT NULL,
  account_number  TEXT NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED' CHECK (verification_status IN (
                    'UNVERIFIED', 'PENDING', 'VERIFIED', 'FAILED')),
  verification_reference TEXT,
  verified_at     TIMESTAMPTZ,
  verified_by     UUID REFERENCES users(id),
  status          TEXT NOT NULL DEFAULT 'ACTIVE'
                    CHECK (status IN ('ACTIVE', 'SUPERSEDED', 'BLOCKED')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER bank_accounts_touch BEFORE UPDATE ON bank_accounts
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER bank_accounts_no_delete BEFORE DELETE ON bank_accounts
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();
-- A bank account's number never changes in place: a change of account is a new
-- row through the maker-checker workflow (PRD §70), leaving the old one visible.
CREATE TRIGGER bank_accounts_immutable BEFORE UPDATE ON bank_accounts
  FOR EACH ROW EXECUTE FUNCTION prevent_column_mutation('account_number', 'bank_code', 'owner_id', 'owner_type');

CREATE INDEX idx_bank_owner ON bank_accounts(owner_type, owner_id) WHERE status = 'ACTIVE';

-- -----------------------------------------------------------------------------
-- Territories (PRD §74)
-- -----------------------------------------------------------------------------

CREATE TABLE territories (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  code         TEXT NOT NULL UNIQUE,
  lga_id       UUID NOT NULL REFERENCES lgas(id),
  ward_ids     UUID[] NOT NULL DEFAULT '{}',
  communities  TEXT[] NOT NULL DEFAULT '{}',
  status       TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER territories_touch BEFORE UPDATE ON territories
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE INDEX idx_territories_lga ON territories(lga_id);

-- -----------------------------------------------------------------------------
-- Agents (Addendum §31, §32)
--
-- Six independent status axes. No single column controls the lifecycle; the
-- derived application state is computed from all of them.
-- -----------------------------------------------------------------------------

CREATE TABLE agents (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL UNIQUE REFERENCES users(id),
  agent_code          TEXT UNIQUE,
  application_number  TEXT NOT NULL UNIQUE,

  account_status      TEXT NOT NULL DEFAULT 'PENDING'
                        CHECK (account_status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSED')),
  kyc_status          TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK (kyc_status IN (
                        'NOT_STARTED', 'SUBMITTED', 'UNDER_REVIEW', 'VERIFICATION_REQUIRED',
                        'FAILED', 'CLEARED', 'SUSPENDED')),
  referee_status      TEXT NOT NULL DEFAULT 'PENDING'
                        CHECK (referee_status IN ('PENDING', 'CLEARED', 'FAILED')),
  training_status     TEXT NOT NULL DEFAULT 'PENDING'
                        CHECK (training_status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED')),
  clearance_status    TEXT NOT NULL DEFAULT 'PENDING' CHECK (clearance_status IN (
                        'PENDING', 'READY_FOR_REVIEW', 'APPROVED', 'REJECTED', 'ACTION_REQUIRED')),
  operational_status  TEXT NOT NULL DEFAULT 'INACTIVE'
                        CHECK (operational_status IN ('INACTIVE', 'ACTIVE', 'SUSPENDED')),
  application_submitted_at TIMESTAMPTZ,

  -- Applicant details (Addendum §3)
  date_of_birth       DATE,
  gender              TEXT CHECK (gender IN ('MALE', 'FEMALE', 'UNSPECIFIED')),
  alternate_phone     TEXT,
  address             TEXT,
  lga_id              UUID REFERENCES lgas(id),
  ward_id             UUID REFERENCES wards(id),
  community           TEXT,
  occupation          TEXT,
  previous_occupation TEXT,

  territory_id        UUID REFERENCES territories(id),
  supervisor_id       UUID REFERENCES users(id),
  bank_account_id     UUID REFERENCES bank_accounts(id),
  commission_policy_id UUID,

  approved_by         UUID REFERENCES users(id),
  approved_at         TIMESTAMPTZ,
  activated_at        TIMESTAMPTZ,
  suspended_at        TIMESTAMPTZ,
  suspension_reason   TEXT,
  rejection_reason    TEXT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Addendum §14/§50, enforced at the database level: an agent can only be
  -- operationally ACTIVE when KYC and referee clearance have both succeeded and
  -- government has approved. A misbehaving service or a hand-run UPDATE cannot
  -- produce an active agent that skipped clearance.
  CONSTRAINT agent_activation_requires_clearance CHECK (
    operational_status <> 'ACTIVE'
    OR (kyc_status = 'CLEARED' AND referee_status = 'CLEARED'
        AND clearance_status = 'APPROVED' AND training_status = 'COMPLETED')
  ),
  -- An active agent must have an assigned territory: every transaction is
  -- attributed geographically (PRD §31).
  CONSTRAINT agent_active_has_territory CHECK (
    operational_status <> 'ACTIVE' OR territory_id IS NOT NULL
  )
);

CREATE TRIGGER agents_touch BEFORE UPDATE ON agents
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER agents_no_delete BEFORE DELETE ON agents
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();
CREATE TRIGGER agents_immutable BEFORE UPDATE ON agents
  FOR EACH ROW EXECUTE FUNCTION prevent_column_mutation('user_id', 'application_number');

CREATE INDEX idx_agents_status ON agents(operational_status, clearance_status);
CREATE INDEX idx_agents_territory ON agents(territory_id);
CREATE INDEX idx_agents_supervisor ON agents(supervisor_id);
CREATE INDEX idx_agents_kyc ON agents(kyc_status, referee_status);

ALTER TABLE taxpayers
  ADD CONSTRAINT taxpayers_agent_fk FOREIGN KEY (registered_by_agent_id) REFERENCES agents(id);

-- -----------------------------------------------------------------------------
-- Agent KYC (Addendum §4, §33)
-- -----------------------------------------------------------------------------

CREATE TABLE agent_kyc (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id              UUID NOT NULL REFERENCES agents(id),
  verification_provider TEXT,
  verification_reference TEXT,
  identity_type         TEXT NOT NULL CHECK (identity_type IN (
                          'NIN', 'BVN', 'PASSPORT', 'DRIVERS_LICENCE', 'VOTERS_CARD', 'OTHER')),
  -- Addendum §33: "Sensitive identity numbers should not be unnecessarily
  -- exposed or stored in plaintext."
  identity_number_hash  TEXT NOT NULL,
  identity_number_masked TEXT NOT NULL,
  verification_status   TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK (verification_status IN (
                          'SUBMITTED', 'UNDER_REVIEW', 'VERIFICATION_REQUIRED', 'FAILED', 'CLEARED')),
  liveness_result       TEXT CHECK (liveness_result IN ('PASSED', 'FAILED', 'MANUAL_REVIEW', 'NOT_PERFORMED')),
  liveness_score        NUMERIC(5, 2),
  submitted_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at           TIMESTAMPTZ,
  failure_reason        TEXT,
  reviewed_by           UUID REFERENCES users(id),
  attempt_number        INTEGER NOT NULL DEFAULT 1,
  superseded_at         TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER agent_kyc_no_delete BEFORE DELETE ON agent_kyc
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();
CREATE INDEX idx_agent_kyc_agent ON agent_kyc(agent_id, submitted_at DESC);
-- One live KYC submission per agent; resubmission supersedes rather than edits
-- (Addendum §28 corrective action, keeping the failed attempt in history).
CREATE UNIQUE INDEX idx_agent_kyc_current ON agent_kyc(agent_id) WHERE superseded_at IS NULL;
CREATE INDEX idx_agent_kyc_identity ON agent_kyc(identity_number_hash);

CREATE TABLE kyc_documents (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id            UUID REFERENCES agents(id),
  referee_id          UUID,
  document_type       TEXT NOT NULL CHECK (document_type IN (
                        'IDENTITY_DOCUMENT', 'SELFIE', 'PROOF_OF_ADDRESS', 'PASSPORT_PHOTOGRAPH',
                        'ADDITIONAL_IDENTIFICATION', 'SUPPORTING_DOCUMENT')),
  storage_reference   TEXT NOT NULL,
  content_type        TEXT NOT NULL,
  byte_size           INTEGER NOT NULL CHECK (byte_size > 0),
  checksum            TEXT NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'PENDING'
                        CHECK (verification_status IN ('PENDING', 'VERIFIED', 'REJECTED')),
  uploaded_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at         TIMESTAMPTZ,
  reviewed_by         UUID REFERENCES users(id),
  rejection_reason    TEXT,
  CONSTRAINT kyc_document_owner CHECK (
    (agent_id IS NOT NULL AND referee_id IS NULL) OR (agent_id IS NULL AND referee_id IS NOT NULL)
  )
);

CREATE TRIGGER kyc_documents_no_delete BEFORE DELETE ON kyc_documents
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();
CREATE INDEX idx_kyc_docs_agent ON kyc_documents(agent_id);
CREATE INDEX idx_kyc_docs_referee ON kyc_documents(referee_id);

-- -----------------------------------------------------------------------------
-- Referees (Addendum §8-§13, §29, §35-§37)
-- -----------------------------------------------------------------------------

CREATE TABLE referees (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id       UUID NOT NULL REFERENCES agents(id),
  reference_code TEXT NOT NULL UNIQUE,
  full_name      TEXT NOT NULL,
  phone          TEXT NOT NULL,
  email          CITEXT,
  address        TEXT,
  occupation     TEXT,
  category       TEXT NOT NULL CHECK (category IN (
                   'COMMUNITY_LEADER', 'EMPLOYER', 'PUBLIC_SERVANT',
                   'RECOGNISED_PROFESSIONAL', 'TRADITIONAL_AUTHORITY', 'RELIGIOUS_LEADER')),
  relationship   TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'INVITED' CHECK (status IN (
                   'INVITED', 'ACCEPTED', 'SUBMITTED', 'UNDER_REVIEW', 'CLEARED',
                   'FAILED', 'REJECTED', 'EXPIRED', 'REPLACED')),
  consent_given  BOOLEAN NOT NULL DEFAULT FALSE,
  declaration_accepted BOOLEAN NOT NULL DEFAULT FALSE,
  invited_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at   TIMESTAMPTZ,
  cleared_at     TIMESTAMPTZ,
  rejected_at    TIMESTAMPTZ,
  rejection_reason TEXT,
  reviewed_by    UUID REFERENCES users(id),
  replaced_by_referee_id UUID REFERENCES referees(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER referees_touch BEFORE UPDATE ON referees
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
-- Addendum §29: a replaced referee "must remain in the audit history. It must
-- not simply be overwritten."
CREATE TRIGGER referees_no_delete BEFORE DELETE ON referees
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();
CREATE TRIGGER referees_immutable BEFORE UPDATE ON referees
  FOR EACH ROW EXECUTE FUNCTION prevent_column_mutation('agent_id', 'reference_code', 'invited_at');

CREATE INDEX idx_referees_agent ON referees(agent_id);
CREATE INDEX idx_referees_phone ON referees(phone);
CREATE INDEX idx_referees_status ON referees(status);

ALTER TABLE kyc_documents
  ADD CONSTRAINT kyc_documents_referee_fk FOREIGN KEY (referee_id) REFERENCES referees(id);

CREATE TABLE referee_kyc (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referee_id            UUID NOT NULL REFERENCES referees(id),
  identity_type         TEXT CHECK (identity_type IN (
                          'NIN', 'BVN', 'PASSPORT', 'DRIVERS_LICENCE', 'VOTERS_CARD', 'OTHER')),
  identity_number_hash  TEXT,
  identity_number_masked TEXT,
  verification_provider TEXT,
  verification_reference TEXT,
  phone_verified        BOOLEAN NOT NULL DEFAULT FALSE,
  verification_status   TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK (verification_status IN (
                          'SUBMITTED', 'UNDER_REVIEW', 'FAILED', 'CLEARED')),
  submitted_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at           TIMESTAMPTZ,
  failure_reason        TEXT,
  reviewed_by           UUID REFERENCES users(id)
);

CREATE TRIGGER referee_kyc_no_delete BEFORE DELETE ON referee_kyc
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();
CREATE INDEX idx_referee_kyc_referee ON referee_kyc(referee_id);
CREATE INDEX idx_referee_kyc_identity ON referee_kyc(identity_number_hash)
  WHERE identity_number_hash IS NOT NULL;

-- Addendum §37: the invitation token is stored only as a hash. Possession of
-- the database does not let anyone impersonate a referee.
CREATE TABLE referee_invitations (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referee_id           UUID NOT NULL REFERENCES referees(id),
  invitation_token_hash TEXT NOT NULL UNIQUE,
  channel              TEXT NOT NULL CHECK (channel IN ('SMS', 'EMAIL', 'BOTH')),
  expires_at           TIMESTAMPTZ NOT NULL,
  sent_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  opened_at            TIMESTAMPTZ,
  responded_at         TIMESTAMPTZ,
  status               TEXT NOT NULL DEFAULT 'SENT'
                         CHECK (status IN ('SENT', 'OPENED', 'RESPONDED', 'EXPIRED', 'REVOKED')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_referee_invitations_referee ON referee_invitations(referee_id);

-- -----------------------------------------------------------------------------
-- Clearance checklist (Addendum §16, §38)
-- -----------------------------------------------------------------------------

CREATE TABLE agent_clearance (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id            UUID NOT NULL UNIQUE REFERENCES agents(id),
  kyc_cleared         BOOLEAN NOT NULL DEFAULT FALSE,
  referee_cleared     BOOLEAN NOT NULL DEFAULT FALSE,
  training_completed  BOOLEAN NOT NULL DEFAULT FALSE,
  bank_verified       BOOLEAN NOT NULL DEFAULT FALSE,
  agreement_accepted  BOOLEAN NOT NULL DEFAULT FALSE,
  device_registered   BOOLEAN NOT NULL DEFAULT FALSE,
  government_approved BOOLEAN NOT NULL DEFAULT FALSE,
  clearance_status    TEXT NOT NULL DEFAULT 'PENDING' CHECK (clearance_status IN (
                        'PENDING', 'READY_FOR_REVIEW', 'APPROVED', 'REJECTED', 'ACTION_REQUIRED')),
  reviewed_by         UUID REFERENCES users(id),
  reviewed_at         TIMESTAMPTZ,
  rejection_reason    TEXT,
  -- Addendum §41: an override is possible only as an explicit, reasoned,
  -- approved exception — there is no hidden "activate anyway" path.
  override_approval_id UUID REFERENCES approvals(id),
  override_reason     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER agent_clearance_touch BEFORE UPDATE ON agent_clearance
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER agent_clearance_no_delete BEFORE DELETE ON agent_clearance
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();

-- Every clearance decision is journalled separately so the review trail
-- survives later state changes (Addendum §28, §47).
CREATE TABLE agent_clearance_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      UUID NOT NULL REFERENCES agents(id),
  event_type    TEXT NOT NULL CHECK (event_type IN (
                  'APPLICATION_SUBMITTED', 'KYC_SUBMITTED', 'KYC_CLEARED', 'KYC_FAILED',
                  'KYC_INFO_REQUIRED', 'REFEREE_INVITED', 'REFEREE_CLEARED', 'REFEREE_FAILED',
                  'REFEREE_REPLACED', 'TRAINING_COMPLETED', 'BANK_VERIFIED', 'AGREEMENT_ACCEPTED',
                  'DEVICE_REGISTERED', 'GOVERNMENT_APPROVED', 'GOVERNMENT_REJECTED',
                  'INFO_REQUESTED', 'ACTIVATED', 'SUSPENDED', 'REINSTATED', 'OVERRIDE_APPLIED')),
  from_state    TEXT,
  to_state      TEXT,
  reason        TEXT,
  actor_id      UUID REFERENCES users(id),
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER agent_clearance_events_no_delete BEFORE DELETE ON agent_clearance_events
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();
CREATE TRIGGER agent_clearance_events_no_update BEFORE UPDATE ON agent_clearance_events
  FOR EACH ROW EXECUTE FUNCTION prevent_any_update();
CREATE INDEX idx_clearance_events_agent ON agent_clearance_events(agent_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- Agreement, training, devices (Addendum §17-§21, §39)
-- -----------------------------------------------------------------------------

CREATE TABLE agreement_versions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version      TEXT NOT NULL UNIQUE,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  status       TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('DRAFT', 'ACTIVE', 'RETIRED')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE agent_agreements (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      UUID NOT NULL REFERENCES agents(id),
  agreement_version_id UUID NOT NULL REFERENCES agreement_versions(id),
  accepted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_address    INET,
  device_id     UUID,
  user_agent    TEXT,
  UNIQUE (agent_id, agreement_version_id)
);

CREATE TRIGGER agent_agreements_no_delete BEFORE DELETE ON agent_agreements
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();
CREATE TRIGGER agent_agreements_no_update BEFORE UPDATE ON agent_agreements
  FOR EACH ROW EXECUTE FUNCTION prevent_any_update();

CREATE TABLE training_modules (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  content     TEXT NOT NULL,
  sequence_no INTEGER NOT NULL,
  assessed    BOOLEAN NOT NULL DEFAULT FALSE,
  pass_mark   INTEGER NOT NULL DEFAULT 0 CHECK (pass_mark BETWEEN 0 AND 100),
  mandatory   BOOLEAN NOT NULL DEFAULT TRUE,
  status      TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RETIRED')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE agent_training_progress (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      UUID NOT NULL REFERENCES agents(id),
  module_id     UUID NOT NULL REFERENCES training_modules(id),
  status        TEXT NOT NULL DEFAULT 'NOT_STARTED'
                  CHECK (status IN ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'FAILED')),
  score         INTEGER CHECK (score IS NULL OR score BETWEEN 0 AND 100),
  attempts      INTEGER NOT NULL DEFAULT 0,
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (agent_id, module_id)
);

CREATE TRIGGER agent_training_touch BEFORE UPDATE ON agent_training_progress
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE agent_devices (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id          UUID NOT NULL REFERENCES agents(id),
  device_identifier TEXT NOT NULL,
  device_name       TEXT,
  browser           TEXT,
  operating_system  TEXT,
  pwa_version       TEXT,
  status            TEXT NOT NULL DEFAULT 'PENDING'
                      CHECK (status IN ('PENDING', 'APPROVED', 'ACTIVE', 'SUSPENDED', 'REVOKED')),
  registered_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at       TIMESTAMPTZ,
  approved_by       UUID REFERENCES users(id),
  last_seen_at      TIMESTAMPTZ,
  revoked_at        TIMESTAMPTZ,
  revoked_by        UUID REFERENCES users(id),
  revocation_reason TEXT,
  UNIQUE (agent_id, device_identifier)
);

CREATE TRIGGER agent_devices_no_delete BEFORE DELETE ON agent_devices
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();
CREATE INDEX idx_devices_agent ON agent_devices(agent_id, status);
CREATE INDEX idx_devices_identifier ON agent_devices(device_identifier);

ALTER TABLE sessions ADD CONSTRAINT sessions_device_fk
  FOREIGN KEY (device_id) REFERENCES agent_devices(id);

-- Addendum §30 / PRD §32: risk flags raised against a referee relationship
-- (one referee vouching for many agents, shared identifiers, and so on).
CREATE TABLE referee_risk_flags (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referee_id   UUID NOT NULL REFERENCES referees(id),
  rule         TEXT NOT NULL,
  severity     TEXT NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  detail       JSONB NOT NULL DEFAULT '{}'::jsonb,
  status       TEXT NOT NULL DEFAULT 'OPEN'
                 CHECK (status IN ('OPEN', 'UNDER_REVIEW', 'CONFIRMED', 'DISMISSED')),
  reviewed_by  UUID REFERENCES users(id),
  reviewed_at  TIMESTAMPTZ,
  resolution_note TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_referee_flags_referee ON referee_risk_flags(referee_id);
CREATE INDEX idx_referee_flags_open ON referee_risk_flags(status) WHERE status = 'OPEN';
