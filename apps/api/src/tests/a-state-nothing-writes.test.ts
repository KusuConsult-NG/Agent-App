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

before(async () => {
  await resetDatabase();
  await startTestServer();
});

after(async () => {
  await stopTestServer();
});

/**
 * States nothing writes, on purpose, with the reason each one stays.
 *
 * Keyed `table.column: VALUE`. Adding a line here is a statement that the
 * platform is not meant to reach this state — not a way to silence the check.
 */
const DELIBERATELY_UNREACHABLE: Record<string, string> = {
  /*
   * Reference data nobody can publish a second version of.
   *
   * All four tables are seeded once and never edited through an API: there is
   * no screen that writes an agreement, a commission policy or a training
   * module, so there is never an older version to retire. The day one is
   * added, retiring its predecessor is part of adding it, and this line goes.
   */
  'agreement_versions.status: RETIRED':
    'Agreement versions are seeded; no endpoint publishes a second one to supersede the first.',
  'commission_policies.status: RETIRED':
    'Commission policies are seeded; no endpoint publishes a replacement policy.',
  'training_modules.status: RETIRED':
    'Training modules are seeded; no endpoint publishes a replacement module.',

  /*
   * A column that describes rather than decides. Nothing reads
   * `settlement_schedule` — a payout is requested by the agent and approved by
   * an officer, not produced by a scheduler — so every one of its four values
   * is equally inert, and WEEKLY only appears because the seed writes it.
   */
  'commission_policies.settlement_schedule: FORTNIGHTLY':
    'No scheduler reads settlement_schedule; payouts are requested and approved, never timed.',

  /*
   * Public verification is logged, in a better place.
   *
   * `verification_attempts` records every lookup with its result, including —
   * and this is the reason it is the right table — the ones that resolve to no
   * document at all. Somebody typing receipt numbers until one answers is the
   * pattern worth seeing, and a log keyed on `document_id` cannot hold it.
   * Writing VERIFY here as well would duplicate the row that matters and lose
   * the ones that matter more.
   */
  'document_access_logs.access_type: VERIFY':
    'Public verification is recorded in verification_attempts, which also holds the lookups that find nothing.',

  /* Nothing shares a document. Access is download or public verification. */
  'document_access_logs.access_type: SHARE':
    'The platform has no document sharing; a taxpayer forwards the PDF itself, off-platform.',

  /*
   * Delivery receipts the providers do not send us. The SMS and email adapters
   * report acceptance, which is SENT; neither has a delivery-report callback
   * wired, and nothing in the platform can observe a person reading an SMS.
   * DELIVERED becomes reachable the day a provider callback lands; READ never
   * does through SMS or email.
   */
  'notifications.status: DELIVERED':
    'No provider delivery-report callback is wired; the adapters report acceptance only.',
  'notifications.status: READ':
    'Neither SMS nor email can tell us a message was read.',

  /*
   * Draft kinds the agent application does not queue. It captures a taxpayer
   * registration and a vehicle; a service request is made online against a
   * live catalogue, and a document is captured inside the registration it
   * belongs to rather than as a draft of its own.
   */
  'offline_drafts.draft_type: SERVICE_REQUEST':
    'The agent app queues registrations and vehicles; a service request needs the live catalogue.',
  'offline_drafts.draft_type: DOCUMENT_CAPTURE':
    'Documents are captured inside the registration draft that carries them, not as a draft.',

  /*
   * Refused deliberately, one pass ago. `recordReversal` requires the refund
   * to equal the payment exactly, because a partial refund against an
   * integer-kobo payment has no verified remainder — the gateway confirms the
   * whole reversal or none of it. The value stays in the constraint so that
   * enabling partial refunds is a schema-free change; the refusal is in code
   * and is tested by name.
   */
  'refunds.refund_type: PARTIAL':
    'Partial refunds are refused in recordReversal; a refund must equal its payment.',

  /* PSIRS collects state and local government revenue. Federal is the FIRS. */
  'revenue_authorities.tier: FEDERAL':
    'Federal revenue is the FIRS, not PSIRS; the tier exists for completeness of the taxonomy.',

  /*
   * Taxpayers and vehicles this platform did not create. There is no importer
   * and no PSIRS feed: every record here was captured by an agent. Both
   * columns exist for the migration that has not happened.
   */
  'taxpayers.source: MIGRATION':
    'No bulk importer exists; every taxpayer on the platform was captured by an agent.',
  'taxpayers.source: PSIRS_SYNC':
    'No PSIRS feed is connected; the integration is TIN issuance, not record sync.',
  'vehicles.source: MIGRATION':
    'No bulk importer exists; every vehicle was captured by an agent or an authority lookup.',

  /*
   * Merging duplicate taxpayers. `existing-tin.test.ts` covers refusing a
   * duplicate at the door, which is the control that matters; reconciling two
   * records that already exist means moving assessments, invoices, payments,
   * receipts and commission between them, and doing that safely is its own
   * piece of work rather than a line in this pass.
   */
  'taxpayers.status: MERGED':
    'Duplicates are refused at registration; no merge tool exists to move money between records.',
};

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

  it('does not carry an excuse for a state that has since become reachable', async () => {
    const repoRoot = workspaceRoot();
    const files = SOURCE_ROOTS.flatMap((root) => sourceFiles(join(repoRoot, root))).map((path) => ({
      path,
      text: readFileSync(path, 'utf8'),
    }));

    /*
     * This half reads narrower than the half above, and on purpose.
     *
     * Above, a value counts as reachable if the word appears anywhere, because
     * a false alarm there is a defect report against working code and gets
     * answered with an allowlist entry — the exact outcome this file exists to
     * prevent. Here the risk runs the other way: the question is whether an
     * excuse has outlived what it excused, and answering "yes" on the strength
     * of the same word turning up in an unrelated part of the platform would
     * retire a true statement.
     *
     * `setRevenueItemStatus` is why this is not hypothetical. It made
     * `revenue_items.status = 'RETIRED'` reachable, and by doing so put the
     * word RETIRED into the source — which, read globally, claimed that
     * agreement versions, commission policies and training modules could now
     * be retired too. None of them can. So an excuse is stale only when its
     * value appears in a file that names its own table.
     */
    const defaults = await columnDefaults();
    const declared = new Map<string, boolean>();
    for (const { table, column, values } of await enumColumns()) {
      const touching = files.filter((file) => file.text.includes(table));
      for (const value of values) {
        const reachable =
          defaults.get(`${table}.${column}`) === value ||
          touching.some((file) => new RegExp(`['"\`]${value}['"\`]`).test(file.text));
        declared.set(`${table}.${column}: ${value}`, reachable);
      }
    }

    /*
     * An excuse outlives the thing it excused. A line saying nothing writes
     * MERGED, left behind after the merge tool ships, reads as a decision that
     * was never revisited — and the next person believes it.
     */
    const stale: string[] = [];
    for (const state of Object.keys(DELIBERATELY_UNREACHABLE)) {
      const reachable = declared.get(state);
      if (reachable === undefined) stale.push(`${state} — no longer declared by the schema`);
      else if (reachable) stale.push(`${state} — something writes this now`);
    }

    assert.deepEqual(stale, [], `DELIBERATELY_UNREACHABLE is out of date:\n  ${stale.join('\n  ')}`);
  });
});
