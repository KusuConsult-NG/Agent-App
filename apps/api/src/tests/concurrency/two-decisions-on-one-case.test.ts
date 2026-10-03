/**
 * Two officers deciding one case at the same moment.
 *
 * The case file is evidence. `audit-workbench.ts` samples it, an auditor
 * reads its timeline months later, and every entry on that timeline says what
 * the case moved from and what it moved to.
 *
 * All five of the case writers read the case with `load(db, caseId)` and then
 * open a transaction that UPDATEs it, and none of them re-reads the row under
 * a lock. For three of them that costs little: attaching evidence and adding a
 * comment are additive, and two of them landing together is two things
 * happening, which is what the record should say.
 *
 * Two of them carry a guard that exists precisely to stop the same thing being
 * done twice, and the guard is decided on the stale read:
 *
 *   `setStatus` refuses when the status asked for is the status the case
 *   already has — "Case CASE-2026-000012 is already resolved." Two officers
 *   resolving one case together both read OPEN, both pass, and the case ends
 *   with two RESOLUTION entries and two audit rows, each claiming it moved the
 *   case out of OPEN. One of those claims is false.
 *
 *   `escalate` computes who to escalate to from `row.assignee_id` — the stale
 *   one — so the second escalation records a move from an officer who no
 *   longer held the case, and notifies the person above a second time. Its own
 *   comment says why that notification matters: "An escalation that the person
 *   above finds out about by looking is an escalation in the sense that a
 *   shrug is an answer."
 *
 * `requestTin` splits the same way and says why it is safe — "The write below
 * re-reads `FOR UPDATE` and refuses" — which is the practice these two did not
 * follow.
 */

import '../env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  loginAs,
  pool,
  post,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from '../helpers';
import { query, queryOne } from '../../db/pool';
import { seedReferenceData } from '../../db/seed';

let auditorToken = '';
let caseId = '';

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
    role: 'auditor',
    phone: '+2348089900001',
    fullName: 'Case Race Auditor',
  });
  auditorToken = (await loginAs('+2348089900001')).accessToken;
  await createGovernmentUser({
    role: 'admin',
    phone: '+2348089900002',
    fullName: 'Case Race Supervisor',
  });
  // Somewhere for an escalation to go. `escalationTarget` takes the direct
  // supervisor first, so one column is the whole hierarchy this needs.
  await query(
    pool,
    `UPDATE users SET supervisor_id = (SELECT id FROM users WHERE phone = $2)
      WHERE phone = $1`,
    ['+2348089900001', '+2348089900002'],
  );

  const opened = await post(
    '/government/cases',
    {
      subject: 'Two decisions arriving together',
      description: 'Opened so two officers can decide it at once.',
      category: 'GENERAL',
      riskLevel: 'MEDIUM',
    },
    { token: auditorToken },
  );
  assert.equal(opened.status, 201, JSON.stringify(opened.body));
  caseId = opened.body.id ?? opened.body.caseId;
  assert.ok(caseId, `the case was opened: ${JSON.stringify(opened.body)}`);
});

const resolve = (resolution: string) =>
  post(
    `/government/cases/${caseId}/status`,
    { status: 'RESOLVED', resolution },
    { token: auditorToken },
  );

async function events(kind: string): Promise<number> {
  const row = await queryOne<{ n: string }>(
    pool,
    `SELECT count(*)::text AS n FROM case_events WHERE case_id = $1 AND kind = $2`,
    [caseId, kind],
  );
  return Number.parseInt(row!.n, 10);
}

const move = (status: string) =>
  post(`/government/cases/${caseId}/status`, { status }, { token: auditorToken });

describe('two moves to the same open status, arriving together', () => {
  it('refuses the second as already there, and leaves one entry', async () => {
    /*
     * The non-terminal case, and the one the terminal check does not cover.
     * INVESTIGATING is not in TERMINAL, so a second move to it is caught by
     * the "already" test rather than by "cannot be changed" — and without
     * re-reading under the lock, both moves landed and the timeline carried
     * two STATUS_CHANGE entries for one transition.
     */
    const [first, second] = await Promise.all([move('INVESTIGATING'), move('INVESTIGATING')]);

    assert.deepEqual(
      [first.status, second.status].sort(),
      [204, 400],
      'both moves were accepted: ' + JSON.stringify([first.body, second.body]),
    );
    const refused = first.status === 400 ? first : second;
    assert.match(refused.body.error.message, /already investigating/i, JSON.stringify(refused.body));

    assert.equal(
      await events('STATUS_CHANGE'),
      1,
      'one transition left two entries on the timeline',
    );
  });
});

