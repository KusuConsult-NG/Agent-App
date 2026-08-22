-- ---------------------------------------------------------------------------
-- 022: changing the account an agent's commission is paid into
-- ---------------------------------------------------------------------------
-- An agent's bank account was written once, when they applied, and never
-- again. Only its *verification status* was ever updated afterwards. Agents
-- change banks, accounts are closed, banks merge — and there was no route, no
-- screen and no service anywhere in the platform that could move the
-- destination. The only remedy was a manual UPDATE against the database,
-- which is the one thing the append-only audit design exists to prevent.
--
-- The pieces for doing it properly were already here and unused:
-- `bank_accounts.status` has always allowed 'SUPERSEDED', `APPROVAL_TYPES`
-- has always listed 'BANK_ACCOUNT_CHANGE', and `STEP_UP_ACTIONS` has always
-- named 'agent.bank_account.change'. The schema anticipated the flow; nobody
-- built it.
--
-- WHY THE PROPOSED ACCOUNT IS A ROW RATHER THAN A JSON PAYLOAD. A change has
-- to be checked against the bank before anyone approves it — the resolved
-- account name is the single strongest control here, because it is the thing
-- an attacker redirecting a payout cannot fake. Verification writes to
-- `bank_accounts`, so the proposed account has to exist as a row to be
-- verifiable at all. It is created 'PROPOSED': visible, checkable, and
-- pointed at by nothing, so no payout can reach it while it waits.
--
-- Changing the destination of money is the classic payout-fraud vector —
-- redirect the account, then trigger a payout. Nothing here is guarded by one
-- control alone: the request needs a step-up code, the new account must come
-- back VERIFIED from the bank, a second officer must approve it, the agent is
-- told on their existing number the moment a change is requested, and the old
-- account is kept rather than overwritten.

ALTER TABLE bank_accounts DROP CONSTRAINT bank_accounts_status_check;
ALTER TABLE bank_accounts
  ADD CONSTRAINT bank_accounts_status_check
  CHECK (status = ANY (ARRAY['PROPOSED', 'ACTIVE', 'SUPERSEDED', 'REJECTED', 'BLOCKED']));

-- Which account this one would replace, so the chain can be walked backwards
-- from the account in use to every account it ever replaced.
ALTER TABLE bank_accounts
  ADD COLUMN replaces_account_id UUID REFERENCES bank_accounts(id),
  ADD COLUMN superseded_at TIMESTAMPTZ,
  ADD COLUMN change_approval_id UUID REFERENCES approvals(id);

-- One account in use at a time, and one proposal outstanding at a time.
--
-- The first was assumed everywhere and enforced nowhere: `agents.bank_account_id`
-- points at a single row, and a second ACTIVE row for the same owner would
-- make "the agent's account" ambiguous in every query that joins on status.
-- The second stops a queue of proposals stacking up, where approving an old
-- one would silently overwrite a newer.
CREATE UNIQUE INDEX bank_accounts_one_active_per_owner
  ON bank_accounts (owner_type, owner_id) WHERE status = 'ACTIVE';

CREATE UNIQUE INDEX bank_accounts_one_proposal_per_owner
  ON bank_accounts (owner_type, owner_id) WHERE status = 'PROPOSED';

-- A proposal names what it replaces; an account in use does not.
ALTER TABLE bank_accounts
  ADD CONSTRAINT bank_accounts_replacement_shape
  CHECK (
    (status = 'PROPOSED' AND replaces_account_id IS NOT NULL)
    OR (status <> 'PROPOSED')
  ) NOT VALID;

-- A superseded account records when it stopped being used.
ALTER TABLE bank_accounts
  ADD CONSTRAINT bank_accounts_superseded_dated
  CHECK ((status = 'SUPERSEDED') = (superseded_at IS NOT NULL)) NOT VALID;

DO $$
DECLARE
  bad BIGINT;
BEGIN
  SELECT count(*) INTO bad FROM bank_accounts
   WHERE (status = 'PROPOSED' AND replaces_account_id IS NULL)
      OR ((status = 'SUPERSEDED') <> (superseded_at IS NOT NULL));
  IF bad = 0 THEN
    ALTER TABLE bank_accounts VALIDATE CONSTRAINT bank_accounts_replacement_shape;
    ALTER TABLE bank_accounts VALIDATE CONSTRAINT bank_accounts_superseded_dated;
    RAISE NOTICE 'bank accounts: every existing row fits the replacement shape; constraints validated';
  ELSE
    RAISE WARNING 'bank accounts: % row(s) do not fit the replacement shape. New writes are already refused; correct them, then VALIDATE CONSTRAINT bank_accounts_replacement_shape and bank_accounts_superseded_dated.', bad;
  END IF;
END $$;

-- The clearance journal is the agent's own history, and its event vocabulary
-- is constrained rather than free text so that a typo cannot quietly create a
-- new kind of event nobody reports on. Three more belong in it: a change of
-- the account somebody's commission is paid into is exactly the sort of thing
-- a supervisor reading that history needs to see.
ALTER TABLE agent_clearance_events DROP CONSTRAINT agent_clearance_events_event_type_check;
ALTER TABLE agent_clearance_events
  ADD CONSTRAINT agent_clearance_events_event_type_check
  CHECK (event_type = ANY (ARRAY[
    'APPLICATION_SUBMITTED', 'KYC_SUBMITTED', 'KYC_CLEARED', 'KYC_FAILED',
    'KYC_INFO_REQUIRED', 'REFEREE_INVITED', 'REFEREE_CLEARED', 'REFEREE_FAILED',
    'REFEREE_REPLACED', 'TRAINING_COMPLETED', 'BANK_VERIFIED',
    'BANK_CHANGE_REQUESTED', 'BANK_CHANGE_APPLIED', 'BANK_CHANGE_REFUSED',
    'AGREEMENT_ACCEPTED', 'DEVICE_REGISTERED', 'GOVERNMENT_APPROVED',
    'GOVERNMENT_REJECTED', 'INFO_REQUESTED', 'ACTIVATED', 'SUSPENDED',
    'REINSTATED', 'OVERRIDE_APPLIED'
  ]));

COMMENT ON COLUMN bank_accounts.replaces_account_id IS
  'For a PROPOSED account, the account it would replace once approved.';
COMMENT ON COLUMN bank_accounts.change_approval_id IS
  'The BANK_ACCOUNT_CHANGE approval that created this account, and later authorised it.';
