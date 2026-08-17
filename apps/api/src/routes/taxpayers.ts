/** Taxpayer registration, search, profile and offline draft sync. */

import { Router } from 'express';
import { z } from 'zod';
import { pool, queryOne, withTransaction, query } from '../db/pool';
import { authenticate, requireActiveAgent, requirePermission } from '../middleware/auth';
import { idempotent } from '../middleware/idempotency';
import { asyncHandler, emailSchema, phoneSchema, uuidSchema, validateBody, validateQuery } from '../middleware/validate';
import { badRequest, forbidden } from '../lib/errors';
import * as taxpayers from '../services/taxpayers';
import { evaluateRegistrationRisk } from '../services/fraud';
import { getTaxpayerIncentives } from '../services/incentives';
import { queueNotification } from '../services/notifications';

export const taxpayerRouter = Router();

taxpayerRouter.use(authenticate);

const taxpayerInputSchema = z
  .object({
    taxpayerType: z.enum(['INDIVIDUAL', 'BUSINESS']),
    firstName: z.string().min(2).max(80).optional(),
    middleName: z.string().max(80).optional(),
    lastName: z.string().min(2).max(80).optional(),
    dateOfBirth: z.string().date().optional(),
    gender: z.enum(['MALE', 'FEMALE', 'UNSPECIFIED']).optional(),
    businessName: z.string().min(2).max(200).optional(),
    businessType: z.string().max(100).optional(),
    registrationNumber: z.string().max(60).optional(),
    natureOfBusiness: z.string().max(200).optional(),
    phone: phoneSchema,
    alternatePhone: phoneSchema.optional(),
    email: emailSchema.optional(),
    address: z.string().min(5).max(300),
    lgaId: uuidSchema,
    wardId: uuidSchema.optional(),
    community: z.string().max(120).optional(),
    occupation: z.string().max(120).optional(),
    businessActivity: z.string().max(200).optional(),
    identityType: z.enum(['NIN', 'BVN', 'PASSPORT', 'DRIVERS_LICENCE', 'VOTERS_CARD', 'OTHER']).optional(),
    identityNumber: z.string().min(5).max(30).optional(),
    consentGiven: z.boolean(),
    declarationAccepted: z.boolean(),
    existingTin: z.string().max(30).optional(),
    acknowledgeDuplicates: z.boolean().default(false),
  })
  .refine(
    (value) =>
      value.taxpayerType === 'BUSINESS'
        ? Boolean(value.businessName)
        : Boolean(value.firstName && value.lastName),
    { message: 'Provide a business name for a business, or a first and last name for an individual' },
  );

/** Check for duplicates before registering (PRD §11). */
taxpayerRouter.post(
  '/duplicate-check',
  requirePermission('taxpayer:create'),
  validateBody(
    z.object({
      taxpayerType: z.enum(['INDIVIDUAL', 'BUSINESS']),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      businessName: z.string().optional(),
      phone: phoneSchema,
      lgaId: uuidSchema,
      identityNumber: z.string().optional(),
    }),
    async (_req, res, data) => {
      const matches = await taxpayers.findPotentialDuplicates(pool, data);
      res.json({
        possibleDuplicates: matches,
        blocking: matches.some((match) => match.score >= 100),
        message:
          matches.length === 0
            ? 'No existing taxpayer matches these details.'
            : 'Possible existing taxpayer found. Review before creating a new record.',
      });
    },
  ),
);

taxpayerRouter.post(
  '/',
  requirePermission('taxpayer:create'),
  requireActiveAgent(),
  idempotent('taxpayer.create'),
  validateBody(taxpayerInputSchema, async (req, res, data) => {
    const result = await taxpayers.registerTaxpayer({
      input: data,
      actorId: req.auth!.userId,
      actorRole: req.auth!.role,
      agentId: req.agent?.agentId ?? null,
      source: req.auth!.role === 'agent' ? 'AGENT' : 'SELF_SERVICE',
      acknowledgeDuplicates: data.acknowledgeDuplicates,
      ipAddress: req.clientIp,
      deviceId: req.agent?.deviceId ?? null,
    });

    await withTransaction(async (client) => {
      await evaluateRegistrationRisk(client, {
        taxpayerId: result.taxpayerId,
        agentId: req.agent?.agentId ?? null,
        phone: data.phone,
      });
      if (result.tin) {
        await queueNotification(client, {
          event: 'TIN_CREATED',
          taxpayerId: result.taxpayerId,
          variables: { tin: result.tin },
          entityType: 'taxpayer',
          entityId: result.taxpayerId,
        });
      }
    });

    res.status(201).json(result);
  }),
);