describe('two resolutions of one case, arriving together', () => {
  it('records one, and refuses the other by name', async () => {
    const [first, second] = await Promise.all([
      resolve('Unfounded on the evidence available.'),
      resolve('Escalated to the ministry for a decision.'),
    ]);

    // 204 on success; the route returns no body.
    const statuses = [first.status, second.status].sort();
    assert.deepEqual(
      statuses,
      [204, 409],
      'both resolutions were accepted, so the case carries two decisions: ' +
        JSON.stringify([first.body, second.body]),
    );

    const refused = first.status === 409 ? first : second;
    assert.equal(refused.body.error.code, 'CASE_CLOSED');

    /*
     * And it is the same answer the officer would have got a second later.
     *
     * That is the property worth holding rather than any particular code: a
     * refusal that depends on how close together two requests arrived is a
     * refusal nobody can be trained on. Resolving an already-resolved case
     * sequentially goes through `assertOpen`, because RESOLVED is terminal,
     * and the locked re-check reaches the same sentence by the same route.
     */
    const sequential = await resolve('Tried again a moment later.');
    assert.equal(sequential.status, refused.status);
    assert.deepEqual(sequential.body.error, refused.body.error);
  });

  it('leaves one resolution on the timeline an auditor reads', async () => {
    await Promise.all([
      resolve('Unfounded on the evidence available.'),
      resolve('Escalated to the ministry for a decision.'),
    ]);

    assert.equal(
      await events('RESOLUTION'),
      1,
      'one case, resolved once, has more than one resolution on its timeline',
    );

    const audits = await query<{ old_value: { status?: string } | null }>(
      pool,
      `SELECT old_value FROM audit_logs
        WHERE entity_type = 'case' AND entity_id = $1 AND action = 'case.resolved'`,
      [caseId],
    );
    assert.equal(
      audits.length,
      1,
      'two audit entries each claim to have moved this case out of OPEN, and one of ' +
        `them did not: ${JSON.stringify(audits)}`,
    );
  });
});

describe('two escalations of one case, arriving together', () => {
  const escalate = () =>
    post(
      `/government/cases/${caseId}/escalate`,
      { reason: 'Needs a decision from somebody above this desk.' },
      { token: auditorToken },
    );

  it('escalates once, and tells the second officer the case has moved', async () => {
    /*
     * `escalate` picks its target from `row.assignee_id` — who held the case
     * when the request started. Two arriving together both computed it from
     * the same stale value, so the second recorded a move from an officer who
     * no longer held the case and notified the person above a second time for
     * one escalation. Its own comment says that notification is not a
     * formality: "An escalation that the person above finds out about by
     * looking is an escalation in the sense that a shrug is an answer."
     */
    const [first, second] = await Promise.all([escalate(), escalate()]);

    assert.deepEqual(
      [first.status, second.status].sort(),
      [200, 409],
      'both escalations were recorded: ' + JSON.stringify([first.body, second.body]),
    );
    const refused = first.status === 409 ? first : second;
    assert.equal(refused.body.error.code, 'CASE_MOVED', JSON.stringify(refused.body));

    assert.equal(
      await events('ESCALATION'),
      1,
      'one escalation left two entries on the timeline an auditor reads',
    );
  });
});

