/** Vehicle lookup and particulars renewal (PRD §21, §22). */

import { Router } from 'express';
import { z } from 'zod';
import { serialiseKobo } from '@psirs/shared';
import { pool, queryOne } from '../db/pool';
import { authenticate, requireActiveAgent, requirePermission, requireSupportedAppVersion } from '../middleware/auth';
import { idempotent } from '../middleware/idempotency';
import { asyncHandler, uuidSchema, validateBody, validateQuery } from '../middleware/validate';
import { notFound } from '../lib/errors';
import * as vehicles from '../services/vehicles';
import { signDocumentUrl } from '../services/storage';

export const vehicleRouter = Router();

vehicleRouter.use(authenticate);

vehicleRouter.get(
  '/lookup/:registrationNumber',
  requirePermission('vehicle:read:all'),
  asyncHandler(async (req, res) => {
    res.json(await vehicles.lookupVehicle(pool, req.params.registrationNumber));
  }),
);

vehicleRouter.get(
  '/',
  requirePermission('vehicle:read:all'),
  validateQuery(
    z.object({
      taxpayerId: uuidSchema.optional(),
      q: z.string().max(20).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }),
    async (_req, res, data) => {
      res.json(await vehicles.listVehicles(pool, data));
    },
  ),
);

vehicleRouter.post(
  '/',
  requirePermission('vehicle:renew'),
  requireActiveAgent(),
  validateBody(
    z.object({
      registrationNumber: z.string().min(4).max(20),
      chassisNumber: z.string().max(40).optional(),
      engineNumber: z.string().max(40).optional(),
      make: z.string().max(60).optional(),
      model: z.string().max(60).optional(),
      yearOfManufacture: z.number().int().min(1950).max(new Date().getFullYear() + 1).optional(),
      vehicleType: z.string().min(2).max(40),
      vehicleClass: z.string().max(40).optional(),
      colour: z.string().max(40).optional(),
      ownerName: z.string().min(2).max(150),
      ownerPhone: z.string().max(20).optional(),
      taxpayerId: uuidSchema.optional(),
    }),
    async (req, res, data) => {
      const result = await vehicles.upsertVehicle({
        input: data,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
      });
      // The message comes from the service, which is the only place that knows
      // whether the authority said "no such vehicle" or could not be asked.
      res.status(201).json(result);
    },
  ),
);

vehicleRouter.post(
  '/:id/renew',
  requirePermission('vehicle:renew'),
  requireSupportedAppVersion,
  requireActiveAgent(),
  idempotent('vehicle.renew'),
  validateBody(
    z.object({
      revenueItemId: uuidSchema,
      renewalPeriodMonths: z.union([z.literal(6), z.literal(12), z.literal(24)]),
      taxpayerId: uuidSchema,
      latitude: z.number().min(-90).max(90).optional(),
      longitude: z.number().min(-180).max(180).optional(),
    }),
    async (req, res, data) => {
      const result = await vehicles.initiateRenewal({
        vehicleId: req.params.id,
        revenueItemId: data.revenueItemId,
        renewalPeriodMonths: data.renewalPeriodMonths,
        taxpayerId: data.taxpayerId,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        agentId: req.agent?.agentId ?? null,
        territoryId: req.agent?.territoryId ?? null,
        deviceId: req.agent?.deviceId ?? null,
        latitude: data.latitude ?? null,
        longitude: data.longitude ?? null,
      });

      res.status(201).json({
        ...result,
        amountKobo: serialiseKobo(result.amountKobo),
        serviceChargeKobo: serialiseKobo(result.serviceChargeKobo),
        totalKobo: serialiseKobo(result.totalKobo),
        message:
          'Renewal invoice created. The renewal document is issued automatically once payment is confirmed.',
      });
    },
  ),
);

/**
 * Issue the renewal document. Normally happens automatically on payment
 * confirmation; this endpoint exists so a document can be re-fetched or
 * recovered after an interrupted session.
 */
vehicleRouter.post(
  '/renewals/:renewalId/document',
  requirePermission('vehicle:renew', 'vehicle:read:all'),
  asyncHandler(async (req, res) => {
    const result = await vehicles.completeRenewal({
      renewalId: req.params.renewalId,
      actorId: req.auth!.userId,
      actorRole: req.auth!.role,
    });
    res.json({ ...result, downloadUrl: signDocumentUrl(result.documentId) });
  }),
);

/**
 * Renewals the vehicle authority has not acknowledged, and vehicles captured
 * while it could not be reached (PRD §82).
 *
 * Declared before `/renewals/:renewalId` so Express matches the literal path
 * rather than treating "authority-outstanding" as a renewal id.
 */
vehicleRouter.get(
  '/renewals/authority-outstanding',
  requirePermission('vehicle:authority_sync'),
  asyncHandler(async (_req, res) => {
    res.json({
      renewals: await vehicles.outstandingAuthorityNotifications(pool),
      vehiclesAwaitingAuthority: await vehicles.vehiclesAwaitingAuthority(pool),
    });
  }),
);

/**
 * Re-send outstanding renewal notifications.
 *
 * Changes no financial record: the taxpayer has already paid and holds their
 * document. This only retries telling the authority, and reports honestly how
 * many are still not through.
 */
vehicleRouter.post(
  '/renewals/authority-retry',
  requirePermission('vehicle:authority_sync'),
  validateBody(
    z.object({ limit: z.number().int().min(1).max(500).optional() }),
    async (req, res, data) => {
      const result = await vehicles.retryAuthorityNotifications({
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        limit: data.limit,
      });
      res.json({
        ...result,
        message:
          result.stillFailing === 0
            ? `${result.accepted} renewal(s) acknowledged by the vehicle authority.`
            : `${result.accepted} acknowledged; ${result.stillFailing} still could not be sent. ` +
              'The renewals themselves remain valid — retry again later.',
      });
    },
  ),
);

vehicleRouter.get(
  '/renewals/:renewalId',
  requirePermission('vehicle:read:all'),
  asyncHandler(async (req, res) => {
    const renewal = await queryOne<{ document_id: string | null }>(
      pool,
      `SELECT r.*, v.registration_number, v.owner_name, t.transaction_reference, t.status AS transaction_status
         FROM vehicle_renewals r
         JOIN vehicles v ON v.id = r.vehicle_id
         LEFT JOIN transactions t ON t.id = r.transaction_id
        WHERE r.id = $1`,
      [req.params.renewalId],
    );
    if (!renewal) throw notFound('That renewal');
    res.json({
      ...renewal,
      downloadUrl: renewal.document_id ? signDocumentUrl(renewal.document_id) : null,
    });
  }),
);