taxpayerRouter.post(
  '/:id/tin',
  requirePermission('taxpayer:create', 'taxpayer:update'),
  asyncHandler(async (req, res) => {
    const result = await taxpayers.requestTin({
      taxpayerId: req.params.id,
      actorId: req.auth!.userId,
      actorRole: req.auth!.role,
    });
    res.json(result);
  }),
);

taxpayerRouter.get(
  '/search',
  requirePermission('taxpayer:read:assigned', 'taxpayer:read:all'),
  validateQuery(
    z.object({
      q: z.string().max(120).optional(),
      tin: z.string().max(30).optional(),
      phone: z.string().max(20).optional(),
      vehicleRegistration: z.string().max(20).optional(),
      receiptNumber: z.string().max(40).optional(),
      transactionReference: z.string().max(40).optional(),
      lgaId: uuidSchema.optional(),
      limit: z.coerce.number().int().min(1).max(100).default(25),
    }),
    async (req, res, data) => {
      if (!Object.values(data).some((value) => typeof value === 'string' && value.length > 0)) {
        throw badRequest('Enter something to search for — a name, phone number, TIN or reference.');
      }
      res.json(await taxpayers.searchTaxpayers(pool, data));
    },
  ),
);

taxpayerRouter.get(
  '/:id',
  requirePermission('taxpayer:read:own', 'taxpayer:read:assigned', 'taxpayer:read:all'),
  asyncHandler(async (req, res) => {
    // A taxpayer may only read their own record.
    if (req.auth!.role === 'taxpayer' && req.auth!.taxpayerId !== req.params.id) {
      throw forbidden('You can only view your own taxpayer record.');
    }

    // The agent's own record is resolved server-side; an agent cannot widen
    // their view by naming a different agent id.
    const agentId =
      req.auth!.role === 'agent'
        ? ((
            await queryOne<{ id: string }>(pool, 'SELECT id FROM agents WHERE user_id = $1', [
              req.auth!.userId,
            ])
          )?.id ?? null)
        : null;

    res.json(
      await taxpayers.getTaxpayerProfile(pool, req.params.id, {
        role: req.auth!.role,
        agentId,
      }),
    );
  }),
);

taxpayerRouter.get(
  '/:id/incentives',
  requirePermission('incentive:read:own', 'incentive:read:all'),
  asyncHandler(async (req, res) => {
    if (req.auth!.role === 'taxpayer' && req.auth!.taxpayerId !== req.params.id) {
      throw forbidden('You can only view your own incentives.');
    }
    res.json(await getTaxpayerIncentives(pool, req.params.id));
  }),
);

// ---------------------------------------------------------------------------
// Offline draft sync (PRD §30, Addendum §23)
// ---------------------------------------------------------------------------

export const draftRouter = Router();

draftRouter.use(authenticate);

/**
 * Accept drafts captured without connectivity.
 *
 * Only non-financial work can arrive this way — the draft type enum has no
 * payment member, so an offline device cannot queue a payment at all
 * (Addendum §23 financial rule). Server ids are assigned on sync (PRD §30).
 */
