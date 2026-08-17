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

export function createApp(): Express {
  const app = express();

  if (config.security.trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(securityHeaders);
  app.use(cors);
  app.use(requestContext);
  app.use(payloadGuard());

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

  app.get('/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok', service: 'psirs-revenue-platform', database: 'connected' });
    } catch {
      res.status(503).json({ status: 'degraded', database: 'unavailable' });
    }
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

  // Public, unauthenticated surfaces.
  api.use('/reference', referenceRouter);
  api.use('/verify', verificationRouter);
  api.use('/referee', refereeRouter);
  api.use('/webhooks', webhookRouter);

  app.use('/api/v1', api);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
