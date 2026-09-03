/**
 * What the suite actually wrote, against what the schema allows.
 *
 * The companion to `a-state-nothing-writes.test.ts`, asking the same question
 * from the other end. That test reads source and proves absence of a *name*,
 * which a value mentioned in a comparison satisfies — so it cannot see a state
 * that is read but never written. `settlements.RECONCILED`,
 * `commission_payouts.FAILED` and `agent_devices.APPROVED` were all exactly
 * that: a query asked for them, nothing produced them, and reading them made
 * them look accounted for.
 *
 * Triggers installed by `src/tests/enum-observation.ts` record every value
 * written to every enum column while the suite runs. This reads what they
 * saw, across all four shard databases, and reports what the schema allows
 * that nothing produced.
 *
 * TWO LISTS, AND THE DIFFERENCE MATTERS. A state can be missing here for two
 * unrelated reasons, and collapsing them would be worse than not checking at
 * all:
 *
 *   DELIBERATELY_UNREACHABLE  the platform is not meant to reach it
 *   NOT_EXERCISED_BY_TESTS    the platform can reach it and no test does
 *
 * The first is a decision about the product. The second is a hole in the
 * suite, and writing it into the first list would launder it into a decision
 * nobody made. Anything in neither is reported.
 *
 * WHAT "OBSERVED" MEANS, AND WHAT IT DOES NOT. The triggers see writes, not
 * who made them. A test process and the server it starts share one pool
 * against one database, so a fixture that inserts a row directly is
 * indistinguishable here from the platform producing the state through a real
 * path — and both come back as covered.
 *
 * Two states in the current suite are covered on that basis alone.
 * `otp_codes.purpose: LOGIN` is written by one line of
 * `auth-session-revocation.test.ts`, deliberately, because it is testing that a
 * code issued for one purpose cannot satisfy another and no route issues LOGIN
 * codes. `refunds.attributable_to: TAXPAYER` is written by a fixture in
 * `the-carried-forward-items.test.ts`. Neither fixture is wrong; both are the
 * only way to reach what they are testing. But the figure this script prints
 * counts them, so it is an upper bound on what the platform can do, not a
 * measure of it.
 *
 * There is no cheap fix: the observers would have to know which connection a
 * write came from, and the test process is the server. The honest thing is to
 * say so here, so that a state added to a fixture to make a number move is
 * recognised for what it is.
 *
 * Run by `scripts/run-tests.mjs` once every shard has finished, because no
 * single shard sees more than a quarter of the suite.
 */

import { Pool } from 'pg';
import { DELIBERATELY_UNREACHABLE, NOT_EXERCISED_BY_TESTS } from '../src/tests/enum-coverage';
import { TRANSACTIONAL_TABLES } from '../src/tests/transactional-tables';

const OBSERVATION_SCHEMA = 'psirs_test_observations';

