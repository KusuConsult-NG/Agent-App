/**
 * Informal-sector groups, their attestation, and benefit allocation.
 *
 * Three audiences share this file, which is why the guards differ so much
 * between routes. Agents register groups and record who says they belong,
 * because that happens in a market or a village and nowhere else. Officers
 * decide whether a group is real and spend the finite resource. And the
 * group's leader — who has no account and should not need one — answers a
 * tokenised link, exactly as a referee does.
 */

import { Router } from 'express';
import { z } from 'zod';
import { ECONOMIC_SECTOR_CODES } from '@psirs/shared';
import { config } from '../config';
import { pool } from '../db/pool';
import { authenticate, requirePermission } from '../middleware/auth';
import { rateLimit } from '../middleware/security';
import { asyncHandler, uuidSchema, validateBody, validateQuery } from '../middleware/validate';
import * as groups from '../services/groups';
import * as allocations from '../services/allocations';

export const groupRouter = Router();

/**
 * The leader's surface, before `authenticate`.
 *
 * Unauthenticated by design and rate limited by address rather than by caller:
 * the token is the authorisation, and this is a public surface where the cap
 * exists to make guessing expensive for whoever is at the other end.
 */
export const groupAttestationRouter = Router();
groupAttestationRouter.use(
  rateLimit({
    max: config.security.groupAttestationRateLimitMax,
    windowMs: 60_000,
    keyPrefix: 'group-attestation',
    keyBy: 'ip',
  }),
);

groupAttestationRouter.get(
  '/:token',
  asyncHandler(async (req, res) => {
    res.json(await groups.openAttestation(pool, req.params.token));
  }),
);

groupAttestationRouter.post(
  '/:token/confirm',
  validateBody(
    z.object({
      confirmedMemberIds: z.array(uuidSchema).max(1000).default([]),
      rejectedMemberIds: z.array(uuidSchema).max(1000).default([]),
      rejectionReason: z.string().max(500).optional(),
    }),
    async (req, res, data) => {
      const result = await groups.submitAttestation({
        token: req.params.token,
        confirmedMemberIds: data.confirmedMemberIds,
        rejectedMemberIds: data.rejectedMemberIds,
        rejectionReason: data.rejectionReason ?? null,
      });
      res.json({
        ...result,
        message:
          `Thank you. ${result.attested} membership(s) confirmed` +
          (result.rejected > 0 ? ` and ${result.rejected} not confirmed.` : '.'),
      });
    },
  ),
);

// ---------------------------------------------------------------------------
// Everything below needs an account.
// ---------------------------------------------------------------------------

groupRouter.use(authenticate);

groupRouter.post(
  '/',
  requirePermission('group:register', 'group:manage'),
  validateBody(
    z.object({
      name: z.string().min(3).max(150),
      groupType: z.enum([
        'FARMERS_COOPERATIVE',
        'MARKET_ASSOCIATION',
        'TRANSPORT_UNION',
        'ARTISAN_GUILD',
        'TRADERS_ASSOCIATION',
        'FISHERIES_GROUP',
        'LIVESTOCK_ASSOCIATION',
        'OTHER',
      ]),
      economicSector: z.enum(ECONOMIC_SECTOR_CODES).optional(),
      lgaId: uuidSchema,
      wardId: uuidSchema.optional(),
      community: z.string().max(120).optional(),
      leaderTaxpayerId: uuidSchema.optional(),
      leaderName: z.string().min(3).max(150),
      leaderPhone: z.string().min(8).max(20),
      memberEstimate: z.number().int().min(1).max(100_000).optional(),
    }),
    async (req, res, data) => {
      const result = await groups.registerGroup({
        input: data,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
      });
      res.status(201).json({
        ...result,
        message:
          'Group recorded. An officer has to approve it before members can be added.',
      });
    },
  ),
);

groupRouter.get(
  '/',
  requirePermission('group:read:all'),
  validateQuery(
    z.object({
      status: z.enum(['PENDING', 'ACTIVE', 'SUSPENDED']).optional(),
      lgaId: uuidSchema.optional(),
      sector: z.enum(ECONOMIC_SECTOR_CODES).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(100),
    }),
    async (_req, res, data) => {
      res.json({ groups: await groups.listGroups(pool, data) });
    },
  ),
);

groupRouter.get(
  '/:id',
  requirePermission('group:read:all'),
  asyncHandler(async (req, res) => {
    res.json(await groups.groupDetail(pool, req.params.id));
  }),
);

groupRouter.post(
  '/:id/review',
  requirePermission('group:manage'),
  validateBody(
    z.object({
      decision: z.enum(['APPROVE', 'SUSPEND']),
      reason: z.string().min(10, 'Record why this decision was made'),
    }),
    async (req, res, data) => {
      const result = await groups.reviewGroup({
        groupId: req.params.id,
        decision: data.decision,
        reason: data.reason,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
      });
      res.json(result);
    },
  ),
);

