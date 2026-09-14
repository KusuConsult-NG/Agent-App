/**
 * A rate limit has to mean the same thing however many instances are running.
 *
 * The limiter kept its counts in a process-local Map. That is a correct
 * limiter for one process and no limiter at all for the second: two instances
 * behind a load balancer each enforce the full cap, so the number the platform
 * advertises in `x-ratelimit-limit` is half what it actually allows. The
 * recommended topology is two or more replicas, so this was wrong in the
 * shape the platform is meant to be deployed in, not in an exotic one.
 *
 * What the leak costs is specific. The tight caps are on public surfaces —
 * enumerating TINs, guessing receipt codes, farming agent applications — and
 * those are precisely the budgets an attacker gets to double. Account lockout
 * is database-backed and bounded the damage, but a cap the platform states and
 * does not hold is a lie told to every caller.
 *
 * These cases drive two stores through one interface. The memory store is what
 * a single instance and the test suite use; the Postgres store is what
 * production requires. The point of testing both is that the *policy* must be
 * identical — only the storage moves.
 */

import './env';

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import { pool, query } from '../db/pool';
import {
  MemoryBucketStore,
  PostgresBucketStore,
  sweepExpiredBuckets,
} from '../middleware/rate-limit-store';

/** Unique per run, so a re-run does not inherit the previous one's counts. */
const ns = `test-${process.pid}-${Date.now()}`;
const key = (name: string) => `${ns}:${name}`;

