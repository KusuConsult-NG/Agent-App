/**
 * Run the API test suite in parallel shards, one database each.
 *
 * The suite is serial — `--test-concurrency=1` — for one reason: every
 * integration file truncates and reseeds the same database, so two files
 * running at once destroy each other's fixtures. That constraint is real, and
 * it cost the suite its whole parallelism: 93 files, one at a time, on a
 * four-core machine, with three of the cores idle.
 *
 * The constraint is per database, not per suite. So each shard gets its own
 * database and stays serial inside itself, which is exactly the invariant the
 * suite already depends on, kept N times over.
 *
 * WHY NOT let node's runner schedule the files itself, with each process
 * claiming a database as it starts? Because then the assignment has to be
 * negotiated at runtime — an advisory lock held open for the life of every
 * test process — and a harness whose failure mode is "two shards quietly
 * shared a database" is worse than a slightly less even split. Here the
 * assignment is decided before anything runs and printed if you ask for it.
 *
 * BALANCING. Longest-first bin packing over file size. Size predicts duration
 * only loosely (Pearson 0.30 when measured), but with this many files greedy
 * packing lands within about 3% of a perfect split anyway, and it needs no
 * timing file to go stale.
 */

import { spawn } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';

const TESTS_DIR = 'src/tests';
const BASE_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/psirs_test';

const shardCount = Math.max(
  1,
  Number(process.env.TEST_SHARDS ?? Math.min(4, availableParallelism())),
);

const files = readdirSync(TESTS_DIR)
  .filter((name) => name.endsWith('.test.ts'))
  .map((name) => join(TESTS_DIR, name));

if (files.length === 0) {
  console.error('No test files found in', TESTS_DIR);
  process.exit(1);
}

/** Longest-first onto the emptiest shard. */
function packShards(paths, count) {
  const shards = Array.from({ length: count }, () => ({ files: [], weight: 0 }));
  for (const path of [...paths].sort((a, b) => statSync(b).size - statSync(a).size)) {
    const lightest = shards.reduce((a, b) => (b.weight < a.weight ? b : a));
    lightest.files.push(path);
    lightest.weight += statSync(path).size;
  }
  return shards.filter((shard) => shard.files.length > 0);
}

function databaseFor(index) {
  // A suffix rather than a rename, so `psirs_test` stays untouched and running
  // a single file by hand still works the way it always did.
  return BASE_URL.replace(/\/([^/?]+)(\?.*)?$/, (_m, name, query) => `/${name}_s${index}${query ?? ''}`);
}

async function ensureDatabases(count) {
  const adminUrl = BASE_URL.replace(/\/([^/?]+)(\?.*)?$/, (_m, _name, query) => `/postgres${query ?? ''}`);
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    for (let index = 1; index <= count; index += 1) {
      const name = new URL(databaseFor(index)).pathname.slice(1);
      const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
      // Migrations run on first use inside startTestServer: 357ms on an empty
      // database, 4ms once they are applied, so a shard database is worth
      // keeping between runs rather than dropping.
      if (rowCount === 0) await admin.query(`CREATE DATABASE "${name}"`);
    }
  } finally {
    await admin.end();
  }
}

function runShard(shard, index) {
  return new Promise((resolve) => {
    const child = spawn(
      'npx',
      ['tsx', '--test', '--test-concurrency=1', ...shard.files],
      {
        env: { ...process.env, DATABASE_URL: databaseFor(index) },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('close', (code) => resolve({ index, code: code ?? 1, output }));
  });
}

function countsFrom(output) {
  const read = (label) => {
    const match = output.match(new RegExp(`^# ${label} (\\d+)$`, 'm'));
    return match ? Number(match[1]) : 0;
  };
  return { tests: read('tests'), pass: read('pass'), fail: read('fail') };
}

const shards = packShards(files, shardCount);
await ensureDatabases(shards.length);

console.log(
  `Running ${files.length} test files across ${shards.length} shard(s), one database each.`,
);
if (process.env.TEST_SHARD_PLAN) {
  shards.forEach((shard, i) => console.log(`  shard ${i + 1}: ${shard.files.length} files`));
}

const startedAt = Date.now();
const results = await Promise.all(shards.map((shard, i) => runShard(shard, i + 1)));
const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);

const totals = { tests: 0, pass: 0, fail: 0 };
for (const result of results.sort((a, b) => a.index - b.index)) {
  process.stdout.write(result.output);
  const counts = countsFrom(result.output);
  totals.tests += counts.tests;
  totals.pass += counts.pass;
  totals.fail += counts.fail;
}

const failedShards = results.filter((result) => result.code !== 0);
console.log(
  `\n${totals.pass}/${totals.tests} passed, ${totals.fail} failed, in ${seconds}s ` +
    `across ${shards.length} shard(s).`,
);
if (failedShards.length > 0) {
  console.log(`Shards that failed: ${failedShards.map((r) => r.index).join(', ')}`);
}

// Set the code and let the process end on its own. `process.exit` here
// truncates the shard output above it whenever stdout is a pipe — which is
// every CI run, and is how this script first appeared to lose a whole shard.
process.exitCode = failedShards.length > 0 ? 1 : 0;
