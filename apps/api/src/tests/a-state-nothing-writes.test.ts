/**
 * Every state the schema allows, reachable by something.
 *
 * A long run of adversarial passes over this platform kept turning up the same
 * defect wearing different clothes: a value the schema declares, the
 * permissions cover and the reports count — that nothing ever writes.
 *
 *   documents.status         REVOKED had a branch in `verifyPublicly` and no
 *                            writer, so a reversed vehicle renewal verified as
 *                            genuine at a checkpoint for two years
 *   settlements.status       RECONCILED was the state a finance officer's
 *                            screen filtered on; no settlement ever reached it
 *   commission_payouts       FAILED was what a refused bank transfer was meant
 *                            to become; a refused transfer stayed APPROVED and
 *                            the commission stayed spent
 *   agent_devices.status     SUSPENDED existed so a handset could be paused;
 *                            the only lever was REVOKED, which is permanent
 *
 * Each was found by hand, one path at a time, and each time the finding was
 * the same shape. So this stops being an audit and becomes a property: a value
 * the database will accept has to be a value the platform can produce, or it
 * has to be named below with the reason it cannot be.
 *
 * WHAT THIS CANNOT SEE. It reads source text, so it proves absence of the
 * *name*, not absence of a write. Three blind spots, stated rather than
 * implied:
 *
 *   - A value whose word appears somewhere else passes. `receipts.status`
 *     could be VOID and nothing wrote it, but `'VOID'` is also one of the
 *     outcomes the agent's Verify screen renders for a document, so the word
 *     was present and this check was satisfied. Migration 034 drops that value
 *     rather than leaving the check quietly wrong about it — which is the only
 *     honest response to a blind spot you have already found something in.
 *   - Scoping the search to files that name the table would close that gap,
 *     and was tried: it reports 70 more, and every one sampled was a false
 *     positive — dropdown options in a screen that names no table, values
 *     validated by a shared enum. A check that cries wolf gets an allowlist
 *     entry instead of a fix, which is the failure this file exists to
 *     prevent. The narrower rule is used below only for the staleness half,
 *     where erring towards silence is the safe direction.
 *   - A value that is read but never written passes either way, because
 *     reading it mentions it. That is precisely what RECONCILED and FAILED
 *     were above, and nothing here would have caught them.
 *
 * THE THIRD ONE WAS TRIED PROPERLY, AND DOES NOT WORK FROM SOURCE. Written
 * down so the next person does not spend the day rediscovering it:
 *
 *   - *Scope the search to files naming the table.* Reports 70 more; every one
 *     sampled was a value the platform writes through a validated payload,
 *     which no file names next to its table.
 *   - *Scope it, and treat a shared enum or option list as a write.* Brings it
 *     to 22 — and re-masks `agent_devices.APPROVED`, the motivating case,
 *     because APPROVED is a legitimate value of `approvals.status` elsewhere.
 *     A rule that misses the thing it was built for is not a rule.
 *   - *Invert the question: is every value the code compares against one it
 *     can also set?* This is the right question and it reports 81, of which
 *     roughly seventy are wrong — a value written through a ternary, a helper
 *     parameter or a column default reads as compare-only. Tightening the
 *     write detection to fix those is what re-masks the true positives again.
 *
 * So the honest position is that this file catches the first half of the class
 * and not the second. `agent_devices.APPROVED` — read by three queries,
 * written by nothing, reached for by three test fixtures because it looked
 * legitimate — was found by reading the device path, and its successor will be
 * found the same way. Runtime observation would close it: record what the
 * suite actually writes to every enum column and compare. That is a real piece
 * of work, it slows the suite, and it conflates "nothing writes this" with
 * "no test covers this" unless the two lists are kept apart.
 *
 * A value the column *defaults* to is written by the database on every insert
 * that omits it, so defaults are excluded before anything is reported.
 */

import './env';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pool, resetDatabase, startTestServer, stopTestServer } from './helpers';
import { DELIBERATELY_UNREACHABLE } from './enum-coverage';

before(async () => {
  await resetDatabase();
  await startTestServer();
});

after(async () => {
  await stopTestServer();
});

function workspaceRoot(): string {
  let directory = process.cwd();
  for (;;) {
    const manifest = join(directory, 'package.json');
    if (existsSync(manifest)) {
      const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { workspaces?: unknown };
      if (parsed.workspaces) return directory;
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error('no workspace root above ' + process.cwd());
    directory = parent;
  }
}

/** Everything the platform ships, minus the tests that describe it. */
const SOURCE_ROOTS = [
  'apps/api/src',
  'apps/agent/src',
  'apps/portal/src',
  'packages/shared/src',
];

function sourceFiles(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      if (entry !== 'tests' && entry !== 'node_modules') sourceFiles(path, found);
      continue;
    }
    if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) found.push(path);
  }
  return found;
}

