-- =============================================================================
-- 048: The thirty messages, in Hausa
-- =============================================================================
--
-- Migration 047 made a second language possible. This is the second language.
--
-- Every template PSIRS sends, rendered for a reader of Hausa: the receipt that
-- is the citizen's only copy, the acknowledgement that must not be mistaken for
-- one, the one-time code that must never be shared, and the messages telling an
-- agent their authority or their money has changed.
--
-- WHAT WAS HELD FIXED WHILE TRANSLATING.
--
--   * Every {{placeholder}} and every literal an eye reads off the screen and a
--     hand types back in — a receipt number, a verification code, PSIRS itself.
--     A translated code is a code that does not verify.
--   * Every negation. "It is NOT a receipt", "never share it", "no money has
--     been taken" — a dropped negative here is the worst failure available, and
--     each is carried by ba, bai, babu or kada.
--   * The glossary the agent application already uses: rasit for receipt,
--     kwamishan for commission, asusu for account, kudi for money, tabbatar for
--     confirm, mai biyan haraji for taxpayer. One word for one thing, across
--     both surfaces.
--   * The keyboard an agent actually has: no hooked letters, and the curly
--     apostrophe the dictionary already uses.
--
-- THESE HAVE NOT BEEN READ BY A NATIVE SPEAKER. docs/HAUSA-REVIEW.md is the
-- sheet for that, and it now carries these thirty. They are correct enough to
-- ship behind a review and must not go to a citizen without one.
-- =============================================================================

