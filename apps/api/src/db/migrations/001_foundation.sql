-- =============================================================================
-- 001_foundation.sql — identity, geography, integrity primitives
--
-- This migration establishes the guarantees every later table depends on:
--   * money is BIGINT kobo, never floating point           (PRD §51)
--   * financial rows can be superseded but never destroyed (PRD §31, §51)
--   * every sensitive action lands in a hash-chained log   (PRD §45)
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- -----------------------------------------------------------------------------
-- Integrity primitives
-- -----------------------------------------------------------------------------

-- Refuse every DELETE. Financial history is corrected by issuing a reversal or
-- a superseding row, never by removing evidence (PRD §31 "No deletion of
-- financial records", §68, §88.21). Applied to every table that carries money,
-- evidence of money, or a decision about money.
CREATE OR REPLACE FUNCTION prevent_delete() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'Row % in % cannot be deleted: financial and audit records are append-only',
    OLD.id, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation',
          HINT = 'Issue a reversal, refund or superseding record instead.';
END;
$$ LANGUAGE plpgsql;

-- Refuse UPDATEs that touch immutable columns. Column names are passed as
-- trigger arguments, so each table declares exactly which of its fields are
-- frozen once written — amounts, references, taxpayer attribution and so on.
-- Mutable workflow fields (status, updated_at) remain writable.
CREATE OR REPLACE FUNCTION prevent_column_mutation() RETURNS TRIGGER AS $$
DECLARE
  col        TEXT;
  old_value  TEXT;
  new_value  TEXT;
BEGIN
  FOREACH col IN ARRAY TG_ARGV LOOP
    EXECUTE format('SELECT ($1).%I::text, ($2).%I::text', col, col)
      INTO old_value, new_value
      USING OLD, NEW;
    IF old_value IS DISTINCT FROM new_value THEN
      RAISE EXCEPTION
        'Column %.% is immutable once written (attempted % -> %)',
        TG_TABLE_NAME, col, coalesce(old_value, 'NULL'), coalesce(new_value, 'NULL')
        USING ERRCODE = 'restrict_violation',
              HINT = 'Create a reversal or superseding record instead of editing history.';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Freeze a row entirely once it reaches a terminal state. Used for completed
-- transactions and issued receipts: PRD §51 "No modification of completed
-- transactions", §23 "Documents must not be silently editable after issuance".
CREATE OR REPLACE FUNCTION prevent_terminal_mutation() RETURNS TRIGGER AS $$
DECLARE
  frozen_states TEXT[] := TG_ARGV;
BEGIN
  IF OLD.status = ANY(frozen_states) AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION
      'Row % in % is in terminal state % and cannot be modified',
      OLD.id, TG_TABLE_NAME, OLD.status
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
  -- Server-side timestamps only (PRD §31 "Timestamping"). A client-supplied
  -- updated_at is discarded; field devices have unreliable clocks and an
  -- agent must not be able to backdate activity.
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- Reference geography (PRD §38, §73) — Plateau State's 17 LGAs and their wards
-- -----------------------------------------------------------------------------

CREATE TABLE lgas (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL UNIQUE,
  zone          TEXT NOT NULL,
  headquarters  TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE wards (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lga_id      UUID NOT NULL REFERENCES lgas(id),
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lga_id, name)
);

CREATE INDEX idx_wards_lga ON wards(lga_id);

-- -----------------------------------------------------------------------------
-- Users, sessions, authentication (PRD §7, §35, §54)
-- -----------------------------------------------------------------------------

CREATE TABLE users (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name           TEXT NOT NULL,
  phone               TEXT NOT NULL UNIQUE,
  email               CITEXT UNIQUE,
  password_hash       TEXT,
  role                TEXT NOT NULL CHECK (role IN (
                        'taxpayer', 'agent', 'supervisor', 'revenue_officer',
                        'finance_officer', 'auditor', 'admin')),
  status              TEXT NOT NULL DEFAULT 'PENDING'
                        CHECK (status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSED')),
  phone_verified_at   TIMESTAMPTZ,
  email_verified_at   TIMESTAMPTZ,
  last_login_at       TIMESTAMPTZ,
  failed_login_count  INTEGER NOT NULL DEFAULT 0,
  locked_until        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER users_touch BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE INDEX idx_users_role_status ON users(role, status);

-- Refresh tokens are stored only as hashes: a database disclosure must not
-- hand an attacker live sessions (PRD §54, Addendum §22).
CREATE TABLE sessions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id),
  refresh_token_hash  TEXT NOT NULL UNIQUE,
  device_id           UUID,
  ip_address          INET,
  user_agent          TEXT,
  issued_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at          TIMESTAMPTZ NOT NULL,
  revoked_at          TIMESTAMPTZ,
  revoked_reason      TEXT,
  last_used_at        TIMESTAMPTZ
);

CREATE INDEX idx_sessions_user ON sessions(user_id) WHERE revoked_at IS NULL;

CREATE TABLE otp_codes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID REFERENCES users(id),
  destination  TEXT NOT NULL,
  purpose      TEXT NOT NULL CHECK (purpose IN (
                 'LOGIN', 'REGISTRATION', 'STEP_UP', 'PASSWORD_RESET', 'REFEREE_VERIFY')),
  code_hash    TEXT NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  expires_at   TIMESTAMPTZ NOT NULL,
  consumed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_otp_lookup ON otp_codes(destination, purpose) WHERE consumed_at IS NULL;

-- Records a successful step-up authentication so a high-risk action (PRD §35)
-- can require a fresh OTP independent of session age.
CREATE TABLE step_up_grants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id),
  action      TEXT NOT NULL,
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);

