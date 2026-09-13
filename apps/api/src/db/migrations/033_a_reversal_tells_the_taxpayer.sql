-- Telling a citizen their payment was reversed.
--
-- There is a notification for a payment that succeeded, one for a payment that
-- failed, and three for an agent whose bank account somebody asked to change.
-- There was none for the money the State took, reversed, and either did or did
-- not give back: a taxpayer's receipt was voided and their transaction marked
-- reversed with nothing sent to them at all. They found out when a public
-- verification told them their receipt was no good.
--
-- Two messages, because there are two facts and days can pass between them.
-- The reversal is a decision government made about their money; the refund
-- arriving is the payment provider actually returning it, and until it does
-- the citizen is out of pocket with a void receipt. Saying only the first
-- would be the same promise this platform refuses to make anywhere else.
--
-- In a migration rather than the reference seed, for the reason the reminder
-- templates are: a template that exists only in `seed.ts` is a message that
-- goes unsent on any deployment that migrates without re-seeding, and it goes
-- unsent silently, because queueing against an event with no template writes
-- nothing and returns zero.

INSERT INTO notification_templates (code, event, channel, subject, body) VALUES

('PAYMENT-REVERSED-SMS', 'PAYMENT_REVERSED', 'SMS', NULL,
 'PSIRS: Your payment of {{amount}} against {{reference}} has been reversed. Reason: {{reason}}. The receipt is no longer valid and the money is being returned to you — we will confirm when it arrives.'),

('PAYMENT-REVERSED-EMAIL', 'PAYMENT_REVERSED', 'EMAIL',
 'Your payment {{reference}} has been reversed',
 'Dear {{name}},

Your payment of {{amount}} against {{reference}} has been reversed by the Plateau State Internal Revenue Service.

Reason: {{reason}}

The receipt issued for that payment is no longer valid. The money is being returned to the account it was paid from, and we will write again once the payment provider confirms it has arrived.

If you believe this is a mistake, quote {{reference}} at any PSIRS office.

Plateau State Internal Revenue Service'),

('REFUND-COMPLETED-SMS', 'REFUND_COMPLETED', 'SMS', NULL,
 'PSIRS: Your refund of {{amount}} for {{reference}} has been returned by the payment provider. Refund reference {{refundReference}}.'),

('REFUND-COMPLETED-EMAIL', 'REFUND_COMPLETED', 'EMAIL',
 'Your refund for {{reference}} has been returned',
 'Dear {{name}},

The payment provider has returned {{amount}} to you for the reversed payment {{reference}}.

Refund reference: {{refundReference}}

Depending on your bank this can take a few working days to appear on your statement. If it has not arrived within five working days, quote the refund reference at any PSIRS office.

Plateau State Internal Revenue Service')

-- No conflict target: `notification_templates` is unique on the code and
-- again on (event, channel), and a re-run must be quiet about either.
ON CONFLICT DO NOTHING;
