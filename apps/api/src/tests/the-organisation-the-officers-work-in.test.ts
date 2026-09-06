/**
 * Departments, the line an officer reports along, and where a case goes up to.
 *
 * The platform modelled the revenue service's work in detail and its structure
 * not at all: no department, no office, no reporting line — a `supervisor` role
 * and nobody with a supervisor. Six items on the readiness assessment read
 * Missing or Partial for that, and one of them was load-bearing: a case could
 * only be addressed to a *role*, because a role was the only grouping the
 * schema could enforce.
 *
 * The property worth testing is not that a department can be created. It is:
 *
 *   * A case routed to a department lands in that department's queue, and in
 *     nobody else's — including another department whose officers hold
 *     identical permissions.
 *   * Escalation resolves to a person, and falls back sensibly when the person
 *     directly above is unset, which in a real service is most of the time.
 *   * The reporting line cannot loop, because escalation walks it.
 *   * A posting record cannot be edited afterwards, because "who was
 *     responsible for Jos North in March" is asked in revenue disputes.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  firstLgaId,
  get,
  grantStepUp,
  loginAs,
  pool,
  post,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './helpers';
import { query, queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';

const OFFICERS = {
  admin: { fullName: 'Org Admin', phone: '+2348075000001', role: 'admin' },
  finance: { fullName: 'Org Finance', phone: '+2348075000002', role: 'finance_officer' },
  financeTwo: { fullName: 'Org Finance Two', phone: '+2348075000003', role: 'finance_officer' },
  revenue: { fullName: 'Org Revenue', phone: '+2348075000004', role: 'revenue_officer' },
  auditor: { fullName: 'Org Auditor', phone: '+2348075000005', role: 'auditor' },
} as const;

const ids: Record<keyof typeof OFFICERS, string> = {} as never;
const tokens: Record<keyof typeof OFFICERS, string> = {} as never;
let lgaId = '';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  for (const [key, officer] of Object.entries(OFFICERS)) {
    ids[key as keyof typeof OFFICERS] = await createGovernmentUser(officer);
    tokens[key as keyof typeof OFFICERS] = (await loginAs(officer.phone)).accessToken;
  }
  lgaId = await firstLgaId();
});

const auth = (who: keyof typeof OFFICERS) => ({ token: tokens[who] });

async function department(body: Record<string, unknown>) {
  const created = await post(
    '/government/departments',
    { code: 'FIN', name: 'Finance', function: 'FINANCE', ...body },
    auth('admin'),
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return created.body.id as string;
}

// ===========================================================================
describe('a department is a body, not a role', () => {
  it('is created, listed and headed by a named officer', async () => {
    const id = await department({ headUserId: ids.finance });

    const listed = await get('/government/departments', auth('revenue'));
    assert.equal(listed.status, 200);
    const row = (listed.body as Record<string, string>[]).find((entry) => entry.id === id);
    assert.ok(row);
    assert.equal(row!.head_name, OFFICERS.finance.fullName);
    assert.equal(row!.function, 'FINANCE');
  });

  /*
   * The whole point of departments existing.
   *
   * Two departments, both FINANCE, both staffed by officers holding identical
   * permissions. A case sent to one must not appear in the other's queue —
   * which is exactly what routing by role could not do.
   */
  it('keeps two departments of the same function apart', async () => {
    const north = await department({ code: 'FIN-N', name: 'Finance North' });
    const south = await department({ code: 'FIN-S', name: 'Finance South' });

    await postOfficerTo(ids.finance, north);
    await postOfficerTo(ids.financeTwo, south);

    const raised = await post(
      '/government/cases',
      {
        subject: 'Settlement short against the Jos North batch',
        departmentId: north,
        category: 'RECONCILIATION_EXCEPTION',
      },
      auth('revenue'),
    );
    assert.equal(raised.status, 201, JSON.stringify(raised.body));

    const northQueue = await get('/government/my-work', auth('finance'));
    assert.equal(
      (northQueue.body.unassigned as { case_number: string }[]).length,
      1,
      'the department it was sent to sees it',
    );

    const southQueue = await get('/government/my-work', auth('financeTwo'));
    assert.equal(
      (southQueue.body.unassigned as unknown[]).length,
      0,
      'a different department with the same permissions does not',
    );
  });

  /*
   * A case addressed to a role still reaches somebody.
   *
   * Everything raised before departments existed is addressed that way, and a
   * raiser who does not know the organisation chart still routes by role. If
   * the department queue read only `department_id`, all of it would strand.
   */
  it('still delivers a case addressed to a role rather than a department', async () => {
    const raised = await post(
      '/government/cases',
      { subject: 'Raised the old way, addressed to a role', department: 'finance_officer' },
      auth('revenue'),
    );
    assert.equal(raised.status, 201);

    const queue = await get('/government/my-work', auth('finance'));
    assert.equal((queue.body.unassigned as unknown[]).length, 1);
  });

  it('refuses to send work to a closed department', async () => {
    const id = await department({});
    assert.equal(
      (await post(
        `/government/departments/${id}/update`,
        { status: 'CLOSED' },
        auth('admin'),
      )).status,
      204,
    );

    const raised = await post(
      '/government/cases',
      { subject: 'A case with somewhere to go' },
      auth('revenue'),
    );
    const routed = await post(
      `/government/cases/${raised.body.id}/assign`,
      { assigneeId: null, departmentId: id },
      auth('revenue'),
    );
    assert.equal(routed.status, 400, JSON.stringify(routed.body));
    assert.match(JSON.stringify(routed.body), /closed/i);
  });

  it('will not close a department that still has officers in it', async () => {
    const id = await department({});
    await postOfficerTo(ids.finance, id);

    const closed = await post(
      `/government/departments/${id}/update`,
      { status: 'CLOSED' },
      auth('admin'),
    );
    assert.equal(closed.status, 409, JSON.stringify(closed.body));
    assert.match(JSON.stringify(closed.body), /still posted/i);
  });

  /*
   * A department is closed, never deleted.
   *
   * A case carries `department_id` and a posting record names the department
   * somebody moved into, so a deleted row turns both into a dangling identifier
   * no report can resolve. CLOSED is a state an auditor can read; an absence is
   * not. Same standard as the case history and the audit chain.
   */
  it('refuses to delete a department or an office, at the database', async () => {
    const id = await department({});
    await assert.rejects(
      () => query(pool, 'DELETE FROM departments WHERE id = $1', [id]),
      /never deleted/,
    );

    const created = await post(
      '/government/offices',
      { code: 'DEL-01', name: 'Deletable Office', lgaId },
      auth('admin'),
    );
    await assert.rejects(
      () => query(pool, 'DELETE FROM revenue_offices WHERE id = $1', [created.body.id]),
      /never deleted/,
    );
  });

  it('lets every portal role read the structure and only an administrator change it', async () => {
    for (const who of ['revenue', 'finance', 'auditor'] as const) {
      assert.equal((await get('/government/departments', auth(who))).status, 200);
      const attempt = await post(
        '/government/departments',
        { code: 'X', name: 'Mine', function: 'FINANCE' },
        auth(who),
      );
      assert.equal(attempt.status, 403, `${who} should not create a department`);
    }
  });
});

