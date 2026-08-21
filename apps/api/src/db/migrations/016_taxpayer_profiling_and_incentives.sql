-- =============================================================================
-- 016 — Taxpayer profiling, tax obligation assignment, incentive programme
--        seeding, tax due-date reminder tracking, and WhatsApp channel
-- =============================================================================
--
-- Five features land in one migration because they share a single conceptual
-- boundary: the taxpayer's relationship with government obligations and the
-- benefits those obligations unlock.
--
-- A citizen who is registered, holds a TIN, and pays on time qualifies for
-- Plateau State social programmes. The path from registration to eligibility
-- runs through: structured sector → matched obligations → compliance score →
-- incentive evaluation.
--
-- Reminders close the loop: if a taxpayer knows their due date is approaching
-- they can pay, improve their score, and unlock a programme rather than
-- accumulating arrears that block them.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Standardised economic sector on taxpayers
-- ---------------------------------------------------------------------------
-- Previously occupation and business_activity were free-text columns. Those
-- columns are kept for backward compatibility (old data, old agents), but the
-- new economic_sector column is the machine-readable value used for obligation
-- derivation and agricultural-programme targeting.

ALTER TABLE taxpayers
  ADD COLUMN IF NOT EXISTS economic_sector TEXT;

ALTER TABLE taxpayers
  ADD CONSTRAINT taxpayers_economic_sector_check
  CHECK (economic_sector IS NULL OR economic_sector IN (
    'AGRICULTURE','LIVESTOCK','FISHING','MINING','MANUFACTURING','CONSTRUCTION',
    'RETAIL_TRADE','WHOLESALE_TRADE','FOOD_BEVERAGE','HOTEL_HOSPITALITY',
    'TRANSPORT_LOGISTICS','MOTOR_VEHICLE','ICT_TELECOMS','FINANCIAL_SERVICES',
    'PROFESSIONAL_SERVICES','HEALTHCARE','EDUCATION','ARTISAN_CRAFT',
    'ENTERTAINMENT_ARTS','GAMING_BETTING','AGRICULTURE_PROCESSING',
    'CIVIL_SERVANT','REAL_PROPERTY','RELIGIOUS_NGO','INFORMAL_WORKER',
    'STUDENT_UNEMPLOYED','OTHER'
  ));

CREATE INDEX IF NOT EXISTS idx_taxpayers_sector
  ON taxpayers (economic_sector)
  WHERE economic_sector IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Taxpayer tax obligation table
-- ---------------------------------------------------------------------------
-- Each row records that a specific taxpayer is liable for a specific revenue
-- item. Source distinguishes agent-confirmed obligations from officer-assigned
-- ones and from automatic recommendations, so an audit can tell who decided.
--
-- The UNIQUE constraint prevents double-recording the same obligation. An
-- obligation is never deleted — it is WAIVED (waived by officer with a reason)
-- or DISPUTED (contested, awaiting resolution).

CREATE TABLE IF NOT EXISTS taxpayer_tax_obligations (
  id              UUID        NOT NULL DEFAULT gen_random_uuid(),
  taxpayer_id     UUID        NOT NULL REFERENCES taxpayers(id),
  revenue_item_id UUID        NOT NULL REFERENCES revenue_items(id),
  source          TEXT        NOT NULL DEFAULT 'AGENT_ONBOARDING',
  status          TEXT        NOT NULL DEFAULT 'ACTIVE',
  notes           TEXT,
  created_by      UUID        REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT taxpayer_tax_obligations_pkey PRIMARY KEY (id),
  CONSTRAINT obligation_unique UNIQUE (taxpayer_id, revenue_item_id),
  CONSTRAINT obligation_source_check CHECK (
    source IN ('AGENT_ONBOARDING','OFFICER_REVIEW','AUTO_RECOMMENDATION')
  ),
  CONSTRAINT obligation_status_check CHECK (
    status IN ('ACTIVE','WAIVED','DISPUTED')
  )
);

CREATE INDEX IF NOT EXISTS idx_obligations_taxpayer
  ON taxpayer_tax_obligations (taxpayer_id);

CREATE INDEX IF NOT EXISTS idx_obligations_item
  ON taxpayer_tax_obligations (revenue_item_id);

-- Append-only: obligations are waived, never deleted.
CREATE OR REPLACE FUNCTION prevent_obligation_delete()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'Tax obligations are append-only and cannot be deleted. Set status = ''WAIVED'' instead.'
    USING ERRCODE = 'P0001';
END;
$$;

CREATE TRIGGER obligations_no_delete
  BEFORE DELETE ON taxpayer_tax_obligations
  FOR EACH ROW EXECUTE FUNCTION prevent_obligation_delete();

CREATE OR REPLACE FUNCTION touch_obligations_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER obligations_touch
  BEFORE UPDATE ON taxpayer_tax_obligations
  FOR EACH ROW EXECUTE FUNCTION touch_obligations_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Invoice reminder tracking columns
