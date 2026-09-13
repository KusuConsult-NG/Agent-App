/**
 * Whether the services this platform depends on are answering.
 *
 * `integrationStatus()` says which adapter is configured. That is a fact about
 * deployment and says nothing about whether the thing at the other end
 * responded this morning, so "an integration is down" was an alert the
 * platform had no way to raise.
 *
 * WHAT IS BEING MEASURED
 *
 * The platform's own traffic, not a probe. Every adapter already returns
 * `UNAVAILABLE` rather than throwing when it cannot reach its service -- the
 * oldest design decision in `integrations/index.ts`, made so an upstream
 * outage never becomes a wrong fact in a government register. Recording that
 * outcome is all this needs: the health of an integration is the shape of the
 * real calls, and a synthetic lookup against a government identity service
 * every five minutes would be a real query about a real person asked for no
 * reason.
 *
 * AN ANSWER NOBODY LIKES IS STILL AN ANSWER
 *
 * "This taxpayer has no TIN" and "this account name does not match" are the
 * service working. Only `UNAVAILABLE` counts against it. Getting that wrong
 * would put an integration into alarm for doing its job, and teach whoever
 * reads the alerts that the alerts are wrong.
 */

import type { PoolClient } from 'pg';
import type { Db } from '../db/pool';
import { pool, query } from '../db/pool';
import { log } from '../lib/logger';
import { raise } from './officer-inbox';

/** The integrations worth watching, and what a person calls each one. */
export const WATCHED_INTEGRATIONS = {
  tin: 'The PSIRS TIN service',
  kyc: 'The government identity service',
  vehicles: 'The vehicle registration authority',
  banks: 'Bank name enquiry',
  gateway: 'The payment gateway',
} as const;

export type IntegrationName = keyof typeof WATCHED_INTEGRATIONS;

export type IntegrationState = 'NEVER_CALLED' | 'HEALTHY' | 'DEGRADED' | 'DOWN';

/**
 * Three failures in a row before an integration is called down.
 *
 * One is a dropped connection, which happens to every network call ever made
 * and is not news. Three in a row, with no answer in between, is a service
 * that is not answering -- and because a success resets the counter, a busy
 * integration failing one call in twenty never reaches it.
 */
const DOWN_AFTER_CONSECUTIVE_FAILURES = 3;

export interface IntegrationReport {
  name: IntegrationName;
  describes: string;
  provider: string | null;
  state: IntegrationState;
  lastCalledAt: string | null;
  lastSucceededAt: string | null;
  lastUnavailableAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  callsTotal: number;
  unavailableTotal: number;
  message: string;
}

/**
 * Record one outbound call.
 *
 * Never throws and never blocks the caller. A taxpayer's registration must not
 * fail because the table that remembers whether the TIN service answered could
 * not be written -- that would turn a monitoring feature into an outage, which
 * is the classic way monitoring makes a system worse.
 */
