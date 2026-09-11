/**
 * Three signed audit reports that did not count money awaiting reconciliation.
 *
 * A collection reaches the State in a fixed order. `verifyPayment` moves the
 * transaction to PAYMENT_VERIFIED and then, in the same database transaction,
 * to RECONCILIATION_PENDING — "confirmed by the gateway; awaiting settlement
 * into a government account". It stays there until a bank statement covering
 * it is fetched and matched, at which point it becomes RECEIPT_GENERATED and
 * then SETTLED. Reconciliation runs against a statement that arrives the next
 * day, so RECONCILIATION_PENDING is not a corner: it is where every naira
 * collected since the last sweep is sitting right now.
 *
 * Six places in the API define which statuses mean the money was collected.
 * Five of them — `REVENUE_STATES` in reports.ts, periods.ts and targets.ts,
 * `paidStates` in vehicles.ts, and the two vehicle queries — name four states
 * and include that one. The audit workbench named three:
 *
 *     ('PAYMENT_VERIFIED','RECEIPT_GENERATED','SETTLED')
 *
 * It kept the state BEFORE the resting state and the two AFTER it, and
 * dropped the resting state itself. That is the shape of a list typed from
 * memory, not a policy — no rule about revenue recognition includes the
 * transient state and excludes the settled-pending one that follows it.
 *
 * WHAT IT DID TO THE THREE REPORTS
 *
 * REVENUE_COLLECTION and LGA_PERFORMANCE are the two an officer reconciles
 * against an MDA remittance; both understated every total by whatever had not
 * yet been through reconciliation. AGENT_ACTIVITY is worse, because its row
 * is built from two different predicates: `transactions` counts every row an
 * agent touched, and `collected_kobo` summed only the three states. An agent
 * whose day's work has not yet been reconciled therefore appeared in a signed,
 * checksummed audit report as
 *
 *     142 transactions, 0 reversed, ₦0 collected
 *
 * which is not an understatement. It is the shape of an accusation, in the
 * document an auditor is invited to verify and take at face value.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  get,
  loginAs,
  pool,
  post,
  resetDatabase,
  seedOneCollection,
  startTestServer,
  stopTestServer,
} from './helpers';
import { query, queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';

let auditor = '';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({
    fullName: 'Workbench Auditor',
    phone: '+2348081000001',
    role: 'auditor',
  });
  // The demonstration agent is only seeded if somebody exists who could have
  // approved it, and `seedOneCollection` needs that agent to collect anything.
  await createGovernmentUser({
    fullName: 'Workbench Administrator',
    phone: '+2348081000002',
    role: 'admin',
  });
  auditor = (await loginAs('+2348081000001')).accessToken;
  await seedOneCollection('900');
});

/**
 * A second collection by the same agent, parked in a chosen state.
 *
 * Copied from the settled one rather than driven through the gateway again:
 * the seeded payment cannot be settled twice, and what these tests are about
 * is which statuses the reports' arithmetic admits, not how a transaction
 * arrives at one.
 */
async function parkAt(status: string, amountKobo: number): Promise<void> {
  await query(
    pool,
    `INSERT INTO transactions (
       transaction_reference, taxpayer_id, invoice_id, assessment_id, revenue_item_id,
       lga_id, amount_kobo, total_amount_kobo, status, created_by, territory_id, agent_id
     )
     SELECT 'TXN-PEND-' || gen_random_uuid()::text, t.taxpayer_id, t.invoice_id,
            t.assessment_id, t.revenue_item_id, t.lga_id, $1, $1,
            $2, t.created_by, t.territory_id, t.agent_id
       FROM transactions t WHERE t.status = 'SETTLED' ORDER BY t.created_at LIMIT 1`,
    [String(amountKobo), status],
  );
}

/** What the settled seed collection was worth, so the sums can be exact. */
async function settledKobo(): Promise<bigint> {
  const row = await queryOne<{ amount_kobo: string }>(
    pool,
    `SELECT amount_kobo::text FROM transactions WHERE status = 'SETTLED' ORDER BY created_at LIMIT 1`,
  );
  return BigInt(row!.amount_kobo);
}

