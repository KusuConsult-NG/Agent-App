-- =============================================================================
-- 005_operations.sql — commission, settlement, reconciliation, fraud,
--                      incentives, notifications, support, offline sync
--
-- PRD §26: "Agents must not receive commission on fraudulent, reversed or
-- unverified transactions." PRD §46 makes reconciliation a mandatory MVP
-- feature, not a reporting afterthought.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Commission policy (PRD §25) — configurable, never hard-coded
-- -----------------------------------------------------------------------------

CREATE TABLE commission_policies (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  TEXT NOT NULL,
  code                  TEXT NOT NULL UNIQUE,
  -- 150 basis points = the 1.5% default of PRD §25. Basis points keep the rate
  -- an exact integer: 1.5% of ₦100,000 is ₦1,500.00 with no float rounding.
  rate_basis_points     INTEGER NOT NULL CHECK (rate_basis_points >= 0 AND rate_basis_points <= 10000),
  eligible_category_ids UUID[] NOT NULL DEFAULT '{}',
  minimum_transaction_kobo BIGINT NOT NULL DEFAULT 0 CHECK (minimum_transaction_kobo >= 0),
  maximum_commission_kobo  BIGINT CHECK (maximum_commission_kobo IS NULL OR maximum_commission_kobo >= 0),
  -- PRD §26: commission becomes payable only after the hold period elapses on a
  -- settled transaction, giving reversals time to surface.
  hold_period_hours     INTEGER NOT NULL DEFAULT 72 CHECK (hold_period_hours >= 0),
  settlement_schedule   TEXT NOT NULL DEFAULT 'WEEKLY'
                          CHECK (settlement_schedule IN ('DAILY', 'WEEKLY', 'FORTNIGHTLY', 'MONTHLY')),
  requires_settlement_confirmation BOOLEAN NOT NULL DEFAULT TRUE,
  version               INTEGER NOT NULL DEFAULT 1,
  effective_from        TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_to          TIMESTAMPTZ,
  status                TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RETIRED')),
  created_by            UUID REFERENCES users(id),
  approval_id           UUID REFERENCES approvals(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER commission_policies_no_delete BEFORE DELETE ON commission_policies
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();
CREATE TRIGGER commission_policies_immutable BEFORE UPDATE ON commission_policies
  FOR EACH ROW EXECUTE FUNCTION prevent_column_mutation(
    'code', 'rate_basis_points', 'version', 'effective_from');

ALTER TABLE agents ADD CONSTRAINT agents_commission_policy_fk
  FOREIGN KEY (commission_policy_id) REFERENCES commission_policies(id);

-- -----------------------------------------------------------------------------
-- Settlements (PRD §47) — the government's money arriving in its own account
-- -----------------------------------------------------------------------------

CREATE TABLE settlements (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_reference TEXT NOT NULL UNIQUE,
  gateway             TEXT NOT NULL,
  bank_reference      TEXT,
  government_account_id UUID REFERENCES bank_accounts(id),
  settlement_date     DATE NOT NULL,
  expected_amount_kobo BIGINT NOT NULL CHECK (expected_amount_kobo >= 0),
  received_amount_kobo BIGINT NOT NULL DEFAULT 0 CHECK (received_amount_kobo >= 0),
  transaction_count   INTEGER NOT NULL DEFAULT 0 CHECK (transaction_count >= 0),
  status              TEXT NOT NULL DEFAULT 'PENDING'
                        CHECK (status IN ('PENDING', 'RECEIVED', 'RECONCILED', 'DISPUTED')),
  received_at         TIMESTAMPTZ,
  reconciled_at       TIMESTAMPTZ,
  reconciled_by       UUID REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER settlements_touch BEFORE UPDATE ON settlements
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER settlements_no_delete BEFORE DELETE ON settlements
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();

ALTER TABLE payments ADD CONSTRAINT payments_settlement_fk
  FOREIGN KEY (settlement_id) REFERENCES settlements(id);

-- -----------------------------------------------------------------------------
-- Commission ledger (PRD §25, §26, §27)
-- -----------------------------------------------------------------------------

CREATE TABLE commissions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id         UUID NOT NULL REFERENCES agents(id),
  -- One commission per transaction, ever. The UNIQUE constraint is what stops
  -- a retry or a bug from paying an agent twice for one collection.
  transaction_id   UUID NOT NULL UNIQUE REFERENCES transactions(id),
  policy_id        UUID NOT NULL REFERENCES commission_policies(id),
  rate_basis_points INTEGER NOT NULL CHECK (rate_basis_points >= 0),
  -- The government revenue figure the commission was computed from, snapshotted
  -- so the calculation stays reproducible during audit (PRD §67).
  basis_amount_kobo BIGINT NOT NULL CHECK (basis_amount_kobo >= 0),
  amount_kobo      BIGINT NOT NULL CHECK (amount_kobo >= 0),
  status           TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN (
                     'PENDING', 'ELIGIBLE', 'ON_HOLD', 'APPROVED', 'PAID', 'REVERSED', 'CANCELLED')),
  hold_reason      TEXT,
  eligible_at      TIMESTAMPTZ,
  approved_at      TIMESTAMPTZ,
  approved_by      UUID REFERENCES users(id),
  paid_at          TIMESTAMPTZ,
  payout_id        UUID,
  reversed_at      TIMESTAMPTZ,
  reversal_reason  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER commissions_touch BEFORE UPDATE ON commissions
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER commissions_no_delete BEFORE DELETE ON commissions
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();
CREATE TRIGGER commissions_immutable BEFORE UPDATE ON commissions
  FOR EACH ROW EXECUTE FUNCTION prevent_column_mutation(
    'agent_id', 'transaction_id', 'policy_id', 'rate_basis_points',
    'basis_amount_kobo', 'amount_kobo');

CREATE INDEX idx_commissions_agent ON commissions(agent_id, status);
CREATE INDEX idx_commissions_status ON commissions(status, eligible_at);

-- Commission may only exist against a transaction whose payment was verified.
-- PRD §68: agents must not be able to "claim commission on unpaid transactions".
CREATE OR REPLACE FUNCTION enforce_commission_requires_verified_revenue() RETURNS TRIGGER AS $$
DECLARE
  txn_status TEXT;
BEGIN
  SELECT status INTO txn_status FROM transactions WHERE id = NEW.transaction_id;

  IF txn_status NOT IN ('PAYMENT_VERIFIED', 'RECEIPT_GENERATED', 'RECONCILIATION_PENDING', 'SETTLED') THEN
    RAISE EXCEPTION
      'Commission cannot be created for transaction in state %', txn_status
      USING ERRCODE = 'restrict_violation',
            HINT = 'Commission accrues only on verified government revenue.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER commissions_require_verified_revenue BEFORE INSERT ON commissions
  FOR EACH ROW EXECUTE FUNCTION enforce_commission_requires_verified_revenue();

-- A commission can only be marked PAID by attaching it to an actual payout with
-- a bank reference (PRD §28: "All commission payouts require transaction
-- references").
CREATE OR REPLACE FUNCTION enforce_commission_payment_evidence() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'PAID' AND (NEW.payout_id IS NULL OR NEW.paid_at IS NULL) THEN
    RAISE EXCEPTION 'Commission % cannot be marked PAID without a payout reference', NEW.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER commissions_payment_evidence BEFORE INSERT OR UPDATE ON commissions
  FOR EACH ROW EXECUTE FUNCTION enforce_commission_payment_evidence();

CREATE TABLE commission_payouts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_reference  TEXT NOT NULL UNIQUE,
  agent_id          UUID NOT NULL REFERENCES agents(id),
  bank_account_id   UUID NOT NULL REFERENCES bank_accounts(id),
  amount_kobo       BIGINT NOT NULL CHECK (amount_kobo > 0),
  commission_count  INTEGER NOT NULL CHECK (commission_count > 0),
  status            TEXT NOT NULL DEFAULT 'REQUESTED' CHECK (status IN (
                      'REQUESTED', 'APPROVED', 'PROCESSING', 'PAID', 'FAILED', 'REJECTED')),
  approval_id       UUID REFERENCES approvals(id),
  bank_reference    TEXT,
  failure_reason    TEXT,
  requested_by      UUID REFERENCES users(id),
  requested_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_by       UUID REFERENCES users(id),
  approved_at       TIMESTAMPTZ,
  paid_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER commission_payouts_touch BEFORE UPDATE ON commission_payouts
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER commission_payouts_no_delete BEFORE DELETE ON commission_payouts
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();
CREATE TRIGGER commission_payouts_immutable BEFORE UPDATE ON commission_payouts
  FOR EACH ROW EXECUTE FUNCTION prevent_column_mutation(
    'payout_reference', 'agent_id', 'amount_kobo', 'commission_count');

ALTER TABLE commissions ADD CONSTRAINT commissions_payout_fk
  FOREIGN KEY (payout_id) REFERENCES commission_payouts(id);

CREATE INDEX idx_payouts_agent ON commission_payouts(agent_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- Reconciliation (PRD §46)
-- -----------------------------------------------------------------------------

CREATE TABLE reconciliation_records (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id                UUID NOT NULL,
  transaction_id        UUID REFERENCES transactions(id),
  payment_id            UUID REFERENCES payments(id),
  gateway_reference     TEXT,
  settlement_id         UUID REFERENCES settlements(id),
  settlement_reference  TEXT,
  expected_amount_kobo  BIGINT NOT NULL DEFAULT 0,
  received_amount_kobo  BIGINT NOT NULL DEFAULT 0,
  variance_kobo         BIGINT NOT NULL DEFAULT 0,
  status                TEXT NOT NULL CHECK (status IN (
                          'PENDING', 'MATCHED', 'MISSING_PAYMENT', 'MISSING_PLATFORM_TRANSACTION',
                          'AMOUNT_MISMATCH', 'DUPLICATE_PAYMENT', 'REVERSED',
                          'PENDING_SETTLEMENT', 'RESOLVED')),
  detail                JSONB NOT NULL DEFAULT '{}'::jsonb,
  resolution_note       TEXT,
  reconciled_by         UUID REFERENCES users(id),
  reconciled_at         TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER reconciliation_touch BEFORE UPDATE ON reconciliation_records
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER reconciliation_no_delete BEFORE DELETE ON reconciliation_records
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();

CREATE INDEX idx_recon_run ON reconciliation_records(run_id);
CREATE INDEX idx_recon_status ON reconciliation_records(status, created_at DESC);
CREATE INDEX idx_recon_transaction ON reconciliation_records(transaction_id);

CREATE TABLE reconciliation_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start      TIMESTAMPTZ NOT NULL,
  period_end        TIMESTAMPTZ NOT NULL,
  gateway           TEXT,
  total_platform_kobo BIGINT NOT NULL DEFAULT 0,
  total_gateway_kobo  BIGINT NOT NULL DEFAULT 0,
  matched_count     INTEGER NOT NULL DEFAULT 0,
  exception_count   INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'RUNNING'
                      CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED')),
  started_by        UUID REFERENCES users(id),
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at      TIMESTAMPTZ
);

CREATE INDEX idx_recon_runs_started ON reconciliation_runs(started_at DESC);

-- Gateway statements imported for three-way matching (platform / gateway /
-- settlement). Stored verbatim so a dispute can be re-argued from the source.
CREATE TABLE gateway_statement_lines (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway           TEXT NOT NULL,
  gateway_reference TEXT NOT NULL,
  amount_kobo       BIGINT NOT NULL,
  status            TEXT NOT NULL,
  paid_at           TIMESTAMPTZ,
  settlement_reference TEXT,
  raw_line          JSONB NOT NULL,
  imported_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  imported_by       UUID REFERENCES users(id),
  UNIQUE (gateway, gateway_reference)
);

CREATE INDEX idx_statement_settlement ON gateway_statement_lines(settlement_reference);

-- -----------------------------------------------------------------------------
-- Refunds and reversals (PRD §71)
-- -----------------------------------------------------------------------------

CREATE TABLE refunds (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_reference  TEXT NOT NULL UNIQUE,
  transaction_id    UUID NOT NULL REFERENCES transactions(id),
  payment_id        UUID NOT NULL REFERENCES payments(id),
  amount_kobo       BIGINT NOT NULL CHECK (amount_kobo > 0),
  refund_type       TEXT NOT NULL CHECK (refund_type IN ('FULL', 'PARTIAL', 'REVERSAL')),
  reason            TEXT NOT NULL,
  approval_id       UUID NOT NULL REFERENCES approvals(id),
  requested_by      UUID NOT NULL REFERENCES users(id),
  approved_by       UUID NOT NULL REFERENCES users(id),
  approved_at       TIMESTAMPTZ NOT NULL,
  gateway_reference TEXT,
  status            TEXT NOT NULL DEFAULT 'PENDING'
                      CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
  completed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT refund_requester_not_approver CHECK (requested_by <> approved_by)
);

CREATE TRIGGER refunds_touch BEFORE UPDATE ON refunds
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER refunds_no_delete BEFORE DELETE ON refunds
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();

CREATE INDEX idx_refunds_transaction ON refunds(transaction_id);

-- -----------------------------------------------------------------------------
-- Fraud and leakage monitoring (PRD §32, §72)
-- -----------------------------------------------------------------------------

CREATE TABLE fraud_flags (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule           TEXT NOT NULL,
  severity       TEXT NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  entity_type    TEXT NOT NULL CHECK (entity_type IN (
                   'TRANSACTION', 'AGENT', 'TAXPAYER', 'DEVICE', 'REFEREE', 'COMMISSION')),
  entity_id      UUID NOT NULL,
  agent_id       UUID REFERENCES agents(id),
  transaction_id UUID REFERENCES transactions(id),
  detail         JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- PRD §32: "Suspicious transactions should be flagged rather than
  -- automatically deleted." A flag never blocks or removes anything by itself.
  status         TEXT NOT NULL DEFAULT 'OPEN'
                   CHECK (status IN ('OPEN', 'UNDER_REVIEW', 'CONFIRMED', 'DISMISSED')),
  reviewed_by    UUID REFERENCES users(id),
  reviewed_at    TIMESTAMPTZ,
  resolution_note TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER fraud_flags_touch BEFORE UPDATE ON fraud_flags
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER fraud_flags_no_delete BEFORE DELETE ON fraud_flags
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();

CREATE INDEX idx_fraud_entity ON fraud_flags(entity_type, entity_id);
CREATE INDEX idx_fraud_open ON fraud_flags(status, severity) WHERE status IN ('OPEN', 'UNDER_REVIEW');
CREATE INDEX idx_fraud_agent ON fraud_flags(agent_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- Taxpayer incentives (PRD §40, §41)
-- -----------------------------------------------------------------------------

CREATE TABLE taxpayer_compliance (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  taxpayer_id           UUID NOT NULL UNIQUE REFERENCES taxpayers(id),
  score                 INTEGER NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
  on_time_payments      INTEGER NOT NULL DEFAULT 0,
  late_payments         INTEGER NOT NULL DEFAULT 0,
  compliant_periods     INTEGER NOT NULL DEFAULT 0,
  outstanding_amount_kobo BIGINT NOT NULL DEFAULT 0 CHECK (outstanding_amount_kobo >= 0),
  has_valid_tin         BOOLEAN NOT NULL DEFAULT FALSE,
  last_payment_at       TIMESTAMPTZ,
  score_breakdown       JSONB NOT NULL DEFAULT '{}'::jsonb,
  computed_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_compliance_score ON taxpayer_compliance(score DESC);

CREATE TABLE incentive_programmes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  code                TEXT NOT NULL UNIQUE,
  description         TEXT,
  benefit_type        TEXT NOT NULL,
  benefit_description TEXT,
  eligibility_rules   JSONB NOT NULL DEFAULT '{}'::jsonb,
  target_lga_ids      UUID[] NOT NULL DEFAULT '{}',
  target_taxpayer_types TEXT[] NOT NULL DEFAULT '{INDIVIDUAL,BUSINESS}',
  minimum_score       INTEGER NOT NULL DEFAULT 0 CHECK (minimum_score BETWEEN 0 AND 100),
  minimum_compliance_periods INTEGER NOT NULL DEFAULT 0,
  requires_no_arrears BOOLEAN NOT NULL DEFAULT TRUE,
  start_date          DATE NOT NULL,
  end_date            DATE,
  approval_authority  TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'DRAFT'
                        CHECK (status IN ('DRAFT', 'ACTIVE', 'CLOSED')),
  created_by          UUID REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT programme_dates_valid CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE TRIGGER incentive_programmes_touch BEFORE UPDATE ON incentive_programmes
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- PRD §41: "The system should record why a citizen qualifies." Eligibility is
-- stored with its reasons, so a benefit decision can always be explained.
CREATE TABLE programme_eligibility (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  programme_id   UUID NOT NULL REFERENCES incentive_programmes(id),
  taxpayer_id    UUID NOT NULL REFERENCES taxpayers(id),
  eligible       BOOLEAN NOT NULL,
  reasons        JSONB NOT NULL DEFAULT '[]'::jsonb,
  score_at_evaluation INTEGER,
  evaluated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (programme_id, taxpayer_id)
);

CREATE INDEX idx_eligibility_taxpayer ON programme_eligibility(taxpayer_id);

-- -----------------------------------------------------------------------------
-- Notifications (PRD §44, §79)
-- -----------------------------------------------------------------------------

CREATE TABLE notification_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT NOT NULL UNIQUE,
  event       TEXT NOT NULL,
  channel     TEXT NOT NULL CHECK (channel IN ('SMS', 'EMAIL', 'PUSH')),
  subject     TEXT,
  body        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event, channel)
);

CREATE TRIGGER notification_templates_touch BEFORE UPDATE ON notification_templates
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE notifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id),
  recipient     TEXT NOT NULL,
  event         TEXT NOT NULL,
  channel       TEXT NOT NULL CHECK (channel IN ('SMS', 'EMAIL', 'PUSH')),
  subject       TEXT,
  message       TEXT NOT NULL,
  entity_type   TEXT,
  entity_id     UUID,
  status        TEXT NOT NULL DEFAULT 'QUEUED'
                  CHECK (status IN ('QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'READ')),
  provider_reference TEXT,
  failure_reason TEXT,
  attempts      INTEGER NOT NULL DEFAULT 0,
  sent_at       TIMESTAMPTZ,
  read_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user ON notifications(user_id, created_at DESC);
CREATE INDEX idx_notifications_queued ON notifications(status) WHERE status = 'QUEUED';

-- -----------------------------------------------------------------------------
-- Support and complaints (PRD §77, §78)
-- -----------------------------------------------------------------------------

CREATE TABLE support_tickets (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number     TEXT NOT NULL UNIQUE,
  raised_by         UUID NOT NULL REFERENCES users(id),
  raiser_role       TEXT NOT NULL,
  category          TEXT NOT NULL CHECK (category IN (
                      'PAYMENT_ISSUE', 'TIN_ISSUE', 'VEHICLE_ISSUE', 'RECEIPT_ISSUE',
                      'TECHNICAL_ISSUE', 'TAXPAYER_COMPLAINT', 'INCORRECT_ASSESSMENT',
                      'AGENT_MISCONDUCT', 'UNAUTHORISED_CHARGE')),
  subject           TEXT NOT NULL,
  description       TEXT NOT NULL,
  transaction_id    UUID REFERENCES transactions(id),
  agent_id          UUID REFERENCES agents(id),
  taxpayer_id       UUID REFERENCES taxpayers(id),
  attachment_document_id UUID REFERENCES documents(id),
  priority          TEXT NOT NULL DEFAULT 'NORMAL'
                      CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  status            TEXT NOT NULL DEFAULT 'OPEN'
                      CHECK (status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED')),
  assigned_to       UUID REFERENCES users(id),
  resolution        TEXT,
  resolved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER support_tickets_touch BEFORE UPDATE ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE INDEX idx_tickets_status ON support_tickets(status, created_at DESC);
CREATE INDEX idx_tickets_raiser ON support_tickets(raised_by, created_at DESC);

CREATE TABLE ticket_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   UUID NOT NULL REFERENCES support_tickets(id),
  author_id   UUID NOT NULL REFERENCES users(id),
  body        TEXT NOT NULL,
  internal    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ticket_messages ON ticket_messages(ticket_id, created_at);

-- -----------------------------------------------------------------------------
-- Offline drafts (PRD §30, Addendum §23)
--
-- Drafts captured without connectivity. They carry a client-generated
-- idempotency key and receive server-generated ids on sync. Nothing here is
-- financial: a draft can never become a payment (Addendum §23 financial rule).
-- -----------------------------------------------------------------------------

CREATE TABLE offline_drafts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        UUID NOT NULL REFERENCES agents(id),
  device_id       UUID REFERENCES agent_devices(id),
  client_reference TEXT NOT NULL,
  draft_type      TEXT NOT NULL CHECK (draft_type IN (
                    'TAXPAYER_REGISTRATION', 'SERVICE_REQUEST', 'VEHICLE_CAPTURE', 'DOCUMENT_CAPTURE')),
  payload         JSONB NOT NULL,
  captured_at     TIMESTAMPTZ NOT NULL,
  synced_at       TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'PENDING_SYNC'
                    CHECK (status IN ('PENDING_SYNC', 'SYNCED', 'REJECTED', 'DUPLICATE')),
  result_entity_type TEXT,
  result_entity_id   UUID,
  rejection_reason TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (agent_id, client_reference)
);

CREATE INDEX idx_drafts_agent ON offline_drafts(agent_id, status);

-- -----------------------------------------------------------------------------
-- Public verification counter (PRD §20, §43)
-- -----------------------------------------------------------------------------

CREATE TABLE verification_attempts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lookup_type     TEXT NOT NULL CHECK (lookup_type IN ('RECEIPT', 'DOCUMENT', 'INVOICE')),
  lookup_value    TEXT NOT NULL,
  result          TEXT NOT NULL CHECK (result IN ('VALID', 'INVALID', 'REVERSED', 'NOT_FOUND')),
  ip_address      INET,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_verification_created ON verification_attempts(created_at DESC);
CREATE INDEX idx_verification_value ON verification_attempts(lookup_value);
