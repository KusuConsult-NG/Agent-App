-- =============================================================================
-- 006_mock_gateway.sql — DEVELOPMENT ONLY
--
-- A stand-in for the payment gateway's own books, deliberately kept in a
-- separate table that the revenue code never reads directly.
--
-- The point is architectural, not cosmetic. PRD §95 requires that a payment be
-- confirmed "independently by the payment/revenue infrastructure". If
-- verification consulted the platform's own `payments` table, the platform
-- would be marking its own homework. The verification path therefore queries
-- this table exactly as it would query a real gateway's API — through the
-- adapter in src/integrations/gateway.ts and nowhere else.
--
-- config.ts refuses to boot in production while PAYMENT_GATEWAY is 'mock'.
-- =============================================================================

CREATE TABLE mock_gateway_transactions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway_reference  TEXT NOT NULL UNIQUE,
  payment_reference  TEXT NOT NULL,
  amount_kobo        BIGINT NOT NULL CHECK (amount_kobo > 0),
  currency           TEXT NOT NULL DEFAULT 'NGN',
  customer_email     TEXT,
  customer_phone     TEXT,
  payment_method     TEXT,
  status             TEXT NOT NULL DEFAULT 'PENDING'
                       CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED', 'ABANDONED', 'REVERSED')),
  failure_reason     TEXT,
  settlement_reference TEXT,
  settled_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at            TIMESTAMPTZ,
  metadata           JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_mock_gateway_payment_ref ON mock_gateway_transactions(payment_reference);
CREATE INDEX idx_mock_gateway_status ON mock_gateway_transactions(status);
