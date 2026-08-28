-- =============================================================================
-- 047: The language the citizen actually reads
-- =============================================================================
--
-- A taxpayer holds no account here. An agent approaches them, they pay, and an
-- SMS carrying the receipt number and the verification code is the only copy
-- they ever get. All thirty templates were English.
--
-- Hausa is the first language of a large share of the people this platform
-- exists to reach. The agent application has carried it since it was built,
-- on the reasoning that an agent who cannot read "never collect cash" is
-- exactly the agent who collects cash. The same argument is stronger for the
-- citizen: they get one message, cannot ask it to repeat itself, and a receipt
-- they cannot read is a receipt they cannot check.
--
-- THREE DECISIONS ARE ENCODED HERE.
--
-- The template key becomes (event, channel, language). It was (event, channel),
-- which is what made a second language impossible rather than merely absent.
--
-- The preference lives on the person, defaulting to English. It is writable at
-- registration, because the agent is standing in front of them and is the only
-- one who can ask — a column nothing sets is the defect this project has found
-- more often than any other.
--
-- And selection falls back to English. A message in the wrong language is far
-- better than no message, and a strict match would silence the first
-- English-only template anybody adds.
-- =============================================================================

ALTER TABLE notification_templates
  ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'en'
    CHECK (language IN ('en', 'ha'));

-- The old key made a translation impossible: one row per event and channel,
-- full stop. Dropped by name because that is what 005 created it as.
ALTER TABLE notification_templates
  DROP CONSTRAINT IF EXISTS notification_templates_event_channel_key;

ALTER TABLE notification_templates
  ADD CONSTRAINT notification_templates_event_channel_language_key
    UNIQUE (event, channel, language);

COMMENT ON COLUMN notification_templates.language IS
  'Which language this rendering is in. Selection prefers the recipient''s own and falls back to en.';

-- -----------------------------------------------------------------------------
-- Who reads what
-- -----------------------------------------------------------------------------

ALTER TABLE taxpayers
  ADD COLUMN IF NOT EXISTS preferred_language TEXT NOT NULL DEFAULT 'en'
    CHECK (preferred_language IN ('en', 'ha'));

COMMENT ON COLUMN taxpayers.preferred_language IS
  'The language this person reads. Recorded by the agent at registration; every message to them is chosen with it.';

-- Agents and officers receive messages too — a suspension, a payout, a
-- clearance decision — and a field agent is as likely to read Hausa as the
-- traders they collect from.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS preferred_language TEXT NOT NULL DEFAULT 'en'
    CHECK (preferred_language IN ('en', 'ha'));

COMMENT ON COLUMN users.preferred_language IS
  'The language this person reads. Every notification addressed to them is chosen with it.';

-- The message a notification was actually rendered in, recorded on the row
-- rather than inferred. A support officer reading the queue has to be able to
-- see which language a citizen was written to in, and the template it came
-- from may since have been edited or retired.
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'en'
    CHECK (language IN ('en', 'ha'));
