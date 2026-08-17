/** Agent application, clearance, devices, commission and field endpoints. */

import { Router, type Request } from 'express';
import { z } from 'zod';
import { REFEREE_CATEGORIES, serialiseKobo } from '@psirs/shared';
import { pool, query, queryOne } from '../db/pool';
import { config } from '../config';
import {
  authenticate,
  compareVersions,
  requireActiveAgent,
  requirePermission,
  requireStepUp,
} from '../middleware/auth';
import { rateLimit } from '../middleware/security';
import { asyncHandler, emailSchema, phoneSchema, uuidSchema, validateBody, validateQuery } from '../middleware/validate';
import { forbidden, notFound } from '../lib/errors';
import * as agents from '../services/agents';
import * as referees from '../services/referees';
import * as commission from '../services/commission';
import { agentPerformance, agentToday } from '../services/reports';

export const agentRouter = Router();

// ---------------------------------------------------------------------------
// Public application intake (Addendum §3) — no account exists yet
// ---------------------------------------------------------------------------

agentRouter.post(
  '/apply',
  rateLimit({
    max: config.security.agentApplyRateLimitMax,
    windowMs: 3_600_000,
    keyPrefix: 'agent-apply',
  }),
  validateBody(
    z.object({
      fullName: z.string().min(3).max(150),
      phone: phoneSchema,
      email: emailSchema.optional(),
      password: z
        .string()
        .min(8, 'Your password must be at least 8 characters')
        .regex(/[0-9]/, 'Include at least one number')
        .regex(/[a-zA-Z]/, 'Include at least one letter'),
      dateOfBirth: z.string().date().optional(),
      gender: z.enum(['MALE', 'FEMALE', 'UNSPECIFIED']).optional(),
      alternatePhone: phoneSchema.optional(),
      address: z.string().min(5).max(300),
      lgaId: uuidSchema,
      wardId: uuidSchema.optional(),
      community: z.string().max(120).optional(),
      occupation: z.string().max(120).optional(),
      previousOccupation: z.string().max(120).optional(),
      bankName: z.string().min(2).max(100),
      bankCode: z.string().max(10).optional(),
      accountName: z.string().min(3).max(150),
      accountNumber: z.string().regex(/^\d{10}$/, 'Nigerian account numbers are 10 digits'),
    }),
    async (req, res, data) => {
      const result = await agents.submitApplication({ input: data, ipAddress: req.clientIp });
      res.status(201).json({
        ...result,
        message:
          'Application received. Complete identity verification and nominate a referee to continue.',
      });
    },
  ),
);

agentRouter.use(authenticate);

// ---------------------------------------------------------------------------
// The applicant's own view of their application (Addendum §25, §27)
// ---------------------------------------------------------------------------

/** Resolve the agent record belonging to the caller, never one passed in. */
async function ownAgentId(req: Request): Promise<string> {
  const agent = await queryOne<{ id: string }>(pool, 'SELECT id FROM agents WHERE user_id = $1', [
    req.auth!.userId,
  ]);
  if (!agent) throw notFound('An agent profile for this account');
  return agent.id;
}

agentRouter.get(
  '/me/application',
  asyncHandler(async (req, res) => {
    const agentId = await ownAgentId(req);
    res.json(await agents.getApplicationStatus(pool, agentId));
  }),
);

agentRouter.post(
  '/me/kyc',
  validateBody(
    z.object({
      identityType: z.enum(['NIN', 'BVN', 'PASSPORT', 'DRIVERS_LICENCE', 'VOTERS_CARD', 'OTHER']),
      identityNumber: z.string().min(5).max(30),
      selfieDocumentId: uuidSchema.optional(),
    }),
    async (req, res, data) => {
      const agentId = await ownAgentId(req);
      const result = await agents.submitKyc({
        agentId,
        actorId: req.auth!.userId,
        identityType: data.identityType,
        identityNumber: data.identityNumber,
        selfieDocumentId: data.selfieDocumentId ?? null,
        ipAddress: req.clientIp,
      });
      res.json(result);
    },
  ),
);

agentRouter.post(
  '/me/referees',
  validateBody(
    z.object({
      fullName: z.string().min(3).max(150),
      phone: phoneSchema,
      email: emailSchema.optional(),
      address: z.string().max(300).optional(),
      occupation: z.string().max(120).optional(),
      category: z.enum(REFEREE_CATEGORIES),
      relationship: z.string().min(3).max(120),
      replacesRefereeId: uuidSchema.optional(),
    }),
    async (req, res, data) => {
      const agentId = await ownAgentId(req);
      const result = await referees.nominateReferee({
        agentId,
        input: data,
        actorId: req.auth!.userId,
        replacesRefereeId: data.replacesRefereeId ?? null,
        ipAddress: req.clientIp,
      });

      // The plaintext token is returned once so the client can show or resend
      // the link; only its hash is stored.
      res.status(201).json({
        refereeId: result.refereeId,
        referenceCode: result.referenceCode,
        invitationUrl: result.invitationUrl,
        expiresAt: result.expiresAt,
        message: `A verification request has been sent to ${data.fullName}.`,
      });
    },
  ),
);

