-- =============================================================================
-- 004_financial.sql — transactions, payments, receipts, documents, vehicles
--
-- Layers 3-5 of the trust model (Addendum §48): what is owed, whether the money
-- actually arrived, and whether anyone can independently prove it.
--
-- The governing rule (PRD §95): no person, including an agent, can make a
-- transaction appear successful without independent confirmation from the
-- payment infrastructure. In this schema that is not a convention — a receipt
-- physically cannot exist without a verified payment row, enforced by trigger.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Transactions (PRD §17, §50)
-- -----------------------------------------------------------------------------

CREATE TABLE transactions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_reference TEXT NOT NULL UNIQUE,
  taxpayer_id           UUID NOT NULL REFERENCES taxpayers(id),
  invoice_id            UUID NOT NULL REFERENCES invoices(id),
  assessment_id         UUID NOT NULL REFERENCES assessments(id),
  revenue_item_id       UUID NOT NULL REFERENCES revenue_items(id),

  -- Attribution (PRD §31): who facilitated it, from where, on what device.
  -- These are frozen at creation, so reassigning an agent's territory later
  -- never rewrites history (PRD §74).
  agent_id              UUID REFERENCES agents(id),
  territory_id          UUID REFERENCES territories(id),
  device_id             UUID REFERENCES agent_devices(id),
  lga_id                UUID NOT NULL REFERENCES lgas(id),
  ward_id               UUID REFERENCES wards(id),
  latitude              NUMERIC(9, 6),
  longitude             NUMERIC(9, 6),
  channel               TEXT NOT NULL DEFAULT 'AGENT_PWA'
                          CHECK (channel IN ('AGENT_PWA', 'TAXPAYER_PORTAL', 'OFFICER', 'API')),

  -- Government revenue and agent commission are kept in separate columns and
  -- never netted (PRD §6). amount_kobo is what government is owed, full stop.
  amount_kobo           BIGINT NOT NULL CHECK (amount_kobo > 0),
  service_charge_kobo   BIGINT NOT NULL DEFAULT 0 CHECK (service_charge_kobo >= 0),
  total_amount_kobo     BIGINT NOT NULL CHECK (total_amount_kobo > 0),

  status                TEXT NOT NULL DEFAULT 'INITIATED' CHECK (status IN (
                          'INITIATED', 'ASSESSMENT_CREATED', 'INVOICE_GENERATED',
                          'PAYMENT_INITIATED', 'PAYMENT_PENDING', 'PAYMENT_SUCCESSFUL',
                          'PAYMENT_VERIFIED', 'RECEIPT_GENERATED', 'SETTLED', 'FAILED',
                          'CANCELLED', 'EXPIRED', 'REVERSED', 'REFUNDED', 'UNDER_REVIEW',
                          'RECONCILIATION_PENDING')),
  status_reason         TEXT,
  created_by            UUID NOT NULL REFERENCES users(id),
  verified_at           TIMESTAMPTZ,
  settled_at            TIMESTAMPTZ,
  reversed_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT transaction_total_consistent CHECK (
    total_amount_kobo = amount_kobo + service_charge_kobo)
);

CREATE TRIGGER transactions_touch BEFORE UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER transactions_no_delete BEFORE DELETE ON transactions
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();
-- PRD §68: agents cannot "modify successful payment amounts" or "change payment
-- references". Amount and identity are immutable for the row's whole life.
CREATE TRIGGER transactions_immutable BEFORE UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION prevent_column_mutation(
    'transaction_reference', 'taxpayer_id', 'invoice_id', 'assessment_id', 'revenue_item_id',
    'agent_id', 'territory_id', 'lga_id', 'amount_kobo', 'service_charge_kobo',
    'total_amount_kobo', 'created_by', 'created_at');

