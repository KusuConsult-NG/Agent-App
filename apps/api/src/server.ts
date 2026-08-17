/**
 * Process entry point.
 *
 * Runs pending migrations before accepting traffic, then starts background
 * workers for the jobs PRD §26 and §46 require to happen on a schedule rather
 * than on a request. Shutdown drains in-flight requests before closing the
 * database pool so a payment confirmation is never cut off mid-transaction.
 */

import { createApp } from './app';
import { config } from './config';
import { closePool, pool } from './db/pool';
import { runMigrations } from './db/migrate';
import { promoteEligibleCommissions } from './services/commission';
import { dispatchQueued } from './services/notifications';
import { runFraudSweep } from './services/fraud';
import { withTransaction } from './db/pool';

const WORKER_INTERVALS = {
  commissionPromotion: 5 * 60_000,
  notificationDispatch: 30_000,
  fraudSweep: 15 * 60_000,
};

async function main(): Promise<void> {
  console.log(`[boot] Plateau State Revenue Platform API (${config.env})`);

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
