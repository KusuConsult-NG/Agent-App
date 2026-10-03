/**
 * Twenty open complaints about conduct, and a banner that said sixteen.
 *
 * The support screen counts AGENT_MISCONDUCT and UNAUTHORISED_CHARGE tickets
 * that are not closed, and shows the figure above the table. The test that
 * put it there says why it matters: "a citizen who reports being overcharged
 * by a revenue agent has no other way into this building."
 *
 * It counted them in the browser, over the rows `/support/tickets` returned —
 * and that list is capped at fifty. Measured on sixty open tickets with every
 * third a conduct complaint: twenty exist, and a count over the newest fifty
 * is sixteen. Four complaints about an agent overcharging citizens, invisible
 * to the supervisor whose job is to act on them.
 *
 * `a-complaint-nobody-saw` fixed the banner DISAPPEARING when the read
 * failed. This is the banner UNDERCOUNTING when the queue is busy. Both end
 * with a complaint nobody saw, which is why the count now comes from SQL over
 * every matching ticket rather than from whatever fitted on a page.
 *
 * The category set is the shared `CONDUCT_CATEGORIES`, read by the screen and
 * interpolated into this query, so the banner and the figure above it cannot
 * come to disagree about what a complaint is.
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
import { query, queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { CONDUCT_CATEGORIES, TICKET_CATEGORIES } from './support-category-bridge';

let officer = '';
let raiserId = '';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({ fullName: 'Support Lead', phone: '+2348000000210', role: 'admin' });
  officer = (await loginAs('+2348000000210')).accessToken;
  const raiser = await queryOne<{ id: string }>(
    pool,
    `SELECT id FROM users WHERE phone = $1`,
    ['+2348000000210'],
  );
  raiserId = raiser!.id;
});

/**
 * `count` open tickets, every third a conduct complaint.
 *
 * Priorities spread the way a real queue is, because the cap takes the newest
 * fifty in priority order and a uniform queue would not exercise that.
 */
async function queueOf(count: number): Promise<void> {
  await query(
    pool,
    `INSERT INTO support_tickets (ticket_number, category, subject, description, status,
                                  priority, raised_by, raiser_role, created_at)
     SELECT 'TK-FIG-' || g,
            CASE WHEN g % 3 = 0 THEN 'AGENT_MISCONDUCT' ELSE 'PAYMENT_ISSUE' END,
            'Complaint ' || g, 'A trader says they were charged twice.', 'OPEN',
            CASE WHEN g <= 4 THEN 'URGENT' WHEN g <= 20 THEN 'HIGH' ELSE 'NORMAL' END,
            $1::uuid, 'agent',
            now() - (g || ' minutes')::interval
       FROM generate_series(1, $2::int) g`,
    [raiserId, count],
  );
}

interface Body {
  tickets: { category: string; status: string }[];
  matched: number;
  conductOpen: number;
  cap: number;
}

const listed = async (extra = ''): Promise<Body> => {
  const answer = await get(`/support/tickets${extra}`, { token: officer });
  assert.equal(answer.status, 200, JSON.stringify(answer.body));
  return answer.body as Body;
};

