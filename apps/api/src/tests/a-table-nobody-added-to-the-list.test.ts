/**
 * The reset that a new table breaks, for the third time.
 *
 * `resetDatabase` truncates the tables named in `TRANSACTIONAL_TABLES` and
 * then runs `DELETE FROM users WHERE phone LIKE '+234%'` to clear the fixture
 * accounts. Any table holding a row that references one of those users, and
 * not in that list, makes the DELETE fail on a foreign key. The hook throws,
 * and node:test cancels every remaining test in the shard — hundreds of them,
 * reported as `cancelledByParent` with a failure count of zero, which reads
 * like the run simply stopped rather than like a bug.
 *
 * The shard databases outlive the run, so a single file that populates such a
 * table poisons every later file and every later run until somebody drops the
 * database.
 *
 * IT HAS NOW HAPPENED THREE TIMES
 *
 * `lga_classes` was first; the comment on it says truncation "was partly
 * happening already ... but that is an accident of which foreign keys exist".
 * `app_versions` was second, and its comment describes this failure exactly:
 * "a single published version left behind by one file broke every later
 * file's reset with a foreign key violation, in a shard database that
 * outlives the run". `taxpayer_groups` is the third.
 *
 * Each time the fix was to add a name. This is the check that makes the next
 * one a failing test with a sentence in it instead of a suite that dies
 * halfway with nothing to read.
 *
 * WHY IT ASKS THE DATABASE RATHER THAN THE MIGRATIONS
 *
 * Because what matters is the constraint as Postgres holds it, including its
 * delete rule. A foreign key that CASCADEs takes its rows with the user and
 * breaks nothing; only NO ACTION and RESTRICT block the DELETE. Reading the
 * migration files would find the reference and not the rule, and would have
 * flagged a dozen tables that are fine.
 */

import './env';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from './helpers';
import { query } from '../db/pool';
import { TRANSACTIONAL_TABLES } from './transactional-tables';

/**
 * Reference tables whose audit column points at a user, left standing on
 * purpose.
 *
 * These are seeded once and belong to the shard database, not to a run: the
 * catalogue, the rates under it, the commission policy and the settings. Their
 * `created_by` names the SEED user, whose phone is not a `+234` fixture, so
 * the delete never reaches them.
 *
 * They are named rather than inferred because "does it bite today" is the
 * wrong question to leave implicit. A test that has a fixture officer publish
 * a rate would put a `+234` user in `revenue_item_rates.created_by` and this
 * would become the fourth instance — at which point this list is where
 * somebody decides whether to truncate the table or to stop the test doing
 * that.
 */
const REFERENCE_WITH_AN_AUDIT_COLUMN = new Set([
  'commission_policies',
  'revenue_items',
  'revenue_item_rates',
  'system_settings',
  'roles',
]);

before(async () => {
  // No server needed: this asks the schema, not the API.
});
after(async () => {
  await pool.end().catch(() => undefined);
});

describe('every table that can block the reset is accounted for', () => {
  it('is either truncated between files or named as reference data', async () => {
    const rows = await query<{ child: string; rule: string }>(
      pool,
      `SELECT DISTINCT c.conrelid::regclass::text AS child, c.confdeltype AS rule
         FROM pg_constraint c
        WHERE c.contype = 'f'
          AND c.confrelid::regclass::text IN ('users', 'taxpayers', 'agents')
          -- 'a' is NO ACTION and 'r' is RESTRICT: the two that refuse.
          -- CASCADE and SET NULL take care of themselves.
          AND c.confdeltype IN ('a', 'r')
        ORDER BY 1`,
    );

    const truncated = new Set(TRANSACTIONAL_TABLES as readonly string[]);
    const unaccounted = rows
      .map((row) => row.child)
      .filter(
        (table) =>
          table !== 'users' &&
          !truncated.has(table) &&
          !REFERENCE_WITH_AN_AUDIT_COLUMN.has(table),
      );

    assert.deepEqual(
      unaccounted,
      [],
      'these hold rows that reference a fixture user and are not cleared between ' +
        'files, so the first test that populates one will cancel the rest of its ' +
        "shard. Add them to TRANSACTIONAL_TABLES, or — if they are reference data " +
        'seeded once — name them in REFERENCE_WITH_AN_AUDIT_COLUMN with the reason:\n  ' +
        unaccounted.join('\n  '),
    );
  });

  /*
   * The control on the guard. It would rot silently by finding nothing: a
   * renamed catalogue, a changed `confdeltype` spelling, an empty result from
   * a database that never migrated. If the query stops seeing the constraints
   * it is about, the check passes for the wrong reason.
   */
  it('is looking at a schema that actually has such constraints', async () => {
    const rows = await query<{ count: string }>(
      pool,
      `SELECT count(*)::text AS count
         FROM pg_constraint c
        WHERE c.contype = 'f'
          AND c.confrelid::regclass::text IN ('users', 'taxpayers', 'agents')
          AND c.confdeltype IN ('a', 'r')`,
    );
    assert.ok(
      Number(rows[0]?.count) > 10,
      `only ${rows[0]?.count} blocking foreign keys found, so the guard is not ` +
        'looking at the schema it was written for',
    );
  });

  /*
   * And that the names in the list are real. A table renamed by a migration
   * leaves a string here that truncates nothing, which is the same silence in
   * the other direction — `resetDatabase` would keep working and the table
   * would quietly stop being cleared.
   */
  it('names only tables that exist', async () => {
    const rows = await query<{ table_name: string }>(
      pool,
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    );
    const real = new Set(rows.map((row) => row.table_name));
    const ghosts = (TRANSACTIONAL_TABLES as readonly string[]).filter(
      (table) => !real.has(table),
    );
    assert.deepEqual(
      ghosts,
      [],
      `TRANSACTIONAL_TABLES names tables that no longer exist, so they are ` +
        `truncating nothing:\n  ${ghosts.join('\n  ')}`,
    );
  });
});
