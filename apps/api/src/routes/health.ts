/**
 * Health Check and Prometheus Metrics Routes.
 */

import { Router } from 'express';
import { telemetry } from '../services/telemetry';

export const healthRouter = Router();

healthRouter.get('/health', async (_req, res) => {
  const summary = await telemetry.getHealthSummary();
  const statusCode = summary.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(summary);
});

healthRouter.get('/metrics', async (_req, res) => {
  const prometheusText = await telemetry.getPrometheusMetrics();
  res.setHeader('content-type', 'text/plain; version=0.0.4; charset=utf-8');
  res.send(prometheusText);
});
