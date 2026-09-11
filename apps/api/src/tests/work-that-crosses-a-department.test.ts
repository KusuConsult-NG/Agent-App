/**
 * The case a revenue officer opens and an auditor finishes.
 *
 * The workspace exists so that an observation can leave the officer who made
 * it. That is one property, and it is not provable by opening a case and
 * reading it back — it needs the whole relay: revenue raises it, routes it to
 * audit, audit picks it up, asks finance a question by name, finance answers
 * without being given authority over the case, audit resolves it, and the
 * record afterwards contains every step in order with a name against each.
 *
 * The other properties are the ones that make the record worth anything:
 *
 *   * The history cannot be rewritten, including by somebody at a psql prompt.
 *   * A case cannot be resolved without saying what it concluded.
 *   * An officer cannot work a case that is neither theirs nor assigned to
 *     them, unless they hold `case:manage`.
 *   * The auditor, who is read-only everywhere else, can do all of this.
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
  startTestServer,
  stopTestServer,
} from './helpers';
import { query, queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';

const OFFICERS = {
  revenue: { fullName: 'Revenue Ladi', phone: '+2348071000001', role: 'revenue_officer' },
  finance: { fullName: 'Finance Bala', phone: '+2348071000002', role: 'finance_officer' },
  auditor: { fullName: 'Auditor Ngo', phone: '+2348071000003', role: 'auditor' },
  admin: { fullName: 'Admin Dung', phone: '+2348071000004', role: 'admin' },
} as const;

const ids: Record<keyof typeof OFFICERS, string> = {} as never;
const tokens: Record<keyof typeof OFFICERS, string> = {} as never;

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
});

const auth = (who: keyof typeof OFFICERS) => ({ token: tokens[who] });

async function openCase(who: keyof typeof OFFICERS, body: Record<string, unknown> = {}) {
  const response = await post(
    '/government/cases',
    {
      subject: 'Unusual collection pattern for a market agent',
      description: 'Collections trebled in one week with no new taxpayers registered.',
      category: 'REVENUE_ANOMALY',
      riskLevel: 'HIGH',
      priority: 'HIGH',
      ...body,
    },
    auth(who),
  );
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body as { id: string; caseNumber: string };
}

// ===========================================================================
describe('an observation leaves the officer who made it', () => {
  it('carries a finding from revenue through audit and finance to a resolution', async () => {
    // Revenue notices something and addresses it to audit rather than to a person.
    const opened = await openCase('revenue', { department: 'auditor' });
    assert.match(opened.caseNumber, /^CASE-\d{4}-\d{6}$/);

    /*
     * It reaches the auditor's queue without anybody having been told.
     *
     * This is the property that email does not have: a case routed to a
     * department is visible to that department because of where it was sent,
     * not because the sender remembered who to copy.
     */
    const auditorWork = await get('/government/my-work', auth('auditor'));
    assert.equal(auditorWork.status, 200);
    const waiting = auditorWork.body.unassigned as { case_number: string }[];
    assert.ok(
      waiting.some((row) => row.case_number === opened.caseNumber),
      `the auditor's department queue should hold ${opened.caseNumber}`,
    );

    // The auditor picks it up and starts work.
    assert.equal(
      (await post(
        `/government/cases/${opened.id}/assign`,
        { assigneeId: ids.auditor, reason: 'Taking this one.' },
        auth('auditor'),
      )).status,
      204,
    );
    assert.equal(
      (await post(
        `/government/cases/${opened.id}/status`,
        { status: 'INVESTIGATING' },
        auth('auditor'),
      )).status,
      204,
    );

    // And asks finance a question, by name.
    assert.equal(
      (await post(
        `/government/cases/${opened.id}/comments`,
        {
          body: 'Settlement for the week of the 3rd looks short. Can you confirm what arrived?',
          mentions: [ids.finance],
        },
        auth('auditor'),
      )).status,
      204,
    );

    /*
     * Finance is told, without holding any authority over the case.
     *
     * They did not open it and it is not assigned to them. That is the whole
     * point: a specialist answers a question on somebody else's case.
     */
    const financeWork = await get('/government/my-work', auth('finance'));
    const mentions = financeWork.body.mentions as { case_number: string; actor_name: string }[];
    assert.equal(mentions.length, 1);
    assert.equal(mentions[0]!.case_number, opened.caseNumber);
    assert.equal(mentions[0]!.actor_name, OFFICERS.auditor.fullName);

    assert.equal(
      (await post(
        `/government/cases/${opened.id}/comments`,
        { body: 'Gateway settled ₦40,000 against ₦58,000 collected. Confirmed short.' },
        auth('finance'),
      )).status,
      204,
    );

    // Finance may talk. Finance may not close.
    const financeCloses = await post(
      `/government/cases/${opened.id}/status`,
      { status: 'CLOSED' },
      auth('finance'),
    );
    assert.equal(financeCloses.status, 403, JSON.stringify(financeCloses.body));

    // The auditor concludes it.
    assert.equal(
      (await post(
        `/government/cases/${opened.id}/status`,
        {
          status: 'RESOLVED',
          resolution: 'Agent under-remitted ₦18,000 across four collections. Referred for suspension.',
        },
        auth('auditor'),
      )).status,
      204,
    );

    /*
     * And the whole relay is on the case, in the order it happened.
     *
     * Six officers' worth of work that would otherwise be spread across a
     * WhatsApp thread, two inboxes and nobody's file.
     */
    const detail = await get(`/government/cases/${opened.id}`, auth('admin'));
    assert.equal(detail.status, 200);
    assert.equal(detail.body.status, 'RESOLVED');
    assert.equal(detail.body.resolved_by_name, OFFICERS.auditor.fullName);

    const kinds = (detail.body.events as { kind: string; actor_name: string }[]).map(
      (event) => `${event.kind}:${event.actor_name}`,
    );
    assert.deepEqual(kinds, [
      `OPENED:${OFFICERS.revenue.fullName}`,
      `ASSIGNMENT:${OFFICERS.auditor.fullName}`,
      `STATUS_CHANGE:${OFFICERS.auditor.fullName}`,
      `COMMENT:${OFFICERS.auditor.fullName}`,
      `COMMENT:${OFFICERS.finance.fullName}`,
      `RESOLUTION:${OFFICERS.auditor.fullName}`,
    ]);
  });
});

