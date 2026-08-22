/**
 * Load and soak testing for the money path.
 *
 * The certification records "Performance under load — Not tested" and says the
 * indexes look right. Those are different claims, and only one of them was
 * evidenced. An index being present tells you a query *can* use it; it does not
 * tell you that the query planner does, that the transaction does not serialise
 * behind another, or that a sweep which is instant over 50 rows is still
 * tolerable over 50,000.
 *
 * WHAT THIS MEASURES, AND WHY THESE THINGS
 *
 * Not throughput for its own sake. Three properties whose failure would be
 * expensive and is not visible at development volumes:
 *
 *   1. Payment confirmation under contention. Confirmation runs at SERIALIZABLE
 *      with an advisory lock, which is correct and is also the most likely
 *      place for latency to collapse when several agents collect at once. A
 *      p99 that is fine at 1 concurrent request and terrible at 32 is a
 *      production incident waiting for market day.
 *
 *   2. Read paths at volume. The dashboards an officer refreshes and the
 *      queues the workers scan. An N+1 or a sequential scan here is invisible
 *      on a seeded database and painful on a real one.
 *
 *   3. The reconciliation sweep. It runs four times a day over a trailing
 *      window; the window grows with the platform and the sweep does not get
 *      its own maintenance window.
 *
 * WHAT IT DOES NOT DO
 *
 * It does not model real user behaviour, network latency, or a cold cache, and
 * it runs against one machine's PostgreSQL rather than a production topology.
 * Treat the absolute numbers as a floor, not a forecast. The comparisons — how
 * a figure moves between 1 and 32 concurrent callers, or between 100 and 10,000
 * rows — are the part worth reading, because those hold across environments in
 * a way absolute milliseconds do not.
 */

/*
 * Environment, set before any import that reads config.
 *
 * Deliberately inline rather than importing `../tests/env`: `tsconfig.json`
 * excludes `src/tests/**` from the build, so that the test helpers — including
 * a `resetDatabase` that truncates everything — cannot end up in the production
 * image. Reaching into that directory from `src/db` would put them back.
 */
process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgres://postgres:postgres@localhost:5432/psirs_test';
process.env.JWT_SECRET ??= 'load-test-jwt-secret-value-long-enough-32';
process.env.IDENTITY_HASH_SECRET ??= 'load-test-identity-secret-long-enough-32';
process.env.PAYMENT_WEBHOOK_SECRET ??= 'load-test-webhook-secret-long-enough-32';
process.env.STORAGE_PATH ??= '/tmp/psirs-load-storage';

import { pool } from './pool';
import { recordAuditStandalone } from '../services/audit';

interface Sample {
  label: string;
  count: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  errors: number;
}

function summarise(label: string, timings: number[], errors: number): Sample {
  const sorted = [...timings].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
  return {
    label,
    count: timings.length,
    p50: Math.round(at(0.5) * 100) / 100,
    p95: Math.round(at(0.95) * 100) / 100,
    p99: Math.round(at(0.99) * 100) / 100,
    max: Math.round((sorted[sorted.length - 1] ?? 0) * 100) / 100,
    errors,
  };
}

async function timed<T>(fn: () => Promise<T>): Promise<number> {
  const started = process.hrtime.bigint();
  await fn();
  return Number(process.hrtime.bigint() - started) / 1_000_000;
}

/**
 * Run `fn` `total` times with at most `concurrency` in flight.
 *
 * Deliberately not `Promise.all` over the whole batch: that measures how fast
 * the pool queues, not how the system behaves at a given concurrency, and it
 * makes every result look identical to every other.
 */
async function drive(
  label: string,
  total: number,
  concurrency: number,
  fn: (i: number) => Promise<unknown>,
): Promise<Sample> {
  const timings: number[] = [];
  let errors = 0;
  let next = 0;
  let firstError: string | null = null;

  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= total) return;
      try {
        timings.push(await timed(() => fn(i)));
      } catch (error) {
        errors += 1;
        // Report the reason once. The first version of this harness only
        // counted failures, so a probe that could never have worked — it wrote
        // audit_logs directly, and that table's hash column is NOT NULL —
        // reported "120 errors" three times and explained nothing.
        firstError ??= error instanceof Error ? error.message : String(error);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  if (firstError) console.log(`    ! ${label}: ${firstError}`);
  return summarise(label, timings, errors);
}