-- ---------------------------------------------------------------------------
-- One flag per reminder window per invoice. Once the sweep has queued a
-- reminder for a window it sets the flag, so re-running the sweep never
-- sends duplicate reminders. The flags are not immutable — they are a delivery
-- cache, not a financial record.

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS reminder_sent_6w BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reminder_sent_4w BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reminder_sent_2w BOOLEAN NOT NULL DEFAULT false;

-- Partial index for the reminder sweep: only UNPAID invoices with future expiry.
-- Daily levies (expires_at within 2 days) are intentionally included here;
-- the sweep function itself skips them at runtime.
CREATE INDEX IF NOT EXISTS idx_invoices_reminder
  ON invoices (expires_at)
  WHERE status IN ('UNPAID','PARTIALLY_PAID') AND expires_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. WhatsApp notification channel
-- ---------------------------------------------------------------------------
-- The notification_templates table has a check constraint on channel that only
-- allows SMS, EMAIL, PUSH. WHATSAPP is a separate channel — different API,
-- different sender number, different opt-in rules.

ALTER TABLE notification_templates
  DROP CONSTRAINT IF EXISTS notification_templates_channel_check;

ALTER TABLE notification_templates
  ADD CONSTRAINT notification_templates_channel_check
  CHECK (channel IN ('SMS','EMAIL','PUSH','WHATSAPP'));

ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_channel_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_channel_check
  CHECK (channel IN ('SMS','EMAIL','PUSH','WHATSAPP'));

-- ---------------------------------------------------------------------------
-- 5. Reminder notification templates (SMS + Email + WhatsApp)
-- ---------------------------------------------------------------------------
-- Three windows × three channels = 9 templates. Subject is NULL for SMS and
-- WhatsApp (no subject field in those protocols).
-- {{name}}, {{dueDate}}, {{amount}}, {{revenueItem}}, {{tinNumber}},
-- {{portalUrl}} are substituted at send time.

INSERT INTO notification_templates (code, event, channel, subject, body) VALUES

-- 6-week reminder
('TAX-REMINDER-6W-SMS', 'TAX_REMINDER_6W', 'SMS', NULL,
 'Dear {{name}}, your {{revenueItem}} payment of {{amount}} (TIN: {{tinNumber}}) is due on {{dueDate}}. Pay early to stay compliant and access government benefits. Verify at {{portalUrl}}'),

