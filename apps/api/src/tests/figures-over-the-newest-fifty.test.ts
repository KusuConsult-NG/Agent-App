/**
 * Four figures on the auditor's workbench, and the fifty rows they came from.
 *
 * The screen shows samples drawn, items still to examine, exceptions found
 * and reports on file, above a table of each. All four were added up in the
 * browser over the rows the list endpoints returned, and both endpoints are
 * `LIMIT 50 ORDER BY ... DESC` with nothing in the response saying so.
 *
 * Measured before anything was changed, on three samples with the cap set to
 * two: the set held three samples, three exceptions and nine pending items,
 * and the endpoint answered with two rows carrying two exceptions and six
 * pending between them. Nothing else in the body. So the screen's arithmetic
 * was correct and its subject was the page.
 *
 * WHY THIS IS THE SCREEN WHERE IT MATTERS MOST
 *
 * "Exceptions found" is what the workbench is for. An auditor reading a low
 * one concludes the sampling programme is clean, and a partial count is the
 * one kind of evidence that must never be able to support that conclusion.
 * "Items still to examine" is the backlog figure, which decides whether the
 * auditor believes the work is finished.
 *
 * The same holds for the reports list, with an edge the samples do not have:
 * `checksumMatches` is recomputed per row, and an altered report raises an
 * alarm — a signed government report whose figures were changed underneath
 * the signature. That recomputation only ever sees the rows returned, so the
 * alarm's reach is the page. It said as much ("a report on this page") and
 * could not say how much it had not looked at. Now it can.
 *
 * HOW THIS IS MEASURED
 *
 * At a cap of two rather than fifty, because the mechanism is the same at any
 * cap and three samples prove it where fifty-one would only cost a minute.
 * The last case pins the default at fifty, which is the number that decides
 * the real screen's exposure — a cap that quietly became 500 would make every
 * case above pass and the screen honest by accident.
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

const AUDITOR = '+2348079100001';
let token = '';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  // The demonstration agent needs an approver to exist before a collection
  // can be driven through, which is what gives the draw a population.
  await createGovernmentUser({ fullName: 'Figures admin', phone: '+2348079100003', role: 'admin' });
  await createGovernmentUser({ fullName: 'Figures auditor', phone: AUDITOR, role: 'auditor' });
  token = (await loginAs(AUDITOR)).accessToken;
});

const auth = { token };

/**
 * A population to draw from: one real collection, and copies of it.
 *
 * The same approach as `a-sample-that-can-be-defended`: one row goes through
 * the whole pipeline so the draw is drawing from real transactions, and the
 * rest are copies with distinct amounts, because what is under test here is
 * the counting and not the collection path.
 */
async function populate(count: number): Promise<void> {
  const already = await queryOne<{ id: string }>(
    pool,
    `SELECT id FROM transactions WHERE status = 'SETTLED' LIMIT 1`,
  );
  if (!already) await seedOneCollection(String(count));
  for (let index = 0; index < count; index += 1) {
    await query(
      pool,
      `INSERT INTO transactions (
         transaction_reference, taxpayer_id, invoice_id, assessment_id, revenue_item_id,
         lga_id, amount_kobo, total_amount_kobo, status, created_by, territory_id, agent_id
       )
       SELECT 'TXN-FIG-' || gen_random_uuid()::text, t.taxpayer_id, t.invoice_id,
              t.assessment_id, t.revenue_item_id, t.lga_id, $1, $1,
              'SETTLED', t.created_by, t.territory_id, t.agent_id
         FROM transactions t WHERE t.status = 'SETTLED' ORDER BY t.created_at LIMIT 1`,
      [String(100_000 + index * 1_000)],
    );
  }
}

/** Three samples of four items, one exception recorded in each. */
async function drawThree(): Promise<void> {
  await populate(20);
  for (let n = 0; n < 3; n += 1) {
    const drawn = await post(
      '/government/audit/samples',
      { title: `Materiality pass number ${n}`, method: 'RANDOM', size: 4 },
      { token: token },
    );
    assert.equal(drawn.status, 201, JSON.stringify(drawn.body));
    const detail = await get(`/government/audit/samples/${drawn.body.id}`, { token: token });
    const items = detail.body.items as { id: string }[];
    const recorded = await post(
      `/government/audit/samples/items/${items[0]!.id}/finding`,
      { outcome: 'EXCEPTION', finding: 'A receipt that names no taxpayer' },
      { token: token },
    );
    assert.equal(recorded.status, 200, JSON.stringify(recorded.body));
  }
}