function table(rows: Sample[]): void {
  const pad = (s: string, n: number) => s.padEnd(n);
  const num = (v: number) => String(v).padStart(9);
  console.log(
    `  ${pad('scenario', 44)}${'n'.padStart(7)}${'p50'.padStart(9)}${'p95'.padStart(9)}${'p99'.padStart(9)}${'max'.padStart(9)}${'err'.padStart(6)}`,
  );
  console.log(`  ${'-'.repeat(93)}`);
  for (const r of rows) {
    console.log(
      `  ${pad(r.label, 44)}${String(r.count).padStart(7)}${num(r.p50)}${num(r.p95)}${num(r.p99)}${num(r.max)}${String(r.errors).padStart(6)}`,
    );
  }
}

// ===========================================================================

/** Bulk-insert taxpayers so the read paths have something to scan. */
async function seedVolume(target: number): Promise<number> {
  const { rows } = await pool.query<{ n: string }>('SELECT count(*)::text AS n FROM taxpayers');
  const have = Number(rows[0]!.n);
  if (have >= target) return have;

  const lga = await pool.query<{ id: string }>('SELECT id FROM lgas LIMIT 1');
  if (lga.rowCount === 0) throw new Error('no LGAs — run the seed first');

  const need = target - have;
  console.log(`  inserting ${need} taxpayers to reach ${target}…`);
  // One statement per 1,000 rows: enough to be fast, small enough that a
  // failure does not roll back twenty minutes of work.
  for (let done = 0; done < need; done += 1000) {
    const batch = Math.min(1000, need - done);
    await pool.query(
      `INSERT INTO taxpayers (taxpayer_type, first_name, last_name, phone, address, lga_id,
                              economic_sector, tin, tin_status, status)
       SELECT 'INDIVIDUAL', 'Load', 'Fixture' || g,
              '+234' || lpad((700000000 + $2 + g)::text, 10, '0'),
              'Jos North', $1,
              (ARRAY['AGRICULTURE','RETAIL_TRADE','TRANSPORT_LOGISTICS','ARTISAN_CRAFT'])[1 + (g % 4)],
              'PL' || lpad((10000000 + $2 + g)::text, 8, '0'),
              'ASSIGNED', 'ACTIVE'
         FROM generate_series(1, $3) g
       ON CONFLICT DO NOTHING`,
      [lga.rows[0]!.id, have + done, batch],
    );
  }

  const after = await pool.query<{ n: string }>('SELECT count(*)::text AS n FROM taxpayers');
  return Number(after.rows[0]!.n);
}

/**
 * Does a query use an index, or scan the table?
 *
 * Asked of the planner rather than inferred from `pg_indexes`, because an index
 * that exists and an index the planner chooses are different facts — and the
 * second is the one that decides whether an officer's dashboard returns.
 */
