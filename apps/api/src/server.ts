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
import { closePool, pool, withTransaction } from './db/pool';
import { runMigrations } from './db/migrate';
import { promoteEligibleCommissions } from './services/commission';
import { dispatchQueued } from './services/notifications';
import { runFraudSweep } from './services/fraud';
import { retryOutstandingTins } from './services/taxpayers';
import { retryAuthorityNotifications } from './services/vehicles';
import { retryOutstandingRefunds, runScheduledReconciliation } from './services/reconciliation';
import { sendDueReminders } from './services/reminders';
import { expireLapsedInvoices } from './services/revenue';
import { BACKGROUND_JOBS, runJob, type JobName } from './services/jobs';
import { expireSettledKeys } from './middleware/idempotency';
import { expireOldEvents } from './services/usage';
import { log } from './lib/logger';
import { metrics } from './lib/metrics';
import { reportError } from './services/error-reporting';


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
 * Schedule a background job behind an advisory lock.
 *
 * Multiple replicas of the API can run simultaneously; without locking, every
 * replica would dispatch the same queued notification, promote the same
 * commission and retry the same refund. Each job takes a session-level
 * advisory lock keyed to its name, executes, records its timing, and releases.
 * If another instance holds the lock, this tick is skipped quietly.
 */
function schedule(
  name: JobName,
  task: () => Promise<string | null | void>,
): NodeJS.Timeout {
  /*
   * The interval comes from the registry rather than from a second table here.
   * The health board decides whether a job is overdue by comparing its last
   * start against its declared interval, so a schedule that could disagree with
   * that declaration would make the board quietly wrong about the one thing it
   * is for — and the disagreement would show up as a job reported healthy while
   * it is late, which is the failure that looks like nothing.
   */
  const { intervalMs } = BACKGROUND_JOBS[name];
  const run = async () => {
    const startedAt = process.hrtime.bigint();
    try {
      const outcome = await runJob(name, task);
      if (!outcome.ran) {
        log.debug('job skipped; another instance holds it', { component: 'worker', job: name });
        return;
      }
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      metrics.workerRun(name, 'success', durationMs);
      if (outcome.value) {
        log.info(String(outcome.value), {
          component: 'worker',
          job: name,
          durationMs: Math.round(durationMs),
        });
      }
    } catch (error) {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      metrics.workerRun(name, 'failure', durationMs);
      log.error('job failed', { component: 'worker', job: name, durationMs: Math.round(durationMs), error });
      reportError({
        message: `Background worker '${name}' failed`,
        error,
        component: `worker.${name}`,
      });
    }
  };

  // Run shortly after boot rather than waiting out the full interval, so
  // pending items left over from before a restart are picked up promptly.
  const initialDelay = Math.min(intervalMs, 5_000 + Math.floor(Math.random() * 5_000));
  const initial = setTimeout(() => void run(), initialDelay);
  initial.unref();

  const interval = setInterval(() => void run(), intervalMs);
  interval.unref();
  return interval;
}

async function main() {
  log.info('booting', {
    component: 'boot',
    nodeEnv: process.env.NODE_ENV ?? 'development',
    database: describeDatabase(config.database.url),
    envFileLoaded: envFileLoaded ? 'yes' : 'no (using environment variables)',
    version: process.env.npm_package_version ?? 'unknown',
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
    schedule('commission-promotion', async () => {
      const promoted = await promoteEligibleCommissions();
      return promoted > 0 ? `promoted ${promoted} commission(s) to eligible` : null;
    }),

    schedule('notification-dispatch', async () => {
      const sent = await dispatchQueued(pool);
      return sent > 0 ? `delivered ${sent} notification(s)` : null;
    }),

    schedule('fraud-sweep', async () => {
      await withTransaction((client) => runFraudSweep(client));
      return null;
    }),

    schedule('tin-catch-up', async () => {
      const result = await retryOutstandingTins({ ...SYSTEM_ACTOR, limit: 100 });
      return result.attempted > 0
        ? `${result.assigned} TIN(s) assigned, ${result.stillOutstanding} still outstanding`
        : null;
    }),

    schedule('authority-catch-up', async () => {
      const result = await retryAuthorityNotifications({ ...SYSTEM_ACTOR, limit: 100 });
      return result.attempted > 0
        ? `${result.accepted} renewal(s) acknowledged, ${result.stillFailing} still outstanding`
        : null;
    }),

    // A taxpayer owed money must not wait on somebody pressing a button.
    schedule('refund-retry', async () => {
      const result = await retryOutstandingRefunds({ ...SYSTEM_ACTOR, limit: 50 });
      return result.attempted > 0
        ? `${result.completed} refund(s) returned, ${result.stillOutstanding} still owed`
        : null;
    }),

    // A deadline nothing acts on is a date on a piece of paper. The payment
    // path already refuses a lapsed invoice; this is what makes the record say
    // the same thing.
    schedule('invoice-expiry', async () => {
      const result = await expireLapsedInvoices({ ...SYSTEM_ACTOR, limit: 500 });
      return result.expired > 0 ? `${result.expired} invoice(s) passed their deadline` : null;
    }),

    // The control that proves government actually received the money. It ran
    // only when somebody remembered to press a button, which is not a control.
    schedule('reconciliation-sweep', async () => {
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

    // Remind taxpayers before their invoices expire (6-week, 4-week, 2-week).
    // The sweep is idempotent: each window is flagged on the invoice after the
    // first send, so running it more than once never duplicates a reminder.
    schedule('reminder-sweep', async () => {
      const result = await sendDueReminders(pool);
      return result.sent > 0 || result.skipped > 0
        ? `${result.sent} reminder(s) sent, ${result.skipped} skipped`
        : null;
    }),

    // Housekeeping on the two tables that grew without bound. Neither moves
    // money; both are how a database runs out of room, which does.
    schedule('idempotency-sweep', async () => {
      const result = await expireSettledKeys();
      if (result.interrupted > 0) {
        // A key still IN_PROGRESS an hour later is a money-path request that
        // was interrupted and never came back. It is not deleted — the same
        // key must not be allowed to re-execute — but it is not silent either.
        log.warn(`${result.interrupted} idempotency key(s) left by interrupted requests`, {
          component: 'worker',
          job: 'idempotency-sweep',
        });
      }
      return result.deleted > 0 ? `${result.deleted} settled key(s) deleted` : null;
    }),

    schedule('usage-retention', async () => {
      const result = await expireOldEvents(pool);
      return result.deleted > 0 ? `${result.deleted} telemetry row(s) deleted` : null;
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
