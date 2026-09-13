/**
 * Recording and reading product usage.
 *
 * The design rules live in `@psirs/shared/usage` and in migration 024; this is
 * where they are enforced. Two of them are enforced here rather than merely
 * stated, because they are the ones a future change would break by accident:
 *
 *   * Nothing identifying is written. `record` takes a role and a surface and
 *     has no parameter for a user, so writing one would require changing this
 *     signature — which is a conversation rather than a slip.
 *
 *   * Small groups are suppressed in aggregates rather than published. Usage
 *     rows carry no identity, but a count of three in one LGA on one afternoon
 *     can still single somebody out.
 */

import {
  USAGE_BATCH_LIMIT,
  USAGE_MIN_GROUP_SIZE,
  USAGE_STEP_MAX_LENGTH,
  isUsageEvent,
  type UsageEventInput,
  type UsageSurface,
} from '@psirs/shared';
import type { Db } from '../db/pool';
import { query } from '../db/pool';
import { badRequest } from '../lib/errors';

export interface RecordUsageParams {
  surface: UsageSurface;
  /** The caller's role, which is a category and not a person. */
  role: string | null;
  events: UsageEventInput[];
}

/**
 * Write a batch.
 *
 * Unknown event names are refused rather than stored. An open string field
 * filled by a client is unbounded cardinality, and it is also the field a
 * compromised client would use to write whatever it liked into an operator's
 * screen — so the vocabulary is closed and this is where it closes.
 */
export async function record(db: Db, params: RecordUsageParams): Promise<{ accepted: number }> {
  if (params.events.length === 0) return { accepted: 0 };
  if (params.events.length > USAGE_BATCH_LIMIT) {
    throw badRequest(`A usage batch may carry at most ${USAGE_BATCH_LIMIT} events.`);
  }

  const rows = params.events.filter((event) => isUsageEvent(event.event));
  if (rows.length === 0) return { accepted: 0 };

  /*
   * One statement rather than a loop.
   *
   * Telemetry is written on the same database as the money path, and a batch
   * of fifty round trips per handset is a cost the collection flow would end
   * up paying for. `unnest` makes a batch one insert.
   */
  await query(
    db,
    `INSERT INTO usage_events
       (occurred_at, surface, event, role, flow_id, step, outcome, duration_ms,
        app_version, language, connection, lga_id)
     SELECT * FROM unnest(
       $1::timestamptz[], $2::text[], $3::text[], $4::text[], $5::uuid[], $6::text[],
       $7::text[], $8::int[], $9::text[], $10::text[], $11::text[], $12::uuid[])`,
    [
      rows.map((e) => e.occurredAt),
      rows.map(() => params.surface),
      rows.map((e) => e.event),
      rows.map(() => params.role),
      rows.map((e) => e.flowId ?? null),
      rows.map((e) => (e.step ? e.step.slice(0, USAGE_STEP_MAX_LENGTH) : null)),
      rows.map((e) => e.outcome ?? null),
      rows.map((e) =>
        typeof e.durationMs === 'number' && e.durationMs >= 0 ? Math.round(e.durationMs) : null,
      ),
      rows.map((e) => e.appVersion ?? null),
      rows.map((e) => e.language ?? null),
      rows.map((e) => e.connection ?? null),
      rows.map((e) => e.lgaId ?? null),
    ],
  );

  return { accepted: rows.length };
}

interface Window {
  from: Date;
  to: Date;
}

function windowOf(params: { from?: Date; to?: Date }): Window {
  return {
    from: params.from ?? new Date(Date.now() - 30 * 86_400_000),
    to: params.to ?? new Date(),
  };
}

/**
 * The funnel for each multi-step flow: how many attempts started, finished,
 * and were given up on.
 *
 * Completion rate is the number worth looking at, and abandonment is the one
 * worth acting on — a form nobody finishes is invisible in every other record
 * the platform keeps, because an abandoned registration creates no taxpayer.
 */
export async function flowFunnels(db: Db, params: { from?: Date; to?: Date } = {}) {
  const { from, to } = windowOf(params);
  return query(
    db,
    `SELECT event,
            count(DISTINCT flow_id) FILTER (WHERE outcome = 'STARTED')::text   AS started,
            count(DISTINCT flow_id) FILTER (WHERE outcome = 'COMPLETED')::text AS completed,
            count(DISTINCT flow_id) FILTER (WHERE outcome = 'ABANDONED')::text AS abandoned,
            count(DISTINCT flow_id) FILTER (WHERE outcome = 'FAILED')::text    AS failed,
            COALESCE(ROUND(
              percentile_cont(0.5) WITHIN GROUP (
                ORDER BY duration_ms) FILTER (WHERE outcome = 'COMPLETED')),0)::text
              AS median_completion_ms
       FROM usage_events
      WHERE occurred_at BETWEEN $1 AND $2
        AND outcome IS NOT NULL
        AND flow_id IS NOT NULL
      GROUP BY event
      ORDER BY count(DISTINCT flow_id) DESC`,
    [from, to],
  );
}