CREATE INDEX idx_transactions_taxpayer ON transactions(taxpayer_id, created_at DESC);
CREATE INDEX idx_transactions_agent ON transactions(agent_id, created_at DESC);
CREATE INDEX idx_transactions_status ON transactions(status, created_at DESC);
CREATE INDEX idx_transactions_lga ON transactions(lga_id, created_at DESC);
CREATE INDEX idx_transactions_item ON transactions(revenue_item_id, created_at DESC);
CREATE INDEX idx_transactions_invoice ON transactions(invoice_id);
CREATE INDEX idx_transactions_created ON transactions(created_at DESC);
CREATE INDEX idx_transactions_device ON transactions(device_id, created_at DESC);

-- Every state change, with the actor and reason. This is what answers PRD §67's
-- audit questions ("show all transactions reversed after successful payment")
-- without querying production tables directly.
CREATE TABLE transaction_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES transactions(id),
  from_status    TEXT,
  to_status      TEXT NOT NULL,
  reason         TEXT,
  actor_id       UUID REFERENCES users(id),
  source         TEXT NOT NULL DEFAULT 'SYSTEM'
                   CHECK (source IN ('SYSTEM', 'AGENT', 'OFFICER', 'GATEWAY_WEBHOOK', 'RECONCILIATION')),
  metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER transaction_events_no_delete BEFORE DELETE ON transaction_events
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();
CREATE TRIGGER transaction_events_no_update BEFORE UPDATE ON transaction_events
  FOR EACH ROW EXECUTE FUNCTION prevent_any_update();
CREATE INDEX idx_txn_events_txn ON transaction_events(transaction_id, created_at);

-- -----------------------------------------------------------------------------
-- Payments (PRD §18)
-- -----------------------------------------------------------------------------

CREATE TABLE payments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id     UUID NOT NULL REFERENCES transactions(id),
  payment_reference  TEXT NOT NULL UNIQUE,
  gateway            TEXT NOT NULL,
  -- The gateway's own reference. UNIQUE is the backstop that makes duplicate
  -- webhook processing impossible even if application logic fails (PRD §53).
  gateway_reference  TEXT UNIQUE,
  payment_method     TEXT CHECK (payment_method IN (
                       'CARD', 'BANK_TRANSFER', 'USSD', 'ACCOUNT_TRANSFER', 'POS')),
  amount_kobo        BIGINT NOT NULL CHECK (amount_kobo > 0),
  currency           TEXT NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  status             TEXT NOT NULL DEFAULT 'INITIATED' CHECK (status IN (
                       'INITIATED', 'PENDING', 'SUCCESSFUL', 'VERIFIED',
                       'FAILED', 'ABANDONED', 'REVERSED', 'REFUNDED')),
  -- Raw gateway payloads, kept verbatim as payment evidence (PRD §18).
  gateway_response   JSONB,
  verification_response JSONB,
  failure_reason     TEXT,
  authorisation_url  TEXT,
  initiated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at            TIMESTAMPTZ,
  -- Set only by the server-side verification path, never by a client request.
  verified_at        TIMESTAMPTZ,
  verified_by_source TEXT CHECK (verified_by_source IN ('WEBHOOK', 'POLL', 'RECONCILIATION')),
  reversed_at        TIMESTAMPTZ,
  settlement_id      UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A payment cannot claim to be verified without recording what verified it.
  CONSTRAINT payment_verification_evidence CHECK (
    status <> 'VERIFIED'
    OR (verified_at IS NOT NULL AND verified_by_source IS NOT NULL
        AND gateway_reference IS NOT NULL))
);

CREATE TRIGGER payments_touch BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER payments_no_delete BEFORE DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();
CREATE TRIGGER payments_immutable BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION prevent_column_mutation(
    'transaction_id', 'payment_reference', 'gateway', 'amount_kobo', 'currency', 'initiated_at');

CREATE INDEX idx_payments_transaction ON payments(transaction_id);
CREATE INDEX idx_payments_status ON payments(status, created_at DESC);
CREATE INDEX idx_payments_gateway_ref ON payments(gateway_reference) WHERE gateway_reference IS NOT NULL;
-- Only one payment may be in flight per transaction at a time; this is what
-- stops a double-tapped Pay button from creating two obligations (PRD §61).
CREATE UNIQUE INDEX idx_payments_one_active ON payments(transaction_id)
  WHERE status IN ('INITIATED', 'PENDING', 'SUCCESSFUL', 'VERIFIED');

