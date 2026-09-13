-- The role-to-permission map, moved out of code and into the database.
--
-- Changing who may approve a refund is currently a code change and a
-- deployment. That is the whole of the complaint: the permissions themselves
-- are granular and properly enforced — `packages/shared/src/rbac.ts` is a good
-- table — but it is a table in a source file, so PSIRS cannot answer a change
-- in their own delegation of authority without an engineer and a release.
--
-- WHAT MOVES AND WHAT DOES NOT
--
-- The *catalogue* of permissions stays in code, and must. A permission is a
-- name that route handlers reference; inventing one in the database creates a
-- string nothing checks, which is worse than not having it because it looks
-- like a control. `rbac.ts` remains the list of what exists.
--
-- The *map* — which role holds which permission — becomes data. So does the
-- role list, so a Service that wants a "Zonal Coordinator" can have one without
-- waiting for a release.
--
-- WHY THE SEED IS THE CURRENT CODE MAP EXACTLY
--
-- This migration must be a no-op in behaviour. Every role comes out of it
-- holding precisely the permissions it held before, and a test compares the two
-- lists directly — because a permission silently gained here is a privilege
-- escalation and one silently lost is an outage, and both would be invisible.

BEGIN;

CREATE TABLE roles (
  name        TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  label_ha    TEXT,
  description TEXT,

  /*
   * A system role cannot be deleted or renamed.
   *
   * The six the platform ships with are referenced by name in the portal's
   * menus, in `belongsInPortal`, and in every test that enumerates them.
   * Deleting `auditor` would not be a configuration change, it would be a
   * broken deployment — so the database refuses it and an administrator gets a
   * sentence rather than a foreign key error.
   */
  is_system   BOOLEAN NOT NULL DEFAULT FALSE,

  /*
   * Whether this role signs in to the officer portal.
   *
   * `belongsInPortal` in the portal is the same fact, stated in code for the
   * five it ships with. A custom role needs to declare it, because the portal
   * cannot guess and the failure mode is an officer signing in to an empty
   * shell — which is the exact bug `PORTAL_ROLES` was introduced to fix.
   */
  is_portal   BOOLEAN NOT NULL DEFAULT FALSE,

  status      TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RETIRED')),
  -- SET NULL, for the same reason as `role_permissions.granted_by` below.
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE role_permissions (
  role        TEXT NOT NULL REFERENCES roles(name) ON UPDATE CASCADE,
  permission  TEXT NOT NULL,

  /*
   * ON DELETE SET NULL, for the reason migration 026 gives at length.
   *
   * CASCADE would be a disaster here: removing a departed administrator would
   * silently revoke every permission they had ever granted, which on this table
   * means taking authority away from officers who have nothing to do with them.
   * RESTRICT would be a different failure — an officer who had ever configured
   * a role could never be removed.
   *
   * Losing the "who" costs nothing. Every grant and revoke writes `rbac.grant`
   * or `rbac.revoke` to `audit_logs` with the actor and the reason on it, and
   * that record is hash-chained and append-only. `granted_by` is a convenience
   * for a screen; the audit log is the evidence.
   */
  granted_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason      TEXT,
  PRIMARY KEY (role, permission)
);

CREATE INDEX role_permissions_permission_idx ON role_permissions (permission);

/*
 * The six roles the platform ships with, and the map exactly as the code held
 * it on 6 September 2026.
 *
 * Written out in full rather than generated, because this is the moment the
 * authority table stops being code and starts being data, and it should be
 * readable in the migration that did it. `a-map-that-moved.test.ts` compares
 * every row here against `ROLE_PERMISSIONS` in `rbac.ts` and fails on any
 * difference in either direction.
 */
INSERT INTO roles (name, label, label_ha, is_system, is_portal) VALUES
  ('agent',           'Field agent',      'Wakilin filin aiki',  TRUE, FALSE),
  ('supervisor',      'Supervisor',       'Mai kula',            TRUE, TRUE),
  ('revenue_officer', 'Revenue officer',  'Jami''in haraji',     TRUE, TRUE),
  ('finance_officer', 'Finance officer',  'Jami''in kudi',       TRUE, TRUE),
  ('auditor',         'Auditor',          'Mai bincike',         TRUE, TRUE),
  ('admin',           'Administrator',    'Mai gudanarwa',       TRUE, TRUE);

/*
 * There is deliberately no `taxpayer` role.
 *
 * Migration 001 allowed the value and migration 007 removed it, with the
 * comment "there is no citizen role to sign in as" — a citizen never signs in,
 * so there is no credential to phish and no self-service session to hijack.
 * `integration.test.ts` asserts the database refuses such a row, at a psql
 * prompt, and that assertion has to keep holding now that the CHECK is replaced
 * by a foreign key.
 *
 * Leaving `taxpayer` out of this table is what keeps it holding: the FK below
 * refuses the insert the CHECK used to refuse, for the same reason and with a
 * clearer message.
 */

INSERT INTO role_permissions (role, permission) VALUES
  -- Field agent
  ('agent','taxpayer:read:assigned'), ('agent','taxpayer:create'),
  ('agent','taxpayer:update'), ('agent','group:register'), ('agent','group:read:own'),
  ('agent','allocation:collect'), ('agent','catalogue:read'), ('agent','assessment:create'),
  ('agent','assessment:read:own'), ('agent','invoice:create'), ('agent','invoice:read:own'),
  ('agent','payment:initiate'), ('agent','payment:read:own'), ('agent','receipt:read:own'),
  ('agent','document:read:own'), ('agent','vehicle:read:all'), ('agent','vehicle:renew'),
  ('agent','agent:read:own'), ('agent','commission:read:own'),
  ('agent','commission:payout:request'), ('agent','report:read:own'),
  ('agent','support:read:own'), ('agent','approval:request'),

  -- Supervisor
  ('supervisor','taxpayer:read:assigned'), ('supervisor','catalogue:read'),
  ('supervisor','assessment:read:all'), ('supervisor','invoice:read:all'),
  ('supervisor','payment:read:all'), ('supervisor','receipt:read:all'),
  ('supervisor','document:read:all'), ('supervisor','vehicle:read:all'),
  ('supervisor','agent:read:assigned'), ('supervisor','agent:assign_territory'),
  ('supervisor','agent:suspend'), ('supervisor','commission:read:all'),
  ('supervisor','report:read:territory'), ('supervisor','fraud:read'),
  ('supervisor','support:read:all'), ('supervisor','support:manage'),
  ('supervisor','approval:review'), ('supervisor','approval:authorise'),
  ('supervisor','case:read:all'), ('supervisor','case:create'),
  ('supervisor','case:contribute'), ('supervisor','target:read:all'),
  ('supervisor','period:read'),

  -- Revenue officer
  ('revenue_officer','taxpayer:correct'), ('revenue_officer','taxpayer:read:all'),
  ('revenue_officer','taxpayer:tin_sync'), ('revenue_officer','taxpayer:update'),
  ('revenue_officer','taxpayer:obligation:waive'), ('revenue_officer','group:read:all'),
  ('revenue_officer','group:manage'), ('revenue_officer','allocation:read:all'),
  ('revenue_officer','allocation:manage'), ('revenue_officer','catalogue:read'),
  ('revenue_officer','catalogue:configure'), ('revenue_officer','assessment:read:all'),
  ('revenue_officer','invoice:read:all'), ('revenue_officer','payment:read:all'),
  ('revenue_officer','payment:reverse:request'), ('revenue_officer','receipt:read:all'),
  ('revenue_officer','document:read:all'), ('revenue_officer','vehicle:read:all'),
  ('revenue_officer','vehicle:authority_sync'), ('revenue_officer','vehicle:manage'),
  ('revenue_officer','agent:read:all'), ('revenue_officer','agent:suspend'),
  ('revenue_officer','commission:read:all'), ('revenue_officer','report:read:all'),
  ('revenue_officer','dashboard:executive'), ('revenue_officer','fraud:read'),
  ('revenue_officer','fraud:manage'), ('revenue_officer','audit:read'),
  ('revenue_officer','support:read:all'), ('revenue_officer','support:manage'),
  ('revenue_officer','incentive:read:all'), ('revenue_officer','approval:request'),
  ('revenue_officer','approval:review'), ('revenue_officer','case:read:all'),
  ('revenue_officer','case:create'), ('revenue_officer','case:contribute'),
  ('revenue_officer','target:read:all'), ('revenue_officer','target:manage'),
  ('revenue_officer','period:read'),

  -- Finance officer
  ('finance_officer','taxpayer:read:all'), ('finance_officer','catalogue:read'),
  ('finance_officer','assessment:read:all'), ('finance_officer','invoice:read:all'),
  ('finance_officer','payment:read:all'), ('finance_officer','payment:reconcile'),
  ('finance_officer','payment:reverse:request'), ('finance_officer','payment:reverse:approve'),
  ('finance_officer','receipt:read:all'), ('finance_officer','document:read:all'),
  ('finance_officer','vehicle:read:all'), ('finance_officer','vehicle:authority_sync'),
  ('finance_officer','agent:read:all'), ('finance_officer','commission:read:all'),
  ('finance_officer','commission:manage'), ('finance_officer','commission:payout:approve'),
  ('finance_officer','report:read:all'), ('finance_officer','report:financial'),
  ('finance_officer','dashboard:executive'), ('finance_officer','fraud:read'),
  ('finance_officer','audit:read'), ('finance_officer','approval:review'),
  ('finance_officer','approval:authorise'), ('finance_officer','case:read:all'),
  ('finance_officer','case:create'), ('finance_officer','case:contribute'),
  ('finance_officer','target:read:all'), ('finance_officer','period:read'),
  ('finance_officer','period:close'),

  -- Auditor
  ('auditor','taxpayer:read:all'), ('auditor','catalogue:read'),
  ('auditor','assessment:read:all'), ('auditor','invoice:read:all'),
  ('auditor','payment:read:all'), ('auditor','receipt:read:all'),
  ('auditor','document:read:all'), ('auditor','vehicle:read:all'),
  ('auditor','agent:read:all'), ('auditor','commission:read:all'),
  ('auditor','report:read:all'), ('auditor','report:financial'),
  ('auditor','fraud:read'), ('auditor','audit:read'),
  ('auditor','incentive:read:all'), ('auditor','support:read:all'),
  ('auditor','case:read:all'), ('auditor','case:create'),
  ('auditor','case:contribute'), ('auditor','case:manage'),
  ('auditor','target:read:all'), ('auditor','period:read'),

  -- Administrator
  ('admin','taxpayer:correct'), ('admin','taxpayer:read:all'),
  ('admin','taxpayer:tin_sync'), ('admin','taxpayer:manage'),
  ('admin','taxpayer:obligation:waive'), ('admin','group:read:all'),
  ('admin','group:manage'), ('admin','allocation:read:all'),
  ('admin','allocation:manage'), ('admin','catalogue:read'),
  ('admin','catalogue:configure'), ('admin','assessment:read:all'),
  ('admin','invoice:read:all'), ('admin','payment:read:all'),
  ('admin','receipt:read:all'), ('admin','document:read:all'),
  ('admin','vehicle:read:all'), ('admin','vehicle:authority_sync'),
  ('admin','vehicle:manage'), ('admin','agent:read:all'),
  ('admin','agent:manage'), ('admin','agent:approve'),
  ('admin','agent:suspend'), ('admin','agent:assign_territory'),
  ('admin','device:manage'), ('admin','commission:read:all'),
  ('admin','commission:manage'), ('admin','report:read:all'),
  ('admin','dashboard:executive'), ('admin','fraud:read'),
  ('admin','fraud:manage'), ('admin','audit:read'),
  ('admin','support:read:all'), ('admin','support:manage'),
  ('admin','incentive:read:all'), ('admin','incentive:configure'),
  ('admin','approval:request'), ('admin','system:configure'),
  ('admin','user:manage'), ('admin','case:read:all'),
  ('admin','case:create'), ('admin','case:contribute'),
  ('admin','case:manage'), ('admin','target:read:all'),
  ('admin','target:manage'), ('admin','period:read'),
  ('admin','period:reopen');

/*
 * A system role cannot be removed or renamed.
 *
 * Deleting `auditor` would not be a configuration change, it would be a broken
 * deployment: the name is referenced in the portal's menus, in the roles that
 * may sign in there, and in every test that enumerates them.
 */
CREATE OR REPLACE FUNCTION system_roles_are_permanent() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_system THEN
      RAISE EXCEPTION 'the % role ships with the platform and cannot be removed', OLD.name
        USING HINT = 'Retire it instead, or take its permissions away.';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.is_system AND NEW.name IS DISTINCT FROM OLD.name THEN
    RAISE EXCEPTION 'the % role ships with the platform and cannot be renamed', OLD.name
      USING HINT = 'Change its label instead; the name is referenced in code.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS roles_system_are_permanent ON roles;
CREATE TRIGGER roles_system_are_permanent
  BEFORE UPDATE OR DELETE ON roles
  FOR EACH ROW EXECUTE FUNCTION system_roles_are_permanent();

/*
 * A role in use cannot be deleted.
 *
 * The FK below would refuse it anyway once `users.role` points here; this
 * exists so the administrator gets a sentence naming the count instead.
 */
CREATE OR REPLACE FUNCTION roles_in_use_are_not_deleted() RETURNS TRIGGER AS $$
DECLARE
  holders INTEGER;
BEGIN
  SELECT count(*) INTO holders FROM users WHERE role = OLD.name;
  IF holders > 0 THEN
    RAISE EXCEPTION '% account(s) still hold the % role', holders, OLD.name
      USING HINT = 'Move them to another role first.';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS roles_in_use_no_delete ON roles;
CREATE TRIGGER roles_in_use_no_delete
  BEFORE DELETE ON roles
  FOR EACH ROW EXECUTE FUNCTION roles_in_use_are_not_deleted();

/*
 * `users.role` now points at the table rather than at a CHECK constraint.
 *
 * The CHECK named the same six roles this table holds, so it refuses exactly
 * what it refused before — including a citizen login, which is a control
 * migration 007 introduced and `integration.test.ts` still asserts. What it
 * additionally admits is a role somebody creates, which is the point.
 */
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_fkey
  FOREIGN KEY (role) REFERENCES roles(name) ON UPDATE CASCADE;

COMMIT;