// ===========================================================================
describe('the record cannot be rewritten', () => {
  it('refuses an UPDATE or a DELETE on a case event, at the database', async () => {
    const opened = await openCase('revenue');
    const event = await queryOne<{ id: string }>(
      pool,
      'SELECT id FROM case_events WHERE case_id = $1',
      [opened.id],
    );

    /*
     * Issued as SQL, not through the service.
     *
     * A rule that only holds when you go through the service layer is not an
     * invariant — the standard migration 053 set for the money, applied to the
     * evidence. Nothing in `services/cases.ts` issues either of these
     * statements; the point is that nothing else can either.
     */
    await assert.rejects(
      () => query(pool, `UPDATE case_events SET body = 'nothing happened' WHERE id = $1`, [event!.id]),
      /append-only/,
    );
    await assert.rejects(
      () => query(pool, `DELETE FROM case_events WHERE id = $1`, [event!.id]),
      /append-only/,
    );
    await assert.rejects(
      () => query(pool, `DELETE FROM cases WHERE id = $1`, [opened.id]),
      /never deleted/,
    );

    const survived = await queryOne<{ body: string }>(
      pool,
      'SELECT body FROM case_events WHERE id = $1',
      [event!.id],
    );
    assert.match(survived!.body, /trebled/);
  });

  it('will not resolve a case without saying what it concluded', async () => {
    const opened = await openCase('revenue');
    const silent = await post(
      `/government/cases/${opened.id}/status`,
      { status: 'RESOLVED' },
      auth('revenue'),
    );
    assert.equal(silent.status, 400, JSON.stringify(silent.body));

    // And the database says so too, for a caller that never reaches the service.
    await assert.rejects(
      () =>
        query(pool, `UPDATE cases SET status = 'RESOLVED', resolved_at = now() WHERE id = $1`, [
          opened.id,
        ]),
      /case_resolution_stated/,
    );
  });

  it('finishes a case rather than reopening it', async () => {
    const opened = await openCase('revenue');
    await post(
      `/government/cases/${opened.id}/status`,
      { status: 'CLOSED', reason: 'Nothing in it.' },
      auth('revenue'),
    );

    const reopened = await post(
      `/government/cases/${opened.id}/status`,
      { status: 'INVESTIGATING' },
      auth('revenue'),
    );
    assert.equal(reopened.status, 409, JSON.stringify(reopened.body));
    assert.match(JSON.stringify(reopened.body), /new case/i);
  });
});

