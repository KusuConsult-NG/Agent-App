-- A handset is active, or it is not.
--
-- `agent_devices.status` has always allowed APPROVED as well as ACTIVE, and
-- nothing has ever written it: `approveDevice` sets ACTIVE, registration sets
-- PENDING or ACTIVE, suspension sets SUSPENDED, revocation REVOKED. APPROVED
-- was only ever *read* — the clearance query asked for `IN ('APPROVED','ACTIVE')`
-- and suspension for `IN ('ACTIVE','APPROVED','PENDING')` — so the branch was
-- carried in three queries and reached in none.
--
-- This is the half of the orphaned-state class that `a-state-nothing-writes`
-- cannot see: the word APPROVED appears all over the platform (approvals,
-- clearance, commission payouts), so the check finds it mentioned and is
-- satisfied. It took reading the device path to find it, and the honest
-- response is to remove the value rather than leave a state the database
-- accepts, three queries expect, and no code can produce.
--
-- Nothing to migrate: a row in this state cannot exist.

ALTER TABLE agent_devices DROP CONSTRAINT agent_devices_status_check;
ALTER TABLE agent_devices ADD CONSTRAINT agent_devices_status_check
  CHECK (status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED'));

COMMENT ON COLUMN agent_devices.status IS
  'PENDING awaits an officer; ACTIVE may collect; SUSPENDED is a reversible stop; '
  'REVOKED is permanent and the same handset may not be registered again.';
