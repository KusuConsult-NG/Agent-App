BEGIN;

/*
 * The permissions that shipped after the map became data.
 *
 * Migration 059 copied the compiled permission map into `role_permissions` and
 * made the database the authority on who may do what. `seedRoles()` in seed.ts
 * fills a role from the compiled map only when that role holds nothing at all:
 *
 *     if (Number(held!.count) > 0) continue;
 *
 * which is right, and is why an administrator's configuration survives a
 * redeploy. What it also means is that once 059 has run, no permission added to
 * `ROLE_PERMISSIONS` afterwards ever reaches the database -- not on an upgrade,
 * and not on a clean install either, because a clean install runs 059 before it
 * runs the seed.
 *
 * Eight grants had gone in that way and were unreachable in every deployed
 * database:
 *
 *   data:export    supervisor, revenue_officer, finance_officer, auditor, admin
 *   audit:sample   auditor
 *   audit:report   auditor
 *   audit:sign     auditor
 *
 * So no officer of any role could export a report, and the audit workbench --
 * drawing a sample, generating a report, signing one -- could not be reached by
 * the only role that has ever been meant to reach it. The code was complete and
 * tested; the database it runs against had never been told.
 *
 * WHY THIS WAS NOT CAUGHT
 *
 * `a-map-that-moved.test.ts` asserts exactly this, in both directions, by name,
 * and it cannot fail. `role_permissions` is in `TRANSACTIONAL_TABLES`, so
 * `resetDatabase()` truncates it, and `seedReferenceData()` then runs
 * `seedRoles()` against an empty table -- which is the one case where the
 * seed's insert loop does run. Every test therefore begins with the table
 * filled from the compiled map, and a test comparing the table against the
 * compiled map is comparing the map with itself.
 *
 * The path production takes is the other one: migrate, then seed against a
 * table 059 has already filled, then skip. No test had ever executed it, so
 * the assertion that looked like the guard for exactly this was measuring a
 * database no deployment has.
 *
 * `the-grants-a-migration-leaves.test.ts` closes that: it migrates a scratch
 * database, seeds it the way a deployment does, and compares. It fails without
 * this migration.
 *
 * WHY A MIGRATION RATHER THAN A CHANGE TO THE SEED
 *
 * Relaxing the seed's guard -- topping every system role back up to the
 * compiled map on each boot -- would also undo an administrator who had
 * deliberately taken a permission away from a system role, silently, on a
 * deploy they did not connect to it. Shipping new capability is a migration,
 * the same way migration 066 gave the shipped roles their export limits, and it
 * is a thing somebody can read in a diff.
 *
 * ON CONFLICT DO NOTHING so a database that already has these -- one built
 * before 059, or one an administrator has already granted -- is left alone.
 */
INSERT INTO role_permissions (role, permission, reason) VALUES
  ('supervisor','data:export','Shipped after migration 059; see migration 067'),
  ('revenue_officer','data:export','Shipped after migration 059; see migration 067'),
  ('finance_officer','data:export','Shipped after migration 059; see migration 067'),
  ('auditor','data:export','Shipped after migration 059; see migration 067'),
  ('admin','data:export','Shipped after migration 059; see migration 067'),

  /*
   * The auditor alone, deliberately. Drawing a sample and signing a report are
   * the examination itself, not oversight of it, and `audit:sign` puts a name
   * to figures everyone downstream reads as settled.
   */
  ('auditor','audit:sample','Shipped after migration 059; see migration 067'),
  ('auditor','audit:report','Shipped after migration 059; see migration 067'),
  ('auditor','audit:sign','Shipped after migration 059; see migration 067')
ON CONFLICT DO NOTHING;

COMMIT;
