/**
 * What an officer has been told, whether anybody looked, and what the platform
 * says about itself when it stops working.
 *
 * `/my-work` already answers "what is waiting for me", by querying for it each
 * time. That shape cannot do two things, and both were marked partial in the
 * officer-readiness assessment.
 *
 * It has no read state, so "I saw that on Tuesday and decided it was fine" is
 * not expressible: the item keeps appearing until the underlying thing
 * changes, which teaches an officer to stop reading the list.
 *
 * And it cannot carry an alert with no row behind it. A stalled background job
 * is a fact about the platform rather than about a case, and there was nowhere
 * to put one -- so the way anybody found out the reminder sweep had been dead
 * for a day was a taxpayer asking why nobody had written.
 *
 * The tests below are mostly about the second-order behaviour, because that is
 * where an inbox becomes noise: one alert for a job failing all day, not
 * ninety-six; a louder alert when it gets worse; nothing at all on a fresh
 * database where every job has understandably never run.
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
import { query, queryOne, withTransaction } from '../db/pool';
import { forget } from '../services/rbac-store';
import { seedReferenceData } from '../db/seed';
import { raiseSystemAlerts } from '../services/officer-inbox';

const PHONES = {
  admin: '+2348083000001',
  officer: '+2348083000002',
  other: '+2348083000003',
};
const ids: Record<string, string> = {};
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
  for (const [key, phone] of Object.entries(PHONES)) {
    ids[key] = await createGovernmentUser({
      fullName: `Inbox ${key}`,
      phone,
      role: key === 'admin' ? 'admin' : 'revenue_officer',
    });
    tokens[key] = (await loginAs(phone)).accessToken;
  }
});

const auth = (who: keyof typeof PHONES) => ({ token: tokens[who] });
const sweep = () => withTransaction((client) => raiseSystemAlerts(client));

/** Put a job into a state the alert sweep cares about. */
async function jobIsFailing(name: string, failures = 3): Promise<void> {
  await query(
    pool,
    `INSERT INTO background_jobs
       (name, last_started_at, last_finished_at, last_outcome, last_error,
        consecutive_failures, runs_total, failures_total)
     VALUES ($1, now() - interval '1 hour', now() - interval '1 hour', 'FAILED',
             'the gateway refused the statement', $2::int, 10, $2::int)
     ON CONFLICT (name) DO UPDATE
        SET consecutive_failures = EXCLUDED.consecutive_failures,
            last_outcome = 'FAILED',
            last_error = EXCLUDED.last_error,
            last_started_at = EXCLUDED.last_started_at,
            last_finished_at = EXCLUDED.last_finished_at`,
    [name, failures],
  );
}

