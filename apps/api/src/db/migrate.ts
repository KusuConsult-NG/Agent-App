/**
 * Migration runner.
 *
 * Migrations are plain SQL applied in filename order, each in its own
 * transaction, recorded with a checksum. If a file that has already been
 * applied is edited, the checksum no longer matches and the runner refuses to
 * continue: on a platform where the schema *is* the financial control, an
 * unnoticed divergence between environments is a real risk.
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config';
import { describeDatabase } from '../env';
import { pool, query, withTransaction, closePool, LOCK_NAMESPACE } from './pool';

const MIGRATIONS_DIR = join(__dirname, 'migrations');

interface AppliedMigration {
  filename: string;
  checksum: string;
}

async function ensureMigrationsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id          SERIAL PRIMARY KEY,
      filename    TEXT NOT NULL UNIQUE,
      checksum    TEXT NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      duration_ms INTEGER NOT NULL
    )
  `);
}

function checksumOf(contents: string): string {
  return createHash('sha256').update(contents).digest('hex');
}

/**
 * Apply pending migrations, holding a lock so only one process does.
 *
 * Without the lock, two instances starting together both read the applied set,
 * both decide the same file is pending, and both run it. One wins and the other
 * dies on "relation already exists" — safe, because DDL is transactional in
 * PostgreSQL and nothing is left half-applied, but a rolling deploy then
 * crash-loops its replicas until the first finishes.
 *
 * `pg_advisory_lock` queues rather than failing: the second instance waits,
 * then finds the schema already current and applies nothing. The lock is held
 * on a dedicated connection for the whole run and released in a `finally`,
 * including when a migration throws.
 */
export async function runMigrations(options: { silent?: boolean } = {}): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1, $2)', [LOCK_NAMESPACE.MIGRATION, 0]);
    return await applyMigrations(options);
  } finally {
    await client
      .query('SELECT pg_advisory_unlock($1, $2)', [LOCK_NAMESPACE.MIGRATION, 0])
      .catch(() => undefined);
    client.release();
  }
}

/**
 * Migrations that were applied under one name and now live under another.
 *
 * A rename is invisible to the runner in both directions: the recorded row
 * goes on naming a file nobody has, and the file under its new name looks
 * unapplied and is applied a second time. Seven were renumbered from 055-061
 * to 068-074 when another branch took those ordinals first, so every database
 * that had the old names — `psirs_test` and all four shards — ran that SQL
 * twice. It was harmless because these files are `IF NOT EXISTS` throughout,
 * which is luck rather than a property anybody checked, and the schemas do
 * still agree.
 *
 * Recorded rather than made everybody's problem. The check below refuses an
 * applied migration with no file, and would refuse these on every existing
 * database; the alternative to naming them is telling each holder of one to
 * drop it. Each entry is verified against the files on disk, so an entry whose
 * target has itself been renamed fails rather than quietly excusing nothing.
 */
export const RENAMED: Record<string, string> = {
  '055_what_is_connected_to_this_person.sql': '068_what_is_connected_to_this_person.sql',
  '056_the_employer_who_deducts.sql': '069_the_employer_who_deducts.sql',
  '057_a_schedule_that_can_be_defended.sql': '070_a_schedule_that_can_be_defended.sql',
  '058_what_the_agent_saw_and_what_it_cost.sql': '071_what_the_agent_saw_and_what_it_cost.sql',
  '059_a_count_taken_where_there_is_no_signal.sql':
    '072_a_count_taken_where_there_is_no_signal.sql',
  '060_what_the_agent_was_told.sql': '073_what_the_agent_was_told.sql',
  '061_a_citizen_asking_for_their_own_statement.sql':
    '074_a_citizen_asking_for_their_own_statement.sql',
};