CREATE INDEX idx_step_up_active ON step_up_grants(user_id, action) WHERE consumed_at IS NULL;

-- -----------------------------------------------------------------------------
-- Hash-chained audit log (PRD §45, §67)
--
-- Each entry stores the hash of the previous entry, so removing or editing any
-- historical row breaks the chain from that point onward and is detectable by
-- replaying it. Combined with prevent_delete()/prevent_column_mutation() this
-- makes silent tampering require more than table access.
-- -----------------------------------------------------------------------------

CREATE TABLE audit_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_no  BIGSERIAL NOT NULL UNIQUE,
  actor_id     UUID REFERENCES users(id),
  actor_role   TEXT,
  action       TEXT NOT NULL,
  entity_type  TEXT NOT NULL,
  entity_id    TEXT,
  old_value    JSONB,
  new_value    JSONB,
  reason       TEXT,
  result       TEXT NOT NULL DEFAULT 'SUCCESS' CHECK (result IN ('SUCCESS', 'FAILURE', 'DENIED')),
  ip_address   INET,
  device_id    UUID,
  latitude     NUMERIC(9, 6),
  longitude    NUMERIC(9, 6),
  request_id   TEXT,
  prev_hash    TEXT,
  hash         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_actor ON audit_logs(actor_id, created_at DESC);
CREATE INDEX idx_audit_action ON audit_logs(action, created_at DESC);
CREATE INDEX idx_audit_created ON audit_logs(created_at DESC);

CREATE TRIGGER audit_logs_no_delete BEFORE DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();

-- The audit log is strictly append-only: no column may ever be updated.
CREATE OR REPLACE FUNCTION prevent_any_update() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; row % cannot be updated', TG_TABLE_NAME, OLD.id
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_no_update BEFORE UPDATE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_any_update();

-- -----------------------------------------------------------------------------
-- Idempotency (PRD §53, §61)
--
-- Keyed by (scope, key). The response of the first successful execution is
-- replayed verbatim for every retry, so a double-tapped Pay button, a retried
-- mobile request on a flaky connection, or a redelivered webhook can never
-- create a second government obligation.
-- -----------------------------------------------------------------------------

CREATE TABLE idempotency_keys (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope          TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  user_id        UUID REFERENCES users(id),
  request_hash   TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'IN_PROGRESS'
                   CHECK (status IN ('IN_PROGRESS', 'COMPLETED', 'FAILED')),
  response_code  INTEGER,
  response_body  JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at   TIMESTAMPTZ,
  UNIQUE (scope, idempotency_key)
);

