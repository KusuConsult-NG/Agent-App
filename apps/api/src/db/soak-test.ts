/**
 * Sustained soak.
 *
 * The load measurement runs for minutes and answers "how fast". This runs for
 * as long as you give it and answers a different question: "does it stay that
 * way". The failure modes it looks for do not appear in a short run, because
 * they are all accumulations.
 *
 *   Connection leaks     a path that takes a client and forgets to release it
 *                        looks perfect until the pool is exhausted, and then
 *                        every request blocks at once. The pool is small, so
 *                        one leak in a rarely-taken branch can take hours to
 *                        surface and then take everything down together.
 *
 *   Memory growth        a cache with no bound, a listener added per request.
 *                        Fine overnight, an OOM on market day.
 *
 *   Index and table bloat  the audit chain and transaction tables only grow.
 *                        Dead tuples accumulate where rows are updated, and a
 *                        query that was 0.02ms on a fresh table is not
 *                        necessarily 0.02ms on a bloated one.
 *
 *   Drift                the point of a soak. A p50 that is 1.5ms in the first
 *                        minute and 1.5ms in the last is a system that will
 *                        still be standing tomorrow. One that has doubled is
 *                        not, however good the average looks.
 *
 * Progress is reported per interval rather than only at the end, so a run that
 * is killed still leaves usable evidence — and so a degradation is visible
 * while it happens rather than only in the summary.
 */

process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgres://postgres:postgres@localhost:5432/psirs_test';
process.env.JWT_SECRET ??= 'soak-test-jwt-secret-value-long-enough-32';
process.env.IDENTITY_HASH_SECRET ??= 'soak-test-identity-secret-long-enough-32';
process.env.PAYMENT_WEBHOOK_SECRET ??= 'soak-test-webhook-secret-long-enough-32';
process.env.STORAGE_PATH ??= '/tmp/psirs-soak-storage';

import { pool } from './pool';
import { recordAuditStandalone } from '../services/audit';

const DURATION_MS = Number(process.env.SOAK_SECONDS ?? 300) * 1000;
const INTERVAL_MS = Number(process.env.SOAK_INTERVAL_SECONDS ?? 30) * 1000;
const CONCURRENCY = Number(process.env.SOAK_CONCURRENCY ?? 8);

interface Window {
  index: number;
  writes: number;
  reads: number;
  errors: number;
  writeP50: number;
  readP50: number;
  rssMb: number;
  heapMb: number;
  poolTotal: number;
  poolIdle: number;
  poolWaiting: number;
  deadTuples: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round((sorted[Math.floor(sorted.length / 2)] ?? 0) * 100) / 100;
}

async function ms(fn: () => Promise<unknown>): Promise<number> {
  const started = process.hrtime.bigint();
  await fn();
  return Number(process.hrtime.bigint() - started) / 1_000_000;
}

/** Dead tuples across the tables that only grow. Bloat, if it is happening. */
async function deadTuples(): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `SELECT COALESCE(SUM(n_dead_tup), 0)::text AS n
       FROM pg_stat_user_tables
      WHERE relname IN ('audit_logs','transactions','payments','receipts','taxpayers')`,
  );
  return Number(rows[0]!.n);
}

