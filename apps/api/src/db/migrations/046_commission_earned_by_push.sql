-- =============================================================================
-- 046: The commission message moves off SMS
-- =============================================================================
--
-- COMMISSION_EARNED was seeded from the beginning and nothing ever raised it.
-- That was not quite an oversight: an agent collects many times a day, and an
-- SMS for each would cost PSIRS a message every time and drown the payout
-- notifications beside it — the ones that say money did or did not reach a
-- bank account.
--
-- Push costs nothing and is what a handset notification is for, so the event is
-- raised now and goes out on push instead. The SMS row is switched off rather
-- than deleted: a template that vanishes makes the notification history
-- unreadable, and INACTIVE is one UPDATE from being reversed.
--
-- The wording is the part that matters. A commission accrues PENDING at
-- collection and becomes the agent's money only once PSIRS holds the
-- settlement, so the message says it is not payable yet. Telling an agent they
-- have earned money that a reversal can still take back is the same
-- overstatement this platform exists to prevent, one ledger down.
-- =============================================================================

INSERT INTO notification_templates (code, event, channel, subject, body) VALUES
  ('COMMISSION_EARNED_PUSH', 'COMMISSION_EARNED', 'PUSH', 'Commission recorded',
   '{{amount}} on {{reference}}. It becomes payable after settlement.')
ON CONFLICT (code) DO NOTHING;

-- Deployments that already hold the SMS row. On a fresh database the seed
-- writes it INACTIVE directly, because migrations run first and there would be
-- nothing here to update.
UPDATE notification_templates
   SET status = 'INACTIVE'
 WHERE code = 'COMMISSION_EARNED_SMS';
