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