// ===========================================================================
describe('the line an officer reports along', () => {
  it('records each part of a posting as its own dated transfer', async () => {
    const id = await department({});
    const moved = await post(
      `/government/users/${ids.finance}/posting`,
      {
        departmentId: id,
        supervisorId: ids.admin,
        jobTitle: 'Principal Finance Officer',
        reason: 'Posted to Finance on promotion.',
      },
      auth('admin'),
    );
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    assert.equal(moved.body.transfers, 3, 'department, supervisor and title each moved');

    const history = await get(`/government/users/${ids.finance}/transfers`, auth('auditor'));
    const kinds = (history.body as { kind: string }[]).map((row) => row.kind).sort();
    assert.deepEqual(kinds, ['DEPARTMENT', 'POSTING', 'SUPERVISOR']);
  });

  /*
   * A posting history that can be edited afterwards is not evidence.
   *
   * Same standard as the case history and the audit chain, and for the same
   * reason: "who was responsible for Jos North in March" is asked in revenue
   * disputes.
   */
  it('will not let a posting record be changed, at the database', async () => {
    await post(
      `/government/users/${ids.finance}/posting`,
      { jobTitle: 'Finance Officer', reason: 'Confirmed in post.' },
      auth('admin'),
    );
    const row = await queryOne<{ id: string }>(pool, 'SELECT id FROM officer_transfers LIMIT 1');
    await assert.rejects(
      () => query(pool, `UPDATE officer_transfers SET reason = 'nothing' WHERE id = $1`, [row!.id]),
      /append-only/,
    );
    await assert.rejects(
      () => query(pool, 'DELETE FROM officer_transfers WHERE id = $1', [row!.id]),
      /append-only/,
    );
  });

  /*
   * A cycle is not a data-quality nuisance here.
   *
   * Escalation walks up `supervisor_id` until it runs out, so a loop is a query
   * that never returns, on the path that fires when somebody escalates. Two
   * officers each set as the other's supervisor is an ordinary administrative
   * slip, so the database refuses it.
   */
  it('refuses a reporting line that loops', async () => {
    await post(
      `/government/users/${ids.finance}/posting`,
      { supervisorId: ids.admin, reason: 'Reports to the administrator.' },
      auth('admin'),
    );
    // Now try to make the administrator report to the finance officer.
    const looped = await post(
      `/government/users/${ids.admin}/posting`,
      { supervisorId: ids.finance, reason: 'A mistake somebody will make.' },
      auth('admin'),
    );
    /*
     * A refusal an officer can act on, not a 500.
     *
     * The platform's error handler already turns a database control violation
     * into FINANCIAL_CONTROL_BLOCKED and carries the trigger's HINT through as
     * `nextStep`, so the administrator is told what they did rather than that
     * something broke. Worth pinning: the hint is written in the migration and
     * it is the only explanation the officer gets.
     */
    assert.equal(looped.status, 409, JSON.stringify(looped.body));
    assert.match(looped.body.error.message, /loops back/);
    assert.match(looped.body.error.nextStep, /supervising themselves/i);

    // And directly, so the rule holds for a caller that never reaches the service.
    await assert.rejects(
      () =>
        query(pool, 'UPDATE users SET supervisor_id = $2 WHERE id = $1', [
          ids.admin,
          ids.finance,
        ]),
      /loops back/,
    );
  });

  it('refuses an officer as their own supervisor', async () => {
    const attempt = await post(
      `/government/users/${ids.finance}/posting`,
      { supervisorId: ids.finance, reason: 'Nobody supervises themselves.' },
      auth('admin'),
    );
    assert.equal(attempt.status, 400);
    /*
     * The trigger catches it before the CHECK constraint does.
     *
     * Both rules hold — `user_is_not_their_own_supervisor` is still on the
     * table — but a BEFORE trigger runs first, so the message an operator sees
     * at a psql prompt is the cycle one. Asserting the constraint name here
     * would pin an ordering that is not the guarantee.
     */
    await assert.rejects(
      () => query(pool, 'UPDATE users SET supervisor_id = id WHERE id = $1', [ids.finance]),
      /loops back/,
    );
  });

  it('will not post a field agent to an office', async () => {
    const agent = await createGovernmentUser({
      fullName: 'Field Person',
      phone: '+2348075009999',
      role: 'agent',
    });
    const attempt = await post(
      `/government/users/${ids.finance}/posting`,
      { supervisorId: agent, reason: 'A field agent cannot supervise an officer.' },
      auth('admin'),
    );
    assert.equal(attempt.status, 400, JSON.stringify(attempt.body));
    assert.match(JSON.stringify(attempt.body), /field agent/i);
  });
});

