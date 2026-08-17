-- =============================================================================
-- 011_notification_delivery.sql — record who delivered a message, if anyone
--
-- A citizen holds no account on this platform. The SMS carrying their receipt
-- number and verification code is the only copy of their proof of payment they
-- ever receive, and the only route to checking it against government records.
--
-- Until now `dispatchQueued` marked every notification SENT with a fabricated
-- reference — `mock-<id>` — whether or not a provider had been configured, let
-- alone contacted. Nothing was ever delivered and the table said otherwise.
--
-- `provider` is what makes that unrepresentable going forward: a row can only
-- claim SENT alongside the name of the service that accepted it, and the
-- development stub records itself as `mock` rather than passing for a gateway.
-- =============================================================================

ALTER TABLE notifications
  ADD COLUMN provider TEXT;

COMMENT ON COLUMN notifications.provider IS
  'The service that accepted this message. NULL means nothing has been asked '
  'to deliver it yet; "mock" means a development stub logged it and no citizen '
  'received anything.';

-- Existing rows claim SENT but nothing was ever delivered for them, and saying
-- so is better than leaving the claim standing. They are marked FAILED with the
-- reason, so an operator can see exactly which citizens were never told —
-- rather than discovering it when one of them asks for a receipt.
UPDATE notifications
   SET status = 'FAILED',
       sent_at = NULL,
       provider_reference = NULL,
       failure_reason = 'Recorded as sent before delivery was implemented; '
                        'no message was actually sent. Re-send if still relevant.'
 WHERE status = 'SENT'
   AND (provider_reference IS NULL OR provider_reference LIKE 'mock-%');

CREATE INDEX idx_notifications_undelivered
  ON notifications(created_at)
  WHERE status = 'FAILED';
