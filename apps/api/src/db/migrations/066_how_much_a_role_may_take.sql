BEGIN;

/*
 * How many rows a role may export, as a decision rather than a constant.
 *
 * `ROW_LIMITS` in `services/export.ts` was a hard-coded map: the auditor a
 * hundred thousand, the administrator fifty, the field roles twenty, and
 * anything else five. That last case is the problem. Since migration 059 an
 * administrator creates their own roles, and a role PSIRS invents gets the
 * floor until an engineer edits a TypeScript file and PSIRS waits for a
 * release -- which is precisely the shape of problem migration 059 existed to
 * fix for permissions, reproduced one file over.
 *
 * WHY A LIMIT AT ALL
 *
 * Not because officers are untrusted. Because a hundred thousand taxpayer
 * records in one file is a different act from a report, and should have to be
 * asked for as one. The auditor's is the highest because an examination that
 * cannot see the whole population is not an examination.
 *
 * WHAT THE BOUNDS ARE FOR
 *
 * Zero is allowed and means this role exports nothing -- a real thing PSIRS
 * might decide, and different from the permission being absent, which is a
 * statement about capability rather than about volume.
 *
 * The ceiling exists because the XLSX writer builds the whole file in memory
 * and the ZIP container it writes carries 32-bit sizes. A limit above what
 * that can produce would not be a policy, it would be a promise the code
 * cannot keep, and an officer would discover it as a truncated file rather
 * than as a refusal.
 */
ALTER TABLE roles ADD COLUMN export_row_limit INTEGER NOT NULL DEFAULT 5000
  CHECK (export_row_limit >= 0 AND export_row_limit <= 1000000);

COMMENT ON COLUMN roles.export_row_limit IS
  'Rows this role may take out of the platform in one export. 0 means none.';

/*
 * The shipped roles keep the limits they had.
 *
 * A migration that quietly changed what an auditor may export would be a
 * migration that changed a control while claiming to move one, and nobody
 * reading the diff would see it.
 */
UPDATE roles SET export_row_limit = 100000 WHERE name = 'auditor';
UPDATE roles SET export_row_limit = 50000 WHERE name IN ('admin', 'finance_officer');
UPDATE roles SET export_row_limit = 20000 WHERE name IN ('revenue_officer', 'supervisor');
/*
 * The field agent exports nothing, which was true before and was expressed as
 * an absent permission rather than as a limit. Both now say it.
 */
UPDATE roles SET export_row_limit = 0 WHERE name = 'agent';

COMMIT;