INSERT INTO notification_templates (code, event, channel, language, subject, body, status) VALUES
  ('COMMISSION_PAYOUT_FAILED_SMS_HA', 'COMMISSION_PAYOUT_FAILED', 'SMS', 'ha', NULL,
   'PSIRS: Ba a iya tura kwamishan dinka {{reference}} zuwa asusunka ba: {{reason}}. Kudin bai bata ba — ya koma cikin kudin da ake bin ka, kuma za a sake turawa idan an gyara bayanan asusun. Duba bayanan bankinka a cikin manhajar.', 'ACTIVE'),
  ('COMMISSION_PAYOUT_REFUSED_SMS_HA', 'COMMISSION_PAYOUT_REFUSED', 'SMS', 'ha', NULL,
   'PSIRS: Ba a amince da bukatarka ta biyan kwamishan {{reference}} ba: {{reason}}. Kudin bai bata ba — ya kasance cikin kudin da ake bin ka kuma kana iya sake nema.', 'ACTIVE'),
  ('AGENT_SUSPENDED_PUSH_HA', 'AGENT_SUSPENDED', 'PUSH', 'ha', 'An dakatar da kai',
   'Ka daina karbar kudi yanzu. Dalili: {{reason}}. Bude manhajar don ka ga abin da zai biyo baya.', 'ACTIVE'),
  ('AGENT_APPROVED_PUSH_HA', 'AGENT_APPROVED', 'PUSH', 'ha', 'An amince ka fara karba',
   'An amince da bukatarka. Bude manhajar don ka yi rajistar na’urarka ka fara aiki.', 'ACTIVE'),
  ('KYC_ACTION_REQUIRED_PUSH_HA', 'KYC_ACTION_REQUIRED', 'PUSH', 'ha', 'Bukatarka na bukatar wani abu',
   'Tabbatar da shaidarka bai cika ba: {{reason}}. Bude manhajar don ka sake turawa.', 'ACTIVE'),
  ('COMMISSION_PAID_PUSH_HA', 'COMMISSION_PAID', 'PUSH', 'ha', 'An biya kwamishan',
   'An tura kwamishan dinka {{reference}} zuwa bankinka.', 'ACTIVE'),
  ('COMMISSION_PAYOUT_FAILED_PUSH_HA', 'COMMISSION_PAYOUT_FAILED', 'PUSH', 'ha', 'Ba a iya biyan kwamishan ba',
   '{{reason}}. Kudin naka ne har yanzu — duba bayanan bankinka a cikin manhajar.', 'ACTIVE'),
  ('TIN_CREATED_SMS_HA', 'TIN_CREATED', 'SMS', 'ha', NULL,
   'PSIRS: Lambar Shaidar Biyan Haraji taka ita ce {{tin}}. Ka adana ta — za ka bukace ta a duk biyan kudi na gwamnati.', 'ACTIVE'),
  ('INVOICE_SMS_HA', 'INVOICE_GENERATED', 'SMS', 'ha', NULL,
   'PSIRS: An bayar da takardar biya {{reference}} na {{amount}}. Ka biya ta hanyoyin gwamnati da aka amince da su kadai.', 'ACTIVE'),
  ('PAYMENT_SUCCESS_SMS_HA', 'PAYMENT_SUCCESSFUL', 'SMS', 'ha', NULL,
   'PSIRS: An tabbatar da biyan kudin ka na {{amount}}. Wannan shaidar karba ce {{receiptNumber}} — BA rasit ba ne. Rasit din gwamnati zai zo bayan kudin ya isa asusun gwamnati. Kana iya duba shi a kowane lokaci da wannan lambar.', 'ACTIVE'),
  ('PAYMENT_SUCCESS_EMAIL_HA', 'PAYMENT_SUCCESSFUL', 'EMAIL', 'ha', NULL,
   E'Ranka ya dade {{name}},\n\nAn tabbatar da biyan kudin ka na {{amount}} ta tsarin biyan kudi (ma’amala {{reference}}).\n\nWannan sakon SHAIDAR KARBA ce, lamba {{receiptNumber}}. BA rasit din gwamnati ba ne. Kudin zai isa asusun Gwamnatin Jihar Plateau nan ba da jimawa ba, kuma za a bayar da rasit din ka kai tsaye idan ya isa — za mu tura maka lambarsa.\n\nKana iya duba wannan shaidar karba a kowane lokaci ba tare da shiga asusu ba.\n\nHukumar Haraji ta Jihar Plateau', 'ACTIVE'),
  ('RECEIPT_GENERATED_SMS_HA', 'RECEIPT_GENERATED', 'SMS', 'ha', NULL,
   'PSIRS: Gwamnati ta karbi biyan kudin ka na {{amount}}. Rasit din ka na gwamnati shi ne {{receiptNumber}} (ma’amala {{reference}}). Kana iya duba shi a kowane lokaci da wannan lambar.', 'ACTIVE'),
  ('RECEIPT_GENERATED_EMAIL_HA', 'RECEIPT_GENERATED', 'EMAIL', 'ha', NULL,
   E'Ranka ya dade {{name}},\n\nGwamnatin Jihar Plateau ta karbi biyan kudin ka na {{amount}} (ma’amala {{reference}}).\n\nLambar rasit din ka ta gwamnati ita ce {{receiptNumber}}. Wannan ya maye gurbin shaidar karba da aka tura maka a baya, kuma shi ne shaidar biyan kudin ka.\n\nKana iya tabbatar da shi a kowane lokaci ba tare da shiga asusu ba.\n\nHukumar Haraji ta Jihar Plateau', 'ACTIVE'),
  ('PAYMENT_FAILED_SMS_HA', 'PAYMENT_FAILED', 'SMS', 'ha', NULL,
   'PSIRS: Biyan kudi na {{reference}} bai yi nasara ba. Ba a karbi kudi ba. Kana iya sake gwadawa.', 'ACTIVE'),
  ('VEHICLE_RENEWAL_SMS_HA', 'VEHICLE_RENEWAL_COMPLETED', 'SMS', 'ha', NULL,
   'PSIRS: An sabunta motar {{registration}}, tana aiki har zuwa {{expiry}}. Sauke takardarka daga shafin.', 'ACTIVE'),
  ('COMMISSION_EARNED_SMS_HA', 'COMMISSION_EARNED', 'SMS', 'ha', NULL,
   'PSIRS: Ka samu kwamishan {{amount}} a kan ma’amala {{reference}}. Za a iya biyan sa bayan an sasanta kudin.', 'INACTIVE'),
  ('COMMISSION_EARNED_PUSH_HA', 'COMMISSION_EARNED', 'PUSH', 'ha', 'An rubuta kwamishan',
   '{{amount}} a kan {{reference}}. Za a iya biyan sa bayan an sasanta kudin.', 'ACTIVE'),
  ('COMMISSION_PAID_SMS_HA', 'COMMISSION_PAID', 'SMS', 'ha', NULL,
   'PSIRS: An biya kwamishan {{amount}} zuwa asusun bankin ka da aka tabbatar. Lamba {{reference}}.', 'ACTIVE'),
  ('AGENT_APPROVED_SMS_HA', 'AGENT_APPROVED', 'SMS', 'ha', NULL,
   'PSIRS: An amince da bukatarka ta zama wakili. Ka kammala horo ka yi rajistar na’urarka don fara aiki.', 'ACTIVE'),
  ('AGENT_REJECTED_SMS_HA', 'AGENT_REJECTED', 'SMS', 'ha', NULL,
   'PSIRS: Ba a amince da bukatarka ta zama wakili ba. Dalili: {{reason}}', 'ACTIVE'),
  ('AGENT_SUSPENDED_SMS_HA', 'AGENT_SUSPENDED', 'SMS', 'ha', NULL,
   'PSIRS: An dakatar da asusun wakilcin ka. Dalili: {{reason}}. Ka tuntubi shugabanka.', 'ACTIVE'),
  ('REFEREE_INVITATION_SMS_HA', 'REFEREE_INVITATION', 'SMS', 'ha', NULL,
   'PSIRS: {{applicant}} ya sa ka a matsayin mai shaida a kan bukatar zama wakilin karbar haraji ({{reference}}). Ka tabbatar a {{link}} kafin {{expiry}}.', 'ACTIVE'),
  ('KYC_ACTION_SMS_HA', 'KYC_ACTION_REQUIRED', 'SMS', 'ha', NULL,
   'PSIRS: Tabbatar da shaidarka na bukatar kulawa. {{reason}}. Bude manhajar don ka sake turawa.', 'ACTIVE'),
  ('SUPPORT_REPLY_SMS_HA', 'SUPPORT_TICKET_UPDATED', 'SMS', 'ha', NULL,
   'PSIRS: An amsa takardar korafinka {{ticketNumber}}. Bude manhajar don ka karanta.', 'ACTIVE'),
  ('SECURITY_OTP_SMS_HA', 'SECURITY_ALERT', 'SMS', 'ha', NULL,
   'PSIRS: Lambar tabbatarwarka ita ce {{code}}. Za ta kare cikin mintuna {{minutes}}. Kada ka fada wa kowa, hatta ma’aikatan PSIRS.', 'ACTIVE'),
  ('AGENT_BANK_CHANGE_REQUESTED_SMS_HA', 'AGENT_BANK_CHANGE_REQUESTED', 'SMS', 'ha', NULL,
   'PSIRS: An nemi a rika biyan kwamishan dinka a {{bank}} {{account}}. Babu abin da ya canza tukuna. Idan ba kai ba ne, ka tuntubi shugabanka yanzu.', 'ACTIVE'),
  ('AGENT_BANK_CHANGE_APPLIED_SMS_HA', 'AGENT_BANK_CHANGE_APPLIED', 'SMS', 'ha', NULL,
   'PSIRS: Yanzu za a rika biyan kwamishan dinka a {{bank}} {{account}}. Idan ba kai ba ne, ka tuntubi shugabanka yanzu.', 'ACTIVE'),
  ('AGENT_BANK_CHANGE_REFUSED_SMS_HA', 'AGENT_BANK_CHANGE_REFUSED', 'SMS', 'ha', NULL,
   'PSIRS: Ba a amince da bukatar canza asusun kwamishan dinka ba. Dalili: {{reason}}. Asusun ka na yanzu bai canza ba.', 'ACTIVE'),
  ('TAXPAYER_RECORD_CORRECTED_SMS_HA', 'TAXPAYER_RECORD_CORRECTED', 'SMS', 'ha', NULL,
   'PSIRS: An gyara {{fields}} a kan bayananka na mai biyan haraji ta hannun jami’in haraji. Idan ba kai ka nema ba, ka je kowane ofishin PSIRS.', 'ACTIVE'),
  ('USER_ROLE_CHANGED_SMS_HA', 'USER_ROLE_CHANGED', 'SMS', 'ha', NULL,
   'PSIRS: An canza matsayinka daga {{previousRole}} zuwa {{newRole}}. An fitar da kai, dole ka sake shiga. Idan ba a sa ran haka ba, ka tuntubi mai gudanarwarka yanzu.', 'ACTIVE')
ON CONFLICT (code) DO NOTHING;