/**
 * Where each flow is abandoned.
 *
 * The last step an abandoned attempt reached is the screen to go and look at.
 * Groups below the suppression threshold are dropped: a single abandonment in
 * a small LGA is somebody's afternoon.
 */
export async function abandonmentPoints(db: Db, params: { from?: Date; to?: Date } = {}) {
  const { from, to } = windowOf(params);
  return query(
    db,
    `WITH last_step AS (
       SELECT DISTINCT ON (flow_id) flow_id, event, step
         FROM usage_events
        WHERE occurred_at BETWEEN $1 AND $2 AND flow_id IS NOT NULL AND step IS NOT NULL
        ORDER BY flow_id, occurred_at DESC
     ),
     abandoned AS (
       SELECT DISTINCT flow_id FROM usage_events
        WHERE occurred_at BETWEEN $1 AND $2 AND outcome = 'ABANDONED'
     )
     SELECT l.event, l.step, count(*)::text AS abandoned_here
       FROM last_step l JOIN abandoned a ON a.flow_id = l.flow_id
      GROUP BY l.event, l.step
     HAVING count(*) >= $3
      ORDER BY count(*) DESC
      LIMIT 25`,
    [from, to, USAGE_MIN_GROUP_SIZE],
  );
}

/**
 * How much the offline queue is actually used, and how often it fails.
 *
 * The offline path is the platform's largest bet about the field. Nothing
 * reported whether it was being exercised, so nobody could tell a queue that
 * works from one nobody reaches.
 */
export async function offlineHealth(db: Db, params: { from?: Date; to?: Date } = {}) {
  const { from, to } = windowOf(params);
  return query(
    db,
    `SELECT event, count(*)::text AS events,
            COALESCE(ROUND(percentile_cont(0.5) WITHIN GROUP (
              ORDER BY EXTRACT(EPOCH FROM (received_at - occurred_at)))),0)::text
              AS median_delay_seconds
       FROM usage_events
      WHERE occurred_at BETWEEN $1 AND $2
        AND event IN ('draft.queued','draft.synced','draft.sync_failed')
      GROUP BY event ORDER BY event`,
    [from, to],
  );
}

/**
 * Which language the applications are actually being used in.
 *
 * The Hausa dictionary, its review sheet and its consistency tests are a large
 * investment, and until now nothing anywhere reported whether a single agent
 * had ever switched to it.
 */
export async function languageUse(db: Db, params: { from?: Date; to?: Date } = {}) {
  const { from, to } = windowOf(params);
  return query(
    db,
    `SELECT COALESCE(language, 'not recorded') AS language, count(*)::text AS events
       FROM usage_events
      WHERE occurred_at BETWEEN $1 AND $2 AND surface = 'AGENT_PWA'
      GROUP BY language
     HAVING count(*) >= $3
      ORDER BY count(*) DESC`,
    [from, to, USAGE_MIN_GROUP_SIZE],
  );
}

/**
 * Whether the platform works as well outside Jos as inside it.
 *
 * This is the question the whole module is for. A completion rate that is fine
 * statewide and poor in the rural LGAs is the difference between a platform
 * that serves the grassroots and one that serves the capital.
 */
export async function reachByLga(db: Db, params: { from?: Date; to?: Date } = {}) {
  const { from, to } = windowOf(params);
  return query(
    db,
    `SELECT l.name AS lga, l.zone,
            count(DISTINCT u.flow_id) FILTER (WHERE u.outcome = 'STARTED')::text AS started,
            count(DISTINCT u.flow_id) FILTER (WHERE u.outcome = 'COMPLETED')::text AS completed,
            count(*)::text AS events
       FROM usage_events u JOIN lgas l ON l.id = u.lga_id
      WHERE u.occurred_at BETWEEN $1 AND $2
      GROUP BY l.name, l.zone
     HAVING count(*) >= $3
      ORDER BY count(*) DESC`,
    [from, to, USAGE_MIN_GROUP_SIZE],
  );
}

/** Which screens are reached at all, and which never are. */
export async function screenReach(db: Db, params: { from?: Date; to?: Date } = {}) {
  const { from, to } = windowOf(params);
  return query(
    db,
    `SELECT surface, step AS screen, count(*)::text AS views
       FROM usage_events
      WHERE occurred_at BETWEEN $1 AND $2 AND event = 'screen.viewed' AND step IS NOT NULL
      GROUP BY surface, step
     HAVING count(*) >= $3
      ORDER BY count(*) DESC LIMIT 40`,
    [from, to, USAGE_MIN_GROUP_SIZE],
  );
}

/**
 * Delete telemetry past the retention window.
 *
 * Raw rows are a means to an aggregate, not a record. Keeping them
 * indefinitely would slowly turn a disposable table into a historical one that
 * somebody starts to rely on, and it is the identity-free design that makes
 * deletion safe to do at all — nothing here is anybody's evidence.
 */
export async function expireOldEvents(db: Db, retentionDays = 90): Promise<{ deleted: number }> {
  const result = await query<{ id: string }>(
    db,
    `DELETE FROM usage_events
      WHERE occurred_at < now() - ($1 || ' days')::interval
      RETURNING id`,
    [String(retentionDays)],
  );
  return { deleted: result.length };
}
