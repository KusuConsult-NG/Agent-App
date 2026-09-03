/**
 * Certification rev10 — adversarial audit of the shared rate limiter.
 *
 * These are attack cases, not confirmation cases. Each one ASSERTS the property
 * that must hold for the control to work, so a passing test means the system
 * held and a FAILING test is a defect the auditor found and left standing.
 *
 * Store under audit:
 *   - apps/api/src/middleware/rate-limit-store.ts  (PostgresBucketStore)
 *   - apps/api/src/middleware/security.ts           (rateLimit(), key building)
 *   - apps/api/src/db/migrations/051_shared_rate_limit_buckets.sql
 *
 * Run against the shared, migrated database (NOT psirs_test):
 *   cd apps/api && DATABASE_URL=postgres://postgres:postgres@localhost:5432/psirs \
 *     npx tsx --test --test-concurrency=1 src/tests/certification-rev10-rate-limit.test.ts
 *
 * Only rows keyed `audit-rl-*` are written, and only those are deleted.
 */

import './env';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';

import { pool, query } from '../db/pool';
import { PostgresBucketStore, sweepExpiredBuckets } from '../middleware/rate-limit-store';
import { requestContext } from '../middleware/context';
import { issueAccessToken } from '../lib/access-token';

/** Every key this file writes starts here, so cleanup can be exact. */
const NS = `audit-rl-r10-${process.pid}-${Date.now()}`;
const k = (name: string) => `${NS}:${name}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('certification rev10 — breaking the shared rate limiter', () => {
  before(async () => {
    const rows = await query<{ exists: boolean }>(
      pool,
      `SELECT to_regclass('public.rate_limit_buckets') IS NOT NULL AS exists`,
    );
    assert.equal(rows[0]?.exists, true, 'migration 051 has not been applied');
  });

  after(async () => {
    await query(pool, `DELETE FROM rate_limit_buckets WHERE key LIKE $1`, [`${NS}:%`]);
    // Belt-and-braces: any stray audit rows from an interrupted run.
    await query(pool, `DELETE FROM rate_limit_buckets WHERE key LIKE 'audit-rl-%'`);
  });

  /* ------------------------------------------------------------------ *
   * ATTACK 1 — Concurrency overshoot.
   * 50 truly concurrent hits, one key, max=10, across three instances.
   * The cap holds iff exactly 10 hits report count <= max and the stored
   * count lands at exactly 50 (no lost increments).
   * ------------------------------------------------------------------ */
  it('attack1: 50 concurrent hits across 3 instances leak no extra budget', async () => {
    const key = k('concurrency');
    const MAX = 10;
    const N = 50;
    const instances = [
      new PostgresBucketStore(),
      new PostgresBucketStore(),
      new PostgresBucketStore(),
    ];

    const states = await Promise.all(
      Array.from({ length: N }, (_v, i) => instances[i % instances.length]!.hit(key, 60_000, MAX)),
    );
    const counts = states.map((s) => s.count).sort((a, b) => a - b);
    const allowed = counts.filter((c) => c <= MAX).length;

    const [row] = await query<{ count: number }>(
      pool,
      `SELECT count FROM rate_limit_buckets WHERE key = $1`,
      [key],
    );

    assert.equal(row?.count, N, `stored count must be exactly ${N} (no lost increments)`);
    assert.equal(allowed, MAX, `exactly ${MAX} hits may report count<=max; got ${allowed} — cap leaked`);
    assert.deepEqual(counts, Array.from({ length: N }, (_v, i) => i + 1), 'counts must be the exact set 1..N');
  });

  /* ------------------------------------------------------------------ *
   * ATTACK 2 — the blocked cache.
   * (a) A stale blockedUntil must NOT refuse after the DB window rolled over.
   * (c) The cache must NEVER return an allow (count<=max); it only refuses.
   * ------------------------------------------------------------------ */
  it('attack2a: a stale blocked-cache does not refuse after the window rolls over', async () => {
    const key = k('cache-stale');
    const store = new PostgresBucketStore();
    const MAX = 2;
    const WINDOW = 300;

    // Drive over the limit so blockedUntil is set for this window.
    for (let i = 0; i < MAX + 1; i++) await store.hit(key, WINDOW, MAX);
    const refused = await store.hit(key, WINDOW, MAX);
    assert.ok(refused.count > MAX, 'the caller is refused from cache mid-window');

    // Let the window (and thus the cache entry) end, then come back.
    await sleep(WINDOW + 200);
    const fresh = await store.hit(key, WINDOW, MAX);
    assert.equal(
      fresh.count,
      1,
      'after the window rolled over the caller must start a fresh count, not be refused from a stale cache',
    );
  });

  it('attack2c: the local cache never converts a refusal into an allow', async () => {
    const key = k('cache-never-allows');
    const store = new PostgresBucketStore();
    const MAX = 3;
    for (let i = 0; i < MAX; i++) await store.hit(key, 60_000, MAX); // fill to the cap
    // Every subsequent same-window hit is served from cache and must be a refusal.
    for (let i = 0; i < 20; i++) {
      const s = await store.hit(key, 60_000, MAX);
      assert.ok(s.count > MAX, 'a cache-served hit must report over the limit, never an allow');
    }
  });

  /* ------------------------------------------------------------------ *
   * ATTACK 3 — FAIL-OPEN AS BYPASS (the headline finding).
   *
   * The store fails open on a DB error. An oversized key errors the INSERT
   * (btree index tuple > 2704 bytes), and the key is
   *   `${keyPrefix}:${identity}`  with identity = req.clientIp for keyBy:'ip'.
   * req.clientIp = req.ip, which under `trust proxy` is taken verbatim from
   * X-Forwarded-For — an attacker-controlled string of any length.
   *
   * So an attacker who sends a multi-KB X-Forwarded-For on every request makes
   * the limiter fail open on every request: unlimited TIN enumeration, receipt
   * guessing and application farming on exactly the ip-keyed public surfaces
   * the limiter is there to guard.
   *
   * These tests assert the cap holds. They currently FAIL — that is the defect.
   * ------------------------------------------------------------------ */
  it('attack3-unit: an oversized (attacker-controlled) key must still be capped, not fail open', async () => {
    const store = new PostgresBucketStore();
    const MAX = 10;
    // Mirror security.ts key building for a keyBy:'ip' surface whose clientIp
    // an attacker set via X-Forwarded-For to a 3000-char string.
    //
    // The filler has to be incompressible. `'X'.repeat(3000)` is not: TOAST
    // compresses a run of one byte down to nothing, the index tuple comes in
    // well under the limit, and the row stores happily — so an oversized key
    // built that way tests nothing, and the precondition below is what caught
    // it. Random printable bytes do not compress and do breach the 2704-byte
    // btree maximum.
    let attackerClientIp = '';
    for (let i = 0; i < 3000; i++) {
      attackerClientIp += String.fromCharCode(33 + Math.floor(Math.random() * 90));
    }
    const key = `citizen-status:${attackerClientIp}`; // > 2704-byte btree limit

    // Confirm the failure mode itself: this key cannot be stored.
    let insertThrew = false;
    try {
      await query(
        pool,
        `INSERT INTO rate_limit_buckets (key, count, reset_at) VALUES ($1, 1, now())`,
        [key],
      );
    } catch (e) {
      insertThrew = true;
      const msg = e instanceof Error ? e.message : String(e);
      assert.match(msg, /exceeds btree/, `expected a btree size error, got: ${msg}`);
    }
    assert.ok(insertThrew, 'precondition: the oversized key must be un-storable');

    const states = await Promise.all(
      Array.from({ length: MAX + 5 }, () => store.hit(key, 60_000, MAX)),
    );
    const allowed = states.filter((s) => s.count <= MAX).length;
    // If the store fails open, EVERY hit reports count=1 and allowed = MAX+5.
    assert.ok(
      allowed <= MAX,
      `DEFECT (fail-open bypass): ${allowed}/${MAX + 5} oversized-key requests were allowed; ` +
        `the store fails open on the un-storable key, so an attacker who sends a multi-KB ` +
        `X-Forwarded-For gets unlimited requests on ip-keyed public surfaces`,
    );
  });

  it('attack3-e2e: an oversized X-Forwarded-For does not defeat an ip-keyed limiter', async () => {
    // Faithful reconstruction of the middleware for a keyBy:'ip' surface,
    // using its real PostgresBucketStore and Express's real `trust proxy`
    // handling of X-Forwarded-For.
    const store = new PostgresBucketStore();
    const MAX = 5;
    const KEY_PREFIX = 'citizen-status';

    const app = express();
    app.set('trust proxy', 1); // app.ts does this when TRUST_PROXY is set
    app.use(requestContext); // sets req.clientIp = req.ip
    app.use((req, res, next) => {
      const identity = req.clientIp ?? 'unknown';
      const key = `${KEY_PREFIX}:${identity}`;
      store.hit(key, 60_000, MAX).then(
        (bucket) => {
          if (bucket.count > MAX) {
            res.status(429).json({ error: 'rate_limited' });
            return;
          }
          next();
        },
        () => next(),
      );
    });
    app.get('/', (_req, res) => res.status(200).json({ ok: true }));

    const server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    const port = (server.address() as import('node:net').AddressInfo).port;

    // Two properties are needed for this to be the attack it claims to be, and
    // the first version of it had neither.
    //
    // Incompressible, for the reason given in attack3-unit: a run of one byte
    // compresses and the row stores, so the key is never oversized.
    //
    // And comma-free. Express splits `X-Forwarded-For` on commas and takes one
    // segment, so a random printable filler — which contains commas roughly one
    // byte in ninety — arrives as an 82-character fragment rather than the
    // whole 3000. Measured: a comma-free value reaches `req.ip` intact at its
    // full length, and that is what makes the key un-storable.
    const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let xff = '';
    for (let i = 0; i < 3000; i++) {
      xff += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    const codes: number[] = [];
    try {
      for (let i = 0; i < MAX + 5; i++) {
        codes.push(
          await new Promise<number>((resolve, reject) => {
            const rq = http.get(
              { host: '127.0.0.1', port, path: '/', headers: { 'x-forwarded-for': xff } },
              (res) => {
                res.resume();
                res.on('end', () => resolve(res.statusCode ?? 0));
              },
            );
            rq.on('error', reject);
          }),
        );
      }
    } finally {
      server.close();
    }

    const allowed = codes.filter((c) => c === 200).length;
    assert.ok(
      allowed <= MAX,
      `DEFECT (fail-open bypass, end to end): ${allowed}/${MAX + 5} requests bearing a 3000-char ` +
        `X-Forwarded-For returned 200; the oversized clientIp overflows the bucket key, the store ` +
        `fails open, and the ip cap is defeated. Status codes: ${codes.join(',')}`,
    );
  });

  /* ------------------------------------------------------------------ *
   * ATTACK 4 — raw SQL as a compromised service account.
   * (a) schema must refuse a negative count.
   * (b) reset_at in the past is accepted (resets the window on next hit).
   * (c) deleting a bucket is accepted (grants a fresh budget).
   * (b)/(c) require existing write access and are reported as informational.
   * ------------------------------------------------------------------ */
  it('attack4a: the CHECK constraint refuses a negative count', async () => {
    const key = k('sql-negcount');
    await query(pool, `INSERT INTO rate_limit_buckets (key, count, reset_at) VALUES ($1, 5, now() + interval '1 hour')`, [key]);
    await assert.rejects(
      () => query(pool, `UPDATE rate_limit_buckets SET count = -1 WHERE key = $1`, [key]),
      /violates check constraint/,
      'count >= 0 must be enforced by the schema',
    );
  });

  it('attack4bc: reset_at-in-past and row deletion are UNconstrained (report as informational)', async () => {
    const key = k('sql-reset');
    const store = new PostgresBucketStore();
    for (let i = 0; i < 3; i++) await store.hit(key, 60_000, 2); // over the limit

    // (b) rewind the window
    await query(pool, `UPDATE rate_limit_buckets SET reset_at = now() - interval '1 hour' WHERE key = $1`, [key]);
    const afterRewind = await new PostgresBucketStore().hit(key, 60_000, 2);
    assert.equal(afterRewind.count, 1, 'a rewound reset_at makes the next hit start a brand-new window (budget granted)');

    // (c) delete the bucket
    await query(pool, `DELETE FROM rate_limit_buckets WHERE key = $1`, [key]);
    const afterDelete = await new PostgresBucketStore().hit(key, 60_000, 2);
    assert.equal(afterDelete.count, 1, 'a deleted bucket is recreated fresh (budget granted)');
    // Verdict recorded in the report: both require prior DB write, so they do
    // not widen an external attacker's reach.
  });

  /* ------------------------------------------------------------------ *
   * ATTACK 5 — window rollover race.
   * At the instant a window expires, concurrent hits must not each see the old
   * window and each restart at 1. Exactly one hit may report count===1.
   * ------------------------------------------------------------------ */
  it('attack5: concurrent hits at the rollover boundary produce exactly one count===1', async () => {
    const key = k('rollover');
    const store = new PostgresBucketStore();
    const WINDOW = 150;
    const N = 12;

    await store.hit(key, WINDOW, 100); // open a window at count 1
    await sleep(WINDOW + 60); // let it expire

    const states = await Promise.all(Array.from({ length: N }, () => store.hit(key, WINDOW, 100)));
    const ones = states.filter((s) => s.count === 1).length;
    const counts = states.map((s) => s.count).sort((a, b) => a - b);

    assert.equal(ones, 1, `only one hit may reset to 1 at the boundary; got ${ones} (a free-request race)`);
    assert.deepEqual(counts, Array.from({ length: N }, (_v, i) => i + 1), 'the rolled-over window counts 1..N exactly once each');
  });

  /* ------------------------------------------------------------------ *
   * ATTACK 6 — the sweep vs the blocked cache.
   * After a window ends: the sweep may delete the row, and a subsequent hit
   * must produce a consistent "fresh window, count 1" — the local cache must
   * not still be refusing (under a matched app/DB clock).
   * ------------------------------------------------------------------ */
  it('attack6: a swept, rolled-over key is allowed again — no cache/DB disagreement (matched clock)', async () => {
    const key = k('sweep');
    const store = new PostgresBucketStore();
    const MAX = 1;
    const WINDOW = 200;

    for (let i = 0; i < MAX + 1; i++) await store.hit(key, WINDOW, MAX); // block + cache
    await sleep(WINDOW + 150);

    const deleted = await sweepExpiredBuckets();
    assert.ok(deleted >= 1, 'the expired bucket should be sweepable');

    const after = await store.hit(key, WINDOW, MAX);
    assert.equal(after.count, 1, 'after sweep + rollover the same instance must allow a fresh request, not refuse from a stale cache');
  });

  /* ------------------------------------------------------------------ *
   * ATTACK 7 — identity keying and token rotation.
   * On an ip-keyed surface, rotating (validly signed) bearer tokens must buy
   * NO extra budget: identity is the address, not the subject.
   * A caller-keyed surface, by contrast, gives one budget per subject — which
   * is why the tight public surfaces must be, and are, keyBy:'ip'.
   * ------------------------------------------------------------------ */
  it('attack7: on an ip-keyed surface, rotating real tokens does not buy budget', async () => {
    const store = new PostgresBucketStore();
    const MAX = 4;
    const KEY_PREFIX = 'citizen-status';
    const clientIp = k('shared-ip'); // stands in for one attacker address

    // Build two genuinely valid tokens for two different subjects.
    const tokenA = issueAccessToken({ sub: k('subjA'), role: 'AGENT', sid: 'sA' });
    const tokenB = issueAccessToken({ sub: k('subjB'), role: 'AGENT', sid: 'sB' });

    // ip-mode identity ignores the token entirely, so both tokens share a key.
    const ipIdentity = (_authHeader: string) => clientIp;
    const keyFor = (authHeader: string) => `${KEY_PREFIX}:${ipIdentity(authHeader)}`;

    let over = 0;
    for (let i = 0; i < MAX + 2; i++) {
      const token = i % 2 === 0 ? tokenA : tokenB; // rotate tokens each request
      const s = await store.hit(keyFor(token), 60_000, MAX);
      if (s.count > MAX) over++;
    }
    assert.ok(over >= 2, 'token rotation must not escape an ip-keyed cap; the last two requests must be refused');

    // Sanity: caller-keying would have given each subject its own budget.
    const callerKey = (sub: string) => `some-caller-surface:${sub}`;
    const a = await store.hit(callerKey(k('subjA')), 60_000, MAX);
    const b = await store.hit(callerKey(k('subjB')), 60_000, MAX);
    assert.equal(a.count, 1);
    assert.equal(b.count, 1, 'caller-keying gives a separate budget per subject — why public surfaces must be ip-keyed');
  });

  /* ------------------------------------------------------------------ *
   * ATTACK 8 — split time source.
   * reset_at comes from the DB clock; the blocked-cache comparison and the
   * fabricated fail-open window use the Node clock. With matched clocks the
   * window the caller is told about tracks Date.now()+windowMs closely. This
   * asserts the matched-clock behaviour; the report explains the skew risk.
   * ------------------------------------------------------------------ */
  it('attack8: with matched clocks, the reported window tracks the node clock (skew is the risk)', async () => {
    const key = k('clock');
    const store = new PostgresBucketStore();
    const WINDOW = 60_000;
    const before = Date.now();
    const s = await store.hit(key, WINDOW, 100);
    const skewMs = s.resetAt - (before + WINDOW);
    assert.ok(
      Math.abs(skewMs) < 2_000,
      `reset_at (DB clock) is ${skewMs}ms from Date.now()+window (node clock); a real app/DB clock ` +
        `skew moves the cache and retry-after by exactly that much`,
    );
  });
});
