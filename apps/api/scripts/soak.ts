/**
 * Sustained-load soak against the audit chain.
 *
 * Distinct from the concurrency sweep recorded as D-20, which answered "what
 * is the ceiling?" by holding a short burst at c=1, 4 and 16. This answers a
 * different question: does anything drift when the load is held? A ceiling
 * measured over ten seconds tells you nothing about the tenth minute — a leak,
 * a pool that stops returning connections, or latency that climbs as the
 * audit_logs index grows would all pass the sweep and fail here.
 *
 * The chain is the right thing to soak because it is the platform's narrowest
 * point by design: `recordAudit` takes an advisory lock so concurrent writers
 * cannot fork the hash chain, which makes every state change in the system
 * queue behind it. Whatever this sustains is the platform's real write budget.
 *
 * Reports per window rather than in aggregate, because an average over twelve
 * minutes hides exactly the shape we are looking for. Verifies the chain at the
 * end: sustained concurrent appending must not produce a fork.
 *
 * IT ALSO WATCHES A READ, AND THE BLOAT. Appending alone answers "can the
 * platform still write", and that is not the question an officer asks at hour
 * six — they ask why the screen is slow. A read held beside the writes catches
 * the case where appends stay flat while everything querying past them
 * degrades, which is the shape index and table bloat actually takes. Dead
 * tuples are sampled from `pg_stat_user_tables` for the same reason: a query
 * that was 0.02ms on a fresh table is not necessarily 0.02ms on a bloated one,
 * and the count says whether that is what is happening rather than leaving it
 * to be guessed from the latency.
 *
 *   npx tsx apps/api/scripts/soak.ts [--windows N] [--seconds N] [--concurrency N]
 */

import { pool, closePool, withTransaction, queryOne } from '../src/db/pool';
import { recordAudit, verifyAuditChain } from '../src/services/audit';
import { chainSentence } from '@psirs/shared';

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const value = Number.parseInt(process.argv[i + 1] ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const WINDOWS = arg('windows', 12);
const WINDOW_SECONDS = arg('seconds', 60);
const CONCURRENCY = arg('concurrency', 4);

interface Window {
  index: number;
  appends: number;
  errors: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  heapMb: number;
  rssMb: number;
  poolTotal: number;
  poolIdle: number;
  poolWaiting: number;
  readP50: number;
  readP95: number;
  deadTuples: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index];
}

const round = (n: number) => Math.round(n * 100) / 100;

/** One chain append, timed. Returns elapsed ms, or null if it failed. */
async function append(worker: number, sequence: number): Promise<number | null> {
  const started = process.hrtime.bigint();
  try {
    await withTransaction((client) =>
      recordAudit(client, {
        actorId: null,
        action: 'SOAK_APPEND',
        entityType: 'soak',
        entityId: null,
        newValue: { worker, sequence },
        result: 'SUCCESS',
      }),
    );
    return Number(process.hrtime.bigint() - started) / 1_000_000;
  } catch (error) {
    if (errors.length < 5) errors.push(String((error as Error).message).slice(0, 200));
    return null;
  }
}

/**
 * A read, timed, against the tables the writes are growing.
 *
 * Deliberately a lookup that misses: a TIN drawn from a range the seed does
 * not use. A hit would be answered from cache after the first window and would
 * measure nothing; a miss walks the index every time, which is what degrades
 * when the index bloats.
 */
async function probeRead(): Promise<number | null> {
  const started = process.hrtime.bigint();
  try {
    await pool.query('SELECT id FROM taxpayers WHERE tin = $1', [
      `PL${String(10_000_000 + Math.floor(Math.random() * 9_000)).padStart(8, '0')}`,
    ]);
    return Number(process.hrtime.bigint() - started) / 1_000_000;
  } catch (error) {
    if (errors.length < 5) errors.push(String((error as Error).message).slice(0, 200));
    return null;
  }
}

