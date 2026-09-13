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

import { ECONOMIC_SECTORS } from '@psirs/shared';
import { pool } from './pool';
import { recordAuditStandalone } from '../services/audit';
import { createAssessment } from '../services/revenue';
import { confirmPayment, initiatePayment } from '../services/payments';
import { runReconciliation } from '../services/reconciliation';

/**
 * Sectors for the fixture: a deliberate spread, checked against the real list.
 *
 * The fixture named four sectors literally, and one of them —
 * TRANSPORT_LOGISTICS — was dropped by migration 019, which split it into
 * TRANSPORT_PASSENGER and TRANSPORT_HAULAGE. The check constraint then refused
 * every insert, so this measurement could not seed a single taxpayer and had
 * not run since.
 *
 * The spread still matters — four sectors from one industry would not exercise
 * the filtered read below the way four unrelated ones do — so the codes are
 * named rather than sliced off the front of the list. What has changed is that
 * they are now verified against it at startup: the next vocabulary change
 * fails here, immediately and by name, instead of ten thousand rows later
 * inside a constraint violation.
 */
const FIXTURE_SECTORS = ['AGRICULTURE', 'RETAIL_TRADE', 'TRANSPORT_HAULAGE', 'ARTISAN_CRAFT'];

for (const code of FIXTURE_SECTORS) {
  if (!ECONOMIC_SECTORS.some((sector) => sector.code === code)) {
    throw new Error(
      `Fixture sector "${code}" is not in ECONOMIC_SECTORS. The vocabulary changed; ` +
        'update FIXTURE_SECTORS to match, keeping the sectors unrelated to one another.',
    );
  }
}

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
              ($4::text[])[1 + (g % 4)],
              'PL' || lpad((10000000 + $2 + g)::text, 8, '0'),
              'ASSIGNED', 'ACTIVE'
         FROM generate_series(1, $3) g
       ON CONFLICT DO NOTHING`,
      [lga.rows[0]!.id, have + done, batch, FIXTURE_SECTORS],
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
/**
 * Payments sitting unconfirmed, ready to be confirmed under contention.
 *
 * Built through `createAssessment` and `initiatePayment` rather than by
 * INSERT, for the reason the audit probe learned the hard way: a fixture
 * assembled by hand measures a code path nobody runs. These go through the
 * same services an agent's tap goes through, and the mock gateway rows are
 * then marked SUCCESS so that confirmation has something truthful to find.
 *
 * Each payment is confirmable exactly once — the second attempt is idempotent
 * and returns without doing the work — so the measurement needs one payment
 * per iteration rather than one payment hit repeatedly.
 */
async function seedConfirmablePayments(count: number): Promise<string[]> {
  const officer = await pool.query<{ id: string }>(
    `INSERT INTO users (full_name, phone, email, password_hash, role, status)
     VALUES ('Load Fixture Officer', '+2348099000001', 'load@psirs.invalid',
             'not-a-usable-hash', 'revenue_officer', 'ACTIVE')
     ON CONFLICT (phone) DO UPDATE SET full_name = EXCLUDED.full_name
     RETURNING id`,
  );
  const actorId = officer.rows[0]!.id;

  const item = await pool.query<{ id: string }>(
    `SELECT ri.id FROM revenue_items ri
       JOIN revenue_item_rates r ON r.revenue_item_id = ri.id
      WHERE r.rate_type = 'FIXED'
        AND ri.status = 'ACTIVE'
        AND 'INDIVIDUAL' = ANY (ri.applicable_taxpayer_types)
        AND (r.effective_to IS NULL OR r.effective_to > now())
      ORDER BY ri.code LIMIT 1`,
  );
  if (item.rowCount === 0) throw new Error('no fixed-rate revenue item — run the seed first');
  const revenueItemId = item.rows[0]!.id;

  const taxpayers = await pool.query<{ id: string }>(
    `SELECT id FROM taxpayers WHERE last_name LIKE 'Fixture%' ORDER BY created_at LIMIT $1`,
    [count],
  );
  if (taxpayers.rowCount! < count) {
    throw new Error(`only ${taxpayers.rowCount} fixture taxpayers for ${count} payments`);
  }

  console.log(`  preparing ${count} unconfirmed payments…`);
  const paymentIds: string[] = [];
  for (const row of taxpayers.rows) {
    const assessment = await createAssessment({
      taxpayerId: row.id,
      revenueItemId,
      inputs: {},
      actorId,
      actorRole: 'revenue_officer',
      channel: 'OFFICER',
    });
    const payment = await initiatePayment({
      transactionId: assessment.transactionId,
      actorId,
      actorRole: 'revenue_officer',
    });
    paymentIds.push(payment.paymentId);
  }

  // The gateway says these were paid. Confirmation still has to go and ask.
  await pool.query(
    `UPDATE mock_gateway_transactions
        SET status = 'SUCCESS', paid_at = now(), payment_method = 'CARD'
      WHERE payment_reference IN (
        SELECT payment_reference FROM payments WHERE id = ANY($1::uuid[]))`,
    [paymentIds],
  );

  return paymentIds;
}

/**
 * A day's settled traffic, for the sweep that decides whether agents get paid.
 *
 * Bulk-inserted rather than driven through the services, and the distinction
 * from the confirmation fixture above is deliberate: there, the code under
 * measurement was the thing that creates the rows, so building them by hand
 * would have measured nothing. Here the code under measurement is
 * `runReconciliation`, which only reads them. What it needs is a realistic
 * number of realistically shaped rows, and forty thousand of those through
 * the assessment service would take longer than the measurement.
 *
 * Each level is seeded into its own day so a run reconciles exactly its own
 * traffic and not the level before it.
 */
async function seedSettledDay(
  count: number,
  daysAgo: number,
  options: { variances?: boolean } = {},
): Promise<{ from: Date; to: Date }> {
  const template = await pool.query<{
    taxpayer_id: string;
    invoice_id: string;
    assessment_id: string;
    revenue_item_id: string;
    lga_id: string;
    created_by: string;
  }>(
    `SELECT taxpayer_id, invoice_id, assessment_id, revenue_item_id, lga_id, created_by
       FROM transactions ORDER BY created_at LIMIT 1`,
  );
  if (template.rowCount === 0) throw new Error('no transaction to model the fixture on');
  const t = template.rows[0]!;
  const tag = `D${daysAgo}`;

  await pool.query(
    `INSERT INTO transactions
       (transaction_reference, taxpayer_id, invoice_id, assessment_id, revenue_item_id,
        lga_id, amount_kobo, total_amount_kobo, created_by, status, created_at)
     SELECT 'RECON-' || $7 || '-' || g, $1, $2, $3, $4, $5, 200000, 200000, $6,
            'SETTLED', now() - make_interval(days => $8)
       FROM generate_series(1, $9) g`,
    [t.taxpayer_id, t.invoice_id, t.assessment_id, t.revenue_item_id, t.lga_id, t.created_by,
     tag, daysAgo, count],
  );

  await pool.query(
    // verified_at and verified_by_source are not decoration: the schema refuses
    // a VERIFIED payment without them, which is the same refusal that stops a
    // receipt existing for money nothing confirmed. The fixture has to be as
    // honest as a real one.
    `INSERT INTO payments
       (transaction_id, payment_reference, gateway, gateway_reference, amount_kobo,
        status, verified_at, verified_by_source, created_at)
     SELECT tx.id, 'RECONPAY-' || $1 || '-' || g, 'mock', 'RECONGW-' || $1 || '-' || g,
            200000, 'VERIFIED', now() - make_interval(days => $2), 'WEBHOOK',
            now() - make_interval(days => $2)
       FROM generate_series(1, $3) g
       JOIN transactions tx ON tx.transaction_reference = 'RECON-' || $1 || '-' || g`,
    [tag, daysAgo, count],
  );

  // The gateway's side of the same day. Reconciliation compares the two.
  await pool.query(
    `INSERT INTO mock_gateway_transactions
       (gateway_reference, payment_reference, amount_kobo, status, paid_at,
        settlement_reference, created_at)
     SELECT 'RECONGW-' || $1 || '-' || g, 'RECONPAY-' || $1 || '-' || g, 200000,
            'SUCCESS', now() - make_interval(days => $2),
            'SETL-' || $1, now() - make_interval(days => $2)
       FROM generate_series(1, $3) g`,
    [tag, daysAgo, count],
  );

  if (options.variances) {
    /*
     * A day that did not go perfectly, which is every real day.
     *
     * The clean fixture above reconciles eight thousand lines to eight
     * thousand matches, and a run that finds nothing wrong is the one case
     * the exception path never executes. These are the disagreements an
     * officer actually opens the queue to see, seeded in the proportions that
     * make the measurement worth reading rather than at a rate that would
     * make every record an exception.
     */
    // One in ten: the gateway says a different amount than the platform.
    await pool.query(
      `UPDATE mock_gateway_transactions SET amount_kobo = 190000
        WHERE gateway_reference LIKE 'RECONGW-' || $1 || '-%'
          AND (split_part(gateway_reference, '-', 3)::int % 10) = 0`,
      [tag],
    );
    // One in twenty: the platform believes it was paid and the gateway has no
    // line for it at all. The worst kind, and the reason the sweep exists.
    await pool.query(
      `DELETE FROM mock_gateway_transactions
        WHERE gateway_reference LIKE 'RECONGW-' || $1 || '-%'
          AND (split_part(gateway_reference, '-', 3)::int % 20) = 1`,
      [tag],
    );
    // One in twenty: the gateway says it failed while the platform says paid.
    await pool.query(
      `UPDATE mock_gateway_transactions SET status = 'FAILED'
        WHERE gateway_reference LIKE 'RECONGW-' || $1 || '-%'
          AND (split_part(gateway_reference, '-', 3)::int % 20) = 2`,
      [tag],
    );
    // And lines the gateway has that the platform never issued, which are
    // found by the second pass rather than the first.
    await pool.query(
      `INSERT INTO mock_gateway_transactions
         (gateway_reference, payment_reference, amount_kobo, status, paid_at,
          settlement_reference, created_at)
       SELECT 'RECONGW-' || $1 || '-orphan-' || g, 'RECONPAY-' || $1 || '-orphan-' || g,
              200000, 'SUCCESS', now() - make_interval(days => $2),
              'SETL-' || $1, now() - make_interval(days => $2)
         FROM generate_series(1, $3) g`,
      [tag, daysAgo, Math.max(1, Math.floor(count / 20))],
    );
  }

  /*
   * The third leg: government's own record that the money arrived in its
   * account. Without it every line reconciles to PENDING_SETTLEMENT, which is
   * correct — PRD §46 will not call money reconciled on the gateway's word
   * alone — but it means the fixture never exercises the matching path, and
   * matching is the work this section exists to time.
   */
  const settlement = await pool.query<{ id: string }>(
    `INSERT INTO settlements
       (settlement_reference, gateway, settlement_date, expected_amount_kobo)
     VALUES ('SETL-' || $1, 'mock', now() - make_interval(days => $2), $3)
     RETURNING id`,
    [tag, daysAgo, String(200000 * count)],
  );
  await pool.query(
    `UPDATE payments SET settlement_id = $1
      WHERE payment_reference LIKE 'RECONPAY-' || $2 || '-%'`,
    [settlement.rows[0]!.id, tag],
  );

  const day = new Date(Date.now() - daysAgo * 86_400_000);
  return {
    from: new Date(day.getTime() - 12 * 3_600_000),
    to: new Date(day.getTime() + 12 * 3_600_000),
  };
}

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

  console.log('\n4. Payment confirmation under contention (ms)');
  /*
   * The property this file was written for, and the one it never measured.
   *
   * `confirmPayment` runs at SERIALIZABLE behind an advisory lock, because
   * two confirmations of one payment must not both issue a receipt. That is
   * correct, and it is also where latency goes when a market fills up and
   * thirty agents tap "check payment status" at once. A p99 that is fine
   * alone and terrible at 32 is a market-day incident, and until now nothing
   * would have said so.
   *
   * Read the movement, not the absolute figures: what matters is whether
   * confirmation degrades gracefully as agents pile on, or falls off a cliff.
   */
  const confirmations: Sample[] = [];
  const perLevel = 60;
  const levels = [1, 8, 32];
  const confirmable = await seedConfirmablePayments(perLevel * levels.length);
  let taken = 0;
  for (const concurrency of levels) {
    const slice = confirmable.slice(taken, taken + perLevel);
    taken += perLevel;
    confirmations.push(
      await drive(`payment confirmation, c=${concurrency}`, slice.length, concurrency, async (i) => {
        await confirmPayment({ paymentId: slice[i]!, source: 'POLL', actorRole: 'system' });
      }),
    );
  }
  table(confirmations);

  console.log('\n5. Reconciliation over a day of settled traffic');
  /*
   * The control that decides whether an agent is paid.
   *
   * `runReconciliation` writes one `reconciliation_records` row per payment,
   * awaited one at a time inside a single transaction — so the sweep costs a
   * round trip per payment and holds one transaction open for all of them.
   * At demo scale that is a matched record and a shrug. Plateau State's
   * seventeen LGAs will not be at demo scale, and if a day's reconciliation
   * cannot finish inside a day, commission stops being payable.
   *
   * Watch the per-record cost across the levels rather than the totals: a
   * flat figure means it scales linearly and the ceiling is arithmetic; a
   * rising one means something in here is quadratic and the ceiling arrives
   * sooner than the arithmetic suggests.
   */
  const officer = await pool.query<{ id: string }>(
    `SELECT id FROM users WHERE role = 'revenue_officer' ORDER BY created_at LIMIT 1`,
  );
  const actorId = officer.rows[0]?.id ?? null;

  console.log(
    `  ${'day'.padEnd(24)}${'elapsed'.padStart(12)}${'per record'.padStart(14)}${'matched'.padStart(10)}${'exceptions'.padStart(12)}`,
  );
  console.log('  ' + '-'.repeat(72));
  let daysAgo = 1;
  for (const [volume, variances] of [
    [500, false],
    [2000, false],
    [8000, false],
    // The same volume again, on a day that did not go perfectly. Compared
    // against the row above it, the difference is what an exception costs.
    [8000, true],
  ] as [number, boolean][]) {
    const window = await seedSettledDay(volume, daysAgo, { variances });
    daysAgo += 1;
    const startedAt = process.hrtime.bigint();
    const summary = await runReconciliation({
      from: window.from,
      to: window.to,
      actorId,
      actorRole: 'revenue_officer',
    });
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    // Every payment in the window gets a record, whatever its outcome. Dividing
    // by matched+exceptions alone reported 0.00 ms per record on a run that had
    // just written eight thousand of them.
    const written = await pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM reconciliation_records WHERE run_id = $1',
      [summary.runId],
    );
    const checked = Number(written.rows[0]!.n);
    const label = variances ? `${volume}, with variances` : String(volume);
    console.log(
      `  ${label.padEnd(24)}${(elapsedMs.toFixed(0) + ' ms').padStart(12)}` +
        `${((checked ? elapsedMs / checked : 0).toFixed(2) + ' ms').padStart(14)}` +
        `${String(summary.matched).padStart(10)}${String(summary.exceptions).padStart(12)}`,
    );
  }

  console.log('\n6. Query plans on the paths that matter');
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

  console.log('\n7. Table sizes');
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