// ===========================================================================
describe('an officer is told, and it is recorded that they were', () => {
  async function openCaseFor(assigneeId: string): Promise<string> {
    const opened = await post(
      '/government/cases',
      { subject: 'Collections at the Terminus market', category: 'GENERAL', assigneeId },
      auth('admin'),
    );
    assert.equal(opened.status, 201, JSON.stringify(opened.body));
    return (opened.body as { id: string }).id;
  }

  it('tells an officer a case landed on them, and not for their own doing', async () => {
    const caseId = await openCaseFor(ids.admin);
    await post(
      `/government/cases/${caseId}/assign`,
      { assigneeId: ids.officer, reason: 'Yours: it is in your territory.' },
      auth('admin'),
    );

    const theirs = await get('/government/inbox', auth('officer'));
    assert.equal(theirs.status, 200, JSON.stringify(theirs.body));
    const body = theirs.body as { notifications: { kind: string; subject: string }[]; unread: number };
    assert.equal(body.unread, 1);
    assert.equal(body.notifications[0]!.kind, 'CASE_ASSIGNED');

    // And the officer who did the assigning was not told about their own act.
    const mine = await get('/government/inbox', auth('admin'));
    assert.equal((mine.body as { unread: number }).unread, 0);
  });

  it('tells an officer they were named in a comment', async () => {
    const caseId = await openCaseFor(ids.admin);
    await post(
      `/government/cases/${caseId}/comments`,
      { body: 'Can you confirm the ward boundary here?', mentions: [ids.officer] },
      auth('admin'),
    );

    const theirs = await get('/government/inbox?unreadOnly=true', auth('officer'));
    const rows = (theirs.body as { notifications: { kind: string }[] }).notifications;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.kind, 'CASE_MENTION');
  });

  /*
   * The property the whole table exists for: an officer can say they have seen
   * something, and it stays said.
   */
  it('marks one read, records who read it, and will not let it be unread', async () => {
    const caseId = await openCaseFor(ids.admin);
    await post(
      `/government/cases/${caseId}/assign`,
      { assigneeId: ids.officer, reason: 'Please take this one on.' },
      auth('admin'),
    );

    const before = await get('/government/inbox', auth('officer'));
    const notificationId = (before.body as { notifications: { id: string }[] }).notifications[0]!.id;

    const read = await post(`/government/inbox/${notificationId}/read`, {}, auth('officer'));
    assert.equal(read.status, 200, JSON.stringify(read.body));

    const after = await get('/government/inbox', auth('officer'));
    const row = (after.body as { notifications: { read_at: string | null; read_by_name: string }[] })
      .notifications[0]!;
    assert.ok(row.read_at, 'it stays on the list, marked');
    assert.equal(row.read_by_name, 'Inbox officer');

    await assert.rejects(
      () =>
        query(pool, 'UPDATE officer_notifications SET read_at = NULL, read_by = NULL WHERE id = $1', [
          notificationId,
        ]),
      /cannot be marked unread/,
    );
  });

  it('will not let a notification be rewritten or deleted', async () => {
    const caseId = await openCaseFor(ids.admin);
    await post(
      `/government/cases/${caseId}/assign`,
      { assigneeId: ids.officer, reason: 'Please take this one on.' },
      auth('admin'),
    );
    const id = (
      (await get('/government/inbox', auth('officer'))).body as { notifications: { id: string }[] }
    ).notifications[0]!.id;

    await assert.rejects(
      () => query(pool, `UPDATE officer_notifications SET subject = 'something else' WHERE id = $1`, [id]),
      /cannot be changed/,
    );
    await assert.rejects(
      () => query(pool, 'DELETE FROM officer_notifications WHERE id = $1', [id]),
      /cannot be deleted/,
    );
  });

  /*
   * Not found rather than forbidden, for the reason the session endpoints
   * give: a 403 confirms that a notification id belongs to somebody.
   */
  it('will not let one officer read another officer’s notification', async () => {
    const caseId = await openCaseFor(ids.admin);
    await post(
      `/government/cases/${caseId}/assign`,
      { assigneeId: ids.officer, reason: 'Please take this one on.' },
      auth('admin'),
    );
    const id = (
      (await get('/government/inbox', auth('officer'))).body as { notifications: { id: string }[] }
    ).notifications[0]!.id;

    const attempt = await post(`/government/inbox/${id}/read`, {}, auth('other'));
    assert.equal(attempt.status, 404, JSON.stringify(attempt.body));
  });

  /*
   * An approval waiting on a named officer waits through their leave, and a
   * reversal sitting unreviewed is money the platform is holding from
   * somebody. So it goes to whichever roles hold `approval:review` -- read
   * from the table rather than named in code, because since migration 059 that
   * is PSIRS's decision.
   */
  it('tells the reviewers when an approval is waiting', async () => {
    const requested = await post(
      '/government/approvals',
      {
        // A kind the administrator may request: `PAYMENT_REVERSAL` needs
        // `payment:reverse:request`, which they deliberately do not hold.
        approvalType: 'COMMISSION_ADJUSTMENT',
        entityType: 'commission',
        entityId: 'CMS-2026-000001',
        reason: 'The commission was accrued at the wrong rate for this ward.',
      },
      auth('admin'),
    );
    assert.equal(requested.status, 201, JSON.stringify(requested.body));

    /*
     * The revenue officer, not the administrator who asked: the alert goes to
     * whoever holds `approval:review`, and the administrator does not. That is
     * the segregation the approval mechanism exists for, showing up in the
     * inbox as well as in the permission.
     */
    const seen = await get('/government/inbox', auth('officer'));
    const rows = (seen.body as { notifications: { kind: string; addressed_to_role: string | null }[] })
      .notifications;
    const waiting = rows.find((row) => row.kind === 'APPROVAL_WAITING');
    assert.ok(waiting, JSON.stringify(rows));
    assert.equal(waiting!.addressed_to_role, 'revenue_officer',
      'addressed to a role, so leave does not silence it');

    const requester = await get('/government/inbox', auth('admin'));
    assert.equal(
      (requester.body as { notifications: { kind: string }[] }).notifications
        .filter((row) => row.kind === 'APPROVAL_WAITING').length,
      0,
      'the officer who asked is not told that they asked',
    );
  });

  /*
   * Found by generating the role-action matrix.
   *
   * `/government/approvals` accepts eleven kinds of request under one
   * permission, so an officer who could ask for an agent activation could also
   * ask for a payment reversal -- while `payment:reverse:request` existed, was
   * granted to two roles, and was checked by nothing. Authority that looks
   * real and confers nothing is exactly what a signed matrix must not contain,
   * so it is enforced rather than deleted.
   */
  it('will not let an officer request a reversal without the permission for one', async () => {
    const admin = await post(
      '/government/approvals',
      {
        approvalType: 'PAYMENT_REVERSAL',
        entityType: 'transaction',
        entityId: 'TXN-2026-000002',
        reason: 'An administrator asking for a reversal they may not request.',
      },
      auth('admin'),
    );
    assert.equal(admin.status, 403, JSON.stringify(admin.body));
    assert.match(JSON.stringify(admin.body), /payment:reverse:request/);

    // And the roles that hold it are unaffected.
    const officer = await post(
      '/government/approvals',
      {
        approvalType: 'PAYMENT_REVERSAL',
        entityType: 'transaction',
        entityId: 'TXN-2026-000003',
        reason: 'The taxpayer paid twice for the same shop rate.',
      },
      auth('officer'),
    );
    assert.equal(officer.status, 201, JSON.stringify(officer.body));

    // A kind with no extra permission still goes through on approval:request.
    const ordinary = await post(
      '/government/approvals',
      {
        approvalType: 'COMMISSION_ADJUSTMENT',
        entityType: 'commission',
        entityId: 'CMS-1',
        reason: 'The commission was accrued at the wrong rate.',
      },
      auth('admin'),
    );
    assert.equal(ordinary.status, 201, JSON.stringify(ordinary.body));
  });

  it('needs no permission, so a narrowed role can still read its own inbox', async () => {
    await query(pool, `DELETE FROM role_permissions WHERE role = 'revenue_officer'`);
    // The map is cached for thirty seconds, keyed on the role rather than the
    // session, so signing in again would not pick this up.
    forget();
    const stripped = await loginAs(PHONES.officer);
    const seen = await get('/government/inbox', { token: stripped.accessToken });
    assert.equal(seen.status, 200, JSON.stringify(seen.body));
  });
});