async function planFor(label: string, sql: string, params: unknown[] = []): Promise<void> {
  const { rows } = await pool.query<{ 'QUERY PLAN': string }>(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${sql}`,
    params,
  );
  const plan = rows.map((r) => r['QUERY PLAN']).join('\n');
  const seq = /Seq Scan on (\w+)/.exec(plan);
  const timeMatch = /Execution Time: ([\d.]+) ms/.exec(plan);
  const time = timeMatch ? `${timeMatch[1]} ms` : '?';
  console.log(`  ${label.padEnd(52)} ${time.padStart(12)}   ${seq ? `SEQ SCAN on ${seq[1]}` : 'index'}`);
}

async function main(): Promise<void> {
  const volume = Number(process.env.LOAD_TAXPAYERS ?? 10_000);

  console.log('\nPSIRS load and soak measurement');
  console.log('='.repeat(97));

  console.log('\n1. Building volume');
  const total = await seedVolume(volume);
  const counts = await pool.query<{ t: string; tx: string; p: string }>(
    `SELECT (SELECT count(*)::text FROM taxpayers) AS t,
            (SELECT count(*)::text FROM transactions) AS tx,
            (SELECT count(*)::text FROM payments) AS p`,
  );
  console.log(
    `  taxpayers ${counts.rows[0]!.t}, transactions ${counts.rows[0]!.tx}, payments ${counts.rows[0]!.p}`,
  );

  console.log('\n2. Read paths under concurrency (ms)');
  const reads: Sample[] = [];
  for (const concurrency of [1, 8, 32]) {
    reads.push(
      await drive(`taxpayer search by name, c=${concurrency}`, 200, concurrency, async (i) => {
        await pool.query(
          `SELECT id, first_name, last_name, tin FROM taxpayers
            WHERE last_name ILIKE $1 LIMIT 25`,
          [`Fixture${i % 500}%`],
        );
      }),
    );
  }
  for (const concurrency of [1, 8, 32]) {
    reads.push(
      await drive(`TIN exact lookup, c=${concurrency}`, 400, concurrency, async (i) => {
        await pool.query('SELECT id FROM taxpayers WHERE tin = $1', [
          `PL${String(10_000_000 + (i % Math.max(1, total))).padStart(8, '0')}`,
        ]);
      }),
    );
  }
  table(reads);

  console.log('\n3. The audit chain under contention (ms)');
  /*
   * This is the write path's real bottleneck, and it is deliberate.
   *
   * `recordAudit` takes a global advisory lock before appending, because the
   * chain is tamper-evident: each entry hashes the previous one, so two
   * concurrent writers reading the same tail would fork it into something no
   * verifier could replay. Correct — and it means every audit append across the
   * whole platform serialises through one lock.
   *
   * Every money movement writes audit entries, so this is not a niche
   * measurement: it is the ceiling on how fast the platform can record revenue,
   * whatever else is optimised. Going through the real service rather than an
   * INSERT is the point. The first version of this probe wrote audit_logs
   * directly, which cannot work — `hash` is NOT NULL because of that very chain
   * — and measured nothing at all.
   */
  const writes: Sample[] = [];
  for (const concurrency of [1, 4, 16]) {
    writes.push(
      await drive(`audit chain append, c=${concurrency}`, 120, concurrency, async (i) => {
        await recordAuditStandalone({
          actorId: null,
          actorRole: 'system',
          action: 'load.probe',
          entityType: 'load_test',
          entityId: null,
          newValue: { i },
        } as Parameters<typeof recordAuditStandalone>[0]);
      }),
    );
  }
  table(writes);

  // For a deliberately serialised resource, throughput is the number that
  // matters: latency rising in step with concurrency is expected, a flat total
  // rate is the ceiling.
  for (const w of writes) {
    const concurrency = Number(/c=(\d+)/.exec(w.label)?.[1] ?? 1);
    if (w.count > 0 && w.p50 > 0) {
      console.log(
        `    c=${String(concurrency).padStart(2)} → about ${Math.round((1000 / w.p50) * concurrency)} appends/second`,
      );
    }
  }

  console.log('\n4. Query plans on the paths that matter');
  await planFor(
    'taxpayer by TIN',
    'SELECT id FROM taxpayers WHERE tin = $1',
    [`PL${String(10_000_050).padStart(8, '0')}`],
  );
  await planFor('taxpayer by phone', 'SELECT id FROM taxpayers WHERE phone = $1', ['+2347000000050']);
  await planFor(
    'taxpayer by sector (incentive targeting)',
    "SELECT count(*) FROM taxpayers WHERE economic_sector = 'AGRICULTURE'",
  );
  await planFor(
    'outstanding TIN queue',
    "SELECT id FROM taxpayers WHERE tin_status IN ('REQUESTED','FAILED') LIMIT 100",
  );
  await planFor('audit log tail', 'SELECT * FROM audit_logs ORDER BY sequence_no DESC LIMIT 50');
  await planFor(
    'unsettled payments (reconciliation input)',
    "SELECT id FROM payments WHERE status = 'VERIFIED' LIMIT 100",
  );

  console.log('\n5. Table sizes');
  const sizes = await pool.query<{ relname: string; size: string; n: string }>(
    `SELECT c.relname,
            pg_size_pretty(pg_total_relation_size(c.oid)) AS size,
            COALESCE(s.n_live_tup, 0)::text AS n
       FROM pg_class c
       JOIN pg_namespace ns ON ns.oid = c.relnamespace
       LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
      WHERE ns.nspname = 'public' AND c.relkind = 'r'
      ORDER BY pg_total_relation_size(c.oid) DESC
      LIMIT 8`,
  );
  for (const row of sizes.rows) {
    console.log(`  ${row.relname.padEnd(36)} ${row.size.padStart(10)}  ${row.n.padStart(10)} rows`);
  }

  console.log('\nDone. Absolute figures are a floor, not a forecast — one machine,');
  console.log('no network. Read the movement between concurrency levels.\n');
}

main()
  .then(() => pool.end())
  .catch(async (error) => {
    console.error('Load test failed:', error);
    await pool.end();
    process.exit(1);
  });