// ===========================================================================
describe('escalation, which now goes somewhere', () => {
  /*
   * ESCALATED used to be a status and nothing more: the case changed colour and
   * stayed on the same desk, which is an escalation in the sense that a shrug
   * is an answer.
   */
  it('moves the case to the officer above, and says how it decided', async () => {
    await post(
      `/government/users/${ids.finance}/posting`,
      { supervisorId: ids.admin, reason: 'Reports to the administrator.' },
      auth('admin'),
    );

    const raised = await post(
      '/government/cases',
      { subject: 'Something above my head', assigneeId: ids.finance },
      auth('finance'),
    );
    const escalated = await post(
      `/government/cases/${raised.body.id}/escalate`,
      { reason: 'The discrepancy is larger than my authority.' },
      auth('finance'),
    );
    assert.equal(escalated.status, 200, JSON.stringify(escalated.body));
    assert.equal(escalated.body.toUserId, ids.admin);
    assert.equal(escalated.body.via, 'SUPERVISOR');

    const detail = await get(`/government/cases/${raised.body.id}`, auth('admin'));
    assert.equal(detail.body.status, 'ESCALATED');
    assert.equal(detail.body.assignee_name, OFFICERS.admin.fullName);
    const escalation = (detail.body.events as { kind: string }[]).find(
      (event) => event.kind === 'ESCALATION',
    );
    assert.ok(escalation, 'and it is in the history');
  });

  /*
   * The fallback, which is the case that actually happens.
   *
   * A supervisor on leave, or never set, is the normal state of a real
   * organisation — so escalation falls back to the head of the department, then
   * to the department above it.
   */
  it('falls back to the department head when nobody is directly above', async () => {
    const id = await department({ headUserId: ids.admin });
    await postOfficerTo(ids.finance, id);

    const raised = await post(
      '/government/cases',
      { subject: 'No supervisor set, as usual', assigneeId: ids.finance },
      auth('finance'),
    );
    const escalated = await post(
      `/government/cases/${raised.body.id}/escalate`,
      { reason: 'Referring this upward for a decision.' },
      auth('finance'),
    );
    assert.equal(escalated.status, 200, JSON.stringify(escalated.body));
    assert.equal(escalated.body.via, 'DEPARTMENT_HEAD');
    assert.equal(escalated.body.toUserId, ids.admin);
  });

  it('falls back again to the parent department’s head', async () => {
    const parent = await department({ code: 'HQ', name: 'Headquarters', headUserId: ids.admin });
    const child = await department({ code: 'FIN-C', name: 'Finance Unit', parentId: parent });
    await postOfficerTo(ids.finance, child);

    const raised = await post(
      '/government/cases',
      { subject: 'Neither a supervisor nor a head of my own', assigneeId: ids.finance },
      auth('finance'),
    );
    const escalated = await post(
      `/government/cases/${raised.body.id}/escalate`,
      { reason: 'Referring this upward for a decision.' },
      auth('finance'),
    );
    assert.equal(escalated.body.via, 'PARENT_DEPARTMENT_HEAD');
    assert.equal(escalated.body.toUserId, ids.admin);
  });

  /*
   * And when the walk genuinely runs out, it refuses.
   *
   * Marking a case ESCALATED and leaving it on the same desk is worse than
   * saying there is nobody above: the first looks like something happened.
   */
  it('refuses rather than escalating a case to nobody', async () => {
    const raised = await post(
      '/government/cases',
      { subject: 'Nobody above me at all', assigneeId: ids.admin },
      auth('admin'),
    );
    const escalated = await post(
      `/government/cases/${raised.body.id}/escalate`,
      { reason: 'There is genuinely nobody above the administrator.' },
      auth('admin'),
    );
    assert.equal(escalated.status, 409, JSON.stringify(escalated.body));
    assert.match(JSON.stringify(escalated.body), /nobody above/i);

    const detail = await get(`/government/cases/${raised.body.id}`, auth('admin'));
    assert.notEqual(detail.body.status, 'ESCALATED', 'and the case did not move');
  });
});