/** Generate a report and hand back the rows it froze. */
async function report(reportType: string): Promise<Record<string, string>[]> {
  const created = await post(
    '/government/audit/reports',
    { reportType, title: `${reportType} for the whole period`, parameters: {} },
    { token: auditor },
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const read = await get(`/government/audit/reports/${(created.body as { id: string }).id}`, {
    token: auditor,
  });
  assert.equal(read.status, 200, JSON.stringify(read.body));
  return (read.body as { payload: { rows: Record<string, string>[] } }).payload.rows;
}

const sumOf = (rows: Record<string, string>[], column: string) =>
  rows.reduce((total, row) => total + BigInt(row[column] ?? '0'), 0n);

// ===========================================================================
describe('a collection awaiting reconciliation is money the State has taken', () => {
  const PENDING_KOBO = 750_000;

  it('is in the revenue collection report', async () => {
    const settled = await settledKobo();
    await parkAt('RECONCILIATION_PENDING', PENDING_KOBO);

    const rows = await report('REVENUE_COLLECTION');
    assert.equal(
      sumOf(rows, 'revenue_kobo'),
      settled + BigInt(PENDING_KOBO),
      'the report an officer reconciles against a remittance left out the unreconciled half',
    );
  });

  it('is in the LGA performance report', async () => {
    const settled = await settledKobo();
    await parkAt('RECONCILIATION_PENDING', PENDING_KOBO);

    const rows = await report('LGA_PERFORMANCE');
    assert.equal(sumOf(rows, 'revenue_kobo'), settled + BigInt(PENDING_KOBO));
    assert.equal(
      sumOf(rows, 'transactions'),
      2n,
      'the LGA row drops the transaction as well as its money, so the count agrees with the total',
    );
  });

  it('is in what an agent is recorded as having collected', async () => {
    const settled = await settledKobo();
    await parkAt('RECONCILIATION_PENDING', PENDING_KOBO);

    const rows = await report('AGENT_ACTIVITY');
    assert.equal(sumOf(rows, 'collected_kobo'), settled + BigInt(PENDING_KOBO));
  });

  /*
   * The reason this one is the worst of the three.
   *
   * `transactions` counts every row the agent touched and `collected_kobo`
   * summed a narrower set, so the two halves of a single line in a signed
   * report described different populations. With the whole day awaiting
   * reconciliation the line read "collections taken, nothing collected".
   */
  it('so an agent with an unreconciled day is not recorded as having remitted nothing', async () => {
    await query(pool, `UPDATE transactions SET status = 'RECONCILIATION_PENDING'`);
    await parkAt('RECONCILIATION_PENDING', PENDING_KOBO);

    const rows = await report('AGENT_ACTIVITY');
    assert.ok(rows.length > 0, 'the agent is in the report at all');
    for (const row of rows) {
      assert.ok(
        BigInt(row.transactions ?? '0') === 0n || BigInt(row.collected_kobo ?? '0') > 0n,
        `an agent credited with ${row.transactions} collections and ${row.collected_kobo} kobo`,
      );
    }
  });
});

// ===========================================================================
describe('and the states that still must not count as revenue', () => {
  /*
   * The controls. Widening the list is only a fix if it stopped where the
   * money stops: a collection that failed, and one the State gave back, are
   * not revenue, and a report that counted them would be wrong in the
   * direction that matters more.
   */
  it('leaves out a collection that failed', async () => {
    const settled = await settledKobo();
    await parkAt('FAILED', 900_000);

    assert.equal(sumOf(await report('REVENUE_COLLECTION'), 'revenue_kobo'), settled);
  });

  it('leaves out a collection that was reversed', async () => {
    const settled = await settledKobo();
    await parkAt('REVERSED', 900_000);

    assert.equal(sumOf(await report('LGA_PERFORMANCE'), 'revenue_kobo'), settled);
  });

  it('leaves out a collection whose payment has not been confirmed', async () => {
    const settled = await settledKobo();
    await parkAt('PAYMENT_PENDING', 900_000);

    assert.equal(sumOf(await report('AGENT_ACTIVITY'), 'collected_kobo'), settled);
  });
});

// ===========================================================================
/**
 * And the guard, because this is the sixth hand-written copy of the same list.
 *
 * The fix moves every money query onto `REVENUE_RECOGNISED_STATES`, but
 * nothing stops the seventh copy: writing `t.status IN ('...','...')` in a new
 * query is easier than finding the constant, it reads as obviously correct,
 * and no test fails when one state is missing — the figure is simply smaller
 * than it should be, which is indistinguishable from a quiet week.
 *
 * WHAT THIS CHECKS, AND WHAT IT DELIBERATELY DOES NOT
 *
 * Not "no file may name a transaction status". Most such lists are fine and
 * have nothing to do with revenue: ('FAILED','CANCELLED','EXPIRED') is the
 * failure tally, ('REVERSED','REFUNDED') is money given back, and a guard
 * that failed those would need an exemption list long enough that nobody
 * reads it — the failure mode the field-drawing guard's own comment warns
 * about.
 *
 * So it looks only at lists naming TWO OR MORE of the four recognised states,
 * which is the shape a revenue predicate has and a failure tally does not.
 * Such a list must mean one of the two things this platform recognises:
 *
 *   RECOGNISED  — the government has the money. Import it, do not retype it.
 *   CONFIRMED   — SETTLED, RECEIPT_GENERATED, RECONCILIATION_PENDING, the
 *                 citizen-facing "has this payment gone through", which
 *                 deliberately excludes the status that exists for a few
 *                 milliseconds inside one transaction.
 *
 * That an allowed set is named by its MEANING rather than by the file it sits
 * in is the point: a new module using the confirmed-payment set correctly
 * passes without anybody editing a list of blessed filenames.
 *
 * Requiring two recognised states, rather than one, is what keeps `paye.ts`
 * and `connections.ts` out of it. Those name a different table's statuses —
 * ('PAYMENT_CONFIRMED','RECEIPTED','SETTLED') — which collides with this
 * domain on the single word SETTLED and means something else entirely.
 */
describe('the definition of collected money is not written out by hand', () => {
  const RECOGNISED = new Set([
    'PAYMENT_VERIFIED',
    'RECEIPT_GENERATED',
    'RECONCILIATION_PENDING',
    'SETTLED',
  ]);
  const CONFIRMED = new Set(['SETTLED', 'RECEIPT_GENERATED', 'RECONCILIATION_PENDING']);

  /*
   * The one exception, recorded rather than excused.
   *
   * `settleLinkedTransactions` asks which collections a bank credit can still
   * advance, and the answer is the two states that are paid but not yet
   * settled. That is a question about what may move next, not about what the
   * State has received, and widening it to the recognised set would have the
   * sweep try to re-settle money it has already settled.
   */
  const ALLOWED_ELSEWHERE = new Map([
    [
      'services/reconciliation.ts',
      new Set(['RECEIPT_GENERATED', 'RECONCILIATION_PENDING']),
    ],
  ]);

  const sameSet = (a: Set<string>, b: Set<string>) =>
    a.size === b.size && [...a].every((value) => b.has(value));

  it('every list naming two or more recognised states means one of the two things it can', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');

    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((entry) => {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) return walk(full);
        return full.endsWith('.ts') ? [full] : [];
      });

    const root = join(import.meta.dirname, '..');
    const files = ['services', 'routes', 'jobs', 'lib', 'integrations', 'middleware']
      .map((dir) => join(root, dir))
      .filter((dir) => {
        try {
          return statSync(dir).isDirectory();
        } catch {
          return false;
        }
      })
      .flatMap(walk)
      .filter((file) => !file.endsWith('revenue-states.ts'));

    // A comma-separated run of two or more upper-case quoted identifiers,
    // which covers both a SQL `IN ('A','B')` and a TypeScript `['A', 'B']`.
    const runs = /(?:'[A-Z_]+'\s*,\s*)+'[A-Z_]+'/g;
    const offenders: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const relative = file.slice(root.length + 1);
      for (const match of source.match(runs) ?? []) {
        const named = new Set(
          [...match.matchAll(/'([A-Z_]+)'/g)].map((found) => found[1]!),
        );
        const recognised = [...named].filter((state) => RECOGNISED.has(state));
        if (recognised.length < 2) continue;
        if (sameSet(named, RECOGNISED) || sameSet(named, CONFIRMED)) continue;
        const permitted = ALLOWED_ELSEWHERE.get(relative);
        if (permitted && sameSet(named, permitted)) continue;
        offenders.push(`${relative}: ${match}`);
      }
    }

    assert.deepEqual(
      offenders,
      [],
      'these name recognised states in a set that is neither the recognised one nor ' +
        'the confirmed-payment one; import REVENUE_RECOGNISED_STATES rather than ' +
        `retyping it:\n  ${offenders.join('\n  ')}`,
    );
  });

  /*
   * The control on the guard itself. A check that cannot fail is not a check,
   * and the way this one would rot is by matching nothing at all — a broken
   * regex, a renamed directory, a walk that returns no files.
   */
  it('is looking at source that actually contains such lists', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');

    const confirmed = readFileSync(
      join(import.meta.dirname, '..', 'services', 'payment-history.ts'),
      'utf8',
    );
    assert.match(
      confirmed,
      /(?:'[A-Z_]+'\s*,\s*)+'[A-Z_]+'/,
      'the pattern no longer matches a known hand-written list, so the guard is inert',
    );
  });
});
