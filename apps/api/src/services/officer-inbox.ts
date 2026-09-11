/**
 * What an officer has been told, and whether anybody looked.
 *
 * `/my-work` answers "what is waiting for me" by querying for it, which is the
 * right shape for a work queue: always current, never stale, nothing to clean
 * up. This is the other half, and it exists because a derived list cannot do
 * two things.
 *
 * It cannot record that somebody was told. Without read state, "I saw that on
 * Tuesday and decided it was fine" is not expressible, so the item keeps
 * appearing until the underlying thing changes -- which teaches the officer to
 * stop reading the list.
 *
 * And it cannot carry an alert with no row behind it. A background job that
 * has stalled is a fact about the platform, not about a case or an approval,
 * and there was nowhere to put one: `GET /government/workers` reported job
 * health and an officer had to go and look. Which means the way anybody found
 * out the reminder sweep had been dead for a day was a taxpayer asking why
 * nobody had written to them.
 */

import type { PoolClient } from 'pg';
import type { Db } from '../db/pool';
import { pool, query, queryOne, withTransaction } from '../db/pool';
import { notFound } from '../lib/errors';
import { jobHealth, type JobReport } from './jobs';

export type NotificationKind =
  | 'CASE_ASSIGNED'
  | 'CASE_MENTION'
  | 'CASE_ESCALATED'
  | 'APPROVAL_WAITING'
  | 'SYSTEM_ALERT'
  /*
   * Back, with something behind it.
   *
   * Migration 064 wrote this kind and removed it before shipping, because
   * nothing could raise one: `integrationStatus()` reports which adapter is
   * configured rather than whether it answers. Migration 065 records the
   * outcome of every outbound call, so the state is now reachable --
   * `services/integration-health.ts` raises it.
   */
  | 'INTEGRATION_ALERT';

export type NotificationSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export interface RaiseInput {
  /** Exactly one of these. A person, or whoever is on duty in a role. */
  userId?: string | null;
  role?: string | null;
  kind: NotificationKind;
  severity?: NotificationSeverity;
  subject: string;
  body?: string;
  entityType?: string | null;
  entityId?: string | null;
  /** What this is about, so a repeat while it is unread is one row, not many. */
  dedupeKey: string;
}

/**
 * Raise one, unless the same thing is already sitting unread.
 *
 * The deduplication is a partial unique index rather than a check here, so it
 * holds against two sweeps running at once -- and this catches the violation
 * rather than letting it become an error, because "somebody was already told"
 * is a normal outcome and not a failure.
 *
 * Deliberately never throws for a duplicate. A caller raising a notification
 * is always doing something else as its main job -- assigning a case, running
 * a sweep -- and that work must not fail because the officer already had the
 * message.
 */