export async function recordCall(
  name: IntegrationName,
  outcome: string,
  detail: { provider?: string | null; error?: string | null } = {},
): Promise<void> {
  const unavailable = outcome === 'UNAVAILABLE';
  try {
    await pool.query(
      `INSERT INTO integration_health (
         name, provider, last_called_at, last_succeeded_at, last_unavailable_at,
         last_error, consecutive_failures, calls_total, unavailable_total, updated_at
       ) VALUES (
         $1, $2, now(),
         CASE WHEN $3 THEN NULL ELSE now() END,
         CASE WHEN $3 THEN now() ELSE NULL END,
         CASE WHEN $3 THEN $4 ELSE NULL END,
         CASE WHEN $3 THEN 1 ELSE 0 END,
         1,
         CASE WHEN $3 THEN 1 ELSE 0 END,
         now()
       )
       ON CONFLICT (name) DO UPDATE SET
         provider = COALESCE(EXCLUDED.provider, integration_health.provider),
         last_called_at = now(),
         last_succeeded_at =
           CASE WHEN $3 THEN integration_health.last_succeeded_at ELSE now() END,
         last_unavailable_at =
           CASE WHEN $3 THEN now() ELSE integration_health.last_unavailable_at END,
         -- The last error is kept after a recovery rather than cleared: an
         -- incident review needs to know what it said, and the timestamps
         -- beside it say whether it is current.
         last_error = CASE WHEN $3 THEN $4 ELSE integration_health.last_error END,
         consecutive_failures =
           CASE WHEN $3 THEN integration_health.consecutive_failures + 1 ELSE 0 END,
         calls_total = integration_health.calls_total + 1,
         unavailable_total =
           integration_health.unavailable_total + CASE WHEN $3 THEN 1 ELSE 0 END,
         updated_at = now()`,
      [name, detail.provider ?? null, unavailable, detail.error ?? null],
    );
  } catch (error) {
    log.warn('could not record integration health', {
      component: 'integrations',
      integration: name,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function describeState(report: Omit<IntegrationReport, 'message' | 'describes'>): string {
  switch (report.state) {
    case 'NEVER_CALLED':
      return 'Has not been called once since this database was created.';
    case 'DOWN':
      return (
        `${report.consecutiveFailures} call(s) in a row could not be answered` +
        (report.lastError ? `: ${report.lastError}` : '.')
      );
    case 'DEGRADED':
      return 'A recent call could not be answered, and the one after it was.';
    default:
      return 'Answering.';
  }
}

export async function integrationHealth(db: Db = pool): Promise<{
  integrations: IntegrationReport[];
  healthy: boolean;
  needingAttention: number;
}> {
  const rows = await query<{
    name: string;
    provider: string | null;
    last_called_at: string | null;
    last_succeeded_at: string | null;
    last_unavailable_at: string | null;
    last_error: string | null;
    consecutive_failures: number;
    calls_total: string;
    unavailable_total: string;
  }>(db, 'SELECT * FROM integration_health');
  const byName = new Map(rows.map((row) => [row.name, row]));

  const integrations = (Object.keys(WATCHED_INTEGRATIONS) as IntegrationName[]).map(
    (name): IntegrationReport => {
      const row = byName.get(name);
      if (!row) {
        return {
          name,
          describes: WATCHED_INTEGRATIONS[name],
          provider: null,
          state: 'NEVER_CALLED',
          lastCalledAt: null,
          lastSucceededAt: null,
          lastUnavailableAt: null,
          lastError: null,
          consecutiveFailures: 0,
          callsTotal: 0,
          unavailableTotal: 0,
          message: 'Has not been called once since this database was created.',
        };
      }

      /*
       * State is read from the consecutive counter rather than from a rate.
       *
       * A rate over all time makes a service that failed for an hour last
       * March look permanently unwell, and a rate over a window needs a window
       * to argue about. What an officer wants to know is whether it is
       * answering *now*, which is what the counter says.
       */
      const state: IntegrationState =
        row.consecutive_failures >= DOWN_AFTER_CONSECUTIVE_FAILURES
          ? 'DOWN'
          : row.consecutive_failures > 0
            ? 'DEGRADED'
            : 'HEALTHY';

      const partial = {
        name,
        provider: row.provider,
        state,
        lastCalledAt: row.last_called_at,
        lastSucceededAt: row.last_succeeded_at,
        lastUnavailableAt: row.last_unavailable_at,
        lastError: row.last_error,
        consecutiveFailures: row.consecutive_failures,
        callsTotal: Number.parseInt(row.calls_total, 10),
        unavailableTotal: Number.parseInt(row.unavailable_total, 10),
      };
      return { ...partial, describes: WATCHED_INTEGRATIONS[name], message: describeState(partial) };
    },
  );

  const needingAttention = integrations.filter((one) => one.state === 'DOWN').length;
  return { integrations, healthy: needingAttention === 0, needingAttention };
}

/**
 * Raise an alert for an integration that has stopped answering.
 *
 * Only DOWN. A degraded integration is one that failed a call and answered the
 * next, which is a network being a network; alerting on it would fill the
 * inbox with rows nobody can act on and bury the one that matters.
 *
 * Addressed to the administrator role, deduplicated per integration, and
 * raised again once somebody has read the last one -- the same three
 * decisions the background-job alerts make, and for the same reasons.
 */
export async function raiseIntegrationAlerts(client: PoolClient): Promise<{ raised: number }> {
  const { integrations } = await integrationHealth(client);
  let raised = 0;

  for (const integration of integrations) {
    if (integration.state !== 'DOWN') continue;
    const created = await raise(client, {
      role: 'admin',
      kind: 'INTEGRATION_ALERT',
      severity: 'CRITICAL',
      subject: `${integration.describes} is not answering`,
      body:
        `${integration.message}\n` +
        `Last answered: ${integration.lastSucceededAt ?? 'never'}. ` +
        `${integration.unavailableTotal} of ${integration.callsTotal} call(s) unanswered.`,
      entityType: 'integration',
      entityId: integration.name,
      dedupeKey: `integration:${integration.name}:DOWN`,
    });
    if (created) raised += 1;
  }

  return { raised };
}
