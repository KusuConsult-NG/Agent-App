/**
 * Queries that filter on a value nothing ever writes.
 *
 * `enum-coverage.ts` records, for each declared enum value the suite never
 * observes, why it is unreachable. Those reasons are load-bearing: several say
 * some variant of "this is recorded elsewhere, which is what the reports read".
 * A query that reads the unreachable value anyway is not refused by anything —
 * it returns zero rows, or a zero count, and looks like a finding about the
 * business rather than a bug in a predicate.
 *
 * It has happened twice, both times to a money column:
 *
 *   * `paid_last_year_kobo` filtered `transactions.status` on
 *     PAYMENT_CONFIRMED and RECEIPTED, neither of which that table's CHECK
 *     constraint allows, so an employer who had paid inside 72 hours showed
 *     zero on an enforcement list.
 *   * `taxpayerAnalytics.byCategory` counted `taxpayers_paid` with
 *     `asm.status IN ('SETTLED')`, and nothing writes `assessments.status =
 *     'SETTLED'`. Every category on every register reported that nobody had
 *     ever paid anything. The enum-coverage exception for that value says, in
 *     as many words, that settlement "is recorded on the invoice and the
 *     transaction, which is what the reports read".
 *
 * WHAT IT FLAGS, AND WHAT IT DELIBERATELY DOES NOT
 *
 * Only where the unreachable value is the *sole* discriminator — `col = 'X'`,
 * or `col IN ('X')` with no other member. An unreachable value sitting in a
 * longer IN-list alongside reachable ones changes no answer; flagging those
 * would be 34 entries of noise, and a tool that cries wolf gets muted, which
 * is worse than not having it. The route-coverage tool's own header makes this
 * point about an error in the opposite direction: a measurement is only worth
 * what the counting is worth.
 *
 * HOW THE COLUMN IS ATTRIBUTED TO A TABLE
 *
 * By alias, not by proximity. A first version matched any `status = 'FAILED'`
 * appearing in a statement that mentioned `vehicle_renewals` anywhere, and so
 * reported `lib/metrics.ts`, where the two belong to different subqueries and
 * the predicate is really `notifications.status = 'FAILED'` — a reachable
 * state. `FROM x AS a` and `JOIN x a` are read into an alias map, and a
 * comparison counts only when it is qualified with an alias bound to that
 * table, or unqualified in a statement naming exactly one table.
 *
 *   node apps/api/scripts/check-dead-predicates.mjs   (from the repository root)
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const API = 'apps/api/src';

/* The values the coverage tool says nothing writes. */
const exceptions = readFileSync(join(API, 'tests/enum-coverage.ts'), 'utf8');
const unreachable = [...exceptions.matchAll(/'([a-z_]+)\.([a-z_]+):\s*([A-Z0-9_]+)'\s*:/g)].map(
  (m) => ({ table: m[1], column: m[2], value: m[3] }),
);

const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry !== 'tests') walk(path);
    } else if (path.endsWith('.ts')) files.push(path);
  }
};
for (const dir of ['services', 'routes', 'lib', 'db']) walk(join(API, dir));

/** Every backtick template literal in a source file, with its offset. */
function templateLiterals(source) {
  const found = [];
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== '`') continue;
    let j = i + 1;
    while (j < source.length && source[j] !== '`') j += source[j] === '\\' ? 2 : 1;
    found.push({ at: i, text: source.slice(i, j + 1) });
    i = j;
  }
  return found;
}

/** alias -> table, plus the set of tables the statement reads at all. */
function aliases(sql) {
  const map = new Map();
  const tables = new Set();
  for (const m of sql.matchAll(/\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*)(?:\s+(?:AS\s+)?([a-z_][a-z0-9_]*))?/gi)) {
    const table = m[1].toLowerCase();
    if (['select', 'lateral', 'unnest', 'generate_series'].includes(table)) continue;
    tables.add(table);
    const alias = m[2]?.toLowerCase();
    if (alias && !['on', 'using', 'where', 'set', 'as', 'group', 'order', 'left', 'join', 'inner', 'full', 'cross'].includes(alias))
      map.set(alias, table);
  }
  return { map, tables };
}

