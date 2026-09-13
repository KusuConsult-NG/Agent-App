/**
 * A control cached for thirty seconds, in each process, with nothing to tell
 * the others.
 *
 * `roles.export_row_limit` is how many rows of the register may leave the
 * platform in one file. `services/export.ts` calls it "the only field on a
 * role that is a control" and says erring high "puts the register on somebody's
 * laptop". Lowering it is an administrator reducing an authority.
 *
 * It was cached for thirty seconds in an in-process map, on the reasoning
 * printed beside it: "an export is not a hot path, but reading two rows per
 * download to answer a question that changes about once a year is a query that
 * exists to be forgotten about." Both halves of that argue against the cache.
 *
 * What it cost is that `forgetLimits()` emptied one process's map and nothing
 * told the others — no LISTEN/NOTIFY, no version column — and, unlike
 * `revoke()` next door, `setExportLimit` ends no sessions, so there was no
 * backstop either. Simulated by doing to one process exactly what happens to
 * the second: change the row, and do not tell it.
 *
 *     limit before = 100000
 *     administrator lowers it to 1
 *     limit still served = 100000
 *
 * For up to thirty seconds, on every instance but one, at the moment an
 * officer is most likely to be mid-export.
 *
 * The limit is now read per export — one row, immediately before building a
 * spreadsheet of up to tens of thousands — so there is no second copy to go
 * stale. That is what the first test below holds, and it is deliberately
 * written as the cross-process case, because a test that changes the value
 * through the service in the same process would have passed against the cache
 * too. The existing suite has one of those: "and the cache does not hold it
 * back" is true, and could never have caught this.
 */

import './env';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pool, resetDatabase, startTestServer, stopTestServer } from './helpers';
import { seedReferenceData } from '../db/seed';
import { rowLimitFor } from '../services/export';

/**
 * The seeded limits, put back after every test in this file.
 *
 * `resetDatabase` deletes only non-system roles — `users.role` references the
 * six the platform ships with, so they survive — which means a column edited
 * on one of them persists for the life of the database, across runs and across
 * shards. The first draft of this file left `auditor` at 90,000 and would have
 * broken `an-export-that-survives-excel.test.ts`, which asserts that an
 * auditor's limit exceeds a revenue officer's, on whatever ran next.
 *
 * So nothing here reads a seeded value to decide what to assert, and
 * everything it changes it changes back.
 */
const SEEDED = new Map<string, number>();

before(async () => {
  await startTestServer();
  const rows = await pool.query<{ name: string; export_row_limit: number }>(
    'SELECT name, export_row_limit FROM roles WHERE is_system',
  );
  for (const row of rows.rows) SEEDED.set(row.name, row.export_row_limit);
  assert.ok(SEEDED.size >= 6, `expected the six system roles, found ${SEEDED.size}`);
});
after(async () => {
  await stopTestServer();
});
beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
});
afterEach(async () => {
  for (const [name, limit] of SEEDED) {
    await pool.query('UPDATE roles SET export_row_limit = $2 WHERE name = $1', [name, limit]);
  }
});

describe('the export row limit', () => {
  it('follows a change this process was never told about', async () => {
    /*
     * The whole finding. No service call, no `forget`, nothing that would let
     * an in-process cache notice: just the row moving underneath, which is
     * what every instance except one experiences.
     */
    // Set rather than read: an assertion that leans on the seeded number is
    // one a legitimate change to the seed breaks.
    await pool.query(`UPDATE roles SET export_row_limit = 40000 WHERE name = 'auditor'`);
    assert.equal(await rowLimitFor('auditor'), 40000, 'the starting point this test sets');

    await pool.query(`UPDATE roles SET export_row_limit = 1 WHERE name = 'auditor'`);

    assert.equal(
      await rowLimitFor('auditor'),
      1,
      'an instance that was not told still let the register out at the old limit',
    );
  });

  it('follows it back up again, so this is not a one-way refusal', async () => {
    // The control against "fixed" by always answering with the floor.
    await pool.query(`UPDATE roles SET export_row_limit = 250 WHERE name = 'auditor'`);
    assert.equal(await rowLimitFor('auditor'), 250);

    await pool.query(`UPDATE roles SET export_row_limit = 90000 WHERE name = 'auditor'`);
    assert.equal(await rowLimitFor('auditor'), 90000, 'a raised limit must reach the officer too');
  });

  it('refuses everything for a role that is not there', async () => {
    /*
     * The fallback is not a policy: it is what to do when the row has gone
     * missing underneath a live request. Zero costs an officer a refusal they
     * can act on; the other direction puts the register on a laptop.
     */
    assert.equal(await rowLimitFor('a_role_that_was_never_created'), 0);
  });

  it('agrees with the row, for every role the platform ships with', async () => {
    // Compared against the row rather than against a table of numbers written
    // here: the seed owns those, and a copy of them would fail on the day
    // PSIRS changed one legitimately.
    const roles = await pool.query<{ name: string; export_row_limit: number }>(
      'SELECT name, export_row_limit FROM roles ORDER BY name',
    );
    assert.ok(roles.rows.length >= 6, `expected the seeded roles, found ${roles.rows.length}`);

    for (const role of roles.rows) {
      assert.equal(
        await rowLimitFor(role.name),
        role.export_row_limit,
        `${role.name} is served something other than what its row says`,
      );
    }
  });

  it('leaves the seeded limits as it found them', async () => {
    /*
     * The guard on this file rather than on the platform.
     *
     * Everything above edits a column `resetDatabase` cannot restore, because
     * `users.role` references the six system roles and they are never deleted.
     * A test that left one moved would break whichever file ran next — the
     * export suite asserts an auditor may take more than a revenue officer —
     * and it would break it somewhere else, which is the worst kind of
     * failure to chase.
     */
    for (const [name, limit] of SEEDED) {
      const row = await pool.query<{ export_row_limit: number }>(
        'SELECT export_row_limit FROM roles WHERE name = $1',
        [name],
      );
      assert.equal(row.rows[0]!.export_row_limit, limit, `${name}'s limit was left moved`);
    }
  });
});