('TAX-REMINDER-6W-EMAIL', 'TAX_REMINDER_6W', 'EMAIL',
 'Action Required: {{revenueItem}} payment due {{dueDate}}',
 'Dear {{name}},

This is a 6-week reminder from the Plateau State Internal Revenue Service (PSIRS).

Your {{revenueItem}} payment of {{amount}} is due on {{dueDate}}.

Tax Identification Number (TIN): {{tinNumber}}

Staying compliant keeps your PSIRS account active and qualifies you for Plateau State social benefit programmes including health insurance, agricultural subsidies, and scholarship schemes.

To make payment or check your status, visit:
{{portalUrl}}

Plateau State Internal Revenue Service
Home of Peace and Tourism'),

('TAX-REMINDER-6W-WHATSAPP', 'TAX_REMINDER_6W', 'WHATSAPP', NULL,
 '🔔 *PSIRS Tax Reminder*

Dear {{name}},

Your *{{revenueItem}}* payment of *{{amount}}* is due on *{{dueDate}}*.

TIN: {{tinNumber}}

Pay on time to maintain your compliance record and access government benefits.

Check your status: {{portalUrl}}

_Plateau State Internal Revenue Service_'),

-- 4-week reminder
('TAX-REMINDER-4W-SMS', 'TAX_REMINDER_4W', 'SMS', NULL,
 'PSIRS REMINDER: Dear {{name}}, your {{revenueItem}} ({{amount}}) is due {{dueDate}}. TIN: {{tinNumber}}. Pay now to avoid arrears. {{portalUrl}}'),

('TAX-REMINDER-4W-EMAIL', 'TAX_REMINDER_4W', 'EMAIL',
 'Reminder: {{revenueItem}} due in 4 weeks — {{dueDate}}',
 'Dear {{name}},

Your {{revenueItem}} payment of {{amount}} is now 4 weeks away (due {{dueDate}}).

TIN: {{tinNumber}}

Unpaid obligations affect your compliance score and may suspend access to Plateau State social programmes.

Pay now or check outstanding obligations at:
{{portalUrl}}

Plateau State Internal Revenue Service'),

('TAX-REMINDER-4W-WHATSAPP', 'TAX_REMINDER_4W', 'WHATSAPP', NULL,
 '⏰ *PSIRS — 4 Week Reminder*

Dear {{name}},

Your *{{revenueItem}}* payment of *{{amount}}* is due on *{{dueDate}}*.

TIN: {{tinNumber}}

Avoid arrears — pay before the due date.

{{portalUrl}}

_Plateau State Internal Revenue Service_'),

-- 2-week reminder (urgent)
('TAX-REMINDER-2W-SMS', 'TAX_REMINDER_2W', 'SMS', NULL,
 'URGENT — PSIRS: Dear {{name}}, your {{revenueItem}} ({{amount}}) is due in 2 weeks on {{dueDate}}. TIN: {{tinNumber}}. Pay immediately to avoid penalties. {{portalUrl}}'),

('TAX-REMINDER-2W-EMAIL', 'TAX_REMINDER_2W', 'EMAIL',
 'URGENT: {{revenueItem}} due in 2 weeks — act now',
 'Dear {{name}},

URGENT REMINDER from the Plateau State Internal Revenue Service.

Your {{revenueItem}} payment of {{amount}} is due on {{dueDate}} — that is in 14 days.

TIN: {{tinNumber}}

Failure to pay on time will result in arrears recorded on your PSIRS profile, which will affect your compliance score and eligibility for government benefit programmes.

Pay now at: {{portalUrl}}

Plateau State Internal Revenue Service
Home of Peace and Tourism'),

('TAX-REMINDER-2W-WHATSAPP', 'TAX_REMINDER_2W', 'WHATSAPP', NULL,
 '🚨 *PSIRS — URGENT: 2 Week Notice*

Dear {{name}},

Your *{{revenueItem}}* payment of *{{amount}}* is due on *{{dueDate}}* — only 14 days remaining.

TIN: {{tinNumber}}

Please pay immediately to avoid arrears.

👉 {{portalUrl}}

_Plateau State Internal Revenue Service_')

ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6. Social incentive programme seeds (DRAFT — must be ACTIVATED by officer)
-- ---------------------------------------------------------------------------
-- No taxpayer becomes a beneficiary until a Revenue Officer with
-- incentive:configure explicitly activates the programme. These rows are
-- DRAFT so they are visible in the portal for configuration before going live.

INSERT INTO incentive_programmes (
  name, code, description,
  benefit_type, benefit_description,
  eligibility_rules,
  minimum_score, minimum_compliance_periods, requires_no_arrears,
  start_date, approval_authority, status
) VALUES
(
  'Plateau State Health Insurance Scheme',
  'PLASHIA',
  'Subsidised health insurance cover for registered taxpayers and their immediate families under the Plateau State Health Insurance Authority (PLASHIA).',
  'HEALTH_INSURANCE',
  'Basic health insurance cover for the taxpayer and up to 4 dependants. Enrolment at any PLASHIA-accredited facility in Plateau State.',
  '{"requires_tin": true, "min_score": 40, "no_arrears": true}'::jsonb,
  40, 1, true,
  CURRENT_DATE, 'Plateau State Health Insurance Authority', 'DRAFT'
),
(
  'Input Fertilizer Distribution Programme',
  'FERTILIZER-SUBSIDY',
  'Subsidised agricultural inputs (fertilizer, seed, pesticide) distributed through LGA-level collection points for registered farmers and livestock keepers.',
  'AGRICULTURAL_SUBSIDY',
  'Access to subsidised fertilizer allocation at LGA collection point. Quantity determined by farm size declared at registration.',
  '{"requires_tin": true, "min_score": 30, "no_arrears": false, "sectors": ["AGRICULTURE","LIVESTOCK","FISHING","AGRICULTURE_PROCESSING"]}'::jsonb,
  30, 1, false,
  CURRENT_DATE, 'Plateau State Ministry of Agriculture and Food Security', 'DRAFT'
),
(
  'State Housing Fund (Low-Income Subsidy)',
  'STATE-HOUSING-FUND',
  'Access to the Plateau State Housing Corporation low-income loan scheme for compliant taxpayers with a clean payment record.',
  'HOUSING_SUBSIDY',
  'Preferential interest rate on housing loans from the Plateau State Housing Corporation. Requires 2 years of compliance history.',
  '{"requires_tin": true, "min_score": 60, "no_arrears": true, "min_periods": 2}'::jsonb,
  60, 2, true,
  CURRENT_DATE, 'Plateau State Housing Corporation', 'DRAFT'
),
(
  'Scholarship and Bursary Scheme',
  'SCHOLARSHIP-BURSARY',
  'Annual bursary for children and dependants of compliant taxpayers, awarded through the Plateau State Scholarship Board.',
  'EDUCATION_BURSARY',
  'Annual bursary award for up to 2 qualifying dependants in secondary or tertiary education. Subject to Scholarship Board approval.',
  '{"requires_tin": true, "min_score": 50, "no_arrears": false}'::jsonb,
  50, 1, false,
  CURRENT_DATE, 'Plateau State Scholarship Board', 'DRAFT'
)
ON CONFLICT (code) DO NOTHING;