describe('the figures above the sample table', () => {
  it('count every sample, not the ones that fitted on the page', async () => {
    await drawThree();

    const capped = await get('/government/audit/samples?limit=2', { token: token });
    assert.equal(capped.status, 200, JSON.stringify(capped.body));

    const body = capped.body as {
      samples: { exceptions: number; pending: number }[];
      matched: number;
      exceptionsTotal: number;
      pendingTotal: number;
      cap: number;
    };

    // The page really is short, or the rest of this proves nothing.
    assert.equal(body.samples.length, 2, 'the cap did not apply, so nothing here is a test');

    assert.equal(body.matched, 3, 'three samples were drawn and the figure must say three');
    assert.equal(
      body.exceptionsTotal,
      3,
      'one exception was recorded in each of three samples; the figure the auditor ' +
        'reads as "exceptions found" must not be the exceptions of the newest two',
    );
    assert.equal(
      body.pendingTotal,
      9,
      'three samples of four items with one examined each leaves nine to examine',
    );
    assert.equal(body.cap, 2, 'the screen cannot say which lists stopped short without this');
  });

  it('are the page totals when nothing is capped, so the figures agree with the table', async () => {
    await drawThree();

    const whole = await get('/government/audit/samples', { token: token });
    const body = whole.body as {
      samples: { exceptions: number; pending: number }[];
      matched: number;
      exceptionsTotal: number;
      pendingTotal: number;
    };

    // The bound. A figure wired to a constant, or to a count over the wrong
    // table, would satisfy the case above and disagree with the rows here.
    const sum = (key: 'exceptions' | 'pending') =>
      body.samples.reduce((total, row) => total + Number(row[key]), 0);

    assert.equal(body.matched, body.samples.length);
    assert.equal(body.exceptionsTotal, sum('exceptions'));
    assert.equal(body.pendingTotal, sum('pending'));
  });

  it('leaves every field the table itself renders', async () => {
    // The page rows moved inside a derived table to make room for the windows,
    // and the window columns are stripped from each row on the way out. Both
    // are the kind of change that silently drops a column the screen shows.
    await drawThree();

    const whole = await get('/government/audit/samples', { token: token });
    const row = (whole.body as { samples: Record<string, unknown>[] }).samples[0]!;

    for (const field of [
      'id',
      'sample_number',
      'title',
      'method',
      'criteria',
      'seed',
      'population_size',
      'sample_size',
      'status',
      'drawn_at',
      'drawn_by_name',
      'exceptions',
      'pending',
    ]) {
      assert.ok(field in row, `the sample table renders ${field} and it is no longer sent`);
    }
    for (const leaked of ['matched', 'exceptions_total', 'pending_total']) {
      assert.ok(!(leaked in row), `${leaked} belongs beside the page, not on every row`);
    }
  });
});

describe('the checksum alarm, and how far it can see', () => {
  /** Two reports, so one can be left off a page of one. */
  async function generateTwo(): Promise<void> {
    await populate(5);
    for (const title of ['March transaction audit', 'April transaction audit']) {
      const generated = await post(
        '/government/audit/reports',
        { reportType: 'TRANSACTION_AUDIT', title, parameters: {} },
        { token: token },
      );
      assert.equal(generated.status, 201, JSON.stringify(generated.body));
    }
  }

  it('says how many reports exist, so the screen can say what it did not check', async () => {
    await generateTwo();

    const capped = await get('/government/audit/reports?limit=1', { token: token });
    const body = capped.body as {
      reports: { checksumMatches?: boolean }[];
      matched: number;
      cap: number;
    };

    assert.equal(body.reports.length, 1, 'the cap did not apply');
    assert.equal(
      body.matched,
      2,
      'the alarm recomputes the checksum of the rows it was sent; without this figure ' +
        'the screen cannot say that a report altered further back raises nothing',
    );
    assert.equal(body.cap, 1);
    assert.equal(
      body.reports[0]!.checksumMatches,
      true,
      'an untouched report must not read as altered',
    );
  });

  it('still strips the payload from every row', async () => {
    // `matched` is removed in the same destructuring that removes `payload`,
    // and the payload is the whole frozen report. Sending it to a list screen
    // would be a leak of every row of every report on the page.
    await generateTwo();

    const whole = await get('/government/audit/reports', { token: token });
    for (const row of (whole.body as { reports: Record<string, unknown>[] }).reports) {
      assert.ok(!('payload' in row), 'the list must not carry the frozen rows');
      assert.ok(!('matched' in row), 'the set size belongs beside the page');
      assert.ok('checksum' in row, 'the checksum is rendered in the table');
      assert.ok('coverage_complete' in row, 'the partial badge reads this');
    }
  });
});

describe('the cap the screen is actually exposed to', () => {
  it('is fifty on both lists, which is what the partial notice is about', async () => {
    // Neither request passes a limit, which is how the screen reads them. If
    // these defaults ever move, the sentence the screen prints about the
    // {{cap}} most recent moves with them — and every case above would pass
    // while the screen said something untrue.
    await drawThree();

    const samples = await get('/government/audit/samples', { token: token });
    const reports = await get('/government/audit/reports', { token: token });

    assert.equal((samples.body as { cap: number }).cap, 50);
    assert.equal((reports.body as { cap: number }).cap, 50);
  });
});