// ===========================================================================
describe('who may work a case', () => {
  it('lets the officer who opened it act, without case:manage', async () => {
    const opened = await openCase('finance');
    // A finance officer holds case:create and case:contribute, not case:manage.
    assert.equal(
      (await post(
        `/government/cases/${opened.id}/status`,
        { status: 'RESOLVED', resolution: 'Settlement arrived late. No discrepancy.' },
        auth('finance'),
      )).status,
      204,
    );
  });

  it('refuses an officer who neither opened it nor holds it', async () => {
    const opened = await openCase('revenue', { assigneeId: ids.auditor });
    const meddling = await post(
      `/government/cases/${opened.id}/assign`,
      { assigneeId: ids.finance },
      auth('finance'),
    );
    assert.equal(meddling.status, 403, JSON.stringify(meddling.body));
  });

  it('lets an administrator reassign anybody’s case', async () => {
    const opened = await openCase('revenue', { assigneeId: ids.auditor });
    assert.equal(
      (await post(
        `/government/cases/${opened.id}/assign`,
        { assigneeId: ids.finance, department: 'finance_officer', reason: 'Better placed there.' },
        auth('admin'),
      )).status,
      204,
    );

    const detail = await get(`/government/cases/${opened.id}`, auth('admin'));
    assert.equal(detail.body.assignee_name, OFFICERS.finance.fullName);
    // A change of department is a routing, and reads as one in the history.
    const routed = (detail.body.events as { kind: string }[]).filter((e) => e.kind === 'ROUTED');
    assert.equal(routed.length, 1);
  });

  /*
   * The id, not just the name, because the portal has to send it back.
   *
   * `/cases/:id/assign` writes `assignee_id` from the body every time — the
   * "leave it alone" reading of a missing field is only offered for the two
   * department columns. So the panel that routes a case has to re-send whoever
   * currently holds it, and it can only do that if the detail body says who
   * that is by id. It did once — through `c.*` — which is exactly the kind of
   * dependency that disappears the day somebody writes the column list out.
   */
  it('says who holds a case by id, not only by name', async () => {
    const opened = await openCase('revenue', { assigneeId: ids.auditor });

    const detail = await get(`/government/cases/${opened.id}`, auth('admin'));
    assert.equal(detail.body.assignee_id, ids.auditor);
    assert.equal(detail.body.assignee_name, OFFICERS.auditor.fullName);
  });

  it('will not assign a case to a field agent', async () => {
    const agentUser = await createGovernmentUser({
      fullName: 'Field Danjuma',
      phone: '+2348071000009',
      role: 'agent',
    });
    const opened = await openCase('revenue');
    const misrouted = await post(
      `/government/cases/${opened.id}/assign`,
      { assigneeId: agentUser },
      auth('revenue'),
    );
    assert.equal(misrouted.status, 400, JSON.stringify(misrouted.body));
    assert.match(JSON.stringify(misrouted.body), /does not work cases/);
  });
});

// ===========================================================================
describe('the auditor writes cases and nothing else', () => {
  /*
   * The role's standing, tested where it can actually be broken.
   *
   * `permissions.test.ts` in the portal asserts the auditor holds no permission
   * that changes the record. That is a statement about a list. This is the same
   * claim made against the running API: the auditor can run an investigation
   * end to end, and is still refused by every endpoint that moves money or
   * alters a record.
   */
  it('opens, assigns and resolves an audit case', async () => {
    const opened = await openCase('auditor', {
      category: 'FRAUD_INVESTIGATION',
      riskLevel: 'CRITICAL',
    });
    assert.equal(
      (await post(
        `/government/cases/${opened.id}/priority`,
        { priority: 'URGENT', reason: 'Money still moving.' },
        auth('auditor'),
      )).status,
      204,
    );
    assert.equal(
      (await post(
        `/government/cases/${opened.id}/status`,
        { status: 'RESOLVED', resolution: 'Confirmed. Referred to the Board.' },
        auth('auditor'),
      )).status,
      204,
    );
  });

  it('is still refused everything that changes the record', async () => {
    for (const [path, body] of [
      ['/government/reconciliation/run', {}],
      ['/government/fraud/sweep', {}],
      ['/government/commissions/promote', {}],
    ] as const) {
      const attempt = await post(path, body, auth('auditor'));
      assert.equal(attempt.status, 403, `${path} answered ${attempt.status}`);
    }
  });
});