describe('the complaints banner above a capped queue', () => {
  it('counts every open complaint, not the ones that fitted on the page', async () => {
    await queueOf(60);

    const body = await listed();

    // The page really is short, or nothing below is a test.
    assert.equal(body.tickets.length, 50, 'the cap did not apply');

    assert.equal(body.matched, 60, 'sixty tickets are open');
    assert.equal(
      body.conductOpen,
      20,
      'twenty complaints about conduct are open; a count over the page is sixteen, and ' +
        'the four it leaves out are the ones nobody comes back to',
    );

    // And the arithmetic this replaced really is short here, so the case is a
    // demonstration rather than a coincidence.
    const onThePage = body.tickets.filter(
      (t) => (CONDUCT_CATEGORIES as readonly string[]).includes(t.category) && t.status !== 'CLOSED',
    ).length;
    assert.equal(onThePage, 16, 'the page should hold sixteen of the twenty');
    assert.notEqual(onThePage, body.conductOpen);
  });

  it('agrees with the page when nothing is capped', async () => {
    // The bound. A figure wired to a constant, or counting the wrong rows,
    // would satisfy the case above and disagree with the page here.
    await queueOf(9);

    const body = await listed();

    assert.equal(body.tickets.length, 9);
    assert.equal(body.matched, 9);
    assert.equal(
      body.conductOpen,
      body.tickets.filter(
        (t) =>
          (CONDUCT_CATEGORIES as readonly string[]).includes(t.category) && t.status !== 'CLOSED',
      ).length,
    );
    assert.equal(body.conductOpen, 3, 'every third of nine is three');
  });

  it('stops counting a complaint once it is closed', async () => {
    /*
     * The banner is about complaints still open. A closed one has been dealt
     * with, and counting it would send a supervisor looking for work that is
     * finished — which is the opposite failure and just as wrong.
     */
    await queueOf(9);
    await query(pool, `UPDATE support_tickets SET status = 'CLOSED' WHERE category = $1`, [
      'AGENT_MISCONDUCT',
    ]);

    const body = await listed();

    assert.equal(body.matched, 9, 'the tickets are still there');
    assert.equal(body.conductOpen, 0, 'and none of the complaints is still open');
  });

  it('counts within the filter, not across the whole queue', async () => {
    // The figures describe what the officer is looking at. Filtering to one
    // status must not report the queue's totals beside a shorter table.
    await queueOf(60);
    await query(pool, `UPDATE support_tickets SET status = 'RESOLVED' WHERE ticket_number LIKE $1`, [
      'TK-FIG-5%',
    ]);

    const body = await listed('?status=RESOLVED');

    assert.ok(body.matched > 0, 'some tickets were resolved');
    assert.equal(
      body.matched,
      body.tickets.length,
      'the resolved set is small enough to fit, so matched is the page',
    );
    assert.equal(
      body.conductOpen,
      body.tickets.filter((t) => t.category === 'AGENT_MISCONDUCT').length,
      'the figure is of the filtered set, not of the queue behind it',
    );
  });

  it('still counts a resolved complaint, because resolved is not finished', async () => {
    /*
     * The predicate is `status <> 'CLOSED'`, not `status = 'OPEN'`, and that
     * is deliberate. `addMessage` records why: "A raiser replying to a ticket
     * that was marked RESOLVED reopens it. Closing a complaint the
     * complainant disagrees with, and leaving them no way to say so except
     * raising a second ticket, is how a queue stays tidy at the expense of
     * the person who needed it."
     *
     * So RESOLVED is provisional — the citizen can still push back — and a
     * supervisor's count of outstanding complaints has to include it. Only
     * CLOSED is finished.
     *
     * This case exists because the first version of it asserted the opposite,
     * out of my own assumption about what "resolved" means, and the service
     * was right.
     */
    await queueOf(9);
    await query(pool, `UPDATE support_tickets SET status = $1 WHERE category = $2`, [
      'RESOLVED',
      'AGENT_MISCONDUCT',
    ]);

    const resolved = await listed();
    assert.equal(resolved.conductOpen, 3, 'a resolved complaint can be reopened and still counts');

    await query(pool, `UPDATE support_tickets SET status = $1 WHERE category = $2`, [
      'CLOSED',
      'AGENT_MISCONDUCT',
    ]);

    const closed = await listed();
    assert.equal(closed.conductOpen, 0, 'a closed complaint is finished and does not');
  });

  it('leaves every field the table renders, and no window columns', async () => {
    await queueOf(3);

    const body = await listed();
    const row = body.tickets[0] as unknown as Record<string, unknown>;

    for (const field of [
      'id',
      'ticket_number',
      'category',
      'subject',
      'status',
      'priority',
      'created_at',
      'raised_by_name',
      'raiser_role',
      'message_count',
      'last_message_at',
    ]) {
      assert.ok(field in row, `the ticket table renders ${field} and it is no longer sent`);
    }
    for (const leaked of ['matched', 'conduct_open']) {
      assert.ok(!(leaked in row), `${leaked} belongs beside the page, not on every row`);
    }
  });

  it('keeps the conduct categories a subset of the ticket categories', () => {
    /*
     * `CONDUCT_CATEGORIES` is shared, and `TICKET_CATEGORIES` — the whole list,
     * which builds request validation — lives in the support service. A
     * category renamed in one and not the other would stop being counted
     * silently: the SQL would filter on a value no ticket can hold, and the
     * banner would read nought on a queue full of complaints.
     */
    for (const category of CONDUCT_CATEGORIES) {
      assert.ok(
        (TICKET_CATEGORIES as readonly string[]).includes(category),
        `${category} is counted as a complaint but is not a ticket category`,
      );
    }
  });
});