/** Dead tuples across the tables that only grow. Bloat, if it is happening. */
async function deadTuples(): Promise<number> {
  const row = await queryOne<{ n: string }>(
    pool,
    `SELECT COALESCE(SUM(n_dead_tup), 0)::text AS n
       FROM pg_stat_user_tables
      WHERE relname IN ('audit_logs','transactions','payments','receipts','taxpayers')`,
  );
  return Number(row?.n ?? 0);
}

const errors: string[] = [];

async function main(): Promise<void> {
  const before = await queryOne<{ count: string }>(
    pool,
    'SELECT count(*)::text AS count FROM audit_logs',
  );
  console.log(
    `soak: ${WINDOWS} windows x ${WINDOW_SECONDS}s at concurrency ${CONCURRENCY}\n` +
      `chain starts at ${before?.count ?? '0'} entries\n`,
  );
  console.log(
    'window   appends   rate/s     p50      p95      p99      max   rd_p50   rd_p95   heapMB  rssMB  pool(t/i/w)   dead  errors',
  );

  const results: Window[] = [];
  let stop = false;

  for (let w = 1; w <= WINDOWS; w++) {
    const latencies: number[] = [];
    const reads: number[] = [];
    let errorCount = 0;
    let counter = 0;
    const deadline = Date.now() + WINDOW_SECONDS * 1000;

    const worker = async (id: number): Promise<void> => {
      while (Date.now() < deadline && !stop) {
        const ms = await append(id, counter++);
        if (ms === null) errorCount++;
        else latencies.push(ms);

        // One read per append, so the read is measured under exactly the write
        // load the same window is reporting rather than beside an idle one.
        const read = await probeRead();
        if (read === null) errorCount++;
        else reads.push(read);
      }
    };

    await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i)));

    latencies.sort((a, b) => a - b);
    reads.sort((a, b) => a - b);
    const memory = process.memoryUsage();
    const dead = await deadTuples();
    const row: Window = {
      index: w,
      appends: latencies.length,
      errors: errorCount,
      p50: round(percentile(latencies, 50)),
      p95: round(percentile(latencies, 95)),
      p99: round(percentile(latencies, 99)),
      max: round(latencies[latencies.length - 1] ?? 0),
      heapMb: round(memory.heapUsed / 1024 / 1024),
      rssMb: round(memory.rss / 1024 / 1024),
      poolTotal: pool.totalCount,
      poolIdle: pool.idleCount,
      poolWaiting: pool.waitingCount,
      readP50: round(percentile(reads, 50)),
      readP95: round(percentile(reads, 95)),
      deadTuples: dead,
    };
    results.push(row);

    console.log(
      `${String(w).padStart(6)}  ${String(row.appends).padStart(8)}  ` +
        `${String(round(row.appends / WINDOW_SECONDS)).padStart(7)}  ` +
        `${String(row.p50).padStart(7)}  ${String(row.p95).padStart(7)}  ` +
        `${String(row.p99).padStart(7)}  ${String(row.max).padStart(7)}  ` +
        `${String(row.readP50).padStart(7)}  ${String(row.readP95).padStart(7)}  ` +
        `${String(row.heapMb).padStart(7)}  ${String(row.rssMb).padStart(6)}  ` +
        `${String(`${row.poolTotal}/${row.poolIdle}/${row.poolWaiting}`).padStart(11)}  ` +
        `${String(row.deadTuples).padStart(6)}  ${String(row.errors).padStart(6)}`,
    );
  }

  // Drift is the whole point: compare the last third against the first third
  // rather than eyeballing a column.
  const third = Math.max(1, Math.floor(results.length / 3));
  const head = results.slice(0, third);
  const tail = results.slice(-third);
  const mean = (rows: Window[], pick: (r: Window) => number) =>
    rows.reduce((sum, r) => sum + pick(r), 0) / rows.length;

  const p50Drift = mean(tail, (r) => r.p50) / mean(head, (r) => r.p50);
  const rateDrift = mean(tail, (r) => r.appends) / mean(head, (r) => r.appends);
  const heapGrowth = mean(tail, (r) => r.heapMb) - mean(head, (r) => r.heapMb);
  const readDrift = mean(tail, (r) => r.readP50) / (mean(head, (r) => r.readP50) || 1);

  console.log(`\nfirst ${third} window(s) vs last ${third}:`);
  console.log(`  p50 latency   ${round(mean(head, (r) => r.p50))}ms -> ${round(mean(tail, (r) => r.p50))}ms  (x${round(p50Drift)})`);
  console.log(`  throughput    ${round(mean(head, (r) => r.appends) / WINDOW_SECONDS)}/s -> ${round(mean(tail, (r) => r.appends) / WINDOW_SECONDS)}/s  (x${round(rateDrift)})`);
  console.log(`  heap          ${round(mean(head, (r) => r.heapMb))}MB -> ${round(mean(tail, (r) => r.heapMb))}MB  (${heapGrowth >= 0 ? '+' : ''}${round(heapGrowth)}MB)`);
  console.log(`  read latency  ${round(mean(head, (r) => r.readP50))}ms -> ${round(mean(tail, (r) => r.readP50))}ms  (x${round(readDrift)})`);
  console.log(`  dead tuples   ${results[0]?.deadTuples ?? 0} -> ${results[results.length - 1]?.deadTuples ?? 0}`);

  const totalAppends = results.reduce((sum, r) => sum + r.appends, 0);
  const totalErrors = results.reduce((sum, r) => sum + r.errors, 0);
  const maxWaiting = Math.max(...results.map((r) => r.poolWaiting));
  console.log(`\ntotal ${totalAppends} appends, ${totalErrors} errors, peak pool waiters ${maxWaiting}`);
  if (errors.length) console.log('first errors: ' + errors.join(' | '));

  /*
   * The reason the lock exists. If sustained concurrent appending forked the
   * chain, every integrity guarantee above it is void.
   *
   * Paged deliberately: `verifyAuditChain` defaults to 10,000 entries from
   * sequence 0, so calling it plainly after half a million appends replays the
   * oldest ten thousand rows and reports "valid" without having looked at a
   * single entry this run produced. That reads like an end-to-end check and is
   * not one.
   */
  process.stdout.write('\nreplaying the whole chain... ');
  const PAGE = 10_000;
  let from = 0;
  let checked = 0;
  let verification = { valid: true } as Awaited<ReturnType<typeof verifyAuditChain>>;
  for (;;) {
    const page = await verifyAuditChain(pool, { fromSequence: from, limit: PAGE });
    if (!page.valid) {
      verification = page;
      break;
    }
    checked += page.entriesChecked;
    if (page.entriesChecked < PAGE) break;
    from += PAGE;
  }
  console.log(
    verification.valid
      ? `valid, ${checked} entries replayed`
      : `BROKEN at sequence ${verification.brokenAtSequence}: ${chainSentence(
          verification.verdict,
          { sequence: verification.brokenAtSequence },
        )}`,
  );

  const verdict: string[] = [];
  if (totalErrors > 0) verdict.push(`${totalErrors} errors`);
  if (p50Drift > 1.5) verdict.push(`latency drifted x${round(p50Drift)}`);
  if (rateDrift < 0.7) verdict.push(`throughput fell to x${round(rateDrift)}`);
  if (heapGrowth > 50) verdict.push(`heap grew ${round(heapGrowth)}MB`);
  // A read that has doubled while appends stayed flat is the bloat case, and
  // is invisible to every other line above.
  if (readDrift > 1.5) verdict.push(`read latency drifted x${round(readDrift)}`);
  if (!verification.valid) verdict.push('chain broken');
  console.log(verdict.length ? `\nSOAK FINDINGS: ${verdict.join('; ')}` : '\nSOAK CLEAN: no drift, no errors, chain intact');

  await closePool();
}

main().catch(async (error) => {
  console.error(error);
  await closePool();
  process.exit(1);
});
