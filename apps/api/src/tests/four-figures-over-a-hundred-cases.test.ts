/**
 * Four figures on the case workbench, counted over the hundred rows below
 * them.
 *
 * The screen shows cases, overdue, urgent and nobody-yet above a table of
 * open cases, and added all four up in the browser over whatever
 * `/government/cases` returned — which is `LIMIT 100`.
 *
 * Measured on a 140-case open queue (5 urgent, 20 high, 100 normal, 15 low,
 * every fourth one overdue, every fifth unassigned):
 *
 *   the whole queue   140 cases, 35 overdue, 5 urgent, 28 unassigned
 *   the first 100     100 cases, 31 overdue, 5 urgent, 20 unassigned
 *
 * Three of the four wrong, and all three understating — a work queue reading
 * as more under control than it is, which is the direction nobody checks. The
 * tile that carries the alert variant, overdue, is one of them.
 *
 * WHY URGENT IS TESTED TOO, THOUGH IT WAS NEVER WRONG
 *
 * `urgent` was exact, because the query sorts URGENT first and five of them
 * fit on a page. That is the ordering protecting a figure by luck: it holds
 * only while fewer than a hundred cases are urgent, and it would stop holding
 * the moment the ORDER BY changed for an unrelated reason. A figure that is
 * right by accident is the one most worth pinning, because nothing announces
 * when the accident ends.
 *
 * `myWork` in the same service already paired a capped list with unbounded
 * `count(*)` subqueries for its own tiles. The correct pattern was two
 * hundred lines from the defect.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  get,
  loginAs,
  pool,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './helpers';
import { query } from '../db/pool';
import { seedReferenceData } from '../db/seed';

let token = '';
let officerId = '';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  officerId = await createGovernmentUser({
    fullName: 'Case Officer',
    phone: '+2348000000200',
    role: 'admin',
  });
  token = (await loginAs('+2348000000200')).accessToken;
});

/**
 * An open queue of `count` cases, in the shape a real one takes.
 *
 * Priorities in the proportion a queue actually holds — a few urgent, more
 * high, mostly normal, a tail of low — because the figures under test depend
 * on the ORDER BY, and a queue of uniform priority would not exercise it.
 * `department` holds a role name on this table, not a department; `category`
 * and `opened_by` are both constrained.
 */
async function queueOf(count: number): Promise<void> {
  await query(
    pool,
    `INSERT INTO cases (case_number, subject, category, status, priority, department,
                        due_at, opened_by, assignee_id)
     SELECT 'CS-FIG-' || g, 'Dispute ' || g, 'TAXPAYER_DISPUTE', 'OPEN',
            CASE WHEN g <= 5 THEN 'URGENT'
                 WHEN g <= 25 THEN 'HIGH'
                 WHEN g <= 125 THEN 'NORMAL'
                 ELSE 'LOW' END,
            'admin',
            CASE WHEN g % 4 = 0 THEN now() - interval '3 days'
                 ELSE now() + interval '9 days' END,
            $1::uuid,
            CASE WHEN g % 5 = 0 THEN NULL ELSE $1::uuid END
       FROM generate_series(1, $2::int) g`,
    [officerId, count],
  );
}

interface Body {
  cases: { priority: string; overdue: boolean; assignee_name: string | null }[];
  matched: number;
  overdue: number;
  urgent: number;
  unassigned: number;
  cap: number;
}

const openQueue = async (extra = ''): Promise<Body> => {
  const answer = await get(`/government/cases?open=true${extra}`, { token });
  assert.equal(answer.status, 200, JSON.stringify(answer.body));
  return answer.body as Body;
};

describe('the figures above the case table', () => {
  it('count every matched case, not the hundred that fitted', async () => {
    await queueOf(140);

    const body = await openQueue();

    // The page really is short, or none of the rest is a test.
    assert.equal(body.cases.length, 100, 'the cap did not apply');

    assert.equal(body.matched, 140, 'the queue holds 140 open cases');
    assert.equal(
      body.overdue,
      35,
      'overdue is the figure wearing the alert, and the one a supervisor acts on',
    );
    assert.equal(body.unassigned, 28, 'nobody-yet decides who picks up next');
    assert.equal(body.urgent, 5);
    assert.equal(body.cap, 100, 'the screen cannot say the table stopped short without this');
  });

  it('agrees with the rows when nothing is capped', async () => {
    // The bound. A figure wired to a constant, or counting the wrong table,
    // would satisfy the case above and disagree with the page here.
    await queueOf(40);

    const body = await openQueue();

    assert.equal(body.cases.length, 40);
    assert.equal(body.matched, 40);
    assert.equal(body.overdue, body.cases.filter((row) => row.overdue).length);
    assert.equal(body.urgent, body.cases.filter((row) => row.priority === 'URGENT').length);
    assert.equal(
      body.unassigned,
      body.cases.filter((row) => row.assignee_name === null).length,
    );
  });

  it('counts the filtered set, not the whole table', async () => {
    /*
     * The figures describe what the officer is looking at. Asking for urgent
     * cases only must not report the queue's totals beside a table of five —
     * that would be the same lie in the opposite direction.
     */
    await queueOf(140);

    const body = await openQueue('&priority=URGENT');

    assert.equal(body.matched, 5, 'five cases are urgent');
    assert.equal(body.urgent, 5);
    assert.equal(body.cases.length, 5);
  });

  it('leaves every field the table renders', async () => {
    // The rows moved inside a derived table to make room for the windows, and
    // the window columns are stripped on the way out. Both are the kind of
    // change that quietly drops a column.
    await queueOf(3);

    const body = await openQueue();
    const row = body.cases[0] as unknown as Record<string, unknown>;

    for (const field of [
      'id',
      'case_number',
      'subject',
      'category',
      'status',
      'priority',
      'risk_level',
      'department',
      'due_at',
      'created_at',
      'overdue',
      'assignee_name',
      'opened_by_name',
      'comment_count',
      'evidence_count',
    ]) {
      assert.ok(field in row, `the case table renders ${field} and it is no longer sent`);
    }
    for (const leaked of ['matched', 'overdue_total', 'urgent_total', 'unassigned_total']) {
      assert.ok(!(leaked in row), `${leaked} belongs beside the page, not on every row`);
    }
  });

  it('answers an empty queue with zeroes rather than nothing', async () => {
    const body = await openQueue();

    assert.deepEqual(
      { ...body, cases: body.cases.length },
      { cases: 0, matched: 0, overdue: 0, urgent: 0, unassigned: 0, cap: 100 },
    );
  });
});