agentRouter.post(
  '/me/training/:moduleCode',
  validateBody(
    z.object({ score: z.number().int().min(0).max(100).optional() }),
    async (req, res, data) => {
      const agentId = await ownAgentId(req);
      const result = await agents.completeTrainingModule({
        agentId,
        moduleCode: req.params.moduleCode,
        score: data.score,
        actorId: req.auth!.userId,
      });
      res.json(result);
    },
  ),
);

agentRouter.get(
  '/me/training',
  asyncHandler(async (req, res) => {
    const agentId = await ownAgentId(req);
    res.json(
      await query(
        pool,
        `SELECT m.code, m.title, m.content, m.sequence_no, m.assessed, m.pass_mark, m.mandatory,
                COALESCE(p.status,'NOT_STARTED') AS status, p.score, p.attempts, p.completed_at
           FROM training_modules m
           LEFT JOIN agent_training_progress p ON p.module_id = m.id AND p.agent_id = $1
          WHERE m.status = 'ACTIVE' ORDER BY m.sequence_no`,
        [agentId],
      ),
    );
  }),
);

agentRouter.get(
  '/agreement',
  asyncHandler(async (_req, res) => {
    const agreement = await queryOne(
      pool,
      `SELECT version, title, body, effective_from FROM agreement_versions
        WHERE status = 'ACTIVE' ORDER BY effective_from DESC LIMIT 1`,
    );
    if (!agreement) throw notFound('An active agent agreement');
    res.json(agreement);
  }),
);

agentRouter.post(
  '/me/agreement',
  validateBody(z.object({ version: z.string().min(1) }), async (req, res, data) => {
    const agentId = await ownAgentId(req);
    await agents.acceptAgreement({
      agentId,
      agreementVersion: data.version,
      actorId: req.auth!.userId,
      ipAddress: req.clientIp,
      deviceIdentifier: req.deviceIdentifier,
      userAgent: req.header('user-agent') ?? null,
    });
    res.json({ accepted: true });
  }),
);

agentRouter.post(
  '/me/bank/verify',
  asyncHandler(async (req, res) => {
    const agentId = await ownAgentId(req);
    res.json(await agents.verifyBankAccount({ agentId, actorId: req.auth!.userId }));
  }),
);

agentRouter.post(
  '/me/devices',
  validateBody(
    z.object({
      deviceIdentifier: z.string().min(8).max(128),
      deviceName: z.string().max(120).optional(),
      browser: z.string().max(120).optional(),
      operatingSystem: z.string().max(120).optional(),
      pwaVersion: z.string().max(32).optional(),
    }),
    async (req, res, data) => {
      const agentId = await ownAgentId(req);
      const result = await agents.registerDevice({
        agentId,
        ...data,
        actorId: req.auth!.userId,
        ipAddress: req.clientIp,
      });
      res.status(201).json({
        ...result,
        message:
          result.status === 'PENDING'
            ? 'Device registered and awaiting approval by your supervisor.'
            : 'Device registered and active.',
      });
    },
  ),
);

/** PWA version gate (Addendum §43). Callable before any transaction. */
agentRouter.get(
  '/app-version',
  asyncHandler(async (req, res) => {
    const row = await queryOne<{ minimum_version: string; recommended_version: string; notes: string | null }>(
      pool,
      `SELECT minimum_version, recommended_version, notes FROM app_versions
        WHERE app = 'AGENT_PWA' AND effective_from <= now()
        ORDER BY effective_from DESC LIMIT 1`,
    );

    const minimum = row?.minimum_version ?? config.pwa.minimumAgentVersion;
    const recommended = row?.recommended_version ?? config.pwa.recommendedAgentVersion;
    const current = req.appVersion;
    const supported = current !== null && compareVersions(current, minimum) >= 0;

    res.json({
      currentVersion: current,
      minimumVersion: minimum,
      recommendedVersion: recommended,
      supported,
      updateRequired: !supported,
      notes: row?.notes ?? null,
      message: supported
        ? 'This version is supported.'
        : 'This version is no longer supported for transactions. Update before collecting revenue.',
    });
  }),
);

// ---------------------------------------------------------------------------
// Field operations (PRD §29, §56)
// ---------------------------------------------------------------------------

agentRouter.get(
  '/me/home',
  requireActiveAgent({ requireDevice: false }),
  asyncHandler(async (req, res) => {
    const agentId = req.agent?.agentId ?? (await ownAgentId(req));
    res.json(await agentToday(pool, agentId));
  }),
);

