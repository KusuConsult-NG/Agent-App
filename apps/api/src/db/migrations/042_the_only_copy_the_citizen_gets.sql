-- The message the taxpayer actually receives.
--
-- A citizen holds no account here. They will not open a portal, and the agent
-- walks away. The SMS is the whole record of the transaction as far as they are
-- concerned, which is why a mock SMS provider is one of the things production
-- refuses to boot with.
--
-- Every surface in the platform was taught to tell an acknowledgement from a
-- receipt: the agent's app, the officer's portal, the public verification page,
-- the PDF itself. The one that was not is the one the citizen ever sees. It was
-- written when confirmation issued a receipt, and it went on saying so:
--
--   "PSIRS: Your payment of N3,000 has been confirmed. Receipt:
--    PSIRS-ACK/2026/000008. Verify it at any time using the receipt number."
--
-- and by email, "Your payment has been received and confirmed. Your official
-- receipt number is PSIRS-ACK/2026/000008." Both name an acknowledgement as an
-- official government receipt, and the email asserts the money has been
-- received, which is the one thing that is not yet true.
--
-- Templates are seeded ON CONFLICT (code) DO NOTHING, so editing the seed
-- changes nothing on a deployment that already has these rows. The wording has
-- to be corrected here or it is corrected only for installations that do not
-- exist yet.
UPDATE notification_templates
   SET body = 'PSIRS: Your payment of {{amount}} is confirmed. This is your acknowledgement '
     || '{{receiptNumber}} - it is NOT a receipt. Your government receipt follows once the '
     || 'money reaches the government account. Check it at any time with this number.',
       updated_at = now()
 WHERE code = 'PAYMENT_SUCCESS_SMS';

UPDATE notification_templates
   SET subject = 'Payment confirmed - acknowledgement {{receiptNumber}}',
       body = 'Dear {{name}},'
     || E'\n\n'
     || 'Your payment of {{amount}} has been confirmed by the payment system '
     || '(transaction {{reference}}).'
     || E'\n\n'
     || 'This message is your ACKNOWLEDGEMENT OF PAYMENT, number {{receiptNumber}}. It is not '
     || 'a government receipt. The money reaches the Plateau State Government account shortly, '
     || 'and your official receipt is issued automatically when it does - we will send you its '
     || 'number.'
     || E'\n\n'
     || 'You can check this acknowledgement at any time without signing in.'
     || E'\n\n'
     || 'Plateau State Internal Revenue Service',
       updated_at = now()
 WHERE code = 'PAYMENT_SUCCESS_EMAIL';

-- ==============================================================================
-- And the message that did not exist at all.
--
-- The receipt is issued when the settlement covering the collection is
-- reconciled, and nothing told the taxpayer. So the citizen's only copy named a
-- document that is not a receipt, and the number of the receipt they are
-- actually entitled to never reached them by any route they could use.
--
-- RECEIPT_GENERATED has been a declared notification event since the type was
-- written. It had no template and nothing ever queued it, which is this
-- codebase's most familiar defect wearing another hat: a state the schema
-- declares, the type system permits and nothing writes.
-- ==============================================================================
INSERT INTO notification_templates (code, event, channel, subject, body)
VALUES
  ('RECEIPT_GENERATED_SMS', 'RECEIPT_GENERATED', 'SMS', NULL,
   'PSIRS: Government has received your payment of {{amount}}. Your official receipt is '
     || '{{receiptNumber}} (transaction {{reference}}). Check it at any time with this number.'),
  ('RECEIPT_GENERATED_EMAIL', 'RECEIPT_GENERATED', 'EMAIL',
   'Your government receipt {{receiptNumber}}',
   'Dear {{name}},'
     || E'\n\n'
     || 'The Plateau State Government has now received your payment of {{amount}} '
     || '(transaction {{reference}}).'
     || E'\n\n'
     || 'Your official receipt number is {{receiptNumber}}. This replaces the acknowledgement '
     || 'you were sent earlier and is your evidence of payment.'
     || E'\n\n'
     || 'You can verify it at any time without signing in.'
     || E'\n\n'
     || 'Plateau State Internal Revenue Service')
ON CONFLICT (code) DO NOTHING;