-- Every webhook delivery, stored before it is acted on (PRD §53).
-- The unique constraint on (gateway, event_id) means a redelivery is detected
-- at insert time; the handler then replays the original outcome and returns 200.
CREATE TABLE payment_webhook_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway           TEXT NOT NULL,
  event_id          TEXT NOT NULL,
  event_type        TEXT NOT NULL,
  gateway_reference TEXT,
  payload           JSONB NOT NULL,
  signature         TEXT,
  signature_valid   BOOLEAN NOT NULL,
  processing_status TEXT NOT NULL DEFAULT 'RECEIVED' CHECK (processing_status IN (
                      'RECEIVED', 'PROCESSED', 'DUPLICATE', 'REJECTED', 'FAILED', 'IGNORED')),
  processing_note   TEXT,
  payment_id        UUID REFERENCES payments(id),
  received_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at      TIMESTAMPTZ,
  UNIQUE (gateway, event_id)
);

CREATE TRIGGER webhook_events_no_delete BEFORE DELETE ON payment_webhook_events
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();
CREATE INDEX idx_webhook_gateway_ref ON payment_webhook_events(gateway_reference);
CREATE INDEX idx_webhook_received ON payment_webhook_events(received_at DESC);
CREATE INDEX idx_webhook_status ON payment_webhook_events(processing_status)
  WHERE processing_status IN ('FAILED', 'REJECTED');

-- -----------------------------------------------------------------------------
-- Receipts (PRD §19, §20)
-- -----------------------------------------------------------------------------

CREATE TABLE receipts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number    TEXT NOT NULL UNIQUE,
  transaction_id    UUID NOT NULL UNIQUE REFERENCES transactions(id),
  payment_id        UUID NOT NULL UNIQUE REFERENCES payments(id),
  taxpayer_id       UUID NOT NULL REFERENCES taxpayers(id),
  amount_kobo       BIGINT NOT NULL CHECK (amount_kobo > 0),
  verification_code TEXT NOT NULL UNIQUE,
  document_id       UUID,
  issued_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  status            TEXT NOT NULL DEFAULT 'VALID'
                      CHECK (status IN ('VALID', 'REVERSED', 'REFUNDED', 'VOID')),
  void_reason       TEXT,
  voided_at         TIMESTAMPTZ,
  voided_by         UUID REFERENCES users(id)
);

CREATE TRIGGER receipts_no_delete BEFORE DELETE ON receipts
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();
-- PRD §31: receipt numbers cannot be reused; a receipt's content is fixed at
-- issuance. Only its validity status may change, and only with a reason.
CREATE TRIGGER receipts_immutable BEFORE UPDATE ON receipts
  FOR EACH ROW EXECUTE FUNCTION prevent_column_mutation(
    'receipt_number', 'transaction_id', 'payment_id', 'taxpayer_id',
    'amount_kobo', 'verification_code', 'issued_at');

CREATE INDEX idx_receipts_taxpayer ON receipts(taxpayer_id, issued_at DESC);
CREATE INDEX idx_receipts_issued ON receipts(issued_at DESC);

-- ==============================================================================
-- THE CENTRAL CONTROL (PRD §31, §68, §88.26, Addendum §50)
--
--   "No verified payment = no government receipt."
--
-- A receipt row cannot be inserted unless the payment it points at is VERIFIED,
-- belongs to the same transaction, and matches the amount. This is a database
-- trigger rather than a service-layer check so that it holds for every possible
-- caller: the API, a migration, a maintenance script, or a DBA at a psql
-- prompt. There is no code path in this system that produces a receipt for an
-- unverified payment.
-- ==============================================================================
CREATE OR REPLACE FUNCTION enforce_receipt_requires_verified_payment() RETURNS TRIGGER AS $$
DECLARE
  pay        payments%ROWTYPE;
  txn_status TEXT;