interface EnumColumn {
  table: string;
  column: string;
  values: string[];
}

/**
 * Enum columns as the database has them, not as the migrations wrote them.
 *
 * Read from `pg_constraint` rather than by parsing SQL files because a
 * constraint can be replaced later — migration 031 widened
 * `fraud_flags.entity_type` to admit SETTLEMENT, and a scan of CREATE TABLE
 * statements would still be reporting the original five values.
 */
async function enumColumns(): Promise<EnumColumn[]> {
  const { rows } = await pool.query<{ table_name: string; definition: string }>(
    `SELECT c.relname AS table_name, pg_get_constraintdef(con.oid) AS definition
       FROM pg_constraint con
       JOIN pg_class c ON c.oid = con.conrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE con.contype = 'c' AND n.nspname = 'public'
        AND pg_get_constraintdef(con.oid) LIKE '%ANY (ARRAY%'
      ORDER BY c.relname, con.conname`,
  );

  return rows.flatMap(({ table_name, definition }) => {
    const column = /\(([a-z_]+) = ANY \(ARRAY/.exec(definition);
    assert.ok(column, `could not read the column out of: ${definition}`);
    const values = [...definition.matchAll(/'([A-Z][A-Z0-9_]*)'::text/g)].map((match) => match[1]);
    // Lower-case sets — `usage_events.language` is 'en' and 'ha' — are values
    // of a different kind and are not states anything transitions to.
    return values.length > 0 ? [{ table: table_name, column: column[1], values }] : [];
  });
}

/** `table.column` → the value the database writes when an insert omits it. */
async function columnDefaults(): Promise<Map<string, string>> {
  const { rows } = await pool.query<{ table_name: string; column_name: string; column_default: string }>(
    `SELECT table_name, column_name, column_default
       FROM information_schema.columns
      WHERE table_schema = 'public' AND column_default IS NOT NULL`,
  );
  const defaults = new Map<string, string>();
  for (const row of rows) {
    const literal = /^'([A-Z][A-Z0-9_]*)'::text$/.exec(row.column_default);
    if (literal) defaults.set(`${row.table_name}.${row.column_name}`, literal[1]);
  }
  return defaults;
}

describe('a state nothing writes', () => {
  it('is either reachable, or named here with the reason it is not', async () => {
    const repoRoot = workspaceRoot();
    const files = SOURCE_ROOTS.flatMap((root) => sourceFiles(join(repoRoot, root)));
    assert.ok(files.length > 140, `expected the whole platform, found ${files.length} files`);

    const named = new Set<string>();
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/['"`]([A-Z][A-Z0-9_]*)['"`]/g)) named.add(match[1]);
    }

    const defaults = await columnDefaults();
    const columns = await enumColumns();
    assert.ok(columns.length > 100, `expected the whole schema, found ${columns.length} enums`);

    const orphaned: string[] = [];
    for (const { table, column, values } of columns) {
      for (const value of values) {
        if (named.has(value)) continue;
        if (defaults.get(`${table}.${column}`) === value) continue;
        orphaned.push(`${table}.${column}: ${value}`);
      }
    }

    const unexplained = orphaned.filter((state) => !(state in DELIBERATELY_UNREACHABLE));
    assert.deepEqual(
      unexplained,
      [],
      'The schema will accept these states and nothing on the platform produces them. ' +
        'Either write them, or add each one to DELIBERATELY_UNREACHABLE with its reason:\n  ' +
        unexplained.join('\n  '),
    );
  });

  /*
   * The staleness half of this moved out, and had to.
   *
   * It used to fail when a value listed as unreachable turned out to be
   * mentioned in a file naming its table. That is word-matching, and it cannot
   * tell a mention from a write — so the moment the runtime observation added
   * `refunds.status: PROCESSING` and friends to the list, this reported all of
   * them as "something writes this now" when nothing does. The check was
   * asserting the exact confusion it exists to prevent.
   *
   * `scripts/check-enum-coverage.ts` owns the question instead, and answers it
   * from evidence: a state listed as unreachable that the suite actually wrote
   * is a stale excuse, and nothing else is. It cannot make this mistake because
   * it is not reading words.
   */
});
