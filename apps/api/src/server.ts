/**
 * Process entry point.
 *
 * Runs pending migrations before accepting traffic, then starts background
 * workers for the jobs PRD §26 and §46 require to happen on a schedule rather
 * than on a request. Shutdown drains in-flight requests before closing the
 * database pool so a payment confirmation is never cut off mid-transaction.
 */

import { createApp } from './app';
import { config, envFileLoaded } from './config';
import { describeDatabase } from './env';
import { closePool, pool } from './db/pool';
import { runMigrations } from './db/migrate';
import { promoteEligibleCommissions } from './services/commission';
import { dispatchQueued } from './services/notifications';
import { runFraudSweep } from './services/fraud';
import { retryOutstandingTins } from './services/taxpayers';
import { retryAuthorityNotifications } from './services/vehicles';
import { retryOutstandingRefunds, runScheduledReconciliation } from './services/reconciliation';
import { withJobLock, withTransaction } from './db/pool';
import { log } from './lib/logger';
import { metrics } from './lib/metrics';
import { reportError } from './services/error-reporting';

/**
 * How often each background job runs.
 *
 * The last two exist because the integration adapters can now say a service
 * could not be reached. That honesty is only worth having if something acts on
 * it later — otherwise "we will ask again" is a promise nothing keeps, and a
 * taxpayer registered during a TIN outage waits for a number forever.
 *
 * Both are also exposed as endpoints for an officer to trigger on demand; the
 * schedule is what makes them happen without anyone remembering.
 */
const WORKER_INTERVALS = {
  commissionPromotion: 5 * 60_000,
  notificationDispatch: 30_000,
  fraudSweep: 15 * 60_000,
  /** Chase TINs the PSIRS TIN service has not issued yet. */
  tinCatchUp: 30 * 60_000,
  /** Re-send renewals the vehicle authority never acknowledged. */
  authorityCatchUp: 30 * 60_000,
  /** Ask the gateway again for refunds a taxpayer is still owed. */
  refundRetry: 10 * 60_000,
  /**
   * Three-way reconciliation (PRD §46).
   *
   * Four times a day over a trailing window, rather than nightly, because a
   * settlement reference can land at any hour and the sooner an exception is
   * visible the cheaper it is to chase. The sweep skips itself if the previous
   * one is still running.
   */
  reconciliationSweep: 6 * 60 * 60_000,
};

/**
 * The identity these jobs act as.
 *
 * Every retry writes an audit entry, and an audit entry needs an actor. There
 * is no human behind a scheduled sweep, so it is attributed to the platform
 * itself rather than borrowed from whichever officer last signed in — an audit
 * trail that names a person who did nothing is worse than one that says
 * "system".
 */
const SYSTEM_ACTOR = { actorId: null as string | null, actorRole: 'system' };

/**
 * Run one scheduled job: once across the fleet, timed, and never able to take
 * the process down.
 *
 * Three things every worker needs and none of them used to have.
 *
 * The lock is the important one. These were bare `setInterval` callbacks, which
 * is a correct arrangement for exactly one instance and no arrangement at all
 * for the second. `withJobLock` returns null rather than waiting when another
 * instance is already running the same sweep, because a sweep that has just run
 * elsewhere does not need running again.
 *
 * The timing and outcome go to metrics, so "the reconciliation sweep stopped
 * running three days ago" becomes an alert instead of a discovery. A worker
 * that throws is reported, because a background failure has nobody watching a
 * screen for it.
 */
async function runJob(name: string, job: () => Promise<string | null>): Promise<void> {
  const startedAt = Date.now();
  try {
    const outcome = await withJobLock(name, job);
    if (!outcome.ran) {
      log.debug('job skipped; another instance holds it', { component: `worker.${name}` });
      return;
    }

    // Recorded whether or not the job had anything to say. A worker that runs
    // every five minutes and finds nothing to do is the healthy case, and it
    // still has to show up in `psirs_worker_last_run_*` — otherwise an alert on
    // "this worker has not run recently" fires on the workers that are working.
    metrics.workerRun(name, 'success', Date.now() - startedAt);
    if (outcome.value) {
      log.info(outcome.value, { component: `worker.${name}`, durationMs: Date.now() - startedAt });
    }
  } catch (error) {
    metrics.workerRun(name, 'failure', Date.now() - startedAt);
    log.error('job failed', { component: `worker.${name}`, error });
    reportError({
      message: `Background job "${name}" failed`,
      error,
      component: `worker.${name}`,
    });
  }
}

/** Start a job on an interval, and run it once at boot so a restart catches up. */
function schedule(name: string, intervalMs: number, job: () => Promise<string | null>): NodeJS.Timeout {
  void runJob(name, job);
  return setInterval(() => void runJob(name, job), intervalMs);
}

