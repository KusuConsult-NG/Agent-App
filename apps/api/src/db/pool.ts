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
  console.error('[db] idle client error', error);
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
      console.error('[db] rollback failed', rollbackError);
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
} as const;

export async function closePool(): Promise<void> {
  await pool.end();
}