agentRouter.get(
  '/me/transactions',
  requirePermission('payment:read:own'),
  validateQuery(
    z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }),
    async (req, res, data) => {
      const agentId = await ownAgentId(req);
      res.json(
        await query(
          pool,
          `SELECT t.transaction_reference, t.amount_kobo, t.status, t.created_at, t.verified_at,
                  ri.name AS revenue_item,
                  COALESCE(tp.business_name, tp.first_name || ' ' || tp.last_name) AS taxpayer_name,
                  tp.tin, r.receipt_number, r.id AS receipt_id
             FROM transactions t
             JOIN revenue_items ri ON ri.id = t.revenue_item_id
             JOIN taxpayers tp ON tp.id = t.taxpayer_id
             LEFT JOIN receipts r ON r.transaction_id = t.id
            WHERE t.agent_id = $1 ORDER BY t.created_at DESC LIMIT $2`,
          [agentId, data.limit],
        ),
      );
    },
  ),
);

// ---------------------------------------------------------------------------
// Commission wallet (PRD §27, §28)
// ---------------------------------------------------------------------------

agentRouter.get(
  '/me/commission',
  requirePermission('commission:read:own'),
  asyncHandler(async (req, res) => {
    const agentId = await ownAgentId(req);
    const [wallet, entries] = await Promise.all([
      commission.getWallet(pool, agentId),
      query(
        pool,
        `SELECT c.id, c.amount_kobo, c.rate_basis_points, c.basis_amount_kobo, c.status,
                c.eligible_at, c.paid_at, c.reversal_reason,
                t.transaction_reference, ri.name AS revenue_item, t.created_at
           FROM commissions c
           JOIN transactions t ON t.id = c.transaction_id
           JOIN revenue_items ri ON ri.id = t.revenue_item_id
          WHERE c.agent_id = $1 ORDER BY c.created_at DESC LIMIT 100`,
        [agentId],
      ),
    ]);

    res.json({
      wallet,
      entries,
      note:
        'This wallet records commission owed to you. It never holds government revenue, ' +
        'and money cannot be withdrawn from it directly.',
    });
  }),
);

agentRouter.post(
  '/me/commission/payout',
  requirePermission('commission:payout:request'),
  requireStepUp('commission.payout.request'),
  asyncHandler(async (req, res) => {
    const agentId = await ownAgentId(req);
    const result = await commission.requestPayout({
      agentId,
      actorId: req.auth!.userId,
      actorRole: req.auth!.role,
    });
    res.status(201).json({
      ...result,
      amountKobo: serialiseKobo(result.amountKobo),
      message: 'Payout requested. It will be paid after finance approval.',
    });
  }),
);

// ---------------------------------------------------------------------------
// Government administration of agents
// ---------------------------------------------------------------------------

agentRouter.get(
  '/',
  requirePermission('agent:read:all', 'agent:read:assigned'),
  validateQuery(
    z.object({
      status: z.string().optional(),
      clearanceStatus: z.string().optional(),
      lgaId: uuidSchema.optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }),
    async (_req, res, data) => {
      res.json(
        await query(
          pool,
          `SELECT a.id, a.agent_code, a.application_number, u.full_name, u.phone, u.email,
                  a.account_status, a.kyc_status, a.referee_status, a.training_status,
                  a.clearance_status, a.operational_status, l.name AS lga,
                  ter.name AS territory, a.activated_at, a.created_at
             FROM agents a
             JOIN users u ON u.id = a.user_id
             LEFT JOIN lgas l ON l.id = a.lga_id
             LEFT JOIN territories ter ON ter.id = a.territory_id
            WHERE ($1::text IS NULL OR a.operational_status = $1)
              AND ($2::text IS NULL OR a.clearance_status = $2)
              AND ($3::uuid IS NULL OR a.lga_id = $3)
            ORDER BY a.created_at DESC LIMIT $4`,
          [data.status ?? null, data.clearanceStatus ?? null, data.lgaId ?? null, data.limit],
        ),
      );
    },
  ),
);

agentRouter.get(
  '/kyc-dashboard',
  requirePermission('agent:read:all'),
  validateQuery(z.object({ lgaId: uuidSchema.optional() }), async (_req, res, data) => {
    res.json(await agents.kycDashboard(pool, data));
  }),
);

agentRouter.get(
  '/referee-dashboard',
  requirePermission('agent:read:all'),
  asyncHandler(async (_req, res) => {
    res.json(await referees.refereeDashboard(pool));
  }),
);

agentRouter.get(
  '/performance',
  requirePermission('report:read:all', 'report:read:territory'),
  validateQuery(
    z.object({ agentId: uuidSchema.optional(), limit: z.coerce.number().int().max(200).default(50) }),
    async (_req, res, data) => {
      res.json(await agentPerformance(pool, data));
    },
  ),
);

