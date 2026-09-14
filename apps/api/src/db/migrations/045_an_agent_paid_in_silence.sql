-- =============================================================================
-- 045: The messages an agent was never sent
-- =============================================================================
--
-- COMMISSION_PAID has been seeded since the beginning and nothing ever queued
-- it. There was no event at all for a bank transfer that bounced or a payout an
-- officer declined, so an agent's own money could stop moving with nothing to
-- tell them but an audit entry they cannot read.
--
-- A bounced transfer is almost always wrong account details, which only the
-- agent can fix, and only once somebody says there is something to fix. Until
-- then "the bank refused my account" is indistinguishable from "PSIRS did not
-- pay me" — which is the belief that becomes a support ticket, or an agent who
-- starts asking citizens for cash.
--
-- The push rows are the other half. The channel had a subscription store, a
-- provider, a settings toggle and a service worker, and no template, so it
-- reached nobody. These are additive: every one still goes by SMS, because a
-- handset can refuse notifications and suspension is the message an agent must
-- not miss.
--
-- Seeded here as well as in seed.ts so a deployment that already exists gets
-- them without a reseed. ON CONFLICT DO NOTHING: a deployment that has edited
-- its own wording keeps it.
-- =============================================================================

INSERT INTO notification_templates (code, event, channel, subject, body) VALUES
  ('COMMISSION_PAYOUT_FAILED_SMS', 'COMMISSION_PAYOUT_FAILED', 'SMS', NULL,
   'PSIRS: Your commission payout {{reference}} could not be paid into your account: {{reason}}. '
   || 'The money has not been lost — it returns to your available balance and will go out again '
   || 'once the account details are correct. Check your bank details in the app.'),

  ('COMMISSION_PAYOUT_REFUSED_SMS', 'COMMISSION_PAYOUT_REFUSED', 'SMS', NULL,
   'PSIRS: Your commission payout request {{reference}} was not approved: {{reason}}. '
   || 'The money has not been lost — it stays in your available balance and you can request it again.'),

  ('AGENT_SUSPENDED_PUSH', 'AGENT_SUSPENDED', 'PUSH', 'You have been suspended',
   'Stop collecting now. Reason: {{reason}}. Open the app for what happens next.'),

  ('AGENT_APPROVED_PUSH', 'AGENT_APPROVED', 'PUSH', 'You are cleared to collect',
   'Your application has been approved. Open the app to register your device and begin.'),

  ('KYC_ACTION_REQUIRED_PUSH', 'KYC_ACTION_REQUIRED', 'PUSH', 'Your application needs something',
   '{{reason}}'),

  ('COMMISSION_PAID_PUSH', 'COMMISSION_PAID', 'PUSH', 'Commission paid',
   'Your payout {{reference}} has been sent to your bank.'),

  ('COMMISSION_PAYOUT_FAILED_PUSH', 'COMMISSION_PAYOUT_FAILED', 'PUSH', 'Payout could not be paid',
   '{{reason}}. The money is still yours — check your bank details in the app.')
ON CONFLICT (code) DO NOTHING;
