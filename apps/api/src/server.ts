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
import { withTransaction } from './db/pool';

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

async function main(): Promise<void> {
  console.log(`[boot] Plateau State Revenue Platform API (${config.env})`);
  console.log(`[boot] configuration: ${envFileLoaded ?? 'environment only (no .env found)'}`);
  console.log(`[boot] database: ${describeDatabase(config.database.url)}`);

  const applied = await runMigrations({ silent: true });
  if (applied > 0) console.log(`[boot] applied ${applied} migration(s)`);

  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`[boot] listening on http://localhost:${config.port}`);
    console.log(`[boot] payment gateway: ${config.payments.gateway}`);
    console.log(`[boot] TIN service: ${config.integrations.tinService}`);
  });

  const timers = [
    setInterval(() => {
      promoteEligibleCommissions().catch((error) =>
        console.error('[worker] commission promotion failed', error),
      );
    }, WORKER_INTERVALS.commissionPromotion),

    setInterval(() => {
      dispatchQueued(pool).catch((error) =>
        console.error('[worker] notification dispatch failed', error),
      );
    }, WORKER_INTERVALS.notificationDispatch),

    setInterval(() => {
      withTransaction((client) => runFraudSweep(client)).catch((error) =>
        console.error('[worker] fraud sweep failed', error),
      );
    }, WORKER_INTERVALS.fraudSweep),

    setInterval(() => {
      retryOutstandingTins({ ...SYSTEM_ACTOR, limit: 100 })
        .then((result) => {
          if (result.attempted > 0) {
            console.log(
              `[worker] TIN catch-up: ${result.assigned} assigned, ` +
                `${result.stillOutstanding} still outstanding`,
            );
          }
        })
        .catch((error) => console.error('[worker] TIN catch-up failed', error));
    }, WORKER_INTERVALS.tinCatchUp),

    setInterval(() => {
      retryAuthorityNotifications({ ...SYSTEM_ACTOR, limit: 100 })
        .then((result) => {
          if (result.attempted > 0) {
            console.log(
              `[worker] vehicle authority catch-up: ${result.accepted} acknowledged, ` +
                `${result.stillFailing} still outstanding`,
            );
          }
        })
        .catch((error) => console.error('[worker] authority catch-up failed', error));
    }, WORKER_INTERVALS.authorityCatchUp),

    // A taxpayer owed money must not wait on somebody pressing a button.
    setInterval(() => {
      retryOutstandingRefunds({ ...SYSTEM_ACTOR, limit: 50 })
        .then((result) => {
          if (result.attempted > 0) {
            console.log(
              `[worker] refunds: ${result.completed} returned, ${result.stillOutstanding} still owed`,
            );
          }
        })
        .catch((error) => console.error('[worker] refund retry failed', error));
    }, WORKER_INTERVALS.refundRetry),

    // The control that proves government actually received the money. It ran
    // only when somebody remembered to press a button, which is not a control.
    setInterval(() => {
      runScheduledReconciliation({ ...SYSTEM_ACTOR })
        .then((result) => {
          if (result.skipped) return;
          if (result.summary?.status === 'ABORTED') {
            console.error(
              `[worker] reconciliation ABORTED: ${result.summary.abortReason} ` +
                '— nothing was compared, and nothing is claimed about this period',
            );
            return;
          }
          console.log(
            `[worker] reconciliation: ${result.summary?.matched} matched, ` +
              `${result.summary?.exceptions} exception(s), ` +
              `${result.summary?.unchecked} unchecked, ` +
              `${result.recovery?.verified ?? 0} payment(s) recovered`,
          );
        })
        .catch((error) => console.error('[worker] reconciliation sweep failed', error));
    }, WORKER_INTERVALS.reconciliationSweep),
  ];

  const shutdown = (signal: string) => {
    console.log(`[shutdown] ${signal} received, draining...`);
    timers.forEach(clearInterval);
    server.close(async () => {
      await closePool();
      console.log('[shutdown] complete');
      process.exit(0);
    });
    // Hard limit so a stuck connection cannot block a restart indefinitely.
    setTimeout(() => {
      console.error('[shutdown] forced after timeout');
      process.exit(1);
    }, 15_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  console.error('[boot] failed to start', error);
  process.exit(1);
});
