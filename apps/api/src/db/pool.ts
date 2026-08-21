/**
 * PostgreSQL access.
 *
 * Two rules hold everywhere in the financial code:
 *   1. Money crosses the driver boundary as a string, never a JS number.
 *      `pg` parses BIGINT (oid 20) as a string by default; we make that
 *      explicit rather than relying on the default, and convert to bigint in
 *      the mapping layer.
 *   2. Anything that changes financial state runs inside `withTransaction`,
 *      so a partial write cannot leave a transaction paid but unreceipted.
 */

import { Pool, types, type PoolClient, type QueryResultRow } from 'pg';
import { config } from '../config';
import { log } from '../lib/logger';

// int8/BIGINT -> string. Losing precision on money would be silent otherwise.
types.setTypeParser(types.builtins.INT8, (value) => value);
// numeric -> string, for the same reason (geolocation, scores, variances).
types.setTypeParser(types.builtins.NUMERIC, (value) => value);

export const pool = new Pool({
  connectionString: config.database.url,
  max: config.database.poolSize,
  statement_timeout: config.database.statementTimeoutMs,
  application_name: 'psirs-revenue-platform',
});

pool.on('error', (error) => {
  // An idle client erroring out must never take the process down silently.
  log.error('idle client error', { component: 'db', error });
});

export type Db = Pool | PoolClient;

export async function query<T extends QueryResultRow = QueryResultRow>(
  db: Db,
  text: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const result = await db.query<T>(text, params as unknown[]);
  return result.rows;
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  db: Db,
  text: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(db, text, params);
  return rows[0] ?? null;
}

/**
 * Run `fn` inside a database transaction, rolling back on any throw.
 *
 * `isolationLevel` defaults to READ COMMITTED. Payment verification and
 * commission accrual use SERIALIZABLE where a phantom read would allow a
 * double credit.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
  options: { isolationLevel?: 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE' } = {},
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query(
      `BEGIN ISOLATION LEVEL ${options.isolationLevel ?? 'READ COMMITTED'}`,
    );
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      log.error('rollback failed', { component: 'db', error: rollbackError });
    }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Serialise concurrent work on one logical resource.
 *
 * Used where uniqueness alone is not enough — for example two webhook
 * deliveries for the same payment arriving simultaneously, where both would
 * otherwise read "not yet verified" and both proceed to verify.
 * The lock is transaction-scoped and released on COMMIT or ROLLBACK.
 */
export async function advisoryLock(client: PoolClient, namespace: number, key: string): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [namespace, key]);
}

export const LOCK_NAMESPACE = {
  PAYMENT: 1,
  COMMISSION: 2,
  RECEIPT: 3,
  AUDIT_CHAIN: 4,
  IDEMPOTENCY: 5,
  RECONCILIATION: 6,
  /** Scheduled jobs: one instance runs each sweep, however many are deployed. */
  WORKER: 7,
  /** Schema migration, so simultaneous boots do not race each other. */
  MIGRATION: 8,
} as const;

/**
 * Run something exactly once across every instance, or not at all.
 *
 * The background workers were `setInterval` timers guarded by a module-level
 * boolean, which is a correct guard for one process and no guard at all for
 * the second replica. Behind a load balancer that meant N reconciliation
 * sweeps every six hours, each asking the gateway about every payment
 * reference in a 48-hour window.
 *
 * `pg_try_advisory_lock` returns immediately rather than queueing: a sweep
 * another instance is already running does not need to be run again afterwards,
 * it needs to be skipped. The lock is session-scoped rather than
 * transaction-scoped because these jobs open and close many transactions, so
 * it is released explicitly and in a `finally`.
 *
 * Returns null when another instance holds the lock.
 */
export async function withJobLock<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
  const client = await pool.connect();
  try {
    const acquired = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock($1, hashtext($2)) AS locked',
      [LOCK_NAMESPACE.WORKER, name],
    );
    if (!acquired.rows[0]?.locked) return null;

    try {
      return await fn();
    } finally {
      await client
        .query('SELECT pg_advisory_unlock($1, hashtext($2))', [LOCK_NAMESPACE.WORKER, name])
        .catch(() => undefined);
    }
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