// ===========================================================================
describe('the platform says when it has stopped working', () => {
  it('raises an alert for a failing job, to the role rather than to a person', async () => {
    await jobIsFailing('reminder-sweep');
    const { raised } = await sweep();
    assert.equal(raised, 1);

    const seen = await get('/government/inbox', auth('admin'));
    const rows = (seen.body as {
      notifications: { kind: string; severity: string; subject: string; addressed_to_role: string | null }[];
    }).notifications;
    assert.equal(rows.length, 1, JSON.stringify(rows));
    assert.equal(rows[0]!.kind, 'SYSTEM_ALERT');
    assert.equal(rows[0]!.severity, 'CRITICAL');
    assert.equal(rows[0]!.addressed_to_role, 'admin', 'nobody is on leave from a role');
    assert.match(rows[0]!.subject, /reminder-sweep/);
  });

  /*
   * The behaviour that decides whether an inbox is read or ignored. A job
   * failing all day must produce one alert, not one per sweep.
   */
  it('does not raise the same alert again while it is still unread', async () => {
    await jobIsFailing('reminder-sweep');
    await sweep();
    await sweep();
    await sweep();

    const count = await queryOne<{ count: string }>(
      pool,
      `SELECT count(*)::text AS count FROM officer_notifications WHERE kind = 'SYSTEM_ALERT'`,
    );
    assert.equal(count!.count, '1');
  });

  /*
   * And once somebody has acknowledged it and not fixed it, they are told
   * again -- otherwise acknowledging an alert is a way of silencing it.
   */
  it('raises it again once the last one has been read', async () => {
    await jobIsFailing('reminder-sweep');
    await sweep();
    await post('/government/inbox/read-all', {}, auth('admin'));
    await sweep();

    const count = await queryOne<{ count: string }>(
      pool,
      `SELECT count(*)::text AS count FROM officer_notifications WHERE kind = 'SYSTEM_ALERT'`,
    );
    assert.equal(count!.count, '2');
  });

  it('says nothing at all about jobs that have simply never run', async () => {
    // A fresh database, which is what `resetDatabase` leaves: every job has
    // never run, and an alert storm on the first morning of a deployment is
    // how an organisation learns to ignore alerts.
    const { raised } = await sweep();
    assert.equal(raised, 0);

    const seen = await get('/government/inbox', auth('admin'));
    assert.deepEqual((seen.body as { notifications: unknown[] }).notifications, []);
  });

  it('does not put the platform’s alarms in an ordinary officer’s inbox', async () => {
    await jobIsFailing('reminder-sweep');
    await sweep();

    const theirs = await get('/government/inbox', auth('officer'));
    assert.deepEqual((theirs.body as { notifications: unknown[] }).notifications, []);
  });
});

