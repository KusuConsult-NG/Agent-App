-- =============================================================================
-- 098: A reminder in the last week before a bill lapses
-- =============================================================================
--
-- The reminder ladder was drawn as three rungs, six, four and two weeks
-- before a bill lapses, and every bill the platform issues has thirty days to
-- be paid. So the six-week rung is never reached, the four-week one fires the
-- day after the bill is raised, and the last thing a taxpayer heard was at two
-- weeks, with fourteen days still to run and nothing after it.
--
-- A rung in the final week, six to eight days before the bill lapses, gives a
-- thirty-day bill three reminders again: the day after it is raised, at two
-- weeks, and at one. The six-week rung stays, inert and correct, for a bill
-- that is ever given longer to be paid.
--
-- English only, like the other three reminders: none of them has a Hausa text,
-- and notifications.ts sends a Hausa reader the English rather than nothing.
-- Writing all four in Hausa is work for a translator, not for this migration.
-- =============================================================================

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS reminder_sent_1w BOOLEAN NOT NULL DEFAULT false;

INSERT INTO notification_templates (code, event, channel, language, subject, body, status) VALUES
  ('TAX-REMINDER-1W-SMS', 'TAX_REMINDER_1W', 'SMS', 'en', NULL,
   'PSIRS: Dear {{name}}, your {{revenueItem}} ({{amount}}) is due in one week, on {{dueDate}}. TIN: {{tinNumber}}. After that date the bill has to be issued again before it can be paid. {{portalUrl}}', 'ACTIVE'),
  ('TAX-REMINDER-1W-EMAIL', 'TAX_REMINDER_1W', 'EMAIL', 'en',
   'One week left: {{revenueItem}} due {{dueDate}}',
   'Dear {{name}},

Your {{revenueItem}} payment of {{amount}} is due on {{dueDate}}, one week from now.

TIN: {{tinNumber}}

After that date this bill lapses. What you owe does not go away, but the bill has to be issued again by a revenue agent or a PSIRS office before it can be paid.

To pay or check your status, visit:
{{portalUrl}}

Plateau State Internal Revenue Service', 'ACTIVE'),
  ('TAX-REMINDER-1W-WHATSAPP', 'TAX_REMINDER_1W', 'WHATSAPP', 'en', NULL,
   '*PSIRS: one week left*

Dear {{name}},

Your *{{revenueItem}}* payment of *{{amount}}* is due on *{{dueDate}}*.

TIN: {{tinNumber}}

After that date the bill has to be issued again before it can be paid.

{{portalUrl}}

_Plateau State Internal Revenue Service_', 'ACTIVE')
ON CONFLICT (code) DO NOTHING;
