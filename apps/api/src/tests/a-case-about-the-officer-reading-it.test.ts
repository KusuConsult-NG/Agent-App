/**
 * A case about an officer, in that officer's hands.
 *
 * A case can name the officer it concerns (`subject_user_id`), and nothing
 * read that column after it was written. Measured through the routes: a case
 * about a revenue officer was opened and assigned to them (201); they listed
 * it, read it (200) and resolved it — "Looked into it myself; nothing wrong"
 * (204); and an administrator a second case was about resolved that one
 * through case:manage (204).
 *
 * The officer a case is about is now kept out of it: not assigned it, not
 * escalated to, not mentioned in it, not shown it in any list, and refused it
 * by number, whatever their permissions.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createGovernmentUser, get, loginAs, pool, post, resetDatabase, startTestServer, stopTestServer } from './helpers';
import { seedReferenceData } from '../db/seed';

let opener = '';
let colleague = '';
let subject = '';
let subjectId = '';
let investigatedAdmin = '';
let investigatedAdminId = '';
let colleagueId = '';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({ fullName: 'Opening Auditor', phone: '+2348077960001', role: 'auditor' });
  colleagueId = await createGovernmentUser({ fullName: 'Colleague', phone: '+2348077960002', role: 'revenue_officer' });
  subjectId = await createGovernmentUser({ fullName: 'Investigated Officer', phone: '+2348077960003', role: 'revenue_officer' });
  investigatedAdminId = await createGovernmentUser({ fullName: 'Investigated Admin', phone: '+2348077960004', role: 'admin' });
  opener = (await loginAs('+2348077960001')).accessToken;
  colleague = (await loginAs('+2348077960002')).accessToken;
  subject = (await loginAs('+2348077960003')).accessToken;
  investigatedAdmin = (await loginAs('+2348077960004')).accessToken;
});

async function caseAbout(subjectUserId: string, extra: Record<string, unknown> = {}) {
  const opened = await post(
    '/government/cases',
    { subject: 'Collections short at Terminus market', category: 'GENERAL', subjectUserId, ...extra },
    { token: opener },
  );
  assert.equal(opened.status, 201, JSON.stringify(opened.body));
  return opened.body.id as string;
}

describe('assigning a case to the officer it is about', () => {
  it('is refused when the case is opened', async () => {
    const opened = await post(
      '/government/cases',
      { subject: 'Collections short at Terminus market', subjectUserId: subjectId, assigneeId: subjectId },
      { token: opener },
    );
    assert.equal(opened.status, 400, JSON.stringify(opened.body));
  });

  it('is refused afterwards, and the case stays with whoever had it', async () => {
    const id = await caseAbout(subjectId, { assigneeId: colleagueId });
    const moved = await post(`/government/cases/${id}/assign`, { assigneeId: subjectId }, { token: opener });
    assert.equal(moved.status, 400, JSON.stringify(moved.body));
    const row = await pool.query<{ assignee_id: string }>('SELECT assignee_id FROM cases WHERE id = $1', [id]);
    assert.equal(row.rows[0]!.assignee_id, colleagueId);
  });
});

describe('the officer a case is about', () => {
  it('does not see it listed, though a colleague does', async () => {
    const id = await caseAbout(subjectId);
    const theirs = await get<{ cases: { id: string }[] }>('/government/cases', { token: subject });
    const others = await get<{ cases: { id: string }[] }>('/government/cases', { token: colleague });
    assert.equal(theirs.body.cases.some((c) => c.id === id), false, 'the case about them was listed');
    assert.equal(others.body.cases.some((c) => c.id === id), true);
  });

  it('is refused it by number', async () => {
    const id = await caseAbout(subjectId);
    const read = await get(`/government/cases/${id}`, { token: subject });
    assert.equal(read.status, 403, JSON.stringify(read.body));
    assert.match(read.body.error.message, /is about you/);
  });

  it('cannot resolve it, even holding case:manage', async () => {
    const id = await caseAbout(investigatedAdminId);
    const resolved = await post(
      `/government/cases/${id}/status`,
      { status: 'RESOLVED', resolution: 'No case to answer.' },
      { token: investigatedAdmin },
    );
    assert.equal(resolved.status, 403, JSON.stringify(resolved.body));
    const row = await pool.query<{ status: string }>('SELECT status FROM cases WHERE id = $1', [id]);
    assert.notEqual(row.rows[0]!.status, 'RESOLVED');
  });

  it('cannot comment on it', async () => {
    const id = await caseAbout(subjectId);
    const said = await post(`/government/cases/${id}/comments`, { body: 'This is all a misunderstanding.' }, { token: subject });
    assert.equal(said.status, 403, JSON.stringify(said.body));
  });

  it('cannot act on one assigned to them before any of this', async () => {
    const id = await caseAbout(subjectId);
    await pool.query('UPDATE cases SET assignee_id = $2 WHERE id = $1', [id, subjectId]);

    const resolved = await post(
      `/government/cases/${id}/status`,
      { status: 'RESOLVED', resolution: 'Looked into it myself; nothing wrong.' },
      { token: subject },
    );
    assert.equal(resolved.status, 403, JSON.stringify(resolved.body));

    const work = await get<{ assigned: { id: string }[]; counts: { assigned_open: string } }>(
      '/government/my-work',
      { token: subject },
    );
    assert.equal(work.status, 200, JSON.stringify(work.body));
    assert.equal(work.body.assigned.some((c) => c.id === id), false);
    assert.equal(work.body.counts.assigned_open, '0', 'counted as their open work');
  });

  it('is not told of it by being mentioned', async () => {
    const id = await caseAbout(subjectId);
    const said = await post(
      `/government/cases/${id}/comments`,
      { body: 'Copying the officer concerned.', mentions: [subjectId, colleagueId] },
      { token: opener },
    );
    assert.equal(said.status, 204, JSON.stringify(said.body));
    const mentions = await pool.query<{ mentions: string[] }>(
      `SELECT mentions FROM case_events WHERE case_id = $1 AND kind IN ('COMMENT','NOTE')`,
      [id],
    );
    assert.deepEqual(mentions.rows[0]!.mentions, [colleagueId], 'the subject was mentioned');
  });
});

describe('the queue of unassigned cases for a department', () => {
  /*
   * Routed to the revenue officers and picked up by nobody: every revenue
   * officer sees it waiting, except the one it is about.
   */
  it('does not offer the officer a case about them, or count it', async () => {
    const id = await caseAbout(subjectId, { department: 'revenue_officer' });

    type Work = { unassigned: { id: string }[]; counts: { department_unassigned: string } };
    const theirs = await get<Work>('/government/my-work', { token: subject });
    const others = await get<Work>('/government/my-work', { token: colleague });

    assert.equal(theirs.body.unassigned.some((c) => c.id === id), false, 'offered to its subject');
    assert.equal(theirs.body.counts.department_unassigned, '0');
    assert.equal(others.body.unassigned.some((c) => c.id === id), true);
    assert.equal(others.body.counts.department_unassigned, '1');
  });
});

describe('escalating a case', () => {
  it('is refused when the next officer up is the one it is about', async () => {
    await pool.query('UPDATE users SET supervisor_id = $2 WHERE id = $1', [colleagueId, subjectId]);
    const id = await caseAbout(subjectId, { assigneeId: colleagueId });

    const escalated = await post(`/government/cases/${id}/escalate`, { reason: 'Needs a senior officer.' }, { token: colleague });
    assert.equal(escalated.status, 409, JSON.stringify(escalated.body));
    assert.match(escalated.body.error.message, /this case is about them/);
  });
});
