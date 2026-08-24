/**
 * Reporting and reading product usage.
 *
 * Ingest is authenticated. That is not because the events are sensitive —
 * they carry no identity — but because an open write endpoint on a government
 * platform is a free way to fill somebody's database. The role travels from
 * the session; nothing about *which* signed-in person sent the batch is
 * stored, and `usage.record` has no parameter that could carry it.
 */

import { Router } from 'express';
import { z } from 'zod';
import { USAGE_BATCH_LIMIT, USAGE_EVENTS, USAGE_OUTCOMES, USAGE_STEP_MAX_LENGTH } from '@psirs/shared';
import { pool } from '../db/pool';
import { authenticate, requirePermission } from '../middleware/auth';
import { asyncHandler, validateBody, validateQuery } from '../middleware/validate';
import * as usage from '../services/usage';

export const usageRouter = Router();

usageRouter.use(authenticate);

const uuidSchema = z.string().uuid();

const eventSchema = z.object({
  event: z.enum(USAGE_EVENTS),
  occurredAt: z.string().datetime(),
  step: z.string().max(USAGE_STEP_MAX_LENGTH).optional().nullable(),
  outcome: z.enum(USAGE_OUTCOMES).optional().nullable(),
  durationMs: z.number().int().min(0).max(86_400_000).optional().nullable(),
  flowId: uuidSchema.optional().nullable(),
  language: z.enum(['en', 'ha']).optional().nullable(),
  connection: z.enum(['ONLINE', 'LIMITED', 'OFFLINE']).optional().nullable(),
  appVersion: z.string().max(32).optional().nullable(),
  lgaId: uuidSchema.optional().nullable(),
});

/**
 * Report a batch.
 *
 * Answers 202 rather than 200, and the count of what was stored. Telemetry is
 * accepted rather than transacted: a client must never wait on it, retry it
 * into a queue that competes with a payment, or treat a rejection as anything
 * to act on.
 */
usageRouter.post(
  '/',
  validateBody(
    z.object({
      surface: z.enum(['AGENT_PWA', 'PORTAL']),
      events: z.array(eventSchema).max(USAGE_BATCH_LIMIT),
    }),
    async (req, res, data) => {
      const result = await usage.record(pool, {
        surface: data.surface,
        // The role, which is a category of hundreds. Never req.auth.userId:
        // see the migration for why that absence is deliberate.
        role: req.auth?.role ?? null,
        events: data.events,
      });
      res.status(202).json(result);
    },
  ),
);

// ---------------------------------------------------------------------------
// Reading it back.
//
// `report:read:all` rather than a new permission: this is aggregate
// information about the software, of a piece with the other reports, and
// minting a permission per screen is how a role ends up holding forty of them
// and nobody can say what it can do.
// ---------------------------------------------------------------------------

const windowSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

const parseWindow = (data: { from?: string; to?: string }) => ({
  from: data.from ? new Date(data.from) : undefined,
  to: data.to ? new Date(data.to) : undefined,
});

usageRouter.get(
  '/overview',
  requirePermission('report:read:all'),
  validateQuery(windowSchema, async (_req, res, data) => {
    const window = parseWindow(data);
    const [funnels, abandonment, offline, language, reach, screens] = await Promise.all([
      usage.flowFunnels(pool, window),
      usage.abandonmentPoints(pool, window),
      usage.offlineHealth(pool, window),
      usage.languageUse(pool, window),
      usage.reachByLga(pool, window),
      usage.screenReach(pool, window),
    ]);
    res.json({ funnels, abandonment, offline, language, reach, screens });
  }),
);

usageRouter.post(
  '/expire',
  requirePermission('report:read:all'),
  asyncHandler(async (_req, res) => {
    res.json(await usage.expireOldEvents(pool));
  }),
);