async function main(): Promise<void> {
  log.info('starting Plateau State Revenue Platform API', {
    component: 'boot',
    environment: config.env,
    configuration: envFileLoaded ?? 'environment only (no .env found)',
    database: describeDatabase(config.database.url),
  });

  // Migrations are an explicit pipeline step in a real deployment (see
  // docs/DEPLOYMENT.md); this stays for single-node and development runs, and
  // now takes an advisory lock so simultaneous boots cannot race.
  if (config.runMigrationsOnBoot) {
    const applied = await runMigrations({ silent: true });
    if (applied > 0) log.info(`applied ${applied} migration(s)`, { component: 'boot' });
  } else {
    log.info('skipping migrations on boot; the deploy pipeline owns them', { component: 'boot' });
  }

  const app = createApp();
  const server = app.listen(config.port, () => {
    log.info('listening', {
      component: 'boot',
      port: config.port,
      paymentGateway: config.payments.gateway,
      tinService: config.integrations.tinService,
      errorReporting: config.observability.errorReporting,
    });
  });

  const timers = [
    schedule('commission-promotion', WORKER_INTERVALS.commissionPromotion, async () => {
      const promoted = await promoteEligibleCommissions();
      return promoted > 0 ? `promoted ${promoted} commission(s) to eligible` : null;
    }),

    schedule('notification-dispatch', WORKER_INTERVALS.notificationDispatch, async () => {
      const sent = await dispatchQueued(pool);
      return sent > 0 ? `delivered ${sent} notification(s)` : null;
    }),

    schedule('fraud-sweep', WORKER_INTERVALS.fraudSweep, async () => {
      await withTransaction((client) => runFraudSweep(client));
      return null;
    }),

    schedule('tin-catch-up', WORKER_INTERVALS.tinCatchUp, async () => {
      const result = await retryOutstandingTins({ ...SYSTEM_ACTOR, limit: 100 });
      return result.attempted > 0
        ? `${result.assigned} TIN(s) assigned, ${result.stillOutstanding} still outstanding`
        : null;
    }),

    schedule('authority-catch-up', WORKER_INTERVALS.authorityCatchUp, async () => {
      const result = await retryAuthorityNotifications({ ...SYSTEM_ACTOR, limit: 100 });
      return result.attempted > 0
        ? `${result.accepted} renewal(s) acknowledged, ${result.stillFailing} still outstanding`
        : null;
    }),

    // A taxpayer owed money must not wait on somebody pressing a button.
    schedule('refund-retry', WORKER_INTERVALS.refundRetry, async () => {
      const result = await retryOutstandingRefunds({ ...SYSTEM_ACTOR, limit: 50 });
      return result.attempted > 0
        ? `${result.completed} refund(s) returned, ${result.stillOutstanding} still owed`
        : null;
    }),

    // The control that proves government actually received the money. It ran
    // only when somebody remembered to press a button, which is not a control.
    schedule('reconciliation-sweep', WORKER_INTERVALS.reconciliationSweep, async () => {
      const result = await runScheduledReconciliation({ ...SYSTEM_ACTOR });
      if (result.skipped) return null;

      if (result.summary?.status === 'ABORTED') {
        // Nothing was compared, so nothing is claimed about this period. That
        // is a silent hole in the audit position unless somebody is told.
        metrics.reconciliationRun('ABORTED', 0);
        reportError({
          message: 'Reconciliation sweep aborted — nothing was compared for this period',
          severity: 'error',
          component: 'worker.reconciliation-sweep',
          context: { abortReason: result.summary.abortReason },
        });
        throw new Error(`Reconciliation aborted: ${result.summary.abortReason}`);
      }

      metrics.reconciliationRun(result.summary?.status ?? 'UNKNOWN', result.summary?.exceptions ?? 0);
      return (
        `${result.summary?.matched} matched, ${result.summary?.exceptions} exception(s), ` +
        `${result.summary?.unchecked} unchecked, ${result.recovery?.verified ?? 0} payment(s) recovered`
      );
    }),
  ];

  const shutdown = (signal: string) => {
    log.info('draining', { component: 'shutdown', signal });
    timers.forEach(clearInterval);
    server.close(async () => {
      await closePool();
      log.info('shutdown complete', { component: 'shutdown' });
      process.exit(0);
    });
    // Hard limit so a stuck connection cannot block a restart indefinitely.
    setTimeout(() => {
      log.error('shutdown forced after timeout', { component: 'shutdown' });
      process.exit(1);
    }, 15_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// A process that dies after this point takes the platform with it, so both
// last-resort handlers report before exiting rather than vanishing into a
// container log nobody is tailing.
process.on('unhandledRejection', (reason) => {
  log.error('unhandled promise rejection', { component: 'process', error: reason });
  reportError({ message: 'Unhandled promise rejection', error: reason, component: 'process' });
});

process.on('uncaughtException', (error) => {
  log.error('uncaught exception', { component: 'process', error });
  reportError({ message: 'Uncaught exception — process will exit', error, component: 'process' });
  // Give the report a moment to leave, then go: an uncaught exception means
  // the process state is no longer trustworthy.
  setTimeout(() => process.exit(1), 1_000).unref();
});

main().catch((error) => {
  log.error('failed to start', { component: 'boot', error });
  reportError({ message: 'API failed to start', error, component: 'boot' });
  process.exit(1);
});
