/**
 * Watching which states the platform actually writes.
 *
 * `a-state-nothing-writes.test.ts` reads source text, so it proves absence of
 * the *name*, not absence of a write. A value the code compares against is
 * mentioned, and therefore passes — which is exactly what
 * `settlements.RECONCILED`, `commission_payouts.FAILED` and
 * `agent_devices.APPROVED` all were: read by a query, written by nothing,
 * invisible to the check. Three ways of closing that from source were tried
 * and each either drowned in false positives or re-masked the case it was
 * built for.
 *
 * This closes it from the other end. Instead of asking what the code says, ask
 * the database what happened: record every value written to every enum column
 * while the suite runs, and compare that against what the schema allows.
 *
 * WHY TRIGGERS AND NOT A SCAN AT REST. The obvious cheap version — read the
 * distinct values in each column before each truncate — misses the states that
 * matter most. A transaction goes INITIATED, PAYMENT_INITIATED, PAYMENT_VERIFIED,
 * SETTLED inside one test; by the time anybody looks, only SETTLED is there.
 * The intermediate states are precisely the ones a reader would want proof of,
 * so the observation has to happen at the moment of the write.
 *
 * WHY A SEPARATE SCHEMA. `schema-audit.test.ts` fails when a table in `public`
 * is neither delete-protected nor classified as deliberately mutable, and it
 * is right to. This table is test scaffolding that must never exist in
 * production, so listing it as a decision about the production schema would be
 * a lie. Out of `public`, it is invisible to that audit and to `pg_dump` of
 * the application schema.
 *
 * Statement-level triggers with transition tables, so the cost is one extra
 * statement per modifying statement rather than one per row.
 */

import { pool } from '../db/pool';

export const OBSERVATION_SCHEMA = 'psirs_test_observations';

interface EnumColumn {
  table: string;
  column: string;
}

/** Every enum column the live schema declares, from its CHECK constraints. */
export async function enumColumns(db = pool): Promise<EnumColumn[]> {
  const { rows } = await db.query<{ table_name: string; definition: string }>(
    `SELECT c.relname AS table_name, pg_get_constraintdef(con.oid) AS definition
       FROM pg_constraint con
       JOIN pg_class c ON c.oid = con.conrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE con.contype = 'c' AND n.nspname = 'public'
        AND pg_get_constraintdef(con.oid) LIKE '%ANY (ARRAY%'
      ORDER BY c.relname, con.conname`,
  );

  const found: EnumColumn[] = [];
  for (const row of rows) {
    const column = /\(([a-z_]+) = ANY \(ARRAY/.exec(row.definition);
    // Lower-case sets — `usage_events.language` is 'en' and 'ha' — are values
    // of a different kind, not states anything transitions to.
    const hasStates = /'[A-Z][A-Z0-9_]*'::text/.test(row.definition);
    if (column && hasStates) found.push({ table: row.table_name, column: column[1] });
  }
  return found;
}

/** Which values each enum column allows, keyed `table.column`. */
export async function declaredValues(db = pool): Promise<Map<string, string[]>> {
  const { rows } = await db.query<{ table_name: string; definition: string }>(
    `SELECT c.relname AS table_name, pg_get_constraintdef(con.oid) AS definition
       FROM pg_constraint con
       JOIN pg_class c ON c.oid = con.conrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE con.contype = 'c' AND n.nspname = 'public'
        AND pg_get_constraintdef(con.oid) LIKE '%ANY (ARRAY%'`,
  );

  const declared = new Map<string, string[]>();
  for (const row of rows) {
    const column = /\(([a-z_]+) = ANY \(ARRAY/.exec(row.definition);
    if (!column) continue;
    const values = [...row.definition.matchAll(/'([A-Z][A-Z0-9_]*)'::text/g)].map((m) => m[1]);
    if (values.length > 0) declared.set(`${row.table_name}.${column[1]}`, values);
  }
  return declared;
}

/**
 * Put the observers in place, once per database.
 *
 * Every test file calls `startTestServer`, and a shard's files all share one
 * database, so this runs about thirty times against a database that only needs
 * it once. The count check makes the repeats a single cheap query.
 */
export async function installEnumObservers(): Promise<void> {
  const columns = await enumColumns();
  const tables = [...new Set(columns.map((c) => c.table))];

  const { rows: existing } = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n
       FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      WHERE t.tgname LIKE 'observe_enum_%' AND NOT t.tgisinternal`,
  );
  if (Number.parseInt(existing[0]!.n, 10) === tables.length * 2) return;

  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${OBSERVATION_SCHEMA}`);
  await pool.query(
    `CREATE TABLE IF NOT EXISTS ${OBSERVATION_SCHEMA}.enum_writes (
       table_name  text NOT NULL,
       column_name text NOT NULL,
       value       text NOT NULL,
       PRIMARY KEY (table_name, column_name, value)
     )`,
  );

  for (const table of tables) {
    const mine = columns.filter((c) => c.table === table);
    const branches = mine
      .map(
        (c) =>
          `SELECT '${table}', '${c.column}', "${c.column}"::text
             FROM new_rows WHERE "${c.column}" IS NOT NULL`,
      )
      .join(' UNION ');

    // A separate function per table, generated with static SQL: a transition
    // table cannot be reached from dynamic SQL, and generating once is faster
    // than deciding on every statement.
    await pool.query(
      `CREATE OR REPLACE FUNCTION ${OBSERVATION_SCHEMA}.observe_${table}()
         RETURNS trigger LANGUAGE plpgsql AS $observer$
       BEGIN
         INSERT INTO ${OBSERVATION_SCHEMA}.enum_writes (table_name, column_name, value)
         ${branches}
         ON CONFLICT DO NOTHING;
         RETURN NULL;
       END $observer$`,
    );

    for (const [suffix, event] of [['ins', 'INSERT'], ['upd', 'UPDATE']] as const) {
      await pool.query(`DROP TRIGGER IF EXISTS observe_enum_${suffix} ON ${table}`);
      await pool.query(
        `CREATE TRIGGER observe_enum_${suffix} AFTER ${event} ON ${table}
           REFERENCING NEW TABLE AS new_rows
           FOR EACH STATEMENT EXECUTE FUNCTION ${OBSERVATION_SCHEMA}.observe_${table}()`,
      );
    }
  }
}

/** What this database saw written, keyed `table.column`. */
export async function observedValues(db = pool): Promise<Map<string, Set<string>>> {
  const { rows } = await db.query<{ table_name: string; column_name: string; value: string }>(
    `SELECT table_name, column_name, value FROM ${OBSERVATION_SCHEMA}.enum_writes`,
  );
  const observed = new Map<string, Set<string>>();
  for (const row of rows) {
    const key = `${row.table_name}.${row.column_name}`;
    if (!observed.has(key)) observed.set(key, new Set());
    observed.get(key)!.add(row.value);
  }
  return observed;
}
