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
/**
 * Postgres codes that mean "this transaction lost a race; run it again".
 *
 * 40001 is a serialization failure and 40P01 a detected deadlock. Neither says
 * the work was wrong — the database has already rolled the transaction back and
 * is asking for a retry. Surfacing them to a caller turns a routine outcome of
 * SERIALIZABLE into an error an agent reads as "the payment failed", at exactly
 * the moment they are asking whether a payment went through.
 */
const RETRYABLE_CONFLICT_CODES = new Set(['40001', '40P01']);

function isRetryableConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    RETRYABLE_CONFLICT_CODES.has(String((error as { code?: unknown }).code))
  );
}

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
  options: {
    isolationLevel?: 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';
    /**
     * Re-run the callback when the database reports a conflict.
     *
     * Off by default and deliberately opt-in: a retry runs `fn` a second time,
     * which is only safe when everything it does is inside this transaction.
     * A callback that also sends an SMS or writes a file would repeat that,
     * and the caller is the only one who knows.
     */
    retryOnConflict?: boolean;
  } = {},
): Promise<T> {
  // Ten, not three. Confirmation appends to the audit chain, and the chain is
  // a hash of its predecessor: every concurrent confirmation reads the same
  // tail and then writes past it, which is a read/write dependency SERIALIZABLE
  // is obliged to abort. The chain's own advisory lock means the retries do
  // make progress rather than colliding for ever — but with a dozen agents
  // confirming at once, three attempts is not enough to get through them.
  const attempts = options.retryOnConflict ? 10 : 1;

  for (let attempt = 1; ; attempt += 1) {
    const client = await pool.connect();
    try {
      await client.query(`BEGIN ISOLATION LEVEL ${options.isolationLevel ?? 'READ COMMITTED'}`);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        log.error('rollback failed', { component: 'db', error: rollbackError });
      }
      if (attempt >= attempts || !isRetryableConflict(error)) throw error;
      log.warn('transaction conflict, retrying', {
        component: 'db',
        attempt,
        code: String((error as { code?: unknown }).code),
      });
      // Back off with jitter, so two transactions that just collided do not
      // wake together and collide again.
      // Capped: the wait only has to outlast the transaction ahead in the
      // queue, and doubling unchecked would put a confirmation to sleep for
      // seconds while an agent watches the screen.
      const backoffMs = Math.min(250, 10 * 2 ** (attempt - 1)) * (1 + Math.random());
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    } finally {
      client.release();
    }
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
 * The result is a discriminated object rather than `T | null`, because `null`
 * is a perfectly ordinary thing for a job to return — most of these return it
 * to mean "ran, nothing worth reporting". Collapsing the two made a job that
 * did its work and found nothing to do indistinguishable from one that never
 * ran, and the caller recorded neither its timing nor its liveness. Worker
 * monitoring then had no reading for exactly the workers that were quietly
 * healthy, which is the opposite of what it is for.
 */
export type JobOutcome<T> = { ran: false } | { ran: true; value: T };

export async function withJobLock<T>(name: string, fn: () => Promise<T>): Promise<JobOutcome<T>> {
  const client = await pool.connect();
  try {
    const acquired = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock($1, hashtext($2)) AS locked',
      [LOCK_NAMESPACE.WORKER, name],
    );
    if (!acquired.rows[0]?.locked) return { ran: false };

    try {
      return { ran: true, value: await fn() };
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
