/**
 * A month the platform would not close, over exceptions already resolved.
 *
 * `reconciliation_records` holds a row per transaction PER RUN. That is right:
 * an auditor asking what Tuesday's sweep concluded needs Tuesday's answer. The
 * sweep runs four times a day over a trailing forty-eight hours, so one
 * collection is recorded by about eight runs, and a persistent exception is
 * recorded afresh by each of them.
 *
 * `exceptionQueue` met this first and fixed it by reading the newest finding
 * per item — `a-worklist-that-multiplied` holds that — and its own test said
 * "every count derived from it is wrong in the same direction". They were,
 * and the fix stayed in the queue. `resolveException` marks the one row the
 * queue shows; the older runs' rows stay unresolved, and everything that
 * counted raw rows went on counting them.
 *
 * MEASURED BEFORE ANYTHING WAS CHANGED, THROUGH THE REAL PATHS
 *
 *   one mismatch, recorded by two sweeps        queue 1   month-close 2
 *   the officer resolves it                     queue 0   month-close 1
 *
 * So the queue empties and the close still refuses — "has 1 unresolved
 * exception(s)" — naming an item that appears nowhere an officer can act on
 * it. The way through was a written override, for closing over work already
 * done. The same raw read sat under the finance officer's own work lists, two
 * dashboard counts, the duplicate-payment figure and the reconciliation rate.
 *
 * A FIRST MEASUREMENT THAT SAID THE OPPOSITE
 *
 * The first probe of this read zero from the month-close figure and two from
 * the queue, which looked like a refutation. It was a fixture: the taxpayer
 * had been refused for a one-letter first name, so every row carried a null
 * transaction and neither query was counting what it appeared to. Every case
 * below asserts its fixture produced a real transaction before trusting
 * anything that follows.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  get,
  grantStepUp,
  loginAs,
  pool,
  post,
  resetDatabase,
  seedOneCollection,
  startTestServer,
  stopTestServer,
} from './helpers';
import { queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { exceptionQueue, resolveException } from '../services/reconciliation';
import { periodFigures } from '../services/periods';
import { executiveDashboard, financeOfficerHome, financeOfficerWorkItems, kpis } from '../services/reports';
import { leakageDashboard } from '../services/fraud';

const PHONES = { admin: '+2348069300001', finance: '+2348069300002' };
let financeId = '';
let financeToken = '';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({ fullName: 'Close Admin', phone: PHONES.admin, role: 'admin' });
  financeId = await createGovernmentUser({
    fullName: 'Close Finance',
    phone: PHONES.finance,
    role: 'finance_officer',
  });
  financeToken = (await loginAs(PHONES.finance)).accessToken;
});

/** Last month — the month a real close is always about. */
function lastMonth(): { start: string; end: string; inside: Date } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    inside: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 10, 12)),
  };
}

/**
 * A real collection, moved into last month.
 *
 * `seedOneCollection` drives the pipeline end to end; this copies the result
 * into the month under test. Asserted, because the first probe of this defect
 * measured a fixture that had silently produced nothing.
 */
async function collectionLastMonth(): Promise<string> {
  await seedOneCollection('1');
  const row = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO transactions (
       transaction_reference, taxpayer_id, invoice_id, assessment_id, revenue_item_id,
       lga_id, amount_kobo, total_amount_kobo, status, created_by, created_at, territory_id
     )
     SELECT 'TXN-CLOSE-' || gen_random_uuid()::text, t.taxpayer_id, t.invoice_id,
            t.assessment_id, t.revenue_item_id, t.lga_id, t.amount_kobo, t.total_amount_kobo,
            'SETTLED', t.created_by, $1, t.territory_id
       FROM transactions t WHERE t.status = 'SETTLED' ORDER BY t.created_at LIMIT 1
     RETURNING id`,
    [lastMonth().inside],
  );
  assert.ok(row?.id, 'the fixture must produce a real transaction or nothing below means anything');
  return row!.id;
}

/** What one sweep concluded about one transaction. */
async function sweep(transactionId: string, status: string, minutesAgo: number): Promise<string> {
  const row = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO reconciliation_records (run_id, transaction_id, status, created_at)
     VALUES (gen_random_uuid(), $1, $2, now() - ($3 || ' minutes')::interval)
     RETURNING id`,
    [transactionId, status, String(minutesAgo)],
  );
  return row!.id;
}

