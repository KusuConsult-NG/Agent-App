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

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';

const TESTS_DIR = 'src/tests';
const BASE_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/psirs_test';
const BASE_STORAGE = process.env.STORAGE_PATH ?? '/tmp/psirs-test-storage';

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

/*
 * Each shard needs its own document store as well as its own database.
 *
 * Storage keys are built from the document number — receipt/2026/
 * PSIRS-RCT-2026-000015.pdf — and document numbers come from
 * document_number_seq, which lives in the database. Give every shard its own
 * database and every shard's sequence starts at 1, so shard 1 and shard 3
 * produce the same document number, which is the same path in the one storage
 * directory every test process shared. They overwrite each other's PDFs, and a
 * test that renames a stored file to prove verification survives an unreadable
 * copy renames somebody else's.
 *
 * That is what the intermittent cancellations were: not a database race, a
 * filesystem one, and only visible when two shards reached the same sequence
 * number at the same moment.
 */
function storageFor(index) {
  return join(BASE_STORAGE, `s${index}`);
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
      // Kept between runs rather than dropped: migrating an empty database
      // costs 357ms, re-running settled migrations costs 4ms.
      if (rowCount === 0) await admin.query(`CREATE DATABASE "${name}"`);
    }
  } finally {
    await admin.end();
  }

  /*
   * MIGRATE EACH SHARD DATABASE BEFORE ANY TEST PROCESS STARTS.
   *
   * Twelve test files call resetDatabase() in `before` ahead of
   * startTestServer(), which is what runs the migrations — so they empty a
   * schema that does not exist yet. They have always done this and it has
   * always worked, because psirs_test was migrated long before any of them ran:
   * by CI's own migrate step, or by whatever ran last on a developer's machine.
   *
   * Fresh per-shard databases removed that assumption without anyone noticing,
   * and the first shard to run one of those files on an unmigrated database
   * lost the whole file — twelve tests reported as cancelled rather than
   * failed, which is a real failure that looks like nothing much in a summary
   * line. Migrating up front restores the precondition those files were
   * written against, rather than editing twelve files to say what CI already
   * says for the database they were built on.
   */
  for (let index = 1; index <= count; index += 1) {
    const migrated = spawnSync('npx', ['tsx', 'src/db/migrate.ts'], {
      env: { ...process.env, DATABASE_URL: databaseFor(index) },
      encoding: 'utf8',
    });
    if (migrated.status !== 0) {
      console.error(`Could not migrate shard ${index}:`);
      console.error(migrated.stdout, migrated.stderr);
      process.exit(1);
    }
  }

  /*
   * THE ENUM OBSERVATIONS ARE ABOUT THIS RUN, SO CLEAR THEM BEFORE IT.
   *
   * `enum_writes` records every state the suite writes, and the check at the
   * end of this script reads it to answer "what did nothing produce". The
   * shard databases are deliberately kept between runs, and nothing ever
   * emptied that table — so the answer was really "what has nothing produced
   * since this database was created", which is a different question and a
   * more flattering one.
   *
   * Two ways it misleads, both seen. A state a fixture wrote and then stopped
   * writing keeps being reported as reached, so deleting the only test that
   * covered a state raises no complaint. And a state written once by a fixture
   * that has since been corrected goes on being reported as an unreachable
   * state the suite reached, which is a failure the run cannot clear by fixing
   * the code — only by somebody knowing to go and empty a table by hand.
   *
   * Emptied here rather than in `installEnumObservers`, which runs once per
   * test file: truncating there would discard whatever the earlier files in
   * the same shard had already recorded.
   */
  for (let index = 1; index <= count; index += 1) {
    const client = new pg.Client({ connectionString: databaseFor(index) });
    await client.connect();
    try {
      await client.query('TRUNCATE psirs_test_observations.enum_writes');
    } catch {
      // The schema does not exist until the first test file installs the
      // observers, which is the ordinary state of a fresh shard database.
    } finally {
      await client.end();
    }
  }
}

