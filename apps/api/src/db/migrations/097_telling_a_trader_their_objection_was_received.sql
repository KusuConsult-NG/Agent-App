-- =============================================================================
-- 097: Telling a trader their objection was received
-- =============================================================================
--
-- Migration 096 told a trader what became of their objection. Nothing told
-- them it had been received, and an objection is often recorded for them — by
-- an agent at the stall, or an officer at a desk — so they left with nothing
-- in hand to show it had been. Meanwhile the reminder sweep stopped chasing
-- the bill, on the strength, its own comment said, of the trader having been
-- told the objection was received. Nobody had told them.
--
-- One message: received, nothing is enforced while it is decided, and the
-- decision will follow. The Hausa follows migration 048's rules and goes to
-- docs/HAUSA-REVIEW.md for a native speaker, as 096's did.
-- =============================================================================

INSERT INTO notification_templates (code, event, channel, language, subject, body, status) VALUES
  ('OBJECTION_RECEIVED_SMS', 'OBJECTION_RECEIVED', 'SMS', 'en', NULL,
   'PSIRS: Your objection to assessment {{reference}} has been received. Nothing is being enforced on it while PSIRS decides, and you will be sent the decision. You do not need to do anything in the meantime.', 'ACTIVE'),
  ('OBJECTION_RECEIVED_SMS_HA', 'OBJECTION_RECEIVED', 'SMS', 'ha', NULL,
   'PSIRS: An karbi kalubalen da aka yi kan kimantawa {{reference}}. Ba a tilasta biya ba yayin da PSIRS ke duba shi, kuma za a aiko da hukuncin. Ba sai an yi komai ba a wannan lokaci.', 'ACTIVE')
ON CONFLICT (code) DO NOTHING;
