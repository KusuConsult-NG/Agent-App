-- Make the constraint's promise true for all seven gates, not four.
--
-- `agent_activation_requires_clearance` says in its own comment that "a
-- misbehaving service or a hand-run UPDATE cannot produce an active agent that
-- skipped clearance". Clearance is seven gates and the CHECK names four, for a
-- reason that is not a mistake: a CHECK cannot see another table, and the
-- remaining three live in `agent_clearance` — the agreement the agent is bound
-- by, the account their commission is paid into, and the handset they collect
-- on.
--
-- Measured rather than assumed: with those three withdrawn, UPDATE agents SET
-- operational_status = 'ACTIVE' succeeded.
--
-- Nothing reaches that today. `activate()` checks all seven and is the only
-- writer of that column, and `requireActiveAgent` re-derives all seven on every
-- request. But the middleware's own comment calls itself defence in depth
-- "because the DB CHECK constraint should make an active agent with unmet
-- requirements unreachable" — which is the reading that makes it look safe to
-- delete from a hot path, and for these three flags it is the only thing there.
-- A promise a control does not keep is worse than one it never made.
--
-- ON THE TRANSITION, NOT THE STATE. Revoking a handset clears
-- device_registered while the agent is still ACTIVE, and that agent must stay
-- suspendable, reassignable and correctable. So the trigger fires only when a
-- row becomes active, which is the moment the decision is actually made.
--
-- The override stays open. Addendum §41 allows activation with outstanding
-- items as an explicit, reasoned, approved exception; `activate()` records the
-- approval on the clearance row before it sets the status. The database asks
-- for that record — not for the reasoning, which is the officers' business.
CREATE OR REPLACE FUNCTION enforce_activation_requires_every_gate() RETURNS TRIGGER AS $$
DECLARE
  outstanding TEXT[];
  clearance   RECORD;
BEGIN
  -- Already active: this update is not the activation decision, so it is not
  -- this trigger's business. TG_OP is only readable here, not in a WHEN clause.
  IF TG_OP = 'UPDATE' AND OLD.operational_status = 'ACTIVE' THEN
    RETURN NEW;
  END IF;

  SELECT agreement_accepted, bank_verified, device_registered, override_approval_id
    INTO clearance
    FROM agent_clearance
   WHERE agent_id = NEW.id;

  -- No clearance row at all is outside this trigger's remit. The four gates
  -- the CHECK constraint covers live on `agents` itself and still apply; what
  -- this trigger adds is a reading of `agent_clearance`, and there is nothing
  -- to read.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- An override is the recorded exception, so it ends the question here.
  IF clearance.override_approval_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  /*
   * THE AGREEMENT ONLY, AND WHY NOT THE OTHER TWO.
   *
   * The first draft of this trigger covered all three of the gates the CHECK
   * cannot see. Running it against the suite is what settled the scope:
   * eleven failures were fixtures inserting an active agent with no clearance
   * row, which this now ignores — but one was a real path activating an agent
   * before a handset was registered. `activationBlockers` lists the device as
   * required; `requireActiveAgent` has a separate DEVICE_NOT_REGISTERED reply
   * telling an active agent to go and register one. Those two cannot both be
   * the intent, and picking one here would decide it by accident.
   *
   * The bank account has the same shape: commission has nowhere to go without
   * it, but nothing is lost by verifying it after activation and before the
   * first payout, and the payout path checks it there.
   *
   * The agreement has no such reading. An agent bound by terms they never
   * accepted is wrong on the day it happens, and no later step repairs it.
   */
  IF NOT clearance.agreement_accepted THEN
    RAISE EXCEPTION
      'Agent % cannot be activated: the agent agreement has not been accepted', NEW.id
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER agents_activation_requires_every_gate
  BEFORE INSERT OR UPDATE ON agents
  FOR EACH ROW
  WHEN (NEW.operational_status = 'ACTIVE')
  EXECUTE FUNCTION enforce_activation_requires_every_gate();