// ===========================================================================
describe('what one officer has been doing', () => {
  it('summarises their own work without any permission at all', async () => {
    const own = await get(`/government/users/${ids.officer}/activity`, auth('officer'));
    assert.equal(own.status, 200, JSON.stringify(own.body));
    const body = own.body as {
      officer: { full_name: string };
      byAction: { action: string; times: string }[];
      sessions: unknown[];
    };
    assert.equal(body.officer.full_name, 'Inbox officer');
    assert.ok(body.byAction.some((row) => row.action === 'auth.login'), 'signing in is work');
    assert.ok(body.sessions.length >= 1, 'and where they are signed in is part of the answer');
  });

  it('lets an officer who may read the audit log read somebody else’s', async () => {
    const seen = await get(`/government/users/${ids.officer}/activity`, auth('admin'));
    assert.equal(seen.status, 200, JSON.stringify(seen.body));
  });

  it('refuses somebody else’s to an officer who may not read the audit log', async () => {
    await query(
      pool,
      `DELETE FROM role_permissions WHERE role = 'revenue_officer' AND permission = 'audit:read'`,
    );
    forget();
    const stripped = await loginAs(PHONES.officer);
    const attempt = await get(`/government/users/${ids.admin}/activity`, {
      token: stripped.accessToken,
    });
    assert.equal(attempt.status, 403, JSON.stringify(attempt.body));
  });

  /*
   * Counts, never a score. A number with a formula behind it becomes the thing
   * people manage to, and this platform suspends people.
   */
  it('counts what was done and does not rate it', async () => {
    const seen = await get(`/government/users/${ids.admin}/activity?days=30`, auth('admin'));
    const body = seen.body as Record<string, unknown>;
    for (const scoreish of ['score', 'rating', 'rank', 'productivity', 'grade']) {
      assert.ok(!(scoreish in body), `activity must not compute a ${scoreish}`);
    }
    assert.ok(Array.isArray(body.byDay));
  });
});
