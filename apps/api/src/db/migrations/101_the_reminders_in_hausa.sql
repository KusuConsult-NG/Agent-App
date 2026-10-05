-- =============================================================================
-- 101: The due-date reminders, in Hausa
-- =============================================================================
--
-- Migration 048 put every message PSIRS sent into Hausa, and the reminders were
-- not among them: TAX_REMINDER_6W, _4W and _2W (migration 016) and _1W (098)
-- had English text only. notifications.ts sends the English when there is no
-- Hausa, so a Hausa reader was reminded in English: the one message the
-- platform sends without being asked, about money.
--
-- Twelve texts: each reminder on SMS, email and WhatsApp, saying what the
-- English says. They use {{revenueItemHa}}, the item's Hausa name, which the
-- reminder sweep already passes. They follow 048's rules: placeholders and
-- PSIRS untouched, every negation kept (kada, ba), the agent application's
-- glossary (takardar biya for bill, bashi for arrears, makin bin ka’ida for the
-- compliance score, shirye-shiryen tallafi for the support programmes), and no
-- hooked letters.
--
-- The date in {{dueDate}} is still written in English ("15 October 2026"),
-- because the sweep formats it with en-NG. A reviewer may want it in Hausa;
-- that is a change to the sweep, not to these texts.
--
-- THESE HAVE NOT BEEN READ BY A NATIVE SPEAKER. They go to docs/HAUSA-REVIEW.md
-- with the rest, and the review there is still required before a field trial.
-- =============================================================================

INSERT INTO notification_templates (code, event, channel, language, subject, body, status) VALUES

-- Six weeks
('TAX-REMINDER-6W-SMS-HA', 'TAX_REMINDER_6W', 'SMS', 'ha', NULL,
 'Ranka ya dade {{name}}, biyan {{revenueItemHa}} dinka na {{amount}} (TIN: {{tinNumber}}) zai kai ranar biya a {{dueDate}}. Ka biya da wuri domin ka ci gaba da bin ka’ida kuma ka samu tallafin gwamnati. Ka duba a {{portalUrl}}', 'ACTIVE'),

