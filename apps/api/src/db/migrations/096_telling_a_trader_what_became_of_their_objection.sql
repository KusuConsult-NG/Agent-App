-- =============================================================================
-- 096: Telling a trader what became of their objection
-- =============================================================================
--
-- A trader who disputed a presumptive estimate was told nothing when the
-- objection was decided. The decision carries a reason "the taxpayer can
-- read" — the service refuses one without it, and so does the database — and
-- nothing ever sent it to them. Upheld, they went on believing they owed the
-- money; rejected, they went on believing collection was suspended, until a
-- reminder or an agent said otherwise.
--
-- Three messages, because there are three things to tell them: the estimate
-- is withdrawn and nothing is owed; it is withdrawn and a refund of what they
-- already paid has been asked for; or it stands.
--
-- The Hausa follows migration 048's rules: every placeholder untouched, every
-- negation carried by ba or babu, the glossary the applications already use
-- (kalubale, kimantawa, kiyasi, wakilin karbar haraji). Like those, these have
-- not been read by a native speaker, and docs/HAUSA-REVIEW.md carries them for
-- that.
-- =============================================================================

INSERT INTO notification_templates (code, event, channel, language, subject, body, status) VALUES
  ('OBJECTION_UPHELD_SMS', 'OBJECTION_UPHELD', 'SMS', 'en', NULL,
   'PSIRS: Your objection to assessment {{reference}} has been upheld: {{reason}}. The estimate has been withdrawn and nothing is owed on it.', 'ACTIVE'),
  ('OBJECTION_UPHELD_REFUND_REQUESTED_SMS', 'OBJECTION_UPHELD_REFUND_REQUESTED', 'SMS', 'en', NULL,
   'PSIRS: Your objection to assessment {{reference}} has been upheld: {{reason}}. The estimate has been withdrawn, and a refund of the {{amount}} you paid has been requested.', 'ACTIVE'),
  ('OBJECTION_REJECTED_SMS', 'OBJECTION_REJECTED', 'SMS', 'en', NULL,
   'PSIRS: Your objection to assessment {{reference}} was not upheld: {{reason}}. The assessment of {{amount}} stands. If it is not yet paid, pay it through a PSIRS revenue agent or office.', 'ACTIVE'),
  ('OBJECTION_UPHELD_SMS_HA', 'OBJECTION_UPHELD', 'SMS', 'ha', NULL,
   'PSIRS: An amince da kalubalen da aka yi kan kimantawa {{reference}}: {{reason}}. An janye kiyasin, kuma babu bashin komai a kansa.', 'ACTIVE'),
  ('OBJECTION_UPHELD_REFUND_REQUESTED_SMS_HA', 'OBJECTION_UPHELD_REFUND_REQUESTED', 'SMS', 'ha', NULL,
   'PSIRS: An amince da kalubalen da aka yi kan kimantawa {{reference}}: {{reason}}. An janye kiyasin, kuma an nemi a mayar da {{amount}} da aka biya.', 'ACTIVE'),
  ('OBJECTION_REJECTED_SMS_HA', 'OBJECTION_REJECTED', 'SMS', 'ha', NULL,
   'PSIRS: Ba a amince da kalubalen da aka yi kan kimantawa {{reference}} ba: {{reason}}. Kimantawar {{amount}} tana nan. Idan ba a biya ba tukuna, a biya ta hannun wakilin karbar haraji ko ofishin PSIRS.', 'ACTIVE')
ON CONFLICT (code) DO NOTHING;
