/**
 * A reversal the month-end close was never shown.
 *
 * `EXCEPTION_STATUSES` in reconciliation.ts names the six statuses that mean an
 * outstanding exception, and its comment is explicit about why it exists:
 * "Named once and shared, because listing and resolving are two halves of the
 * same idea. They were written separately." It goes on about REVERSED in
 * particular —
 *
 *     REVERSED was missing, and it is the most serious of them. ... a gateway
 *     line saying REVERSED against a payment the platform holds as VERIFIED is
 *     money that came in, was receipted, and went back. But it appeared in no
 *     list — not here, so the queue never showed it ... The sweep noticed,
 *     wrote it down, and told nobody.
 *
 * That fix named the constant and used it in the queue. Three other places had
 * already written the list out by hand, and none of them was updated:
 *
 *   periods.ts  — the `unreconciled` count that gates closing a month
 *   cases.ts    — the finance officer's exception panel
 *   reports.ts  — `reconciliation_exceptions` on the officer dashboard
 *
 * All three still say four statuses. So the sweep noticed, wrote it down, told
 * the one queue that was fixed, and went on telling nobody everywhere else.
 *
 * WHY THE MONTH-END ONE IS THE SERIOUS ONE
 *
 * `closePeriod` refuses with PERIOD_NOT_SETTLED when anything is outstanding,
 * unless the officer writes down why they are closing over it — "because
 * closing over either freezes a figure already known to be wrong, and the point
 * of a closed month is a figure somebody stands behind". A REVERSED exception
 * is money the platform and the bank disagree about by the whole amount. With
 * it missing from the count, the month does not get closed over an objection:
 * it closes with no objection raised, no override reason recorded, and a
 * figure nobody was ever asked to stand behind.
 *
 * PENDING_SETTLEMENT is deliberately NOT treated the same way here. It is the
 * ordinary state of money in transit and only becomes a fault once it is past
 * the settlement window, which is exactly how `exceptionQueue` already treats
 * it, and the tests below hold that distinction rather than flattening it.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  grantStepUp,
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
import { EXCEPTION_STATUSES } from '../services/reconciliation';
import { executiveDashboard } from '../services/reports';
import { myWork } from '../services/cases';
import { permissionsForRole } from '@psirs/shared';

const PHONES = { finance: '+2348082000001', admin: '+2348082000002' };
const tokens: Record<string, string> = {};

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
    fullName: 'Period Finance Officer',
    phone: PHONES.finance,
    role: 'finance_officer',
  });
  await createGovernmentUser({
    fullName: 'Period Administrator',
    phone: PHONES.admin,
    role: 'admin',
  });
  tokens.finance = (await loginAs(PHONES.finance)).accessToken;
  tokens.admin = (await loginAs(PHONES.admin)).accessToken;
  await seedOneCollection('910');
});

const auth = (who: keyof typeof PHONES) => ({ token: tokens[who] });
const iso = (date: Date) => date.toISOString().slice(0, 10);

/** The month the seeded collection falls in, which is the one being closed. */
function thisMonth(): { start: Date; end: Date } {
  const now = new Date();
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)),
  };
}