('TAX-REMINDER-6W-EMAIL-HA', 'TAX_REMINDER_6W', 'EMAIL', 'ha',
 'Ana bukatar mataki: biyan {{revenueItemHa}} zai kai ranar biya a {{dueDate}}',
 'Ranka ya dade {{name}},

Wannan tunatarwa ce ta makonni 6 daga Hukumar Haraji ta Jihar Plateau (PSIRS).

Biyan {{revenueItemHa}} dinka na {{amount}} zai kai ranar biya a {{dueDate}}.

Lambar Shaidar Mai Biyan Haraji (TIN): {{tinNumber}}

Bin ka’ida yana sa asusunka na PSIRS ya ci gaba da aiki, kuma yana sa ka cancanci shirye-shiryen tallafi na Jihar Plateau, ciki har da inshorar lafiya, tallafin noma da tallafin karatu.

Domin biya ko duba matsayinka, ziyarci:
{{portalUrl}}

Hukumar Haraji ta Jihar Plateau
Gidan Zaman Lafiya da Yawon Bude Ido', 'ACTIVE'),

('TAX-REMINDER-6W-WHATSAPP-HA', 'TAX_REMINDER_6W', 'WHATSAPP', 'ha', NULL,
 '🔔 *Tunatarwar Haraji ta PSIRS*

Ranka ya dade {{name}},

Biyan *{{revenueItemHa}}* dinka na *{{amount}}* zai kai ranar biya a *{{dueDate}}*.

TIN: {{tinNumber}}

Ka biya a kan lokaci domin ka ci gaba da bin ka’ida kuma ka samu tallafin gwamnati.

Duba matsayinka: {{portalUrl}}

_Hukumar Haraji ta Jihar Plateau_', 'ACTIVE'),

-- Four weeks
('TAX-REMINDER-4W-SMS-HA', 'TAX_REMINDER_4W', 'SMS', 'ha', NULL,
 'TUNATARWAR PSIRS: Ranka ya dade {{name}}, {{revenueItemHa}} dinka ({{amount}}) zai kai ranar biya a {{dueDate}}. TIN: {{tinNumber}}. Ka biya yanzu domin kada ka shiga bashi. {{portalUrl}}', 'ACTIVE'),

('TAX-REMINDER-4W-EMAIL-HA', 'TAX_REMINDER_4W', 'EMAIL', 'ha',
 'Tunatarwa: {{revenueItemHa}} zai kai ranar biya cikin makonni 4 — {{dueDate}}',
 'Ranka ya dade {{name}},

Saura makonni 4 kafin ranar biyan {{revenueItemHa}} dinka na {{amount}} ({{dueDate}}).

TIN: {{tinNumber}}

Rashin biyan abin da ake bin ka yana shafar makin bin ka’idarka, kuma yana iya dakatar da samun shirye-shiryen tallafi na Jihar Plateau.

Ka biya yanzu ko ka duba abin da ake bin ka a:
{{portalUrl}}

Hukumar Haraji ta Jihar Plateau', 'ACTIVE'),

('TAX-REMINDER-4W-WHATSAPP-HA', 'TAX_REMINDER_4W', 'WHATSAPP', 'ha', NULL,
 '⏰ *PSIRS — Tunatarwar Makonni 4*

Ranka ya dade {{name}},

Biyan *{{revenueItemHa}}* dinka na *{{amount}}* zai kai ranar biya a *{{dueDate}}*.

TIN: {{tinNumber}}

Kada ka shiga bashi — ka biya kafin ranar biya.

{{portalUrl}}

_Hukumar Haraji ta Jihar Plateau_', 'ACTIVE'),

-- Two weeks
('TAX-REMINDER-2W-SMS-HA', 'TAX_REMINDER_2W', 'SMS', 'ha', NULL,
 'GAGGAWA — PSIRS: Ranka ya dade {{name}}, {{revenueItemHa}} dinka ({{amount}}) zai kai ranar biya nan da makonni 2, a {{dueDate}}. TIN: {{tinNumber}}. Ka biya nan take domin kada a ci ka tara. {{portalUrl}}', 'ACTIVE'),

('TAX-REMINDER-2W-EMAIL-HA', 'TAX_REMINDER_2W', 'EMAIL', 'ha',
 'GAGGAWA: {{revenueItemHa}} zai kai ranar biya cikin makonni 2 — ka dauki mataki yanzu',
 'Ranka ya dade {{name}},

TUNATARWA TA GAGGAWA daga Hukumar Haraji ta Jihar Plateau.

Biyan {{revenueItemHa}} dinka na {{amount}} zai kai ranar biya a {{dueDate}} — wato nan da kwanaki 14.

TIN: {{tinNumber}}

Rashin biya a kan lokaci zai sa a rubuta bashi a bayananka na PSIRS, wanda zai shafi makin bin ka’idarka da cancantarka ga shirye-shiryen tallafin gwamnati.

Ka biya yanzu a: {{portalUrl}}

Hukumar Haraji ta Jihar Plateau
Gidan Zaman Lafiya da Yawon Bude Ido', 'ACTIVE'),

('TAX-REMINDER-2W-WHATSAPP-HA', 'TAX_REMINDER_2W', 'WHATSAPP', 'ha', NULL,
 '🚨 *PSIRS — GAGGAWA: Sanarwar Makonni 2*

Ranka ya dade {{name}},

Biyan *{{revenueItemHa}}* dinka na *{{amount}}* zai kai ranar biya a *{{dueDate}}* — saura kwanaki 14 kacal.

TIN: {{tinNumber}}

Don Allah ka biya nan take domin kada ka shiga bashi.

👉 {{portalUrl}}

_Hukumar Haraji ta Jihar Plateau_', 'ACTIVE'),

-- One week
('TAX-REMINDER-1W-SMS-HA', 'TAX_REMINDER_1W', 'SMS', 'ha', NULL,
 'PSIRS: Ranka ya dade {{name}}, {{revenueItemHa}} dinka ({{amount}}) zai kai ranar biya nan da mako daya, a {{dueDate}}. TIN: {{tinNumber}}. Bayan wannan rana, sai an sake fitar da takardar biya kafin a iya biya. {{portalUrl}}', 'ACTIVE'),

('TAX-REMINDER-1W-EMAIL-HA', 'TAX_REMINDER_1W', 'EMAIL', 'ha',
 'Saura mako daya: {{revenueItemHa}} zai kai ranar biya a {{dueDate}}',
 'Ranka ya dade {{name}},

Biyan {{revenueItemHa}} dinka na {{amount}} zai kai ranar biya a {{dueDate}}, nan da mako daya.

TIN: {{tinNumber}}

Bayan wannan rana takardar biya za ta kare. Abin da ake bin ka ba zai bace ba, amma sai wakilin karbar haraji ko ofishin PSIRS ya sake fitar da takardar kafin a iya biya.

Domin biya ko duba matsayinka, ziyarci:
{{portalUrl}}

Hukumar Haraji ta Jihar Plateau', 'ACTIVE'),

('TAX-REMINDER-1W-WHATSAPP-HA', 'TAX_REMINDER_1W', 'WHATSAPP', 'ha', NULL,
 '*PSIRS: saura mako daya*

Ranka ya dade {{name}},

Biyan *{{revenueItemHa}}* dinka na *{{amount}}* zai kai ranar biya a *{{dueDate}}*.

TIN: {{tinNumber}}

Bayan wannan rana, sai an sake fitar da takardar biya kafin a iya biya.

{{portalUrl}}

_Hukumar Haraji ta Jihar Plateau_', 'ACTIVE')

ON CONFLICT (code) DO NOTHING;
