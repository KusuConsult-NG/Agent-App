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