async function openPeriod() {
  const bounds = thisMonth();
  const created = await post(
    '/government/periods',
    { periodStart: iso(bounds.start), periodEnd: iso(bounds.end) },
    auth('finance'),
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return (created.body as { id: string }).id;
}

async function closeWithoutOverride(periodId: string) {
  await grantStepUp(tokens.finance, PHONES.finance, 'financial.period.close');
  return post(
    `/government/periods/${periodId}/close`,
    { note: 'Month reconciled and reported to the Accountant-General.' },
    auth('finance'),
  );
}

/**
 * One unresolved finding of a chosen kind against the seeded collection.
 *
 * `ageHours` backdates the row, which only matters for PENDING_SETTLEMENT —
 * inside the window it is money in transit, past it the gateway has had the
 * money for days and not handed it over.
 */
async function record(status: string, ageHours = 0): Promise<void> {
  await query(
    pool,
    `INSERT INTO reconciliation_records (
       run_id, transaction_id, payment_id, gateway_reference,
       expected_amount_kobo, received_amount_kobo, variance_kobo, status, created_at
     )
     SELECT gen_random_uuid(), t.id, p.id, 'GW-' || gen_random_uuid()::text,
            t.amount_kobo, 0, t.amount_kobo, $1,
            now() - ($2 || ' hours')::interval
       FROM transactions t
       LEFT JOIN payments p ON p.transaction_id = t.id
      WHERE t.status = 'SETTLED' ORDER BY t.created_at LIMIT 1`,
    [status, String(ageHours)],
  );
  /*
   * Age the PAYMENT, not just the record.
   *
   * "How long has the gateway held this money" is a question about when the
   * payment was confirmed, and `exceptionQueue` reads
   * COALESCE(p.verified_at, p.paid_at, p.created_at, rr.created_at) for
   * exactly that reason. Backdating only the reconciliation row would have
   * produced a test that passed while measuring the wrong clock.
   */
  /*
   * A collection awaiting settlement is one whose money has NOT arrived.
   *
   * The seeded collection is fully settled, and its payment points at a
   * RECONCILED settlement — so a PENDING_SETTLEMENT row against it is
   * correctly not an exception, because the State can see the credit. Writing
   * the fixture without this detached the test from what the status means and
   * would have had it assert that settled money is overdue.
   */
  if (status === 'PENDING_SETTLEMENT') {
    await query(
      pool,
      `UPDATE payments SET settlement_id = NULL
        WHERE transaction_id = (
          SELECT id FROM transactions WHERE status = 'SETTLED' ORDER BY created_at LIMIT 1)`,
    );
  }
  if (ageHours > 0) {
    await query(
      pool,
      `UPDATE payments SET verified_at = now() - ($1 || ' hours')::interval,
                           paid_at     = now() - ($1 || ' hours')::interval,
                           created_at  = now() - ($1 || ' hours')::interval
        WHERE transaction_id = (
          SELECT id FROM transactions WHERE status = 'SETTLED' ORDER BY created_at LIMIT 1)`,
      [String(ageHours)],
    );
  }
}

/** Nothing else outstanding, so the close turns only on the exception. */
async function clearPendingPayments(): Promise<void> {
  await query(pool, `UPDATE payments SET status = 'VERIFIED' WHERE status IN ('INITIATED','PENDING')`);
}

// ===========================================================================
describe('a month is not closed over an exception nobody was shown', () => {
  it('refuses the close when a reversal is outstanding', async () => {
    await clearPendingPayments();
    await record('REVERSED');
    const periodId = await openPeriod();

    const closed = await closeWithoutOverride(periodId);
    assert.equal(
      closed.status,
      409,
      `the month closed over a reversal: ${JSON.stringify(closed.body)}`,
    );
    assert.equal(
      (closed.body as { error: { code: string } }).error.code,
      'PERIOD_NOT_SETTLED',
      JSON.stringify(closed.body),
    );
  });

  it('counts it among the exceptions the refusal names', async () => {
    await clearPendingPayments();
    await record('REVERSED');
    const periodId = await openPeriod();

    const closed = await closeWithoutOverride(periodId);
    assert.match(
      (closed.body as { error: { message: string } }).error.message,
      /1 unresolved exception/,
      'the officer is told how many, and a reversal is one of them',
    );
  });

  it('still closes once somebody writes down why', async () => {
    // The control on the refusal: it is a gate with a key, not a wall.
    await clearPendingPayments();
    await record('REVERSED');
    const periodId = await openPeriod();

    await grantStepUp(tokens.finance, PHONES.finance, 'financial.period.close');
    const closed = await post(
      `/government/periods/${periodId}/close`,
      {
        note: 'Month reported to the Accountant-General.',
        overrideReason: 'The reversal is a duplicate credit the bank is recalling; ledger note 41.',
      },
      auth('finance'),
    );
    assert.equal(closed.status, 200, JSON.stringify(closed.body));
  });

  /*
   * The control that keeps the fix honest. A month with nothing outstanding
   * must still close without ceremony, or the refusal above proves only that
   * the gate is stuck shut.
   */
  it('closes a clean month without an override', async () => {
    await clearPendingPayments();
    await record('MATCHED');
    const periodId = await openPeriod();

    const closed = await closeWithoutOverride(periodId);
    assert.equal(closed.status, 200, JSON.stringify(closed.body));
  });
});

// ===========================================================================
describe('money in transit is not an exception until it is late', () => {
  /*
   * The distinction `exceptionQueue` already draws, held here so that widening
   * these three lists does not flatten it. A collection the gateway confirmed
   * an hour ago is the ordinary state of money moving, and a month that
   * refused to close over it would refuse every month.
   */
  it('a fresh pending settlement does not block the close', async () => {
    await clearPendingPayments();
    await record('PENDING_SETTLEMENT', 1);
    const periodId = await openPeriod();

    const closed = await closeWithoutOverride(periodId);
    assert.equal(closed.status, 200, JSON.stringify(closed.body));
  });

  it('one past the settlement window does', async () => {
    await clearPendingPayments();
    await record('PENDING_SETTLEMENT', 200);
    const periodId = await openPeriod();

    const closed = await closeWithoutOverride(periodId);
    assert.equal(
      closed.status,
      409,
      `the gateway has held the money for eight days: ${JSON.stringify(closed.body)}`,
    );
  });
});

// ===========================================================================
describe('and the two officers who read it are shown it too', () => {
  /*
   * The same omission, in the two places a person looks rather than a gate.
   * Asserted through the functions that compute the figures, because what is
   * being tested is which rows they count, not how a route spells them.
   */
  it('the dashboard counts a reversal among the reconciliation exceptions', async () => {
    await record('REVERSED');

    const dashboard = await executiveDashboard(pool);
    const exceptions = dashboard.exceptions as { reconciliation_exceptions: string } | null;
    assert.equal(
      Number(exceptions?.reconciliation_exceptions),
      1,
      'the count an officer acts on left the reversal out',
    );
  });

  it("the finance officer's exception panel shows it", async () => {
    await record('REVERSED');

    const work = await myWork(pool, {
      userId: (await queryOne<{ id: string }>(
        pool,
        `SELECT id FROM users WHERE phone = $1`,
        [PHONES.finance],
      ))!.id,
      role: 'finance_officer',
      permissions: permissionsForRole('finance_officer'),
    } as never);
    const rows = (work.exceptions ?? []) as { status: string }[];
    assert.ok(
      rows.some((row) => row.status === 'REVERSED'),
      `the panel listed ${rows.length} exception(s) and none of them was the reversal`,
    );
  });
});

// ===========================================================================
describe('the exception set is not written out by hand', () => {
  /*
   * The guard. This list has now drifted twice: once when REVERSED was added
   * to the queue and not to the three copies, and once before that when the
   * queue and `resolveException` disagreed. `EXCEPTION_STATUSES` exists
   * precisely so there is one answer, and the way it stops meaning that is a
   * fourth copy typed into a new query.
   */
  it('every query asking for outstanding exceptions uses the shared constant', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');

    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((entry) => {
        const full = join(dir, entry);
        return statSync(full).isDirectory()
          ? walk(full)
          : full.endsWith('.ts')
            ? [full]
            : [];
      });

    const root = join(__dirname, '..');
    const files = ['services', 'routes', 'lib', 'integrations', 'middleware']
      .map((dir) => join(root, dir))
      .filter((dir) => {
        try {
          return statSync(dir).isDirectory();
        } catch {
          return false;
        }
      })
      .flatMap(walk)
      .filter((file) => !file.endsWith('reconciliation.ts'));
    assert.ok(files.length > 0, 'the walk found no source to check, so the guard is inert');

    const runs = /(?:'[A-Z_]+'\s*,\s*)+'[A-Z_]+'/g;
    const exceptions = new Set<string>(EXCEPTION_STATUSES);
    const offenders: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.match(runs) ?? []) {
        const named = [...match.matchAll(/'([A-Z_]+)'/g)].map((found) => found[1]!);
        // Two or more members of the exception set named together is a query
        // asking this question; one is some other query that happens to share
        // a word.
        if (named.filter((name) => exceptions.has(name)).length < 2) continue;
        offenders.push(`${file.slice(root.length + 1)}: ${match}`);
      }
    }

    assert.deepEqual(
      offenders,
      [],
      'import EXCEPTION_STATUSES rather than retyping it:\n  ' + offenders.join('\n  '),
    );
  });
});