export async function raise(client: PoolClient, input: RaiseInput): Promise<string | null> {
  const inserted = await queryOne<{ id: string }>(
    client,
    `INSERT INTO officer_notifications (
       user_id, role, kind, severity, subject, body, entity_type, entity_id, dedupe_key
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      input.userId ?? null,
      input.role ?? null,
      input.kind,
      input.severity ?? 'INFO',
      input.subject,
      input.body ?? '',
      input.entityType ?? null,
      input.entityId ?? null,
      input.dedupeKey,
    ],
  );
  return inserted?.id ?? null;
}

/** The same, for a caller with no transaction of its own. */
export async function raiseStandalone(input: RaiseInput): Promise<string | null> {
  return withTransaction((client) => raise(client, input));
}

export interface InboxRow {
  id: string;
  kind: string;
  severity: string;
  subject: string;
  body: string;
  entity_type: string | null;
  entity_id: string | null;
  created_at: string;
  read_at: string | null;
  read_by_name: string | null;
  addressed_to_role: string | null;
}

/**
 * One officer's inbox: what was sent to them, and what was sent to their role.
 *
 * Role-addressed alerts are included for every holder of the role rather than
 * routed to one of them. An alert nobody in particular owns is an alert
 * everybody assumes somebody else has seen -- so instead it appears for all of
 * them and the first to read it marks it read for all of them, with their name
 * on it.
 */
export async function inboxFor(
  db: Db,
  viewer: { userId: string; role: string },
  options: { unreadOnly?: boolean; limit?: number } = {},
): Promise<InboxRow[]> {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 200);
  return query<InboxRow>(
    db,
    `SELECT n.id, n.kind, n.severity, n.subject, n.body, n.entity_type, n.entity_id,
            n.created_at, n.read_at, n.role AS addressed_to_role,
            r.full_name AS read_by_name
       FROM officer_notifications n
       LEFT JOIN users r ON r.id = n.read_by
      WHERE (n.user_id = $1 OR n.role = $2)
        AND ($3::boolean IS NOT TRUE OR n.read_at IS NULL)
      ORDER BY n.read_at IS NULL DESC,
               CASE n.severity WHEN 'CRITICAL' THEN 0 WHEN 'WARNING' THEN 1 ELSE 2 END,
               n.created_at DESC
      LIMIT $4`,
    [viewer.userId, viewer.role, options.unreadOnly ?? false, limit],
  );
}

export async function unreadCount(db: Db, viewer: { userId: string; role: string }): Promise<number> {
  const row = await queryOne<{ count: string }>(
    db,
    `SELECT count(*)::text AS count FROM officer_notifications
      WHERE (user_id = $1 OR role = $2) AND read_at IS NULL`,
    [viewer.userId, viewer.role],
  );
  return Number.parseInt(row!.count, 10);
}

/**
 * Mark one read.
 *
 * Refused for a notification addressed to somebody else, and quietly accepted
 * for one already read -- reading something twice is not an error and an
 * officer should not be shown a failure for clicking a row that a colleague
 * cleared while they were looking at it.
 */
export async function markRead(
  viewer: { userId: string; role: string },
  notificationId: string,
): Promise<void> {
  await withTransaction(async (client) => {
    const row = await queryOne<{ id: string; read_at: string | null }>(
      client,
      `SELECT id, read_at FROM officer_notifications
        WHERE id = $1 AND (user_id = $2 OR role = $3)`,
      [notificationId, viewer.userId, viewer.role],
    );
    /*
     * Not found rather than forbidden, for the reason the session endpoints
     * give: a 403 would confirm that a notification id exists and belongs to
     * somebody, which is more than a caller who may not read it should learn.
     */
    if (!row) throw notFound('That notification');
    if (row.read_at) return;

    await client.query(
      'UPDATE officer_notifications SET read_at = now(), read_by = $2 WHERE id = $1',
      [notificationId, viewer.userId],
    );
  });
}

export async function markAllRead(viewer: { userId: string; role: string }): Promise<number> {
  const result = await pool.query(
    `UPDATE officer_notifications SET read_at = now(), read_by = $1
      WHERE (user_id = $1 OR role = $2) AND read_at IS NULL`,
    [viewer.userId, viewer.role],
  );
  return result.rowCount ?? 0;
}

// ===========================================================================
// System alerts
// ===========================================================================

/**
 * Which job states are worth waking somebody for, and how loudly.
 *
 * `NEVER_RUN` is deliberately absent. On a fresh database every job has never
 * run, and an alert storm on the first morning of a deployment is how an
 * organisation learns to ignore alerts. It becomes OVERDUE soon enough, which
 * is the same fact once it means something.
 */
const JOB_ALERT_SEVERITY: Partial<Record<JobReport['state'], NotificationSeverity>> = {
  OVERDUE: 'WARNING',
  FAILING: 'CRITICAL',
  STALLED: 'CRITICAL',
};

/**
 * Turn the platform's own health into something that arrives.
 *
 * Addressed to the administrator role rather than to a named officer: an alert
 * with somebody's name on it goes unread exactly when that person is on leave,
 * which is when nobody is watching.
 *
 * Deduplicated per job *and state*, so a job that is overdue and then starts
 * failing raises a second, louder alert rather than being silenced by the
 * first -- and a job failing all day raises one, not ninety-six.
 */
export async function raiseSystemAlerts(client: PoolClient): Promise<{ raised: number }> {
  const health = await jobHealth();
  let raised = 0;

  for (const job of health.jobs) {
    /*
     * A job that works some of the time, which no state can say.
     *
     * `state` is FAILING only while `consecutive_failures > 0`, and one
     * success resets that to zero — so a reconciliation sweep failing every
     * other run is HEALTHY, raises nothing, and the unattended-work board
     * counts it as nothing needing attention. For reconciliation that is
     * money not reconciled.
     *
     * WARNING rather than CRITICAL, deliberately. The job IS working, some of
     * the time; CRITICAL is reserved for work that is not happening at all,
     * and an administrator who cannot tell those apart at a glance stops
     * reading either.
     *
     * Its own dedupe key, so a job that flaps and then fails outright still
     * raises the louder alert rather than being silenced by this one.
     */
    if (job.flapping) {
      const created = await raise(client, {
        role: 'admin',
        kind: 'SYSTEM_ALERT',
        severity: 'WARNING',
        subject: `${job.name}: working some of the time`,
        body:
          `${job.purpose}\n` +
          `${job.failuresTotal} of ${job.runsTotal} run(s) have failed. ` +
          `Last threw ${job.lastFailedAt?.toISOString() ?? 'unknown'}, ` +
          `last succeeded ${job.lastSucceededAt?.toISOString() ?? 'never'}.` +
          (job.lastError ? `\nLast error: ${job.lastError}` : ''),
        entityType: 'background_job',
        entityId: job.name,
        dedupeKey: `job:${job.name}:flapping`,
      });
      if (created) raised += 1;
    }

    const severity = JOB_ALERT_SEVERITY[job.state];
    if (!severity) continue;

    const created = await raise(client, {
      role: 'admin',
      kind: 'SYSTEM_ALERT',
      severity,
      subject: `${job.name}: ${job.message}`,
      body:
        `${job.purpose}\n` +
        `Last succeeded: ${job.lastSucceededAt ?? 'never'}. ` +
        `Consecutive failures: ${job.consecutiveFailures}.` +
        (job.lastError ? `\nLast error: ${job.lastError}` : ''),
      entityType: 'background_job',
      entityId: job.name,
      dedupeKey: `job:${job.name}:${job.state}`,
    });
    if (created) raised += 1;
  }

  return { raised };
}

// ===========================================================================
// What an officer has been doing
// ===========================================================================

/**
 * One officer's work, summarised.
 *
 * "Every material action is in the audit log; nothing summarises this officer"
 * was the gap. The log answers it and answers it badly for this question: a
 * supervisor asking what somebody has been doing today gets four hundred rows
 * in reverse order and has to count.
 *
 * Deliberately counts rather than scores. A number with a formula behind it
 * becomes the thing people manage to, and this platform suspends people; a
 * supervisor reading rows and forming a judgement is slower and answerable in
 * a way a productivity score is not.
 */
export async function activityFor(db: Db, userId: string, days = 7) {
  const window = Math.min(Math.max(days, 1), 90);

  const [officer, byAction, byDay, sessions, mostRecent] = await Promise.all([
    queryOne(
      db,
      `SELECT u.id, u.full_name, u.role, u.status, u.job_title, u.staff_number,
              d.name AS department_name, o.name AS office_name
         FROM users u
         LEFT JOIN departments d ON d.id = u.department_id
         LEFT JOIN revenue_offices o ON o.id = u.revenue_office_id
        WHERE u.id = $1`,
      [userId],
    ),
    query(
      db,
      `SELECT action, count(*)::text AS times, max(created_at) AS most_recent
         FROM audit_logs
        WHERE actor_id = $1 AND created_at > now() - ($2 || ' days')::interval
        GROUP BY action
        ORDER BY count(*) DESC`,
      [userId, String(window)],
    ),
    /*
     * Days with nothing are absent rather than zero-filled.
     *
     * A supervisor reading this needs to see a gap; a row saying "0" on a
     * Sunday reads as a working day that produced nothing, which is a
     * different and unfair statement.
     */
    query(
      db,
      `SELECT date_trunc('day', created_at AT TIME ZONE 'Africa/Lagos')::date AS day,
              count(*)::text AS times,
              count(*) FILTER (WHERE result <> 'SUCCESS')::text AS refused
         FROM audit_logs
        WHERE actor_id = $1 AND created_at > now() - ($2 || ' days')::interval
        GROUP BY 1
        ORDER BY 1 DESC`,
      [userId, String(window)],
    ),
    query(
      db,
      `SELECT s.id, s.issued_at, s.last_used_at, s.ip_address::text AS ip_address,
              d.label AS device_label
         FROM sessions s
         LEFT JOIN officer_devices d ON d.id = s.officer_device_id
        WHERE s.user_id = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
        ORDER BY s.last_used_at DESC NULLS LAST`,
      [userId],
    ),
    query(
      db,
      `SELECT created_at, action, entity_type, entity_id, result, reason
         FROM audit_logs
        WHERE actor_id = $1
        ORDER BY sequence_no DESC
        LIMIT 25`,
      [userId],
    ),
  ]);

  if (!officer) throw notFound('That officer');

  return { officer, windowDays: window, byAction, byDay, sessions, mostRecent };
}
