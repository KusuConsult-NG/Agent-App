-- =============================================================================
-- 007_agent_mediated_only.sql — citizens are served by agents, not by a portal
--
-- The operating model is that an authorised agent approaches the citizen: to
-- onboard them, or to help them remit a tax or levy. A citizen never holds an
-- account on this platform.
--
-- Earlier migrations allowed for a self-service citizen portal (PRD §42, marked
-- SHOULD in §85). That is not how the service works, so the schema is narrowed
-- to say so. This matters beyond tidiness: while `users.role` admitted
-- 'taxpayer', a row could exist that authenticated as a citizen and raised its
-- own assessments. Removing the value makes that unrepresentable rather than
-- merely unused.
--
-- What is deliberately kept:
--   * taxpayer records themselves — they are the subject of every assessment;
--   * taxpayers.user_id — harmless, and the natural hook if government ever
--     authorises a citizen-facing channel through a future migration;
--   * public receipt verification, which needs no account and is the citizen's
--     independent check that a receipt is genuine (PRD §43).
-- =============================================================================

-- Refuse to proceed if any affected row exists, with an error that says what to
-- do about it. A CHECK constraint would fail anyway, but not legibly.
DO $$
DECLARE
  citizen_users     INTEGER;
  portal_txns       INTEGER;
  self_service_tp   INTEGER;
BEGIN
  SELECT count(*) INTO citizen_users   FROM users       WHERE role = 'taxpayer';
  SELECT count(*) INTO portal_txns     FROM transactions WHERE channel = 'TAXPAYER_PORTAL';
  SELECT count(*) INTO self_service_tp FROM taxpayers    WHERE source = 'SELF_SERVICE';

  IF citizen_users > 0 THEN
    RAISE EXCEPTION
      'Cannot narrow users.role: % user(s) still hold the taxpayer role. '
      'Reassign or close those accounts first — this migration will not delete them.',
      citizen_users
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- Transactions are financial records and are never rewritten, so a
  -- portal-channel transaction is a genuine blocker rather than something to
  -- migrate away (PRD §51).
  IF portal_txns > 0 THEN
    RAISE EXCEPTION
      'Cannot narrow transactions.channel: % transaction(s) were collected through '
      'the taxpayer portal. Financial records are immutable, so this migration '
      'cannot proceed without a decision about how to represent them.',
      portal_txns
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF self_service_tp > 0 THEN
    RAISE EXCEPTION
      'Cannot narrow taxpayers.source: % taxpayer(s) are recorded as self-registered.',
      self_service_tp
      USING ERRCODE = 'restrict_violation';
  END IF;
END $$;

-- users.role — there is no citizen role to sign in as.
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN (
  'agent', 'supervisor', 'revenue_officer', 'finance_officer', 'auditor', 'admin'));

-- transactions.channel — revenue is collected in the field by an agent, raised
-- by an officer, or submitted by an approved integration. Never self-served.
ALTER TABLE transactions DROP CONSTRAINT transactions_channel_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_channel_check CHECK (channel IN (
  'AGENT_PWA', 'OFFICER', 'API'));

-- taxpayers.source — a taxpayer record is created by an agent in the field, or
-- arrives from migration or a PSIRS sync.
ALTER TABLE taxpayers DROP CONSTRAINT taxpayers_source_check;
ALTER TABLE taxpayers ADD CONSTRAINT taxpayers_source_check CHECK (source IN (
  'AGENT', 'MIGRATION', 'PSIRS_SYNC'));
