/**
 * The observers, and whether they are actually on the tables they describe.
 *
 * `enum-observation.ts` puts a statement-level trigger on every enum column in
 * the schema, so `check-enum-coverage` can say which states the suite really
 * wrote. Installing them about thirty times per shard would be wasteful, so the
 * installer records a fingerprint — the sorted set of observed `table.column`
 * names — as a comment on `enum_writes`, and returns early when it matches.
 *
 * Its own comment says why a fingerprint replaced a trigger count: a count
 * missed a column added to a table that already had observers, which left the
 * new column unobserved and made the coverage check "accuse the platform of a
 * gap that was really its own — and the accusation looks exactly like the real
 * thing it exists to catch".
 *
 * The fingerprint has the same hole in a different shape. It describes the
 * columns that OUGHT to be observed, never the triggers that ARE. Drop a table
 * and recreate it with the same columns and the fingerprint is unchanged, the
 * installer returns early, and the recreated table carries no observers at all.
 *
 * That is not a hypothetical. It is how a gate on this branch failed: a new
 * migration was applied to the shard databases, edited, and — because
 * `migrate.ts` refuses to boot on a changed checksum, which is correct — the
 * table was dropped and the migration row deleted so it would re-apply. The
 * fingerprint from the first run survived in a schema nothing truncates. The
 * second run recreated the table, matched the fingerprint, installed nothing,
 * and reported four states as written by nothing — on a run where the suite
 * had just written all four and asserted them.
 *
 * Nothing could have caught it, because no test asked the one question that
 * matters about a watcher: is it there. These do.
 */

import './env';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pool, startTestServer, stopTestServer } from './helpers';
import { query } from '../db/pool';
import { enumColumns, installEnumObservers } from './enum-observation';

/** Which tables carry which observer triggers, from the catalogue. */
async function installedOn(): Promise<Map<string, Set<string>>> {
  const rows = await query<{ table_name: string; tgname: string }>(
    pool,
    `SELECT c.relname AS table_name, t.tgname
       FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND NOT t.tgisinternal
        AND t.tgname IN ('observe_enum_ins', 'observe_enum_upd')`,
  );
  const byTable = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!byTable.has(row.table_name)) byTable.set(row.table_name, new Set());
    byTable.get(row.table_name)!.add(row.tgname);
  }
  return byTable;
}

before(async () => {
  await startTestServer();
});
after(async () => {
  // Whatever these tests did to the observers, the shard's later files depend
  // on them being in place. Installing again is the repair as well as the
  // subject, which is the point.
  await installEnumObservers();
  await stopTestServer();
});

describe('an observer that was not there', () => {
  /*
   * A check on the database this shard is about to use, not on the installer.
   *
   * Worth saying because it behaves differently from the two below it. If the
   * observers are in place it passes whatever the installer's code says — a
   * mutation that stops the installer putting triggers on a table does not
   * fail this test, because `startTestServer` had already found a matching
   * fingerprint and returned early without reaching the mutated line. I
   * predicted two failures for that mutation and got one, which is why this is
   * written down rather than left to be rediscovered.
   *
   * It is still the one that matters most in a gate: it names the unobserved
   * tables directly, instead of leaving somebody to work backwards from
   * `check-enum-coverage` reporting states the suite demonstrably wrote.
   */
  it('watches every enum column the schema declares', async () => {
    const columns = await enumColumns();
    assert.ok(
      columns.length > 60,
      `only ${columns.length} enum columns found; the schema query is not working, ` +
        'and an empty list would make every assertion below pass for nothing',
    );

    const tables = [...new Set(columns.map((column) => column.table))].sort();
    const installed = await installedOn();

    const unwatched = tables.filter(
      (table) =>
        !installed.get(table)?.has('observe_enum_ins') ||
        !installed.get(table)?.has('observe_enum_upd'),
    );
    assert.deepEqual(
      unwatched,
      [],
      'these tables have an enum column and no observer on it, so every state they ' +
        'hold will be reported as written by nothing however many times the suite writes it',
    );
  });

  /*
   * The repair, driven the way the real case arrives.
   *
   * A table dropped and recreated keeps its name and its columns and loses its
   * triggers — so the fingerprint is unchanged and the installer has to notice
   * from something other than the fingerprint. Dropping the two triggers
   * reproduces exactly that state without dropping a table other tests need.
   */
  it('puts them back when a table has lost them', async () => {
    const columns = await enumColumns();
    const table = [...new Set(columns.map((column) => column.table))].sort()[0]!;

    await pool.query(`DROP TRIGGER observe_enum_ins ON ${table}`);
    await pool.query(`DROP TRIGGER observe_enum_upd ON ${table}`);
    assert.equal(
      (await installedOn()).get(table)?.size ?? 0,
      0,
      `the triggers on ${table} are gone, which is the state to recover from`,
    );

    await installEnumObservers();

    assert.deepEqual(
      [...((await installedOn()).get(table) ?? [])].sort(),
      ['observe_enum_ins', 'observe_enum_upd'],
      `installEnumObservers left ${table} unobserved. The fingerprint matched, because ` +
        'the columns had not changed — and the fingerprint is not evidence that the ' +
        'triggers it describes exist',
    );
  });

  /*
   * And that a restored trigger records, rather than merely existing.
   *
   * A trigger can be present and point at a function that was replaced or
   * dropped underneath it, which would fail only at write time — so the
   * question is answered with a write.
   */
  it('records a write once they are back', async () => {
    await installEnumObservers();

    /*
     * `usage_events.surface`, not `.language`: the language column is named in
     * `NOT_STATE_COLUMNS` as a preference rather than a state, so it carries no
     * observer and a write to it would prove nothing.
     */
    await pool.query(
      `DELETE FROM psirs_test_observations.enum_writes
        WHERE table_name = 'usage_events' AND column_name = 'surface' AND value = 'PORTAL'`,
    );

    await pool.query(
      `INSERT INTO usage_events (event, surface, occurred_at, received_at)
       VALUES ('observer.probe', 'PORTAL', now(), now())`,
    );

    const observed = await query<{ value: string }>(
      pool,
      `SELECT value FROM psirs_test_observations.enum_writes
        WHERE table_name = 'usage_events' AND column_name = 'surface'`,
    );
    assert.ok(
      observed.some((row) => row.value === 'PORTAL'),
      `the write was not observed; enum_writes holds ${JSON.stringify(observed)}`,
    );
  });
});