/**
 * Predicates that read an unreachable value on purpose, and why.
 *
 * Keyed without a line number so the entry survives edits above it. An
 * acknowledgement list is how a guard gets quietly neutered, so there are two
 * rules on it: every entry states a reason, and an entry that stops matching
 * anything fails the run rather than lingering. The second is the one that
 * matters — a stale acknowledgement is an assertion about the code that is no
 * longer true, which is the fault this whole tool exists to catch.
 */
const ACKNOWLEDGED = new Map([
  [
    "apps/api/src/routes/payments.ts documents.owner_type='AGENT'",
    'Deliberate breadth in an ownership CASE, not a figure anybody reads. The ' +
      'branch answers "which agent is this document scoped to" and feeds ' +
      '`assertOwnRecord`, which refuses a null owner, so the branch being inert ' +
      'costs nothing today. Deleting it would mean that if agent-owned documents ' +
      'are ever issued they are scoped to nobody and hidden from their own owner. ' +
      'Inert and correct beats absent and wrong.',
  ],
]);

const findings = [];
for (const file of files) {
  const source = readFileSync(file, 'utf8');
  for (const { at, text } of templateLiterals(source)) {
    if (text.length < 40) continue;
    const { map, tables } = aliases(text);
    if (tables.size === 0) continue;

    for (const { table, column, value } of unreachable) {
      if (!tables.has(table)) continue;

      const sole = new RegExp(
        String.raw`(?:([a-z_][a-z0-9_]*)\.)?\b${column}\b\s*(?:=\s*'${value}'|IN\s*\(\s*'${value}'\s*\))`,
        'gi',
      );
      sole.lastIndex = 0;
      for (const m of text.matchAll(sole)) {
        const qualifier = m[1]?.toLowerCase();
        const boundTo = qualifier ? map.get(qualifier) : tables.size === 1 ? [...tables][0] : null;
        if (boundTo !== table) continue;
        findings.push({
          file,
          line: source.slice(0, at).split('\n').length,
          table,
          column,
          value,
          snippet: m[0].trim(),
        });
      }
    }
  }
}

const keyOf = (f) => `${f.file} ${f.table}.${f.column}='${f.value}'`;
const matched = new Set(findings.map(keyOf).filter((k) => ACKNOWLEDGED.has(k)));
const unexplained = findings.filter((f) => !ACKNOWLEDGED.has(keyOf(f)));
const stale = [...ACKNOWLEDGED.keys()].filter((k) => !matched.has(k));

if (stale.length > 0) {
  console.error(`${stale.length} acknowledgement${stale.length === 1 ? ' no longer matches' : 's no longer match'} anything:\n`);
  for (const key of stale) console.error(`  ${key}`);
  console.error('\nThe predicate was changed or removed. Delete the entry rather than leave a claim about code that is gone.');
  process.exit(1);
}

if (unexplained.length === 0) {
  console.log(
    `checked ${unreachable.length} unreachable values across ${files.length} files: ` +
      `no dead predicates (${ACKNOWLEDGED.size} acknowledged)`,
  );
  process.exit(0);
}

console.error(`${unexplained.length} quer${unexplained.length === 1 ? 'y filters' : 'ies filter'} on a value nothing writes:\n`);
for (const f of unexplained) {
  console.error(`  ${f.file}:${f.line}`);
  console.error(`    ${f.snippet}   — ${f.table}.${f.column} is never written with '${f.value}'`);
  const reason = exceptions.match(new RegExp(`'${f.table}\\.${f.column}: ${f.value}'\\s*:\\s*\\n?\\s*'([^']*)'`));
  if (reason) console.error(`    enum-coverage says: ${reason[1]}\n`);
}
console.error('This predicate matches nothing. The column it computes is silently zero or empty.');
process.exit(1);
