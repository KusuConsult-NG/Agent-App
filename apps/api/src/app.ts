/**
 * Express application assembly.
 *
 * Middleware order matters and is deliberate:
 *   1. security headers and CORS, before anything can respond;
 *   2. request context, so every log line and audit row has a correlation id;
 *   3. the raw-body JSON parser, which keeps the exact bytes a webhook
 *      signature was computed over;
 *   4. routes;
 *   5. the error handler, which turns every failure into the actionable
 *      contract of PRD §60.
 */

import express, { type Express } from 'express';
import { config } from './config';
import { pool } from './db/pool';
import { requestContext } from './middleware/context';
import { cors, payloadGuard, rateLimit, securityHeaders } from './middleware/security';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { authRouter } from './routes/auth';
import { taxpayerRouter, draftRouter } from './routes/taxpayers';
import { revenueRouter } from './routes/revenue';
import {
  paymentRouter,
  webhookRouter,
  receiptRouter,
  documentRouter,
  verificationRouter,
} from './routes/payments';
import { agentRouter } from './routes/agents';
import { refereeRouter } from './routes/referees';
import { vehicleRouter } from './routes/vehicles';
import { governmentRouter, supportRouter } from './routes/government';
import { referenceRouter } from './routes/reference';
import { log } from './lib/logger';
import {
  collectDatabaseGauges,
  metrics,
  render as renderMetrics,
  setPoolGauges,
} from './lib/metrics';
import { citizenRouter } from './routes/citizen';
import { pushRouter } from './routes/push';
import { allocationRouter, groupAttestationRouter, groupRouter } from './routes/groups';

export function createApp(): Express {
  const app = express();

  if (config.security.trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(securityHeaders);
  app.use(cors);
  app.use(requestContext);
  app.use(payloadGuard());

  // One line per completed request, with the correlation id the response
  // carries, so a support ticket quoting a reference can be traced without
  // anyone reading container output by eye.
  app.use((req, res, next) => {
    const startedAt = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      metrics.httpRequest(req.method, res.statusCode);
      // 4xx is the caller being told no, which is routine; 5xx is ours.
      log[res.statusCode >= 500 ? 'error' : 'info']('request', {
        requestId: req.requestId,
        component: 'http',
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Math.round(durationMs),
        role: req.auth?.role ?? null,
      });
    });
    next();
  });

  // The raw body is retained so webhook signatures verify against the exact
  // bytes received. Re-serialising parsed JSON would break verification and
  // could hide a mismatch between what was signed and what was parsed.
  app.use(
    express.json({
      limit: '1mb',
      verify: (req, _res, buf) => {
        (req as express.Request).rawBody = Buffer.from(buf);
      },
    }),
  );

  /**
   * Liveness: is the process itself wedged?
   *
   * Deliberately does not touch the database. An orchestrator restarts a
   * container that fails this, and restarting every replica because Postgres
   * is briefly unreachable turns a database blip into a full outage.
   */
  app.get('/health/live', (_req, res) => {
    res.json({ status: 'ok', service: 'psirs-revenue-platform', uptimeSeconds: Math.floor(process.uptime()) });
  });

  /**
   * Readiness: can this instance actually serve a request?
   *
   * This one does check the database, because an instance that cannot reach it
   * should be taken out of the load balancer rather than restarted.
   */
  app.get('/health/ready', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok', database: 'connected' });
    } catch (error) {
      log.error('readiness check failed', { component: 'health', error });
      res.status(503).json({ status: 'degraded', database: 'unavailable' });
    }
  });

  // The original path, kept because deployments and uptime checks may already
  // point at it. Same behaviour as readiness.
  app.get('/health', async (_req, res) => {
    /*
     * The richer of the three, for an APM probe rather than a load balancer.
     *
     * `database` carries the round-trip time as well as the verdict, because
     * "reachable" and "reachable in 4ms" are different facts and the second one
     * is what tells you a problem is coming. `/health/ready` keeps its flat
     * string shape — a load balancer wants one thing to compare.
     */
    const startedAt = process.hrtime.bigint();
    try {
      await pool.query('SELECT 1');
      const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      res.json({
        status: 'ok',
        service: 'psirs-revenue-platform',
        uptimeSeconds: Math.floor(process.uptime()),
        database: { status: 'connected', latencyMs: Math.round(latencyMs * 100) / 100 },
      });
    } catch {
      const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      res.status(503).json({
        status: 'degraded',
        service: 'psirs-revenue-platform',
        uptimeSeconds: Math.floor(process.uptime()),
        database: { status: 'unavailable', latencyMs: Math.round(latencyMs * 100) / 100 },
      });
    }
  });

  /**
   * Metrics for a scraper.
   *
   * Counters come from this process; the queue depths are read from the
   * database at scrape time, because those are facts about the platform rather
   * than about whichever replica answered.
   */
  app.get('/metrics', async (req, res) => {
    const expected = config.observability.metricsToken;
    if (expected) {
      const provided = req.header('authorization')?.replace(/^Bearer /, '') ?? '';
      // Length-independent comparison is unnecessary here — the token guards
      // operational counters, not money — but constant work costs nothing.
      if (provided !== expected) {
        res.status(401).type('text/plain').send('unauthorised\n');
        return;
      }
    }

    // Pool depth is a fact about this process, so it is recorded even when the
    // database itself cannot be read for the queue gauges below.
    setPoolGauges(pool);

    try {
      await collectDatabaseGauges(pool);
    } catch (error) {
      // Serve the process counters anyway: a database that cannot be read is
      // exactly when an operator most needs whatever is still available.
      log.error('could not collect database gauges', { component: 'metrics', error });
    }

    res.type('text/plain; version=0.0.4').send(renderMetrics());
  });

  const api = express.Router();
  api.use(rateLimit());

  api.use('/auth', authRouter);
  api.use('/taxpayers', taxpayerRouter);
  api.use('/drafts', draftRouter);
  api.use('/revenue', revenueRouter);
  api.use('/payments', paymentRouter);
  api.use('/receipts', receiptRouter);
  api.use('/documents', documentRouter);
  api.use('/agents', agentRouter);
  api.use('/vehicles', vehicleRouter);
  api.use('/government', governmentRouter);
  api.use('/support', supportRouter);
  api.use('/groups', groupRouter);
  api.use('/allocations', allocationRouter);
  api.use('/push', pushRouter);

  // Public, unauthenticated surfaces.
  api.use('/reference', referenceRouter);
  api.use('/verify', verificationRouter);
  api.use('/referee', refereeRouter);
  api.use('/group-attestation', groupAttestationRouter);
  api.use('/webhooks', webhookRouter);
  api.use('/citizen-status', citizenRouter);

  app.use('/api/v1', api);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