/**
 * Every applied migration is still in the repository.
 *
 * The checksum above holds an applied migration to its contents. Nothing held
 * it to existing: the loop walks the files on disk, so a row naming a file
 * that has been deleted or renamed is never visited and never mentioned.
 * Measured on a scratch database — insert a row for a filename nobody has, run
 * again, and the runner answers "schema is up to date" and exits 0.
 *
 * What that costs is the ability to rebuild a database from the repository and
 * get the one that is deployed. A row nobody can produce is a schema change
 * nobody can review, reproduce or roll back.
 */
export function assertEveryAppliedMigrationIsStillHere(
  appliedByName: Map<string, string>,
  onDisk: string[],
): void {
  const files = new Set(onDisk);

  const staleExcuse = Object.entries(RENAMED).filter(([, to]) => !files.has(to));
  if (staleExcuse.length > 0) {
    throw new Error(
      `RENAMED names a migration that is not on disk: ${staleExcuse
        .map(([from, to]) => `${from} -> ${to}`)
        .join(', ')}. The excuse is stale; correct it rather than leaving it.`,
    );
  }

  const missing = [...appliedByName.keys()].filter(
    (filename) => !files.has(filename) && !(filename in RENAMED),
  );
  if (missing.length > 0) {
    throw new Error(
      `${missing.length} applied migration(s) are no longer in the repository: ` +
        `${missing.join(', ')}. This database cannot be rebuilt from these sources. ` +
        'Restore the file, or record the rename in RENAMED in this file with the reason.',
    );
  }
}

async function applyMigrations(options: { silent?: boolean }): Promise<number> {
  const log = options.silent ? () => {} : (message: string) => console.log(message);

  await ensureMigrationsTable();

  const applied = await query<AppliedMigration>(
    pool,
    'SELECT filename, checksum FROM schema_migrations',
  );
  const appliedByName = new Map(applied.map((row) => [row.filename, row.checksum]));

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  assertEveryAppliedMigrationIsStillHere(appliedByName, files);

  let count = 0;

  for (const filename of files) {
    const contents = readFileSync(join(MIGRATIONS_DIR, filename), 'utf8');
    const checksum = checksumOf(contents);
    const previous = appliedByName.get(filename);

    if (previous !== undefined) {
      if (previous !== checksum) {
        throw new Error(
          `Migration ${filename} has changed since it was applied ` +
            `(recorded ${previous.slice(0, 12)}, found ${checksum.slice(0, 12)}). ` +
            'Applied migrations are immutable — add a new migration instead.',
        );
      }
      continue;
    }

    const startedAt = Date.now();
    await withTransaction(async (client) => {
      // A migration that decides something at run time — skipping a VALIDATE
      // because existing rows would fail it, say — says so with RAISE NOTICE
      // or RAISE WARNING. Those go to the connection, not to stdout, so
      // without this listener the decision is made and nobody is told.
      const relay = (notice: { severity?: string; message?: string }) => {
        if (!notice.message) return;
        log(`  [${(notice.severity ?? 'NOTICE').toLowerCase()}] ${notice.message}`);
      };
      client.on('notice', relay);
      try {
        await client.query(contents);
        await client.query(
          'INSERT INTO schema_migrations (filename, checksum, duration_ms) VALUES ($1, $2, $3)',
          [filename, checksum, Date.now() - startedAt],
        );
      } finally {
        client.off('notice', relay);
      }
    });

    log(`  applied ${filename} (${Date.now() - startedAt}ms)`);
    count += 1;
  }

  if (count === 0) log('  schema is up to date');
  return count;
}

if (require.main === module) {
  // Name the target before touching it. Without this the runner was silent
  // about which database it had picked, so a `.env` that was never read looked
  // exactly like one that was.
  console.log(`Running migrations against ${describeDatabase(config.database.url)}...`);
  runMigrations()
    .then(async (count) => {
      console.log(`Done. ${count} migration(s) applied.`);
      await closePool();
    })
    .catch(async (error) => {
      console.error('Migration failed:', error instanceof Error ? error.message : error);
      await closePool();
      process.exit(1);
    });
}