// ===========================================================================
describe('every state a case can be in', () => {
  /*
   * Reached rather than declared.
   *
   * The suite's enum-coverage gate asks that every state the schema allows is
   * actually written by something. For a table this new the honest answer is
   * not an exemption list — it is that each category, priority, risk level,
   * source and event kind is reachable through the API, which is also the
   * cheapest way to find out that one of them is not.
   *
   * The interesting part is the walk at the bottom: a case that goes
   * OPEN → INVESTIGATING → AWAITING_INFORMATION → ESCALATED → RESOLVED is the
   * shape of a real investigation, and each hop is a separate refusal risk.
   */
  it('opens one in every category, at every priority and risk', async () => {
    const categories = [
      'GENERAL',
      'REVENUE_ANOMALY',
      'RECONCILIATION_EXCEPTION',
      'FRAUD_INVESTIGATION',
      'AGENT_CONDUCT',
      'TAXPAYER_DISPUTE',
      'COMMISSION_QUERY',
      'DATA_CORRECTION',
      'SYSTEM_ISSUE',
    ];
    const priorities = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
    const risks = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

    for (const [index, category] of categories.entries()) {
      const opened = await post(
        '/government/cases',
        {
          subject: `Case about ${category.toLowerCase().replace(/_/g, ' ')}`,
          category,
          priority: priorities[index % priorities.length],
          riskLevel: risks[index % risks.length],
        },
        auth('admin'),
      );
      assert.equal(opened.status, 201, `${category}: ${JSON.stringify(opened.body)}`);
    }

    const listed = await get('/government/cases?limit=50', auth('admin'));
    assert.equal((listed.body as unknown[]).length, categories.length);
  });

  /*
   * A case can be raised from the thing that produced it.
   *
   * `source_type` is what keeps the flag, the exception, the ticket or the
   * approval reachable from the case afterwards — the alternative is a case
   * whose first comment says "see the fraud screen" and a reader who has to go
   * and find it.
   */
  it('records where each case came from', async () => {
    for (const sourceType of [
      'MANUAL',
      'FRAUD_FLAG',
      'RECONCILIATION_EXCEPTION',
      'SUPPORT_TICKET',
      'APPROVAL',
    ]) {
      const opened = await post(
        '/government/cases',
        { subject: `Raised from ${sourceType}`, sourceType },
        auth('admin'),
      );
      assert.equal(opened.status, 201, `${sourceType}: ${JSON.stringify(opened.body)}`);
    }

    const stored = await query<{ source_type: string }>(
      pool,
      'SELECT DISTINCT source_type FROM cases ORDER BY source_type',
    );
    assert.deepEqual(
      stored.map((row) => row.source_type),
      ['APPROVAL', 'FRAUD_FLAG', 'MANUAL', 'RECONCILIATION_EXCEPTION', 'SUPPORT_TICKET'],
    );
  });

  it('walks a case through every status on the way to a finding', async () => {
    const opened = await openCase('auditor', { assigneeId: ids.auditor });

    for (const status of ['INVESTIGATING', 'AWAITING_INFORMATION', 'ESCALATED']) {
      const moved = await post(
        `/government/cases/${opened.id}/status`,
        { status, reason: `Moving to ${status.toLowerCase()}.` },
        auth('auditor'),
      );
      assert.equal(moved.status, 204, `${status}: ${JSON.stringify(moved.body)}`);
    }

    // An internal note, and a deadline somebody moved.
    assert.equal(
      (await post(
        `/government/cases/${opened.id}/comments`,
        { body: 'Third similar pattern from this territory this quarter.', internal: true },
        auth('auditor'),
      )).status,
      204,
    );
    assert.equal(
      (await post(
        `/government/cases/${opened.id}/priority`,
        { dueAt: new Date(Date.now() + 7 * 86_400_000).toISOString(), reason: 'Board meets Friday.' },
        auth('auditor'),
      )).status,
      204,
    );

    assert.equal(
      (await post(
        `/government/cases/${opened.id}/status`,
        { status: 'RESOLVED', resolution: 'Under-remittance confirmed. Referred to the Board.' },
        auth('auditor'),
      )).status,
      204,
    );

    const detail = await get(`/government/cases/${opened.id}`, auth('auditor'));
    const kinds = (detail.body.events as { kind: string }[]).map((event) => event.kind);
    assert.deepEqual(kinds, [
      'OPENED',
      'STATUS_CHANGE',
      'STATUS_CHANGE',
      'ESCALATION',
      'NOTE',
      'DUE_DATE_CHANGE',
      'RESOLUTION',
    ]);
  });

  /*
   * Evidence, from a document the platform actually issued.
   *
   * There is no officer upload path — every document is minted by the service
   * that produced it — so this attaches one that exists, which is also the only
   * thing the endpoint accepts.
   */
  it('attaches a document the platform issued, and says why', async () => {
    /*
     * Both rows written directly, and only because the subject here is the
     * case's link to a document rather than how either comes to exist. The
     * paths that mint a real taxpayer and a real receipt document run through
     * registration and a settled collection, which
     * `one-transaction-told-whole.test.ts` exercises end to end.
     */
    const taxpayer = await queryOne<{ id: string }>(
      pool,
      `INSERT INTO taxpayers (taxpayer_type, first_name, last_name, phone, address, lga_id)
       SELECT 'INDIVIDUAL', 'Evidence', 'Subject', '+2348079000001',
              '1 Evidence Close, Jos', l.id
         FROM lgas l ORDER BY l.name LIMIT 1
       RETURNING id`,
    );
    assert.ok(taxpayer, 'the reference data seeded an LGA to register into');

    const document = await queryOne<{ id: string; owner_id: string }>(
      pool,
      `INSERT INTO documents (
         document_number, document_type, owner_type, owner_id, storage_reference,
         byte_size, checksum, verification_code, issuing_authority
       ) VALUES (
         'PSIRS/2026/000900', 'RECEIPT', 'TAXPAYER', $1,
         'test/receipt.pdf', 1024, 'sha256:test', 'EVIDENCE-CODE-1', 'PSIRS'
       )
       RETURNING id, owner_id`,
      [taxpayer!.id],
    );
    assert.ok(document, 'the evidence exists to be attached');

    const opened = await openCase('auditor', {
      assigneeId: ids.auditor,
      taxpayerId: document!.owner_id,
    });

    const attached = await post(
      `/government/cases/${opened.id}/evidence`,
      { documentId: document!.id, body: 'The receipt the taxpayer produced.' },
      auth('auditor'),
    );
    assert.equal(attached.status, 204, JSON.stringify(attached.body));

    const detail = await get(`/government/cases/${opened.id}`, auth('auditor'));
    const evidence = (detail.body.events as { kind: string; document_number: string }[]).find(
      (event) => event.kind === 'EVIDENCE',
    );
    assert.ok(evidence, 'the case carries the evidence');
    assert.equal(evidence!.document_number, 'PSIRS/2026/000900');

    // And the attachment left its own trail, separate from the case's history.
    const audited = await queryOne<{ count: string }>(
      pool,
      `SELECT count(*)::text FROM audit_logs
        WHERE action = 'case.evidence.attach' AND entity_id = $1`,
      [opened.id],
    );
    assert.equal(audited!.count, '1');

    // The same document is not offered again.
    assert.equal((detail.body.attachable as unknown[]).length, 0);
  });
});

