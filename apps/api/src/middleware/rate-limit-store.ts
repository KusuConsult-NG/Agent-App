/**
 * Where the rate limiter keeps its counts.
 *
 * The limiter used to hold them in a process-local Map. That is a correct
 * limiter for one process and no limiter at all for the second: with N
 * instances behind a load balancer the effective cap is N times the number the
 * response advertises in `x-ratelimit-limit`.
 *
 * PostgreSQL rather than Redis, because the platform's stated shape is that
 * the only state is PostgreSQL — sessions are already database-backed and the
 * background jobs already take advisory locks there. A Redis is one more thing
 * to provision, secure, back up and watch, and it would be the only component
 * whose quiet loss weakens a security control without anything failing. If
 * throughput ever demands one it slots in behind this same interface.
 *
 * Two properties matter more than the storage choice, and both are here:
 *
 *   - **A refused caller costs one round trip, not one per request.** The
 *     original in-process comment warned that a limiter querying the database
 *     per request "would let an unauthenticated flood cost a database round
 *     trip each, which is the thing it is here to prevent". That warning is
 *     right, and `PostgresBucketStore` answers it by remembering locally which
 *     keys are already over their limit until their window ends. A flood pays
 *     for its first request and is refused from memory thereafter — cheaper
 *     under load than the Map it replaces, not dearer.
 *
 *   - **It fails open, and says so.** A limiter that turns a database hiccup
 *     into a statewide outage has done more damage than the leak it closes.
 *     On an error the request is allowed and the failure is logged at warn.
 *     Account lockout still holds underneath, in the same database, on the one
 *     path where being wrong would actually cost money.
 */

import { createHash } from 'node:crypto';

import { pool, query } from '../db/pool';
import { log } from '../lib/logger';

/**
 * The longest key that is certainly storable.
 *
 * `rate_limit_buckets.key` is the primary key, so it carries a btree index, and
 * a btree tuple cannot exceed 2704 bytes. Part of a key is attacker-controlled:
 * on an `ip`-keyed surface it is `req.clientIp`, and behind a load balancer
 * (`TRUST_PROXY=true`, which is the recommended topology) Express takes that
 * from `X-Forwarded-For` — a header the caller sends. Express splits the header
 * on commas but does not otherwise bound it, so a comma-free multi-kilobyte
 * value arrives in `req.ip` whole.
 *
 * Left unbounded that is a bypass rather than an error: the oversized key fails
 * the insert, the store fails open by design, and the caller is allowed every
 * time — unlimited requests on exactly the public surfaces the tight caps exist
 * to protect. So a key that could not be stored is folded to one that can be,
 * rather than being allowed to fail.
 *
 * 512 is well under the limit with room for multi-byte UTF-8 in the prefix.
 */
const MAX_KEY_BYTES = 512;

/**
 * Fold an over-long key into a bounded one, deterministically.
 *
 * The readable head is kept so a key remains recognisable in a query or a log,
 * and a SHA-256 of the whole distinguishes two keys that share it. Callers that
 * were already short — every legitimate one — are returned untouched, so this
 * changes no existing bucket.
 */
export function boundKey(key: string): string {
  if (Buffer.byteLength(key, 'utf8') <= MAX_KEY_BYTES) return key;
  const digest = createHash('sha256').update(key, 'utf8').digest('hex');
  // Slice by characters on a byte-bounded prefix: `slice` never splits a
  // surrogate pair mid-character, so the result is always valid UTF-8.
  return `${key.slice(0, 128)}#${digest}`;
}

/** What one counted request did to its bucket. */
export interface BucketState {
  /** Requests counted in this window, including the one just counted. */
  count: number;
  /** When the window ends, in epoch milliseconds. */
  resetAt: number;
}

export interface RateLimitStore {
  /**
   * Count one request against `key` and report the bucket afterwards.
   *
   * Starts a fresh window when there is none or the previous one has ended.
   * Never throws: a store that cannot reach its backing service reports the
   * request as allowed rather than failing the request.
   */
  hit(key: string, windowMs: number, max: number): Promise<BucketState>;
}

/* ------------------------------------------------------------------------ */

/**
 * One process, one Map. Correct for development, for the test suite, and for
 * any deployment that runs exactly one instance.
 */
export class MemoryBucketStore implements RateLimitStore {
  private readonly buckets = new Map<string, BucketState>();

  constructor() {
    // Bounded sweep so the map cannot grow without limit under a spray of IPs.
    setInterval(() => this.sweep(), 60_000).unref();
  }