// ===========================================================================
describe('revenue offices', () => {
  /*
   * Where officers sit, which is not the territory they cover.
   *
   * The Jos North office administers three LGAs. A taxpayer asking "where do I
   * go" needs the office; a report asking "whose revenue is this" needs the
   * territory. Conflating them is why the brief lists both.
   */
  it('always administers its own LGA, whether or not anybody said so', async () => {
    const others = await query<{ id: string }>(
      pool,
      'SELECT id FROM lgas WHERE id <> $1 ORDER BY name LIMIT 2',
      [lgaId],
    );

    const created = await post(
      '/government/offices',
      {
        code: 'JN-01',
        name: 'Jos North Revenue Office',
        lgaId,
        // Deliberately omitting its own LGA, which is the mistake half of
        // callers make and the failure is silent.
        coversLgaIds: others.map((row) => row.id),
      },
      auth('admin'),
    );
    assert.equal(created.status, 201, JSON.stringify(created.body));

    const listed = await get('/government/offices', auth('revenue'));
    const office = (listed.body as Record<string, string[]>[]).find(
      (row) => (row as never as { code: string }).code === 'JN-01',
    );
    assert.ok(office);
    assert.equal(office!.covers_lga_ids.length, 3, 'its own LGA and the two named');
    assert.ok(office!.covers_lga_ids.includes(lgaId));
  });
});