groupRouter.post(
  '/:id/members',
  requirePermission('group:register', 'group:manage'),
  validateBody(
    z.object({
      taxpayerId: uuidSchema,
      memberReference: z.string().max(60).optional(),
      joinedOn: z.string().date().optional(),
    }),
    async (req, res, data) => {
      const result = await groups.addMember({
        groupId: req.params.id,
        taxpayerId: data.taxpayerId,
        memberReference: data.memberReference ?? null,
        joinedOn: data.joinedOn ?? null,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
      });
      res.status(201).json({
        ...result,
        message:
          'Recorded. The membership counts only once the group leader has confirmed it.',
      });
    },
  ),
);

groupRouter.post(
  '/:id/attestation-request',
  requirePermission('group:manage', 'group:register'),
  asyncHandler(async (req, res) => {
    const result = await groups.inviteLeaderToAttest({
      groupId: req.params.id,
      actorId: req.auth!.userId,
      actorRole: req.auth!.role,
    });
    // The plaintext token is returned once so the caller can send or re-send
    // the link; only its hash is stored.
    res.status(201).json({
      ...result,
      message: 'Send this link to the group leader to confirm the membership list.',
    });
  }),
);

// ---------------------------------------------------------------------------
// Allocation rounds and awards
// ---------------------------------------------------------------------------

export const allocationRouter = Router();
allocationRouter.use(authenticate);

allocationRouter.post(
  '/rounds',
  requirePermission('allocation:manage'),
  validateBody(
    z.object({
      programmeId: uuidSchema,
      name: z.string().min(3).max(150),
      unit: z.enum(['BAG_50KG', 'BAG_25KG', 'LITRE', 'KILOGRAM', 'TRACTOR_DAY', 'SEEDLING', 'UNIT']),
      totalQuantity: z.number().positive().max(10_000_000),
      quantityPerBeneficiary: z.number().positive().max(10_000),
      collectionPoint: z.string().max(200).optional(),
      opensAt: z.string().datetime(),
      closesAt: z.string().datetime().optional(),
    }),
    async (req, res, data) => {
      const result = await allocations.createRound({
        input: data,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
      });
      res.status(201).json(result);
    },
  ),
);

allocationRouter.get(
  '/rounds',
  requirePermission('allocation:read:all', 'allocation:collect'),
  validateQuery(
    z.object({
      programmeId: uuidSchema.optional(),
      limit: z.coerce.number().int().min(1).max(200).default(100),
    }),
    async (_req, res, data) => {
      res.json({ rounds: await allocations.listRounds(pool, data) });
    },
  ),
);

allocationRouter.post(
  '/rounds/:id/status',
  requirePermission('allocation:manage'),
  validateBody(
    z.object({ status: z.enum(['DRAFT', 'OPEN', 'CLOSED']) }),
    async (req, res, data) => {
      res.json(
        await allocations.setRoundStatus({
          roundId: req.params.id,
          status: data.status,
          actorId: req.auth!.userId,
          actorRole: req.auth!.role,
        }),
      );
    },
  ),
);

allocationRouter.get(
  '/rounds/:id',
  requirePermission('allocation:read:all', 'allocation:collect'),
  asyncHandler(async (req, res) => {
    res.json(await allocations.roundSummary(pool, req.params.id));
  }),
);

allocationRouter.get(
  '/rounds/:id/awards',
  requirePermission('allocation:read:all'),
  validateQuery(
    z.object({
      status: z.enum(['AWARDED', 'COLLECTED', 'FORFEITED']).optional(),
      limit: z.coerce.number().int().min(1).max(500).default(200),
    }),
    async (req, res, data) => {
      res.json({ awards: await allocations.listAwards(pool, req.params.id, data) });
    },
  ),
);

allocationRouter.post(
  '/rounds/:id/awards',
  requirePermission('allocation:manage'),
  validateBody(z.object({ taxpayerId: uuidSchema }), async (req, res, data) => {
    const result = await allocations.awardTo({
      roundId: req.params.id,
      taxpayerId: data.taxpayerId,
      actorId: req.auth!.userId,
      actorRole: req.auth!.role,
    });
    res.status(201).json({
      ...result,
      message: `Give the beneficiary this code to collect: ${result.collectionCode}`,
    });
  }),
);

/** At the collection point: somebody presents their code and takes their share. */
allocationRouter.post(
  '/collections',
  requirePermission('allocation:collect', 'allocation:manage'),
  validateBody(
    z.object({ collectionCode: z.string().min(4).max(20) }),
    async (req, res, data) => {
      const result = await allocations.recordCollection({
        collectionCode: data.collectionCode,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
      });
      res.json({
        ...result,
        message: `${result.taxpayerName} collected ${result.quantity} ${result.unit}.`,
      });
    },
  ),
);