/** One mismatch, seen by two sweeps six hours apart. Returns the newest row. */
async function mismatchSeenTwice(transactionId: string): Promise<string> {
  await sweep(transactionId, 'AMOUNT_MISMATCH', 360);
  return sweep(transactionId, 'AMOUNT_MISMATCH', 5);
}

const resolve = (recordId: string) =>
  resolveException({
    recordId,
    resolution: 'The bank confirmed the full credit; the variance was a fee shown separately.',
    actorId: financeId,
    actorRole: 'finance_officer',
  });

async function openAndClose(body: Record<string, unknown> = {}) {
  const month = lastMonth();
  const opened = await post(
    '/government/periods',
    { periodStart: month.start, periodEnd: month.end },
    { token: financeToken },
  );
  assert.equal(opened.status, 201, JSON.stringify(opened.body));
  await grantStepUp(financeToken, PHONES.finance, 'financial.period.close');
  return post(
    `/government/periods/${opened.body.id}/close`,
    { note: 'Reconciled and reported to the Accountant-General.', ...body },
    { token: financeToken },
  );
}

describe('the month-close gate', () => {
  it('counts an exception once, however many sweeps recorded it', async () => {
    const tx = await collectionLastMonth();
    await mismatchSeenTwice(tx);

    const month = lastMonth();
    const figures = await periodFigures(pool, month.start, month.end);
    assert.equal(
      figures.unreconciled,
      '1',
      'one mismatch is one unresolved exception; two sweeps recording it is not two',
    );
  });

  it('closes the month once the queue is empty', async () => {
    // THE DEFECT. The officer resolves the one exception the queue shows them,
    // and the month must then close without an override.
    const tx = await collectionLastMonth();
    const newest = await mismatchSeenTwice(tx);
    await resolve(newest);

    assert.equal((await exceptionQueue(pool)).length, 0, 'the queue is empty');

    const month = lastMonth();
    assert.equal(
      (await periodFigures(pool, month.start, month.end)).unreconciled,
      '0',
      'the older sweep recorded the same mismatch, and it was resolved with the newer one',
    );

    const closed = await openAndClose();
    assert.equal(
      closed.status,
      200,
      `the month refused to close over work already done: ${JSON.stringify(closed.body)}`,
    );
    assert.equal(closed.body.overridden, false, 'and it needed no written override to do it');
  });

  it('still refuses while an exception is genuinely unresolved', async () => {
    // The bound. A gate that now always opened would pass the case above and
    // freeze months over money the platform and the bank disagree about.
    const tx = await collectionLastMonth();
    await mismatchSeenTwice(tx);

    const closed = await openAndClose();
    assert.equal(closed.status, 409, JSON.stringify(closed.body));
    assert.match(
      JSON.stringify(closed.body),
      /1 unresolved exception/,
      'and it names one exception, not one per sweep',
    );
  });
});