describe('a case routed while it is being assigned', () => {
  /*
   * `assign` is right to let the last writer win: an assignment names its
   * target, so a case moving under it does not invalidate the intent. What it
   * had wrong is the fields the caller did not name. They were derived from
   * the stale row —
   *
   *     const department = input.department === undefined ? row.department : …
   *
   * — so an officer routing a case to Finance while another assigns it to a
   * person lost the routing, to a write that never mentioned it. A lost
   * update rather than a guard that failed, and the audit entry recorded
   * `oldValue.department` as the value before the routing, which is a claim
   * about a state this request never saw.
   */
  it('keeps the routing a concurrent assignment never mentioned', async () => {
    /*
     * The window, forced rather than hoped for.
     *
     * Two simultaneous requests do not reliably interleave the way this
     * defect needs — six runs of `Promise.all` never caught it — so the test
     * holds the case row itself and lets the database do the ordering:
     *
     *   1. The test opens a transaction and locks the case.
     *   2. An assignment naming only an assignee is fired. It reads the case
     *      on the pool, unblocked, and sees the department as it is now. Its
     *      UPDATE then waits for the lock.
     *   3. The test routes the case to Finance and commits.
     *   4. The assignment's UPDATE proceeds — and wrote back the department it
     *      read in step 2.
     *
     * The wait in step 2 is only there to let the read happen before the
     * routing; the lock is what makes the write order certain. The audit entry
     * is asserted as well, because it is what proves the interleaving actually
     * occurred rather than the test having raced past its own setup.
     */
    // Looked up here rather than in a hook: `resetDatabase` recreates the
    // officers for every test, so an id captured once goes stale.
    const assignee = await queryOne<{ id: string }>(
      pool,
      'SELECT id FROM users WHERE phone = $1',
      ['+2348089900002'],
    );
    const assigneeId = assignee!.id;

    const holder = await pool.connect();
    let assignment: Promise<unknown>;
    let settled = false;
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM cases WHERE id = $1 FOR UPDATE', [caseId]);

      assignment = post(
        `/government/cases/${caseId}/assign`,
        { assigneeId },
        { token: auditorToken },
      );
      void assignment.then(() => {
        settled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 150));

      /*
       * The interleaving, proved rather than assumed.
       *
       * If the assignment had already finished there would be no window and
       * the outcome below would be meaningless. It cannot have finished: its
       * write needs the row this test is holding. Asserted because a test that
       * races past its own setup passes for the wrong reason, which is the
       * failure mode of every concurrency test in this directory.
       */
      assert.equal(
        settled,
        false,
        'the assignment completed before the routing, so this run never opened the window',
      );

      await holder.query(`UPDATE cases SET department = 'finance_officer' WHERE id = $1`, [
        caseId,
      ]);
      await holder.query('COMMIT');
    } finally {
      holder.release();
    }

    const landed = (await assignment) as { status: number; body: unknown };
    assert.ok(
      [200, 204].includes(landed.status),
      `the assignment itself was refused: ${JSON.stringify(landed)}`,
    );

    const current = await queryOne<{ department: string | null; assignee_id: string | null }>(
      pool,
      'SELECT department, assignee_id FROM cases WHERE id = $1',
      [caseId],
    );
    assert.equal(
      current!.department,
      'finance_officer',
      'the routing was reverted by an assignment that said nothing about it',
    );
    assert.equal(current!.assignee_id, assigneeId, 'and the assignment itself still landed');
  });

  it('does not assign a case that was resolved while it waited', async () => {
    /*
     * The same window, with the case closing in it rather than being routed.
     * `assertOpen` runs on the read taken before the transaction, so without
     * the locked re-check an assignment could land on a case somebody had
     * just resolved — and the timeline would carry an assignment after its
     * own resolution.
     */
    const assignee = await queryOne<{ id: string }>(
      pool,
      'SELECT id FROM users WHERE phone = $1',
      ['+2348089900002'],
    );

    const holder = await pool.connect();
    let assignment: Promise<unknown>;
    let settled = false;
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM cases WHERE id = $1 FOR UPDATE', [caseId]);

      assignment = post(
        `/government/cases/${caseId}/assign`,
        { assigneeId: assignee!.id },
        { token: auditorToken },
      );
      void assignment.then(() => {
        settled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.equal(settled, false, 'this run never opened the window');

      // `case_resolution_stated` requires all three together, which is the
      // point of it: a resolved case says what it concluded and when.
      await holder.query(
        `UPDATE cases
            SET status = 'RESOLVED',
                resolution = 'Closed while an assignment waited.',
                resolved_at = now()
          WHERE id = $1`,
        [caseId],
      );
      await holder.query('COMMIT');
    } finally {
      holder.release();
    }

    const refused = (await assignment) as { status: number; body: { error: { code: string } } };
    assert.equal(
      refused.status,
      409,
      `the assignment landed on a resolved case: ${JSON.stringify(refused)}`,
    );
    assert.equal(refused.body.error.code, 'CASE_CLOSED');

    const held = await queryOne<{ assignee_id: string | null }>(
      pool,
      'SELECT assignee_id FROM cases WHERE id = $1',
      [caseId],
    );
    assert.equal(held!.assignee_id, null, 'and nobody was given a case that had been closed');
  });
});

describe('a due date set while the priority is being raised', () => {
  /*
   * `setPriority` writes both columns every time, and took the one the caller
   * did not name from the read above its transaction. Two officers — one
   * raising the priority, one setting a due date — each wrote the other's
   * field back as they had found it, and whichever committed second undid the
   * first. The change was lost to a request that never mentioned the field it
   * overwrote, and the timeline recorded the stale value as the old one.
   *
   * Forced the same way as the assignment above: the test holds the row, so
   * the database decides the write order rather than the scheduler.
   */
  it('keeps the due date a concurrent priority change never mentioned', async () => {
    const holder = await pool.connect();
    let change: Promise<unknown>;
    let settled = false;
    const due = '2027-03-31';
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM cases WHERE id = $1 FOR UPDATE', [caseId]);

      change = post(
        `/government/cases/${caseId}/priority`,
        { priority: 'URGENT' },
        { token: auditorToken },
      );
      void change.then(() => {
        settled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.equal(settled, false, 'this run never opened the window');

      await holder.query('UPDATE cases SET due_at = $2 WHERE id = $1', [caseId, due]);
      await holder.query('COMMIT');
    } finally {
      holder.release();
    }

    const landed = (await change) as { status: number; body: unknown };
    assert.ok(
      [200, 204].includes(landed.status),
      `the priority change was refused: ${JSON.stringify(landed)}`,
    );

    const current = await queryOne<{ priority: string; due_at: Date | null }>(
      pool,
      'SELECT priority, due_at FROM cases WHERE id = $1',
      [caseId],
    );
    assert.equal(current!.priority, 'URGENT', 'the priority change itself landed');
    assert.ok(current!.due_at, 'the due date was erased by a change that never mentioned it');
    assert.equal(
      new Date(current!.due_at!).toISOString().slice(0, 10),
      due,
      'the due date was reverted by a change that never mentioned it',
    );
  });
});