  // `max` is unused here — with one process there is nothing to short-circuit,
  // the count is already local. It stays in the signature so the two stores
  // are substitutable and the interface remains the one description of a hit.
  async hit(key: string, windowMs: number, _max?: number): Promise<BucketState> {
    const now = Date.now();
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;
    return { count: bucket.count, resetAt: bucket.resetAt };
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }

  /** Test seam: forget everything, so one case cannot bleed into the next. */
  reset(): void {
    this.buckets.clear();
  }
}

/* ------------------------------------------------------------------------ */

/**
 * Counts shared through PostgreSQL, so N instances enforce one limit.
 *
 * The increment is a single `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`.
 * One statement rather than a read and a write, because two concurrent
 * requests either side of a read would each see the same count and each
 * decide they were under it. `ON CONFLICT DO UPDATE` takes a row lock, so
 * concurrent hits on one key serialise and the count is exact.
 *
 * The same statement handles window rollover: if the stored `reset_at` has
 * passed, the row restarts at one rather than accumulating for ever. Expired
 * rows are therefore self-healing on next use, and the sweep exists only for
 * keys nobody comes back to.
 */
export class PostgresBucketStore implements RateLimitStore {
  /**
   * Keys known to be over their limit, and when that stops being true.
   *
   * This is the answer to the round-trip warning. A caller who is already
   * refused does not need the database consulted again to be refused a second
   * time — the count is past `max` and nothing in the window can bring it
   * back under. So the first refusal is recorded here and every subsequent
   * request in that window is answered from memory.
   *
   * It only ever suppresses requests that were going to be refused anyway, so
   * a stale entry cannot let a caller through; the entry is dropped the moment
   * its window ends.
   */
  private readonly blockedUntil = new Map<string, number>();

  constructor() {
    setInterval(() => this.sweepBlocked(), 60_000).unref();
  }

  async hit(rawKey: string, windowMs: number, max: number): Promise<BucketState> {
    const now = Date.now();
    // Bounded before anything else, so an attacker-controlled key cannot reach
    // the failure path and be allowed through it. See `boundKey`.
    const key = boundKey(rawKey);

    const blockedUntil = this.blockedUntil.get(key);
    if (blockedUntil !== undefined && blockedUntil > now) {
      // Already over the limit for this window. Report a count past `max`
      // without asking the database again.
      return { count: max + 1, resetAt: blockedUntil };
    }

    try {
      const rows = await query<{ count: number; reset_at: Date }>(
        pool,
        `INSERT INTO rate_limit_buckets (key, count, reset_at)
              VALUES ($1, 1, now() + ($2::numeric / 1000) * interval '1 second')
         ON CONFLICT (key) DO UPDATE
                 SET count = CASE
                               WHEN rate_limit_buckets.reset_at <= now() THEN 1
                               ELSE rate_limit_buckets.count + 1
                             END,
                     reset_at = CASE
                                  WHEN rate_limit_buckets.reset_at <= now()
                                    THEN now() + ($2::numeric / 1000) * interval '1 second'
                                  ELSE rate_limit_buckets.reset_at
                                END
           RETURNING count, reset_at`,
        [key, windowMs],
      );

      const row = rows[0];
      if (!row) {
        // RETURNING on an upsert always yields a row; treat its absence the
        // same as an error rather than inventing a count.
        return { count: 1, resetAt: now + windowMs };
      }

      const state = { count: row.count, resetAt: row.reset_at.getTime() };
      if (state.count > max) this.blockedUntil.set(key, state.resetAt);
      return state;
    } catch (error) {
      // Fail open. The alternative is refusing collection statewide because
      // one bookkeeping table was unreachable.
      log.warn('rate limit store unavailable; allowing the request', {
        component: 'rate-limit',
        error: error instanceof Error ? error.message : String(error),
      });
      return { count: 1, resetAt: now + windowMs };
    }
  }

  private sweepBlocked(): void {
    const now = Date.now();
    for (const [key, until] of this.blockedUntil) {
      if (until <= now) this.blockedUntil.delete(key);
    }
  }

  /** Test seam, mirroring `MemoryBucketStore.reset`. */
  reset(): void {
    this.blockedUntil.clear();
  }
}

/* ------------------------------------------------------------------------ */

/**
 * Delete buckets whose window ended and which nothing has touched since.
 *
 * A live key never needs this — the upsert restarts its window in place — so
 * this only collects addresses that appeared once and went away. Run from the
 * `rate-limit-sweep` background job, which holds an advisory lock, so one
 * instance does the deleting however many are deployed.
 */
export async function sweepExpiredBuckets(): Promise<number> {
  const rows = await query<{ key: string }>(
    pool,
    `DELETE FROM rate_limit_buckets WHERE reset_at <= now() RETURNING key`,
  );
  return rows.length;
}