draftRouter.post(
  '/sync',
  requirePermission('taxpayer:create'),
  requireActiveAgent({ requireDevice: false }),
  validateBody(
    z.object({
      drafts: z
        .array(
          z.object({
            clientReference: z.string().min(6).max(120),
            draftType: z.enum([
              'TAXPAYER_REGISTRATION',
              'SERVICE_REQUEST',
              'VEHICLE_CAPTURE',
              'DOCUMENT_CAPTURE',
            ]),
            payload: z.record(z.unknown()),
            capturedAt: z.string().datetime(),
          }),
        )
        .max(50),
    }),
    async (req, res, data) => {
      const agentId = req.agent?.agentId ?? req.auth!.agentId;
      if (!agentId) throw forbidden('Only agents can synchronise offline drafts.');

      const results: {
        clientReference: string;
        status: string;
        entityType?: string;
        entityId?: string;
        message: string;
      }[] = [];

      for (const draft of data.drafts) {
        // The client reference is the idempotency key: replaying a sync after a
        // dropped connection cannot create the taxpayer twice.
        const existing = await queryOne<{ id: string; status: string; result_entity_id: string | null }>(
          pool,
          'SELECT id, status, result_entity_id FROM offline_drafts WHERE agent_id = $1 AND client_reference = $2',
          [agentId, draft.clientReference],
        );

        if (existing) {
          results.push({
            clientReference: draft.clientReference,
            status: 'DUPLICATE',
            entityId: existing.result_entity_id ?? undefined,
            message: 'This draft was already synchronised. It has not been duplicated.',
          });
          continue;
        }

        const stored = await queryOne<{ id: string }>(
          pool,
          `INSERT INTO offline_drafts
             (agent_id, device_id, client_reference, draft_type, payload, captured_at)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [
            agentId,
            req.agent?.deviceId ?? null,
            draft.clientReference,
            draft.draftType,
            JSON.stringify(draft.payload),
            draft.capturedAt,
          ],
        );

        if (draft.draftType === 'TAXPAYER_REGISTRATION') {
          const parsed = taxpayerInputSchema.safeParse(draft.payload);
          if (!parsed.success) {
            await pool.query(
              `UPDATE offline_drafts SET status = 'REJECTED', rejection_reason = $2 WHERE id = $1`,
              [stored!.id, parsed.error.issues.map((issue) => issue.message).join('; ')],
            );
            results.push({
              clientReference: draft.clientReference,
              status: 'REJECTED',
              message: `Draft could not be accepted: ${parsed.error.issues
                .map((issue) => issue.message)
                .join('; ')}`,
            });
            continue;
          }

          try {
            const created = await taxpayers.registerTaxpayer({
              input: parsed.data,
              actorId: req.auth!.userId,
              actorRole: req.auth!.role,
              agentId,
              acknowledgeDuplicates: parsed.data.acknowledgeDuplicates,
              ipAddress: req.clientIp,
            });
            await pool.query(
              `UPDATE offline_drafts
                  SET status = 'SYNCED', synced_at = now(),
                      result_entity_type = 'taxpayer', result_entity_id = $2
                WHERE id = $1`,
              [stored!.id, created.taxpayerId],
            );
            results.push({
              clientReference: draft.clientReference,
              status: 'SYNCED',
              entityType: 'taxpayer',
              entityId: created.taxpayerId,
              message: created.tin
                ? `Registered with TIN ${created.tin}.`
                : 'Registered. TIN assignment is still in progress.',
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            await pool.query(
              `UPDATE offline_drafts SET status = 'REJECTED', rejection_reason = $2 WHERE id = $1`,
              [stored!.id, message],
            );
            results.push({ clientReference: draft.clientReference, status: 'REJECTED', message });
          }
        } else {
          results.push({
            clientReference: draft.clientReference,
            status: 'PENDING_SYNC',
            entityId: stored!.id,
            message: 'Draft stored for processing.',
          });
        }
      }

      res.json({ results });
    },
  ),
);

draftRouter.get(
  '/',
  requireActiveAgent({ requireDevice: false }),
  asyncHandler(async (req, res) => {
    res.json(
      await query(
        pool,
        `SELECT id, client_reference, draft_type, status, captured_at, synced_at,
                result_entity_type, result_entity_id, rejection_reason
           FROM offline_drafts WHERE agent_id = $1 ORDER BY captured_at DESC LIMIT 100`,
        [req.agent?.agentId ?? req.auth!.agentId],
      ),
    );
  }),
);
