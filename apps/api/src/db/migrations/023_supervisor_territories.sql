-- ---------------------------------------------------------------------------
-- 023: which territories a supervisor supervises
-- ---------------------------------------------------------------------------
-- `report:read:territory` has been in the RBAC table since the beginning and a
-- supervisor is the only role that holds it. It scoped nothing, and it could
-- not have: `users` had no territory, so there was no fact in the database
-- that said which territory a supervisor supervises.
--
-- What that produced, running the platform and signing in as one:
--
--   * `/government/dashboard` refused them — it required report:read:all — and
--     the portal menu hid it, so a supervisor landed on a raw transaction list
--     and had no analytics at all. The role that runs a territory could not
--     see its revenue.
--   * `/government/intelligence/geography` accepted the permission and then
--     returned all seventeen LGAs. The permission with "territory" in its name
--     was, wherever it was honoured, indistinguishable from statewide access.
--
-- `territories` already existed and both `agents.territory_id` and
-- `transactions.territory_id` are already populated, so revenue has always
-- known which territory it was collected in. The only missing link was from
-- the officer to the territory, which is what this table is.
--
-- WHY A JOIN TABLE RATHER THAN A COLUMN. A supervisor covering two territories
-- is an ordinary arrangement, and a column would force the second one to be
-- modelled as a second account. It also gives the assignment somewhere to
-- record who made it, which a column cannot carry.
--
-- WHY NOT ON DELETE CASCADE FROM territories. Deleting a territory that an
-- officer is assigned to should fail rather than silently widen or narrow what
-- that officer can see. The user side does cascade: a deleted user has no
-- assignments to keep.
--
-- The fail-closed property this enables lives in the reporting layer and is
-- held by `territory-scoped-reporting.test.ts`: a supervisor with no row here
-- sees nothing, not everything. An account nobody has finished configuring
-- must be the least dangerous account in the system.

CREATE TABLE user_territories (
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  territory_id UUID NOT NULL REFERENCES territories(id),
  assigned_by  UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, territory_id)
);

CREATE INDEX idx_user_territories_user ON user_territories(user_id);
CREATE INDEX idx_user_territories_territory ON user_territories(territory_id);

COMMENT ON TABLE user_territories IS
  'Which territories an officer may see reports for. An officer holding '
  'report:read:territory and no row here sees nothing.';
