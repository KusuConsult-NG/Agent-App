BEGIN;

/*
 * `paye:file` reaches the database, which it never had.
 *
 * Migration 059 made `role_permissions` the authority on who may do what, and
 * `seedRoles()` fills a role from the compiled map only when that role holds
 * nothing at all — which is what lets an administrator's own configuration
 * survive a redeploy. Migration 067 wrote up the consequence: a permission
 * added to `ROLE_PERMISSIONS` after 059 never reaches a deployed database, and
 * not a clean install either, because 059 runs before the seed does.
 *
 * The payroll screen was built on a branch cut before 059 existed, so it added
 * `paye:file` to the compiled map and nothing else. Merged as it stood, the
 * menu would have offered "Employers and premises" to a revenue officer and
 * the API would have refused every filing they attempted — the code complete
 * and tested, the database never told. `the-grants-a-migration-leaves` caught
 * it on the merge, which is the whole reason that test exists.
 *
 * Two roles, matching the compiled map exactly. `ON CONFLICT DO NOTHING` so a
 * database where an administrator has already granted it is left alone.
 */
INSERT INTO role_permissions (role, permission, reason) VALUES
  ('revenue_officer','paye:file','Shipped on the payroll branch; see migration 075'),
  ('admin','paye:file','Shipped on the payroll branch; see migration 075')
ON CONFLICT (role, permission) DO NOTHING;

COMMIT;