describe('the figures beside the queue', () => {
  it('agree with the queue on the executive dashboard and the finance home', async () => {
    const tx = await collectionLastMonth();
    await mismatchSeenTwice(tx);

    const queue = (await exceptionQueue(pool)).length;
    assert.equal(queue, 1);

    // Under `exceptions`, the eleventh of the dashboard's parallel reads — not
    // under `counts`, which an earlier version of this case assumed.
    const executive = (await executiveDashboard(pool)) as unknown as {
      exceptions: { reconciliation_exceptions: string };
    };
    assert.equal(executive.exceptions.reconciliation_exceptions, '1', 'the executive count is the queue');

    const home = (await financeOfficerHome(pool)) as unknown as { reconciliation_exceptions: string };
    assert.equal(home.reconciliation_exceptions, '1', "the finance officer's own count is the queue");
  });

  it('do not offer a stale row to work once the exception is resolved', async () => {
    /*
     * The finance work items sort oldest first, so after a resolution they
     * offered precisely the older run's row that the resolution left behind —
     * an item with its own id, pointing at work that was already finished.
     */
    const tx = await collectionLastMonth();
    const newest = await mismatchSeenTwice(tx);
    await resolve(newest);

    const work = await financeOfficerWorkItems(pool);
    assert.deepEqual(work.exceptions, [], 'nothing is left to do, and nothing must be offered');

    const myWork = await get('/government/my-work', { token: financeToken });
    assert.equal(myWork.status, 200, JSON.stringify(myWork.body));
    assert.deepEqual(
      (myWork.body as { exceptions: unknown[] }).exceptions,
      [],
      "the officer's own desk must not list a resolved exception",
    );
  });

  it('count a duplicate payment once', async () => {
    const tx = await collectionLastMonth();
    for (let n = 0; n < 8; n += 1) {
      await sweep(tx, 'DUPLICATE_PAYMENT', 6 * 60 * n + 5);
    }

    const leakage = (await leakageDashboard(pool)) as unknown as {
      duplicatePayments: { count: string };
    };
    assert.equal(
      leakage.duplicatePayments.count,
      '1',
      'eight sweeps recording one duplicate is one duplicate payment',
    );
  });

  it('report reconciliation over collections, not over sweeps', async () => {
    /*
     * Ten collections, each reconciled perfectly: waiting on the bank for the
     * first five sweeps, matched for the last three. Over every row that is
     * 37.5 per cent — a figure that measures how long the bank took, and that
     * teaches a finance director to stop reading it.
     */
    await seedOneCollection('1');
    for (let c = 0; c < 10; c += 1) {
      const row = await queryOne<{ id: string }>(
        pool,
        `INSERT INTO transactions (
           transaction_reference, taxpayer_id, invoice_id, assessment_id, revenue_item_id,
           lga_id, amount_kobo, total_amount_kobo, status, created_by, territory_id
         )
         SELECT 'TXN-RATE-' || gen_random_uuid()::text, t.taxpayer_id, t.invoice_id,
                t.assessment_id, t.revenue_item_id, t.lga_id, t.amount_kobo, t.total_amount_kobo,
                'SETTLED', t.created_by, t.territory_id
           FROM transactions t WHERE t.status = 'SETTLED' ORDER BY t.created_at LIMIT 1
         RETURNING id`,
      );
      for (let s = 1; s <= 8; s += 1) {
        await sweep(row!.id, s <= 5 ? 'PENDING_SETTLEMENT' : 'MATCHED', (8 - s) * 360 + 1);
      }
    }
    // Every other record in the table — the seeded collection has none — so
    // the only rows are the eighty written above.
    const rows = await queryOne<{ n: string }>(pool, 'SELECT count(*)::text AS n FROM reconciliation_records');
    assert.equal(rows!.n, '80', 'ten collections, eight sweeps each');

    const k = (await kpis(pool)) as unknown as { reconciliation_rate_percent: string };
    assert.equal(k.reconciliation_rate_percent, '100.00', 'every one of them reconciled');
  });
});

describe('the history the table exists for', () => {
  it('still shows every sweep on the transaction file', async () => {
    // The bound in the other direction. The per-run rows are not the defect —
    // reading them as current was. An investigator opening one transaction
    // must still see what each sweep concluded, in order.
    const tx = await collectionLastMonth();
    const newest = await mismatchSeenTwice(tx);
    await resolve(newest);

    const file = await get(`/government/transactions/${tx}/full`, { token: financeToken });
    assert.equal(file.status, 200, JSON.stringify(file.body).slice(0, 300));
    const history = (file.body as { reconciliation: { status: string }[] }).reconciliation;
    assert.deepEqual(
      history.map((r) => r.status),
      ['RESOLVED', 'AMOUNT_MISMATCH'],
      'both sweeps, newest first — the resolved one and the one before it',
    );
  });
});