async function readShard(url: string) {
  const pool = new Pool({ connectionString: url });
  try {
    const present = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
          WHERE table_schema = $1 AND table_name = 'enum_writes') AS exists`,
      [OBSERVATION_SCHEMA],
    );
    /*
     * The schema is read whether or not the observations are there.
     *
     * Returning early on a missing observation table also skipped reading the
     * constraints, so a run where the triggers never installed reported "no
     * enum columns found" — blaming the migration for a missing observer. Both
     * refuse to pass, but only one of them says the true thing.
     */
    const observed = present.rows[0]?.exists
      ? (
          await pool.query<{ key: string; value: string }>(
            `SELECT table_name || '.' || column_name AS key, value
               FROM ${OBSERVATION_SCHEMA}.enum_writes`,
          )
        ).rows
      : [];

    const declared = await pool.query<{ table_name: string; definition: string }>(
      `SELECT c.relname AS table_name, pg_get_constraintdef(con.oid) AS definition
         FROM pg_constraint con
         JOIN pg_class c ON c.oid = con.conrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE con.contype = 'c' AND n.nspname = 'public'
          AND pg_get_constraintdef(con.oid) LIKE '%ANY (ARRAY%'`,
    );

    const defaults = await pool.query<{ key: string; value: string }>(
      `SELECT table_name || '.' || column_name AS key,
              substring(column_default from '''([A-Z][A-Z0-9_]*)''::text') AS value
         FROM information_schema.columns
        WHERE table_schema = 'public' AND column_default IS NOT NULL`,
    );

    /*
     * THE STATES REFERENCE DATA IS STANDING IN, AS WELL AS THE ONES THIS RUN WROTE.
     *
     * The observation table is emptied before every run, so the report is
     * about the run rather than about everything the database has ever seen
     * (D-64). That is right for operational tables, which `resetDatabase`
     * empties between files and the suite refills as it goes. It is wrong for
     * reference data: geography, the revenue catalogue, notification
     * templates. Those are seeded once into a shard database that outlives the
     * run, `seedReferenceData` inserts them ON CONFLICT DO NOTHING, and on
     * every run after the first it therefore writes nothing and the observers
     * see nothing.
     *
     * The first run after the emptying was introduced duly reported
     * `notification_templates.channel: PUSH` as a state nothing wrote — while
     * four push templates sat in the table. Nothing was wrong with the
     * platform; the question had become unanswerable from writes alone.
     *
     * So the standing contents of the non-transactional tables are read too.
     * A state a reference row currently holds is a state the seed produced,
     * which is what the report is trying to establish. The narrower staleness
     * this reintroduces is real and worth naming: a template removed from
     * `seed.ts` still counts while its row survives in a kept shard database.
     * That is a much smaller window than counting every write since the
     * database was created, and it closes the moment the database is dropped.
     */
    const referenceTables = declared.rows
      .map((row) => row.table_name)
      .filter((table, index, all) => all.indexOf(table) === index)
      .filter((table) => !TRANSACTIONAL_TABLES.includes(table));

    const standing: { key: string; value: string }[] = [];
    for (const row of declared.rows) {
      if (!referenceTables.includes(row.table_name)) continue;
      const column = /\(([a-z_]+) = ANY \(ARRAY/.exec(row.definition);
      if (!column) continue;
      const { rows } = await pool.query<{ value: string }>(
        `SELECT DISTINCT "${column[1]}"::text AS value
           FROM "${row.table_name}" WHERE "${column[1]}" IS NOT NULL`,
      );
      for (const found of rows) {
        standing.push({ key: `${row.table_name}.${column[1]}`, value: found.value });
      }
    }

    return {
      observed: [...observed, ...standing],
      declared: declared.rows,
      defaults: defaults.rows.filter((row) => row.value),
    };
  } finally {
    await pool.end();
  }
}

async function main() {
  const urls = process.argv.slice(2);
  if (urls.length === 0) {
    console.error('check-enum-coverage: no shard database URLs given');
    process.exit(2);
  }

  const observed = new Set<string>();
  const declared = new Map<string, string[]>();
  const defaults = new Map<string, string>();

  for (const url of urls) {
    const shard = await readShard(url);
    for (const row of shard.observed) observed.add(`${row.key}: ${row.value}`);
    for (const row of shard.defaults) defaults.set(row.key, row.value);
    for (const row of shard.declared) {
      const column = /\(([a-z_]+) = ANY \(ARRAY/.exec(row.definition);
      if (!column) continue;
      const values = [...row.definition.matchAll(/'([A-Z][A-Z0-9_]*)'::text/g)].map((m) => m[1]);
      if (values.length > 0) declared.set(`${row.table_name}.${column[1]}`, values);
    }
  }

  if (declared.size === 0) {
    console.error('check-enum-coverage: no enum columns found — is the schema migrated?');
    process.exit(2);
  }
  if (observed.size === 0) {
    console.error(
      'check-enum-coverage: nothing was observed. The triggers did not run, so an empty ' +
        'report here would mean nothing. Check that startTestServer installs them.',
    );
    process.exit(2);
  }

  const unwritten: string[] = [];
  const staleExcuses: string[] = [];

  for (const [key, values] of declared) {
    for (const value of values) {
      const state = `${key}: ${value}`;
      if (observed.has(state)) {
        // A state somebody said was unreachable, that the suite just reached.
        if (state in DELIBERATELY_UNREACHABLE) {
          staleExcuses.push(`${state} — listed as unreachable, but the suite wrote it`);
        }
        continue;
      }
      // A column default is written by the database on every insert that omits
      // it; if no row took the default the column is simply always specified.
      if (defaults.get(key) === value) continue;
      if (state in DELIBERATELY_UNREACHABLE) continue;
      if (state in NOT_EXERCISED_BY_TESTS) continue;
      unwritten.push(state);
    }
  }

  const covered = [...declared.values()].reduce((n, v) => n + v.length, 0);
  console.log(
    `enum coverage: ${observed.size} of ${covered} declared states written during the suite ` +
      `across ${urls.length} shard(s) — including any a fixture wrote directly.`,
  );

  if (staleExcuses.length > 0) {
    console.error('\nStates listed as deliberately unreachable that the suite reached:');
    for (const line of staleExcuses) console.error(`  ${line}`);
  }

  if (unwritten.length > 0) {
    console.error(
      `\n${unwritten.length} state(s) the schema allows that nothing wrote. Each is either a ` +
        'state the platform cannot reach — add it to DELIBERATELY_UNREACHABLE with the reason — ' +
        'or one no test covers, which belongs in NOT_EXERCISED_BY_TESTS. The two are different ' +
        'admissions and must not be mixed:',
    );
    for (const line of unwritten) console.error(`  ${line}`);
  }

  process.exit(staleExcuses.length > 0 || unwritten.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('check-enum-coverage failed:', error);
  process.exit(2);
});