// ===========================================================================
describe('my work', () => {
  it('gathers the queues an officer would otherwise go looking for', async () => {
    const mine = await openCase('revenue', { assigneeId: ids.revenue, priority: 'URGENT' });
    await openCase('revenue', { assigneeId: ids.auditor });
    await openCase('admin', { department: 'revenue_officer' });

    const work = await get('/government/my-work', auth('revenue'));
    assert.equal(work.status, 200);
    assert.equal(work.body.counts.assigned_open, '1');
    // Opened by them and now somebody else's: still theirs to follow.
    assert.equal(work.body.counts.opened_open, '2');
    assert.equal(work.body.counts.department_unassigned, '1');
    assert.equal((work.body.assigned as unknown[]).length, 1);
    assert.equal((work.body.assigned as { case_number: string }[])[0]!.case_number, mine.caseNumber);
  });

  /*
   * A finance officer sees the exception queue; an auditor does not.
   *
   * `/my-work` folds several existing screens into one answer, and each block
   * has to keep the gate its own screen had. Folding them together is exactly
   * where that would get lost.
   */
  it('gives each role only the shared queues it already had', async () => {
    const finance = await get('/government/my-work', auth('finance'));
    assert.ok(Array.isArray(finance.body.exceptions));
    assert.ok(Array.isArray(finance.body.approvals));

    const auditor = await get('/government/my-work', auth('auditor'));
    // An auditor holds no approval permission, so there is no approval queue.
    assert.deepEqual(auditor.body.approvals, []);
    // And does hold fraud:read.
    assert.ok(Array.isArray(auditor.body.flags));
  });
});