// ===========================================================================
describe('every function a department can have, and every way an office ends', () => {
  /*
   * Reached rather than declared.
   *
   * The suite's enum-coverage gate asks that every state the schema allows is
   * written by something. For a table this new the honest answer is that each
   * function is reachable through the API — and it also catches the case where
   * the list in the migration and the list the route accepts have drifted
   * apart, which is a real and silent failure.
   */
  it('creates a department for every kind of work the service does', async () => {
    const functions = [
      'ASSESSMENT',
      'COLLECTION',
      'FINANCE',
      'AUDIT',
      'ENFORCEMENT',
      'TAXPAYER_SERVICES',
      'ADMINISTRATION',
      'TECHNOLOGY',
    ];
    for (const [index, fn] of functions.entries()) {
      const created = await post(
        '/government/departments',
        { code: `D${index}`, name: `Department ${index}`, function: fn },
        auth('admin'),
      );
      assert.equal(created.status, 201, `${fn}: ${JSON.stringify(created.body)}`);
    }

    const stored = await query<{ function: string }>(
      pool,
      'SELECT DISTINCT function FROM departments ORDER BY function',
    );
    assert.deepEqual(stored.map((row) => row.function).sort(), [...functions].sort());
  });

  it('closes an office, and records the move when one changes', async () => {
    const office = await post(
      '/government/offices',
      { code: 'CLS-01', name: 'Closing Office', lgaId },
      auth('admin'),
    );
    assert.equal(office.status, 201, JSON.stringify(office.body));

    // Posting somebody into it is the OFFICE kind of transfer.
    const moved = await post(
      `/government/users/${ids.finance}/posting`,
      { revenueOfficeId: office.body.id, reason: 'Posted to the Jos North office.' },
      auth('admin'),
    );
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    const history = await get(`/government/users/${ids.finance}/transfers`, auth('admin'));
    assert.ok(
      (history.body as { kind: string }[]).some((row) => row.kind === 'OFFICE'),
      JSON.stringify(history.body),
    );

    /*
     * An office closes the same way a department does.
     *
     * There is no officer-facing control for it yet — closing an office is
     * rarer than closing a department and PSIRS has not asked for one — so this
     * is written directly, which is also the only way the CLOSED state is
     * currently reachable. When a control arrives, this assertion is what it
     * has to keep true.
     */
    await query(pool, `UPDATE revenue_offices SET status = 'CLOSED' WHERE id = $1`, [
      office.body.id,
    ]);
    const listed = await get('/government/offices', auth('admin'));
    const closed = (listed.body as { id: string; status: string }[]).find(
      (row) => row.id === office.body.id,
    );
    assert.equal(closed!.status, 'CLOSED');
  });
});

// ===========================================================================
describe('every kind of posting change leaves a dated record', () => {
  /*
   * Reassigning territories, and changing a role, were transfers in effect and
   * were recorded only as audit entries. The two answer different questions:
   * an audit entry says what was written and when; a transfer says what
   * somebody's posting was on a given date, which is what a revenue dispute
   * asks and what you cannot reconstruct by replaying a log.
   */
  it('records a territory reassignment as a transfer, not only as an audit entry', async () => {
    const territory = await queryOne<{ id: string }>(
      pool,
      'SELECT id FROM territories WHERE status = $1 LIMIT 1',
      ['ACTIVE'],
    );
    assert.ok(territory, 'the seed created a territory');

    const assigned = await post(
      `/government/users/${ids.revenue}/territories`,
      { territoryIds: [territory!.id], reason: 'Covering Jos North from this month.' },
      auth('admin'),
    );
    assert.equal(assigned.status, 200, JSON.stringify(assigned.body));

    const history = await get(`/government/users/${ids.revenue}/transfers`, auth('auditor'));
    const transfer = (history.body as { kind: string; to_value: { territoryIds: string[] } }[])
      .find((row) => row.kind === 'TERRITORY');
    assert.ok(transfer, JSON.stringify(history.body));
    assert.deepEqual(transfer!.to_value.territoryIds, [territory!.id]);
  });

  it('records a role change as a transfer too', async () => {
    await grantStepUp(tokens.admin, OFFICERS.admin.phone, 'user.role.change');
    const changed = await post(
      `/government/users/${ids.revenue}/role`,
      { role: 'auditor', reason: 'Moved to the audit department on promotion.' },
      auth('admin'),
    );
    assert.equal(changed.status, 200, JSON.stringify(changed.body));

    const history = await get(`/government/users/${ids.revenue}/transfers`, auth('auditor'));
    const transfer = (history.body as { kind: string; from_value: { role: string } }[]).find(
      (row) => row.kind === 'ROLE',
    );
    assert.ok(transfer, JSON.stringify(history.body));
    assert.equal(transfer!.from_value.role, 'revenue_officer');
  });

  /*
   * And the whole service's postings in one place.
   *
   * "Who was responsible for Jos North in March" is the question, and this is
   * the only surface that answers it without joining an audit log to itself.
   */
  it('lists every posting change across the service', async () => {
    await post(
      `/government/users/${ids.finance}/posting`,
      { jobTitle: 'Principal Finance Officer', reason: 'Confirmed in post this month.' },
      auth('admin'),
    );
    const all = await get('/government/transfers', auth('auditor'));
    assert.equal(all.status, 200);
    assert.ok((all.body as unknown[]).length > 0);
    const row = (all.body as { full_name: string; kind: string }[])[0]!;
    assert.ok(row.full_name && row.kind, 'named, and typed');
  });
});

/** Post an officer to a department, which is all several of these need. */
async function postOfficerTo(userId: string, departmentId: string): Promise<void> {
  const moved = await post(
    `/government/users/${userId}/posting`,
    { departmentId, reason: 'Posted for the purposes of this test.' },
    auth('admin'),
  );
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
}