BEGIN
  SELECT * INTO pay FROM payments WHERE id = NEW.payment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Receipt % references a payment that does not exist', NEW.receipt_number
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF pay.status <> 'VERIFIED' THEN
    RAISE EXCEPTION
      'Receipt cannot be issued: payment % is %, not VERIFIED',
      pay.payment_reference, pay.status
      USING ERRCODE = 'restrict_violation',
            HINT = 'A government receipt requires independent gateway confirmation.';
  END IF;

  IF pay.verified_at IS NULL OR pay.gateway_reference IS NULL THEN
    RAISE EXCEPTION 'Receipt cannot be issued: payment % lacks verification evidence',
      pay.payment_reference
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF pay.transaction_id <> NEW.transaction_id THEN
    RAISE EXCEPTION 'Receipt payment/transaction mismatch for receipt %', NEW.receipt_number
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF pay.amount_kobo <> NEW.amount_kobo THEN
    RAISE EXCEPTION
      'Receipt amount (% kobo) does not match verified payment amount (% kobo)',
      NEW.amount_kobo, pay.amount_kobo
      USING ERRCODE = 'restrict_violation';
  END IF;

  SELECT status INTO txn_status FROM transactions WHERE id = NEW.transaction_id;
  IF txn_status NOT IN ('PAYMENT_VERIFIED', 'RECEIPT_GENERATED') THEN
    RAISE EXCEPTION
      'Receipt cannot be issued while transaction is in state %', txn_status
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER receipts_require_verified_payment BEFORE INSERT ON receipts
  FOR EACH ROW EXECUTE FUNCTION enforce_receipt_requires_verified_payment();

-- -----------------------------------------------------------------------------
-- Documents (PRD §23, §64)
-- -----------------------------------------------------------------------------