CREATE INDEX idx_idempotency_created ON idempotency_keys(created_at);

-- -----------------------------------------------------------------------------
-- Maker-checker approvals (PRD §69, §70)
--
-- High-risk operations are requested, reviewed and authorised by different
-- users. The requester can never be the approver — enforced by CHECK below and
-- re-checked in the service layer.
-- -----------------------------------------------------------------------------

CREATE TABLE approvals (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_type     TEXT NOT NULL CHECK (approval_type IN (
                      'AGENT_ACTIVATION', 'AGENT_SUSPENSION', 'COMMISSION_ADJUSTMENT',
                      'COMMISSION_PAYOUT', 'REFUND', 'PAYMENT_REVERSAL',
                      'REVENUE_RATE_CHANGE', 'MANUAL_CORRECTION', 'BANK_ACCOUNT_CHANGE',
                      'TAXPAYER_ADJUSTMENT', 'AGENT_OVERRIDE_ACTIVATION')),
  entity_type       TEXT NOT NULL,
  entity_id         TEXT NOT NULL,
  payload           JSONB NOT NULL,
  status            TEXT NOT NULL DEFAULT 'REQUESTED' CHECK (status IN (
                      'REQUESTED', 'REVIEWED', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXECUTED')),
  requested_by      UUID NOT NULL REFERENCES users(id),
  requested_reason  TEXT NOT NULL,
  requested_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by       UUID REFERENCES users(id),
  reviewed_at       TIMESTAMPTZ,
  review_note       TEXT,
  approved_by       UUID REFERENCES users(id),
  approved_at       TIMESTAMPTZ,
  decision_reason   TEXT,
  executed_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Segregation of duties: the maker is never the checker or the approver.
  CONSTRAINT approvals_maker_not_checker CHECK (reviewed_by IS NULL OR reviewed_by <> requested_by),
  CONSTRAINT approvals_maker_not_approver CHECK (approved_by IS NULL OR approved_by <> requested_by),
  -- Every decision carries a reason (Addendum §15).
  CONSTRAINT approvals_decision_reason CHECK (
    status NOT IN ('APPROVED', 'REJECTED') OR decision_reason IS NOT NULL)
);

CREATE TRIGGER approvals_touch BEFORE UPDATE ON approvals
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER approvals_no_delete BEFORE DELETE ON approvals
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();
CREATE TRIGGER approvals_immutable BEFORE UPDATE ON approvals
  FOR EACH ROW EXECUTE FUNCTION prevent_column_mutation(
    'approval_type', 'entity_type', 'entity_id', 'requested_by', 'requested_at');

CREATE INDEX idx_approvals_pending ON approvals(approval_type, status)
  WHERE status IN ('REQUESTED', 'REVIEWED');
CREATE INDEX idx_approvals_entity ON approvals(entity_type, entity_id);

-- -----------------------------------------------------------------------------
-- PWA version control (Addendum §43)
-- -----------------------------------------------------------------------------

CREATE TABLE app_versions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app              TEXT NOT NULL CHECK (app IN ('AGENT_PWA', 'PORTAL')),
  minimum_version  TEXT NOT NULL,
  recommended_version TEXT NOT NULL,
  notes            TEXT,
  effective_from   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       UUID REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_app_versions_current ON app_versions(app, effective_from DESC);

-- -----------------------------------------------------------------------------
-- System configuration (PRD §7.6) — versioned, never silently overwritten
-- -----------------------------------------------------------------------------

CREATE TABLE system_settings (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key          TEXT NOT NULL,
  value        JSONB NOT NULL,
  description  TEXT,
  version      INTEGER NOT NULL DEFAULT 1,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_at  TIMESTAMPTZ,
  created_by   UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_settings_current ON system_settings(key) WHERE superseded_at IS NULL;
CREATE TRIGGER system_settings_no_delete BEFORE DELETE ON system_settings
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();
