-- Record which digest each entry was written with.
--
-- The chain hashes ten of the row's seventeen columns. Seven are outside it:
-- actor_role, reason, ip_address, device_id, latitude, longitude, request_id.
-- Those are not incidental. `reason` is the why of every discretionary act on
-- this platform — the words an officer typed when reversing a payment or
-- overriding an agent's clearance. Latitude and longitude are what revenue is
-- attributed by and what the fraud rules read. actor_role is the authority
-- somebody claimed to be acting under.
--
-- The triggers on this table refuse UPDATE and DELETE, so nothing reachable
-- through the application can rewrite them. A hash chain exists for the case
-- those triggers cannot cover: somebody with rights over the database. Against
-- that person the chain protected the act and left the account of it open.
--
-- WHY A VERSION RATHER THAN A REWRITE. Entries already written were hashed the
-- old way, and an append-only log is the one place where recomputing history to
-- match a new rule is exactly the wrong move. Existing rows keep version 1 and
-- verify under the old algorithm; new rows are version 2 and cover the whole
-- row. The verifier reads the version off each row, so a chain spanning the
-- change verifies end to end without either half being rewritten.
ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS hash_version SMALLINT NOT NULL DEFAULT 1;

COMMENT ON COLUMN audit_logs.hash_version IS
  '1: digest covers sequence_no, actor_id, action, entity_type, entity_id, '
  'old_value, new_value, result, created_at, prev_hash. '
  '2: adds actor_role, reason, ip_address, device_id, latitude, longitude, request_id.';