function runShard(shard, index) {
  return new Promise((resolve) => {
    const child = spawn(
      'npx',
      ['tsx', '--test', '--test-concurrency=1', ...shard.files],
      {
        env: {
          ...process.env,
          DATABASE_URL: databaseFor(index),
          STORAGE_PATH: storageFor(index),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('close', (code) => resolve({ index, code: code ?? 1, output }));
  });
}

/*
 * Cancelled is counted, and counted as a failure.
 *
 * node:test reports a test as `cancelled` when it never finished — its file's
 * hook threw, or the process died under it. That is a whole file's worth of
 * coverage silently absent, and it does not appear in `# fail`, so a summary
 * that reports only passes and failures says "0 failed" about a run that lost
 * twelve tests. Whatever else this runner does, it must never be the reason
 * nobody noticed.
 */
function countsFrom(output) {
  const read = (label) => {
    // Several summaries can appear in one shard's output; every one counts.
    const matches = output.matchAll(new RegExp(`^# ${label} (\\d+)$`, 'gm'));
    return [...matches].reduce((total, match) => total + Number(match[1]), 0);
  };
  return {
    tests: read('tests'),
    pass: read('pass'),
    fail: read('fail'),
    cancelled: read('cancelled'),
  };
}

const shards = packShards(files, shardCount);
await ensureDatabases(shards.length);

// Emptied rather than kept: the databases are worth reusing because migrating
// them is the expensive part, but stored documents are rebuilt by whichever
// test needs them and stale ones only make a later checksum harder to trust.
for (let index = 1; index <= shards.length; index += 1) {
  rmSync(storageFor(index), { recursive: true, force: true });
  mkdirSync(storageFor(index), { recursive: true });
}

console.log(
  `Running ${files.length} test files across ${shards.length} shard(s), one database each.`,
);
if (process.env.TEST_SHARD_PLAN) {
  shards.forEach((shard, i) => console.log(`  shard ${i + 1}: ${shard.files.length} files`));
}

const startedAt = Date.now();
const results = await Promise.all(shards.map((shard, i) => runShard(shard, i + 1)));
const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);

const totals = { tests: 0, pass: 0, fail: 0, cancelled: 0 };
for (const result of results.sort((a, b) => a.index - b.index)) {
  process.stdout.write(result.output);
  const counts = countsFrom(result.output);
  result.counts = counts;
  totals.tests += counts.tests;
  totals.pass += counts.pass;
  totals.fail += counts.fail;
  totals.cancelled += counts.cancelled;
}

const failedShards = results.filter(
  (result) => result.code !== 0 || result.counts.fail > 0 || result.counts.cancelled > 0,
);

console.log(
  `\n${totals.pass}/${totals.tests} passed, ${totals.fail} failed, ` +
    `${totals.cancelled} cancelled, in ${seconds}s across ${shards.length} shard(s).`,
);

for (const shard of failedShards) {
  const { fail, cancelled } = shard.counts;
  console.log(
    `  shard ${shard.index}: exit ${shard.code}, ${fail} failed, ${cancelled} cancelled` +
      (cancelled > 0
        ? ' — cancelled means a file did not run to completion, so those tests were never checked'
        : ''),
  );
  if (cancelled > 0) {
    // Name the files the shard was given, because the cancelled tests are the
    // ones whose names never got printed.
    console.log(`    files: ${shards[shard.index - 1].files.join(' ')}`);
  }
}

/*
 * Say again, at the end, what actually failed.
 *
 * The shard output above is complete, and on a full suite it is a hundred
 * thousand lines of it. GitHub's log API serves only a tail, the raw archive
 * is not always reachable, and shard 1 prints first — so a failure in the
 * first shard of a long run is, in practice, unreadable. One run failed
 * `1398/1399` with no way to learn which test that was.
 *
 * The summary is what a person reads, so the diagnosis belongs beside it. This
 * repeats each failing shard's `not ok` lines and the diagnostic block under
 * them, which is the part with the assertion in it.
 */
function failureDigest(output) {
  const lines = output.split('\n');
  const blocks = [];
  for (let i = 0; i < lines.length; i += 1) {
    const header = /^(\s*)not ok \d+ - /.exec(lines[i]);
    if (!header) continue;
    const indent = header[1];
    const block = [lines[i]];
    /*
     * The YAML diagnostic node that follows carries the assertion, the
     * expected and actual values, and the stack. It opens with `---` and
     * closes with `...` at the same indent as the `not ok`; stopping at that
     * terminator is what keeps the digest from running on into the next
     * test's server logs.
     */
    for (let j = i + 1; j < lines.length; j += 1) {
      block.push(lines[j]);
      if (lines[j] === `${indent}  ...`) break;
      if (/^\s*(not )?ok \d+ - /.test(lines[j])) break;
    }
    const text = block.join('\n');
    // A parent suite fails because a child did, and the child has already
    // printed the assertion. Repeating the parent says only "1 subtest
    // failed", which is the one thing the summary line already told you.
    if (/failureType: 'subtestsFailed'/.test(text)) continue;
    blocks.push(text);
  }
  return blocks;
}

for (const shard of failedShards) {
  const blocks = failureDigest(shard.output);
  if (blocks.length === 0) {
    // Exit code but no `not ok`: the process died rather than a test failing.
    // The last of its output is the only evidence there is.
    console.log(`\n--- shard ${shard.index} failed without reporting a test ---`);
    console.log(shard.output.split('\n').slice(-40).join('\n'));
    continue;
  }
  console.log(`\n--- shard ${shard.index}: ${blocks.length} failing test(s) ---`);
  for (const block of blocks) console.log(block);
}

/*
 * What the suite never wrote.
 *
 * Runs here rather than as a test file because no single shard sees more than
 * a quarter of the suite, and the question is about the whole of it: which of
 * the states the schema allows did nothing produce, across every shard
 * together. The triggers that recorded it are installed by `startTestServer`.
 *
 * Skipped when a shard failed. A shard that stopped early wrote less than it
 * would have, so every state its files would have reached looks unreached —
 * which would bury a real failure under a page of noise about coverage.
 */
let coverageFailed = false;
if (failedShards.length === 0) {
  const urls = shards.map((_, index) => databaseFor(index + 1));
  const check = spawnSync('npx', ['tsx', 'scripts/check-enum-coverage.ts', ...urls], {
    stdio: 'inherit',
  });
  coverageFailed = check.status !== 0;
}

// Set the code and let the process end on its own. `process.exit` here
// truncates the shard output above it whenever stdout is a pipe — which is
// every CI run, and is how this script first appeared to lose a whole shard.
process.exitCode = failedShards.length > 0 || coverageFailed ? 1 : 0;