describe('a rate limit holds across instances', () => {
  before(async () => {
    // The store's table is created by migration 051; fail loudly rather than
    // silently passing if the suite is run against an un-migrated database.
    const rows = await query<{ exists: boolean }>(
      pool,
      `SELECT to_regclass('public.rate_limit_buckets') IS NOT NULL AS exists`,
    );
    assert.equal(rows[0]?.exists, true, 'migration 051 has not been applied');
  });

  after(async () => {
    await query(pool, `DELETE FROM rate_limit_buckets WHERE key LIKE $1`, [`${ns}:%`]);
  });

  describe('the memory store', () => {
    let store: MemoryBucketStore;
    beforeEach(() => {
      store = new MemoryBucketStore();
    });

    it('counts each hit against its key', async () => {
      const k = key('memory-counts');
      assert.equal((await store.hit(k, 60_000, 5)).count, 1);
      assert.equal((await store.hit(k, 60_000, 5)).count, 2);
      assert.equal((await store.hit(k, 60_000, 5)).count, 3);
    });

    it('keeps separate keys apart', async () => {
      await store.hit(key('memory-a'), 60_000, 5);
      await store.hit(key('memory-a'), 60_000, 5);
      assert.equal(
        (await store.hit(key('memory-b'), 60_000, 5)).count,
        1,
        'one caller must not spend the budget of another',
      );
    });

    it('starts a fresh window once the old one has passed', async () => {
      const k = key('memory-window');
      // A window of zero has already ended by the time the next hit lands.
      assert.equal((await store.hit(k, 0, 5)).count, 1);
      assert.equal((await store.hit(k, 0, 5)).count, 1, 'the window should have rolled over');
    });

    it('does not hold a count for the next process', async () => {
      const k = key('memory-not-shared');
      await new MemoryBucketStore().hit(k, 60_000, 5);
      assert.equal(
        (await new MemoryBucketStore().hit(k, 60_000, 5)).count,
        1,
        'this is the defect: a second instance starts the count again',
      );
    });
  });

  describe('the Postgres store', () => {
    it('counts each hit against its key', async () => {
      const store = new PostgresBucketStore();
      const k = key('pg-counts');
      assert.equal((await store.hit(k, 60_000, 5)).count, 1);
      assert.equal((await store.hit(k, 60_000, 5)).count, 2);
      assert.equal((await store.hit(k, 60_000, 5)).count, 3);
    });

    it('keeps separate keys apart', async () => {
      const store = new PostgresBucketStore();
      await store.hit(key('pg-a'), 60_000, 5);
      await store.hit(key('pg-a'), 60_000, 5);
      assert.equal((await store.hit(key('pg-b'), 60_000, 5)).count, 1);
    });

    /**
     * The defect, stated as the property that fixes it.
     *
     * Two stores are two instances: separate objects, separate local state,
     * one database. The count must continue rather than restart.
     */
    it('carries the count from one instance to the next', async () => {
      const k = key('pg-shared');
      const instanceOne = new PostgresBucketStore();
      const instanceTwo = new PostgresBucketStore();

      assert.equal((await instanceOne.hit(k, 60_000, 10)).count, 1);
      assert.equal(
        (await instanceTwo.hit(k, 60_000, 10)).count,
        2,
        'the second instance must see what the first counted',
      );
      assert.equal((await instanceOne.hit(k, 60_000, 10)).count, 3);
    });

    /**
     * The cap is the cap, not the cap times the number of replicas.
     *
     * Four instances spend one budget of six between them; the seventh request
     * is over the limit whichever instance receives it.
     */
    it('enforces one budget across several instances', async () => {
      const k = key('pg-one-budget');
      const MAX = 6;
      const instances = [
        new PostgresBucketStore(),
        new PostgresBucketStore(),
        new PostgresBucketStore(),
        new PostgresBucketStore(),
      ];

      const counts: number[] = [];
      for (let i = 0; i < MAX; i++) {
        const instance = instances[i % instances.length]!;
        counts.push((await instance.hit(k, 60_000, MAX)).count);
      }
      assert.deepEqual(counts, [1, 2, 3, 4, 5, 6], 'the count is shared, so it climbs once');

      const over = await instances[0]!.hit(k, 60_000, MAX);
      assert.ok(over.count > MAX, 'the next request must be over the limit on any instance');
    });

    /**
     * Concurrent hits must not lose counts.
     *
     * A read-then-write limiter would let two simultaneous requests both read
     * the same count and both write one more than it, so the bucket would
     * advance by one instead of two. The increment is a single upsert for
     * exactly this reason, and this case is what proves it.
     */
    it('loses no count when requests arrive together', async () => {
      const k = key('pg-concurrent');
      const store = new PostgresBucketStore();
      const CONCURRENT = 20;

      await Promise.all(
        Array.from({ length: CONCURRENT }, () => store.hit(k, 60_000, CONCURRENT * 2)),
      );

      const rows = await query<{ count: number }>(
        pool,
        `SELECT count FROM rate_limit_buckets WHERE key = $1`,
        [k],
      );
      assert.equal(rows[0]?.count, CONCURRENT, 'every concurrent hit must be counted exactly once');
    });

    it('starts a fresh window once the old one has passed', async () => {
      const k = key('pg-window');
      const store = new PostgresBucketStore();
      assert.equal((await store.hit(k, 0, 5)).count, 1);
      assert.equal((await store.hit(k, 0, 5)).count, 1, 'the window should have rolled over');
    });

    /**
     * A refused caller must not cost a database round trip per request.
     *
     * This is the warning the original in-process limiter carried: making an
     * unauthenticated flood cost a query each hands an attacker the thing the
     * limiter exists to deny. Once a key is over its limit nothing in the
     * window can bring it back under, so the refusal is remembered locally and
     * the database is not asked again.
     */
    it('refuses a flood without going back to the database', async () => {
      const k = key('pg-flood');
      const store = new PostgresBucketStore();
      const MAX = 3;

      for (let i = 0; i < MAX + 1; i++) await store.hit(k, 60_000, MAX);

      const [before] = await query<{ count: number }>(
        pool,
        `SELECT count FROM rate_limit_buckets WHERE key = $1`,
        [k],
      );

      // The flood: a hundred more requests from a caller already refused.
      for (let i = 0; i < 100; i++) {
        const state = await store.hit(k, 60_000, MAX);
        assert.ok(state.count > MAX, 'every one of them must still be refused');
      }

      const [after] = await query<{ count: number }>(
        pool,
        `SELECT count FROM rate_limit_buckets WHERE key = $1`,
        [k],
      );
      assert.equal(
        after?.count,
        before?.count,
        'the stored count must not move: the flood was answered from memory',
      );
    });

    /**
     * A bookkeeping table being unreachable must not stop collection.
     *
     * Failing closed here would turn a Postgres hiccup into a statewide
     * outage, which is worse than the leak this store exists to close.
     * Account lockout still holds underneath on the one path where being
     * wrong costs money.
     */
    it('allows the request when the store cannot be reached', async () => {
      const store = new PostgresBucketStore();
      // A NUL byte cannot be represented in a Postgres `text` value, so the
      // statement fails inside the driver — a real store failure rather than a
      // value the query happens to reject. (A merely long key does not do
      // this: repeated bytes compress, and the insert succeeds.)
      const impossible = `${key('pg-unreachable')}${String.fromCharCode(0)}x`;
      const state = await store.hit(impossible, 60_000, 5);
      assert.equal(state.count, 1, 'a failed store reports the request as allowed');
      assert.ok(state.resetAt > Date.now(), 'and gives the caller a window that has not passed');
    });
  });

  describe('the sweep', () => {
    it('collects buckets whose window has ended and leaves live ones alone', async () => {
      const expired = key('sweep-expired');
      const live = key('sweep-live');
      const store = new PostgresBucketStore();

      await store.hit(expired, 0, 5); // already over
      await store.hit(live, 60_000, 5); // still open

      await sweepExpiredBuckets();

      const rows = await query<{ key: string }>(
        pool,
        `SELECT key FROM rate_limit_buckets WHERE key = ANY($1)`,
        [[expired, live]],
      );
      const keys = rows.map((r) => r.key);
      assert.ok(!keys.includes(expired), 'an ended window should be collected');
      assert.ok(keys.includes(live), 'an open one must be left alone');
    });
  });
});