agentRouter.get(
  '/:id',
  requirePermission('agent:read:all', 'agent:read:assigned'),
  asyncHandler(async (req, res) => {
    res.json(await agents.getApplicationStatus(pool, req.params.id));
  }),
);

agentRouter.post(
  '/:id/review',
  requirePermission('agent:approve', 'agent:manage'),
  validateBody(
    z.object({
      decision: z.enum(['APPROVE', 'REJECT', 'REQUEST_INFO']),
      reason: z.string().min(10, 'Give a clear reason for this decision'),
    }),
    async (req, res, data) => {
      const result = await agents.reviewApplication({
        agentId: req.params.id,
        decision: data.decision,
        reason: data.reason,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
      });
      res.json(result);
    },
  ),
);

agentRouter.post(
  '/:id/activate',
  requirePermission('agent:manage', 'agent:approve'),
  validateBody(
    z.object({
      territoryId: uuidSchema.optional(),
      supervisorId: uuidSchema.optional(),
      overrideApprovalId: uuidSchema.optional(),
    }),
    async (req, res, data) => {
      const result = await agents.activate({
        agentId: req.params.id,
        territoryId: data.territoryId ?? null,
        supervisorId: data.supervisorId ?? null,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        overrideApprovalId: data.overrideApprovalId ?? null,
      });
      res.json(result);
    },
  ),
);

agentRouter.post(
  '/:id/suspend',
  requirePermission('agent:suspend'),
  requireStepUp('agent.suspend'),
  validateBody(
    z.object({ reason: z.string().min(10, 'Give a reason for the suspension') }),
    async (req, res, data) => {
      await agents.suspend({
        agentId: req.params.id,
        reason: data.reason,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
      });
      res.json({ suspended: true, message: 'The agent has been suspended and signed out.' });
    },
  ),
);

agentRouter.post(
  '/:id/territory',
  requirePermission('agent:assign_territory'),
  validateBody(
    z.object({ territoryId: uuidSchema, supervisorId: uuidSchema.optional() }),
    async (req, res, data) => {
      // PRD §74: reassigning a territory never rewrites historical attribution;
      // transactions keep the territory they were collected under.
      const { withTransaction } = await import('../db/pool');
      const { recordAudit } = await import('../services/audit');

      await withTransaction(async (client) => {
        const previous = await queryOne<{ territory_id: string | null }>(
          client,
          'SELECT territory_id FROM agents WHERE id = $1',
          [req.params.id],
        );
        if (!previous) throw notFound('That agent');

        await client.query(
          'UPDATE agents SET territory_id = $2, supervisor_id = COALESCE($3, supervisor_id) WHERE id = $1',
          [req.params.id, data.territoryId, data.supervisorId ?? null],
        );

        await recordAudit(client, {
          actorId: req.auth!.userId,
          actorRole: req.auth!.role,
          action: 'agent.territory_assigned',
          entityType: 'agent',
          entityId: req.params.id,
          oldValue: { territoryId: previous.territory_id },
          newValue: { territoryId: data.territoryId },
        });
      });

      res.json({ assigned: true });
    },
  ),
);

agentRouter.post(
  '/devices/:deviceId/revoke',
  requirePermission('device:manage', 'agent:manage'),
  validateBody(
    z.object({ reason: z.string().min(5, 'Give a reason for revoking the device') }),
    async (req, res, data) => {
      await agents.revokeDevice({
        deviceId: req.params.deviceId,
        reason: data.reason,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
      });
      res.json({ revoked: true, message: 'The device has been revoked and its sessions ended.' });
    },
  ),
);

agentRouter.post(
  '/devices/:deviceId/approve',
  requirePermission('device:manage', 'agent:manage'),
  asyncHandler(async (req, res) => {
    const device = await queryOne<{ id: string; status: string }>(
      pool,
      'SELECT id, status FROM agent_devices WHERE id = $1',
      [req.params.deviceId],
    );
    if (!device) throw notFound('That device');
    if (device.status === 'REVOKED') {
      throw forbidden('A revoked device cannot be approved again.');
    }

    await pool.query(
      `UPDATE agent_devices SET status = 'ACTIVE', approved_at = now(), approved_by = $2 WHERE id = $1`,
      [req.params.deviceId, req.auth!.userId],
    );
    res.json({ approved: true });
  }),
);

agentRouter.post(
  '/referees/:refereeId/review',
  requirePermission('agent:approve', 'agent:manage'),
  validateBody(
    z.object({
      decision: z.enum(['CLEAR', 'REJECT']),
      reason: z.string().min(10, 'Give a reason for this decision'),
    }),
    async (req, res, data) => {
      await referees.reviewReferee({
        refereeId: req.params.refereeId,
        decision: data.decision,
        reason: data.reason,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
      });
      res.json({ reviewed: true });
    },
  ),
);