async function main(): Promise<void> {
  console.log('\nPSIRS sustained soak');
  console.log('='.repeat(104));
  console.log(
    `  ${DURATION_MS / 1000}s at concurrency ${CONCURRENCY}, reporting every ${INTERVAL_MS / 1000}s\n`,
  );

  const startedAt = Date.now();
  const endsAt = startedAt + DURATION_MS;
  const windows: Window[] = [];

  let writeTimes: number[] = [];
  let readTimes: number[] = [];
  let errors = 0;
  let stop = false;

  // A signal should end the run tidily and still print what it learned; a soak
  // killed at hour three should not lose three hours of evidence.
  const finish = () => {
    stop = true;
  };
  process.on('SIGINT', finish);
  process.on('SIGTERM', finish);

  async function worker(): Promise<void> {
    while (!stop && Date.now() < endsAt) {
      try {
        // The write path's real bottleneck, exercised through the service so
        // the hash chain and its advisory lock are included.
        writeTimes.push(
          await ms(() =>
            recordAuditStandalone({
              actorId: null,
              actorRole: 'system',
              action: 'soak.probe',
              entityType: 'soak',
              entityId: null,
              newValue: { at: Date.now() },
            } as Parameters<typeof recordAuditStandalone>[0]),
          ),
        );

        readTimes.push(
          await ms(() =>
            pool.query('SELECT id FROM taxpayers WHERE tin = $1', [
              `PL${String(10_000_000 + Math.floor(Math.random() * 9_000)).padStart(8, '0')}`,
            ]),
          ),
        );
      } catch {
        errors += 1;
      }
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, worker);

  console.log(
    `  ${'win'.padStart(4)}${'writes'.padStart(9)}${'reads'.padStart(8)}${'w-p50'.padStart(9)}${'r-p50'.padStart(9)}${'rss MB'.padStart(9)}${'heap MB'.padStart(9)}${'pool t/i/w'.padStart(13)}${'dead tup'.padStart(10)}${'err'.padStart(6)}`,
  );
  console.log(`  ${'-'.repeat(102)}`);

  let index = 0;
  while (!stop && Date.now() < endsAt) {
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
    index += 1;

    const memory = process.memoryUsage();
    const window: Window = {
      index,
      writes: writeTimes.length,
      reads: readTimes.length,
      errors,
      writeP50: median(writeTimes),
      readP50: median(readTimes),
      rssMb: Math.round(memory.rss / 1_048_576),
      heapMb: Math.round(memory.heapUsed / 1_048_576),
      poolTotal: pool.totalCount,
      poolIdle: pool.idleCount,
      poolWaiting: pool.waitingCount,
      deadTuples: await deadTuples(),
    };
    windows.push(window);

    console.log(
      `  ${String(window.index).padStart(4)}${String(window.writes).padStart(9)}${String(window.reads).padStart(8)}` +
        `${String(window.writeP50).padStart(9)}${String(window.readP50).padStart(9)}` +
        `${String(window.rssMb).padStart(9)}${String(window.heapMb).padStart(9)}` +
        `${`${window.poolTotal}/${window.poolIdle}/${window.poolWaiting}`.padStart(13)}` +
        `${String(window.deadTuples).padStart(10)}${String(window.errors).padStart(6)}`,
    );

    // Reset per-window so each row is that window, not a running average —
    // an average hides the drift a soak exists to find.
    writeTimes = [];
    readTimes = [];
  }

  stop = true;
  await Promise.all(workers);

  // ---------------------------------------------------------------------
  console.log('\nVerdict');
  console.log('-'.repeat(104));

  const first = windows[0];
  const last = windows[windows.length - 1];
  if (!first || !last || windows.length < 2) {
    console.log('  Too few windows to judge drift. Increase SOAK_SECONDS.');
    await pool.end();
    return;
  }

  const problems: string[] = [];
  const note = (ok: boolean, label: string, detail: string) => {
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(34)} ${detail}`);
    if (!ok) problems.push(label);
  };

  const writeDrift = last.writeP50 / Math.max(first.writeP50, 0.01);
  note(
    writeDrift < 2,
    'write latency held',
    `first window ${first.writeP50}ms → last ${last.writeP50}ms (${writeDrift.toFixed(2)}×)`,
  );

  const readDrift = last.readP50 / Math.max(first.readP50, 0.01);
  note(
    readDrift < 3,
    'read latency held',
    `first window ${first.readP50}ms → last ${last.readP50}ms (${readDrift.toFixed(2)}×)`,
  );

  const heapGrowth = last.heapMb - first.heapMb;
  note(
    heapGrowth < 100,
    'heap did not run away',
    `${first.heapMb}MB → ${last.heapMb}MB (${heapGrowth >= 0 ? '+' : ''}${heapGrowth}MB)`,
  );

  // The pool is the one that fails catastrophically rather than gradually: a
  // leak shows as idle sinking toward zero while waiting climbs.
  const everWaiting = Math.max(...windows.map((w) => w.poolWaiting));
  note(
    last.poolIdle > 0 || everWaiting === 0,
    'no connection leak',
    `final total/idle/waiting ${last.poolTotal}/${last.poolIdle}/${last.poolWaiting}, peak waiting ${everWaiting}`,
  );

  note(last.errors === 0, 'no errors', `${last.errors} across the run`);

  const totalWrites = windows.reduce((sum, w) => sum + w.writes, 0);
  const elapsed = (Date.now() - startedAt) / 1000;
  console.log(
    `\n  ${totalWrites} audit appends in ${Math.round(elapsed)}s — ${Math.round(totalWrites / elapsed)}/second sustained\n`,
  );

  if (problems.length > 0) {
    console.log(`  Soak found: ${problems.join(', ')}\n`);
    await pool.end();
    process.exit(1);
  }
  console.log('  Nothing degraded over the run.\n');
  await pool.end();
}

main().catch(async (error) => {
  console.error('Soak failed:', error);
  await pool.end();
  process.exit(1);
});