CREATE TABLE documents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_number   TEXT NOT NULL UNIQUE,
  document_type     TEXT NOT NULL CHECK (document_type IN (
                      'RECEIPT', 'INVOICE', 'ASSESSMENT', 'VEHICLE_RENEWAL',
                      'TIN_CONFIRMATION', 'PAYMENT_EVIDENCE')),
  owner_type        TEXT NOT NULL CHECK (owner_type IN ('TAXPAYER', 'AGENT', 'VEHICLE')),
  owner_id          UUID NOT NULL,
  entity_type       TEXT,
  entity_id         UUID,
  storage_reference TEXT NOT NULL,
  content_type      TEXT NOT NULL DEFAULT 'application/pdf',
  byte_size         INTEGER NOT NULL CHECK (byte_size > 0),
  -- SHA-256 of the rendered bytes. A stored document that no longer matches its
  -- checksum has been tampered with; verification recomputes and compares.
  checksum          TEXT NOT NULL,
  verification_code TEXT NOT NULL UNIQUE,
  version           INTEGER NOT NULL DEFAULT 1,
  issuing_authority TEXT NOT NULL,
  issued_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ,
  status            TEXT NOT NULL DEFAULT 'ISSUED'
                      CHECK (status IN ('ISSUED', 'SUPERSEDED', 'REVOKED')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER documents_no_delete BEFORE DELETE ON documents
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();
CREATE TRIGGER documents_immutable BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION prevent_column_mutation(
    'document_number', 'document_type', 'storage_reference', 'checksum',
    'verification_code', 'version', 'issued_at', 'owner_id');

CREATE INDEX idx_documents_owner ON documents(owner_type, owner_id, issued_at DESC);
CREATE INDEX idx_documents_entity ON documents(entity_type, entity_id);

ALTER TABLE receipts ADD CONSTRAINT receipts_document_fk
  FOREIGN KEY (document_id) REFERENCES documents(id);
ALTER TABLE taxpayers ADD CONSTRAINT taxpayers_photo_fk
  FOREIGN KEY (photo_document_id) REFERENCES documents(id);

-- PRD §64: document access is logged.
CREATE TABLE document_access_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   UUID NOT NULL REFERENCES documents(id),
  accessed_by   UUID REFERENCES users(id),
  access_type   TEXT NOT NULL CHECK (access_type IN ('DOWNLOAD', 'VIEW', 'VERIFY', 'SHARE')),
  ip_address    INET,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_doc_access_document ON document_access_logs(document_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- Vehicles (PRD §21, §22)
-- -----------------------------------------------------------------------------

CREATE TABLE vehicles (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  taxpayer_id         UUID REFERENCES taxpayers(id),
  registration_number TEXT NOT NULL UNIQUE,
  chassis_number      TEXT,
  engine_number       TEXT,
  make                TEXT,
  model               TEXT,
  year_of_manufacture INTEGER,
  vehicle_type        TEXT NOT NULL,
  vehicle_class       TEXT,
  colour              TEXT,
  owner_name          TEXT NOT NULL,
  owner_phone         TEXT,
  -- PRD §21: "The system must not rely solely on manually entered vehicle
  -- data." This records whether the authoritative registry confirmed the record.
  source              TEXT NOT NULL DEFAULT 'MANUAL_ENTRY'
                        CHECK (source IN ('AUTHORITY_LOOKUP', 'MANUAL_ENTRY', 'MIGRATION')),
  authority_reference TEXT,
  authority_verified_at TIMESTAMPTZ,
  owner_verified      BOOLEAN NOT NULL DEFAULT FALSE,
  current_expiry_date DATE,
  status              TEXT NOT NULL DEFAULT 'ACTIVE'
                        CHECK (status IN ('ACTIVE', 'SUSPENDED', 'ARCHIVED')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER vehicles_touch BEFORE UPDATE ON vehicles
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER vehicles_no_delete BEFORE DELETE ON vehicles
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();
CREATE INDEX idx_vehicles_taxpayer ON vehicles(taxpayer_id);
CREATE INDEX idx_vehicles_chassis ON vehicles(chassis_number) WHERE chassis_number IS NOT NULL;

CREATE TABLE vehicle_renewals (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id        UUID NOT NULL REFERENCES vehicles(id),
  transaction_id    UUID REFERENCES transactions(id),
  renewal_period_months INTEGER NOT NULL CHECK (renewal_period_months > 0),
  period_start      DATE NOT NULL,
  expiry_date       DATE NOT NULL,
  document_id       UUID REFERENCES documents(id),
  document_number   TEXT UNIQUE,
  status            TEXT NOT NULL DEFAULT 'PENDING_PAYMENT' CHECK (status IN (
                      'PENDING_PAYMENT', 'PAID', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED')),
  agent_id          UUID REFERENCES agents(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT renewal_period_valid CHECK (expiry_date > period_start)
);

CREATE TRIGGER vehicle_renewals_touch BEFORE UPDATE ON vehicle_renewals
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER vehicle_renewals_no_delete BEFORE DELETE ON vehicle_renewals
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();
CREATE INDEX idx_renewals_vehicle ON vehicle_renewals(vehicle_id, created_at DESC);

-- A renewal document is issued only against a completed transaction — the same
-- rule as receipts, applied to vehicle papers (PRD §22).
CREATE OR REPLACE FUNCTION enforce_renewal_requires_verified_payment() RETURNS TRIGGER AS $$
DECLARE
  txn_status TEXT;
BEGIN
  IF NEW.document_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.transaction_id IS NULL THEN
    RAISE EXCEPTION 'Vehicle renewal document requires a paid transaction'
      USING ERRCODE = 'restrict_violation';
  END IF;

  SELECT status INTO txn_status FROM transactions WHERE id = NEW.transaction_id;
  IF txn_status NOT IN ('PAYMENT_VERIFIED', 'RECEIPT_GENERATED', 'RECONCILIATION_PENDING', 'SETTLED') THEN
    RAISE EXCEPTION
      'Vehicle renewal document cannot be issued while transaction is %', txn_status
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER renewals_require_payment BEFORE INSERT OR UPDATE ON vehicle_renewals
  FOR EACH ROW EXECUTE FUNCTION enforce_renewal_requires_verified_payment();
