-- =============================================================================
-- 099: The group leader is sent the attestation link
-- =============================================================================
--
-- A membership counts only once the group's leader confirms it, because the
-- agent who records members is paid on what they collect. The leader confirms
-- through a link that needs no account. That link was returned to whoever
-- asked for it, agents included, and nothing sent it to the leader. So an
-- agent could confirm their own claims, and the record named the leader as
-- having done it.
--
-- The link now goes by SMS to the leader's phone as the group was registered
-- and approved, and nowhere else. One message, in English and Hausa; the Hausa
-- follows migration 048's rules and goes to docs/HAUSA-REVIEW.md for a native
-- speaker, as 096's and 097's did.
-- =============================================================================

INSERT INTO notification_templates (code, event, channel, language, subject, body, status) VALUES
  ('GROUP_ATTESTATION_INVITATION_SMS', 'GROUP_ATTESTATION_INVITATION', 'SMS', 'en', NULL,
   'PSIRS: You are recorded as the leader of {{group}} ({{code}}). Confirm who belongs to it at {{link}} before {{expiry}}. Do not forward this message: the link is your confirmation.', 'ACTIVE'),
  ('GROUP_ATTESTATION_INVITATION_SMS_HA', 'GROUP_ATTESTATION_INVITATION', 'SMS', 'ha', NULL,
   'PSIRS: An rubuta ka a matsayin shugaban {{group}} ({{code}}). Ka tabbatar da wadanda ke cikin kungiyar a {{link}} kafin {{expiry}}. Kada ka tura wannan sakon ga kowa: hanyar tabbatarwar taka ce.', 'ACTIVE')
ON CONFLICT (code) DO NOTHING;
