/** Taxpayer registration, search, profile and offline draft sync. */

import { Router } from 'express';
import { z } from 'zod';
import { ECONOMIC_SECTORS, roleHasPermission } from '@psirs/shared';
import { pool, queryOne, withTransaction, query } from '../db/pool';
import {
  authenticate,
  requireActiveAgent,
  requirePermission,
  requireStepUp,
} from '../middleware/auth';
import { idempotent } from '../middleware/idempotency';
import {
  asyncHandler,
  birthDateSchema,
  emailSchema,
  phoneSchema,
  uuidSchema,
  validateBody,
  validateQuery,
} from '../middleware/validate';
import { AppError, badRequest, forbidden } from '../lib/errors';
import { log } from '../lib/logger';
import * as taxpayers from '../services/taxpayers';
import * as vehicles from '../services/vehicles';
import * as obligations from '../services/obligations';
import { vehicleCaptureSchema } from './vehicles';
import { evaluateRegistrationRisk } from '../services/fraud';
import { getTaxpayerIncentives, syncTaxpayerComplianceAndIncentives } from '../services/incentives';
import { queueNotification } from '../services/notifications';

export const taxpayerRouter = Router();

/**
 * Economic sector taxonomy with live revenue item suggestions.
 *
 * This endpoint is unauthenticated (the taxonomy is public reference data) and is
 * used by the Agent PWA to populate the sector dropdown and pre-select
 * applicable revenue items during taxpayer onboarding.
 */
taxpayerRouter.get(
  '/sectors',
  asyncHandler(async (_req, res) => {
    const allCodes = [...new Set(ECONOMIC_SECTORS.flatMap((s) => [...s.suggestedRevenueCodes]))];
    const items = await query<{ id: string; code: string; name: string; frequency: string }>(
      pool,
      `SELECT id, code, name, frequency FROM revenue_items
        WHERE code = ANY($1::text[]) AND status = 'ACTIVE'`,
      [allCodes],
    );
    const byCode = new Map(items.map((item) => [item.code, item]));

    const sectors = ECONOMIC_SECTORS.map((sector) => ({
      code: sector.code,
      label: sector.label,
      hausa: sector.hausa,
      suggestedItems: sector.suggestedRevenueCodes
        .map((code) => byCode.get(code))
        .filter(Boolean),
    }));

    res.json(sectors);
  }),
);

taxpayerRouter.use(authenticate);

const taxpayerInputSchema = z
  .object({
    taxpayerType: z.enum(['INDIVIDUAL', 'BUSINESS']),
    firstName: z.string().min(2).max(80).optional(),
    middleName: z.string().max(80).optional(),
    lastName: z.string().min(2).max(80).optional(),
    dateOfBirth: birthDateSchema.optional(),
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
    economicSector: z.string().max(80).optional(),
    taxObligationIds: z.array(uuidSchema).max(50).optional(),
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
      source: 'AGENT',
      acknowledgeDuplicates: data.acknowledgeDuplicates,
      ipAddress: req.clientIp,
      deviceId: req.agent?.deviceId ?? null,
    });

    await withTransaction(async (client) => {
      if (data.economicSector) {
        await client.query('UPDATE taxpayers SET economic_sector = $1 WHERE id = $2', [
          data.economicSector,
          result.taxpayerId,
        ]);
      }
      if (data.taxObligationIds && data.taxObligationIds.length > 0) {
        // A taxpayer being created has nothing on file yet, so this can only
        // add. `mayWaive` is still passed honestly rather than hardcoded true.
        await obligations.upsertObligations(
          result.taxpayerId,
          data.taxObligationIds,
          'AGENT_ONBOARDING',
          req.auth!.userId,
          {
            role: req.auth!.role,
            mayWaive: req.auth!.permissions.includes('taxpayer:obligation:waive'),
          },
        );
      }
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
      // Compute initial compliance & incentive eligibility for the new taxpayer.
      await syncTaxpayerComplianceAndIncentives(client, result.taxpayerId);
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

/**
 * Taxpayers registered without a TIN, and why (PRD §11, §82).
 *
 * Declared before the parametrised routes so "tin-outstanding" is not read as
 * a taxpayer id.
 */
taxpayerRouter.get(
  '/tin-outstanding',
  requirePermission('taxpayer:tin_sync'),
  asyncHandler(async (_req, res) => {
    res.json({ taxpayers: await taxpayers.taxpayersAwaitingTin(pool) });
  }),
);

/**
 * Re-ask the TIN service for everyone still waiting.
 *
 * The counterpart to letting the TIN service say it could not be reached:
 * without this, "we will ask again later" is a promise nothing keeps.
 */
taxpayerRouter.post(
  '/tin-retry',
  requirePermission('taxpayer:tin_sync'),
  validateBody(
    z.object({ limit: z.number().int().min(1).max(500).optional() }),
    async (req, res, data) => {
      const result = await taxpayers.retryOutstandingTins({
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        limit: data.limit,
      });
      res.json({
        ...result,
        message:
          result.stillOutstanding === 0
            ? `${result.assigned} TIN(s) assigned.`
            : `${result.assigned} assigned; ${result.stillOutstanding} still outstanding. ` +
              'Those taxpayers remain registered and can still be assessed and pay.',
      });
    },
  ),
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
  requirePermission('taxpayer:read:assigned', 'taxpayer:read:all'),
  asyncHandler(async (req, res) => {
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
  requirePermission('incentive:read:all'),
  asyncHandler(async (req, res) => {
    res.json(await getTaxpayerIncentives(pool, req.params.id));
  }),
);

// ---------------------------------------------------------------------------
// Economic sector reference (public — used by Agent PWA dropdown)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Tax obligation management (PRD §10)
// ---------------------------------------------------------------------------

taxpayerRouter.get(
  '/:id/obligations',
  requirePermission('taxpayer:read:assigned', 'taxpayer:read:all'),
  asyncHandler(async (req, res) => {
    res.json(await obligations.getObligationsForTaxpayer(pool, req.params.id));
  }),
);

/**
 * Correcting who a taxpayer record says somebody is.
 *
 * Two tiers, because two different things are being changed. A name or a date
 * of birth corrects what the record says about a person, and is within a
 * revenue officer's ordinary work. The identity document decides *which*
 * person the record is about — the identity hash is what duplicate detection
 * blocks on — so it needs `taxpayer:manage`, which only an administrator has.
 *
 * Agents hold neither. `taxpayer:correct` exists precisely so that the
 * distinction lives in the permission rather than in a role check inside the
 * handler: agents keep `taxpayer:update` for the records they maintain in the
 * field, and an agent who notices a misspelling raises it through support,
 * where somebody who did not capture the record decides. An agent able to
 * rewrite the identity of a taxpayer they registered could point a compliance
 * history, and the benefits that follow it, at another person.
 */
taxpayerRouter.post(
  '/:id/identity',
  requirePermission('taxpayer:correct'),
  requireStepUp('taxpayer.identity.change'),
  validateBody(
    z
      .object({
        firstName: z.string().trim().min(2).max(80).optional(),
        middleName: z.string().trim().max(80).optional(),
        lastName: z.string().trim().min(2).max(80).optional(),
        businessName: z.string().trim().min(2).max(200).optional(),
        dateOfBirth: birthDateSchema.optional(),
        gender: z.enum(['MALE', 'FEMALE', 'UNSPECIFIED']).optional(),
        identityType: z.enum(['NIN', 'BVN', 'PASSPORT', 'DRIVERS_LICENCE', 'VOTERS_CARD', 'OTHER']).optional(),
        identityNumber: z.string().trim().min(5).max(30).optional(),
        reason: z
          .string()
          .trim()
          .min(10, 'Say what is being corrected and why, in at least 10 characters'),
      })
      .refine(
        (data) => Object.keys(data).some((key) => key !== 'reason'),
        { message: 'Give at least one detail to correct.', path: ['reason'] },
      )
      .refine((data) => !(data.identityNumber !== undefined && data.identityType === undefined), {
        message: 'Name the type of identification when changing the number.',
        path: ['identityType'],
      }),
    async (req, res, data) => {
      if (
        taxpayers.changesIdentityDocument(data) &&
        !roleHasPermission(req.auth!.role, 'taxpayer:manage')
      ) {
        throw forbidden(
          'Changing which identification document a record is held under needs an administrator. ' +
            'A name or date of birth can be corrected here; the document cannot.',
        );
      }

      const { reason, ...fields } = data;
      res.json(
        await taxpayers.changeTaxpayerIdentity({
          taxpayerId: req.params.id,
          actorId: req.auth!.userId,
          actorRole: req.auth!.role,
          reason,
          ...fields,
        }),
      );
    },
  ),
);

taxpayerRouter.put(
  '/:id/obligations',
  requirePermission('taxpayer:update', 'taxpayer:manage'),
  validateBody(
    z.object({
      itemIds: z.array(z.string().uuid()).max(50),
      source: z.enum(['AGENT_ONBOARDING', 'OFFICER_REVIEW', 'AUTO_RECOMMENDATION']).default('OFFICER_REVIEW'),
    }),
    async (req, res, data) => {
      // Agents may only update obligations for taxpayers they registered.
      if (req.auth!.role === 'agent') {
        const owns = await queryOne<{ id: string }>(
          pool,
          `SELECT t.id FROM taxpayers t
           JOIN agents a ON a.id = t.registered_by_agent_id
           WHERE t.id = $1 AND a.user_id = $2`,
          [req.params.id, req.auth!.userId],
        );
        if (!owns) throw forbidden('Agents can only set obligations for their own registered taxpayers.');
      }

      const result = await obligations.upsertObligations(
        req.params.id,
        data.itemIds,
        data.source,
        req.auth!.userId,
        {
          role: req.auth!.role,
          mayWaive: req.auth!.permissions.includes('taxpayer:obligation:waive'),
        },
      );
      await syncTaxpayerComplianceAndIncentives(pool, req.params.id);
      res.json({ ...result, message: `${result.added} obligation(s) added, ${result.waived} waived.` });
    },
  ),
);

// ---------------------------------------------------------------------------
// Offline draft sync (PRD §30, Addendum §23)
// ---------------------------------------------------------------------------

export const draftRouter = Router();

draftRouter.use(authenticate);

/**
 * Accept captures taken without a connection (PRD §30; Addendum §23).
 *
 * Four rules govern this endpoint. Three are about what it refuses; the
 * fourth is about what it is allowed to claim.
 *
 * First, the draft types. Every one is a record of something the agent
 * observed; none of them moves money. There is no payment draft type, and the
 * enum is the enforcement — a payment cannot be expressed here at all, so no
 * amount of client compromise can replay one.
 *
 * Second, every draft that is stored must actually be acted on. A draft type
 * with no handler used to be inserted and reported as "stored for processing",
 * which was not true: nothing processed it, the phone deleted its copy on the
 * next sync, and the capture was lost while every message said it had worked.
 * A type this endpoint cannot complete is now rejected in the agent's face.
 *
 * Third, the handset. This endpoint writes the same government records as
 * `POST /taxpayers`, so it asks the same question of the device (Addendum
 * §21). It used to exempt itself, which made going offline first a way around
 * a binding every other agent write enforces — and left the audit entry with
 * no device against it, so the record could not afterwards be traced to a
 * handset at all. A queued capture is not a lesser capture.
 *
 * Fourth, an answer about a draft has to be an answer about that draft. The
 * phone acts on what this endpoint says — deleting a capture it is told was
 * synchronised, keeping one it is told was refused — so "already
 * synchronised" for a draft that was rejected, or for one still waiting to be
 * processed, does not merely mislead: it erases the only remaining copy. Each
 * stored state gets its own reply, and the state that means "not finished" is
 * finished rather than reported as though it had been.
 */
const DRAFT_TYPES = ['TAXPAYER_REGISTRATION', 'VEHICLE_CAPTURE'] as const;

draftRouter.post(
  '/sync',
  requirePermission('taxpayer:create'),
  requireActiveAgent(),
  validateBody(
    z.object({
      drafts: z
        .array(
          z.object({
            clientReference: z.string().min(6).max(120),
            draftType: z.enum(DRAFT_TYPES),
            payload: z.record(z.string(), z.unknown()),
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
        /*
         * One bad capture must not take the batch down with it.
         *
         * Storing the payload is a database write like any other, and a draft
         * carrying something the column will not hold — a NUL byte left in a
         * name by a mis-scanned document, say — used to throw from outside
         * this try, answering the whole request with a 500. Every other draft
         * in the batch went unanswered, the phone kept all of them, and the
         * next sync died on the same one: an agent's entire queue held shut by
         * a single corrupt capture, with no way for them to see which.
         *
         * The whole of one draft's handling therefore sits inside the catch,
         * including its own storage. A draft that cannot even be stored is
         * refused by name, and the other forty-nine go through.
         */
        let storedId: string | null = null;

        const reject = async (message: string) => {
          // A draft that failed before it could be stored has no row to mark;
          // the agent is still told, by name, that this one was refused.
          if (storedId) {
            await pool.query(
              `UPDATE offline_drafts SET status = 'REJECTED', rejection_reason = $2 WHERE id = $1`,
              [storedId, message],
            );
          }
          results.push({ clientReference: draft.clientReference, status: 'REJECTED', message });
        };

        const accept = async (entityType: string, entityId: string, message: string) => {
          await pool.query(
            `UPDATE offline_drafts
                SET status = 'SYNCED', synced_at = now(),
                    result_entity_type = $3, result_entity_id = $2
              WHERE id = $1`,
            [storedId, entityId, entityType],
          );
          results.push({
            clientReference: draft.clientReference,
            status: 'SYNCED',
            entityType,
            entityId,
            message,
          });
        };

        try {
          /*
           * The client reference is the idempotency key: replaying a sync after
           * a dropped connection cannot create the record twice.
           *
           * What the replay is told, though, has to be about this draft. Any
           * existing row used to answer "already synchronised", and the phone
           * acts on that by deleting its copy — so a draft the server had
           * *rejected*, re-sent because the agent never saw the reply, was
           * reported as done and then erased along with the reason the agent
           * needed to fix it. A row still in PENDING_SYNC — what a crash between
           * the insert and the handler leaves behind — was answered the same
           * way, and the capture existed nowhere afterwards.
           *
           * So each stored state gets its own answer, and the one state that
           * means "not finished" is finished now rather than reported as though
           * it had been.
           */
          const existing = await queryOne<{
            id: string;
            status: string;
            result_entity_type: string | null;
            result_entity_id: string | null;
            rejection_reason: string | null;
          }>(
            pool,
            `SELECT id, status, result_entity_type, result_entity_id, rejection_reason
               FROM offline_drafts WHERE agent_id = $1 AND client_reference = $2`,
            [agentId, draft.clientReference],
          );

          if (existing && existing.status !== 'PENDING_SYNC') {
            if (existing.status === 'REJECTED') {
              results.push({
                clientReference: draft.clientReference,
                status: 'REJECTED',
                message:
                  existing.rejection_reason ??
                  'This draft was refused earlier and has not been stored as a record.',
              });
            } else {
              results.push({
                clientReference: draft.clientReference,
                status: 'DUPLICATE',
                entityType: existing.result_entity_type ?? undefined,
                entityId: existing.result_entity_id ?? undefined,
                message: 'This draft was already synchronised. It has not been duplicated.',
              });
            }
            continue;
          }

          storedId = (
            existing
            ? await queryOne<{ id: string }>(
                pool,
                // Resuming: the phone still holds this capture, so what it is
                // sending now is what the record should be made from, and the
                // row should say so rather than keeping a payload that produced
                // nothing.
                `UPDATE offline_drafts SET payload = $2, device_id = COALESCE($3, device_id)
                  WHERE id = $1 RETURNING id`,
                [existing.id, JSON.stringify(draft.payload), req.agent?.deviceId ?? null],
              )
            : await queryOne<{ id: string }>(
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
              )
          )!.id;

          if (draft.draftType === 'TAXPAYER_REGISTRATION') {
            const parsed = taxpayerInputSchema.safeParse(draft.payload);
            if (!parsed.success) {
              await reject(
                `Draft could not be accepted: ${parsed.error.issues
                  .map((issue) => issue.message)
                  .join('; ')}`,
              );
              continue;
            }

            const created = await taxpayers.registerTaxpayer({
              input: parsed.data,
              actorId: req.auth!.userId,
              actorRole: req.auth!.role,
              agentId,
              source: 'AGENT',
              /*
               * A duplicate acknowledgement cannot travel in the queue.
               *
               * The flag means a person looked at the matches the server
               * offered and said none of them is this citizen. A phone with no
               * signal has no duplicate list to have looked at, so the only
               * way it reaches the queue is an attempt made online, refused,
               * acknowledged, resubmitted — and then cut off before its reply
               * arrived. Which is the one case where the acknowledgement is
               * certainly wrong: the record it waves past is the one that
               * attempt created.
               *
               * So the check runs against the register as it stands now, and
               * the agent decides with the current record in front of them.
               */
              acknowledgeDuplicates: false,
              ipAddress: req.clientIp,
              // The same fields the online route records. A capture that
              // arrived through the queue is audited no differently from one
              // typed with a signal, or the queue becomes the way to file a
              // registration nothing can trace back to a handset.
              deviceId: req.agent?.deviceId ?? null,
            });
            await accept(
              'taxpayer',
              created.taxpayerId,
              created.tin
                ? `Registered with TIN ${created.tin}.`
                : 'Registered. TIN assignment is still in progress.',
            );
            continue;
          }

          if (draft.draftType === 'VEHICLE_CAPTURE') {
            const parsed = vehicleCaptureSchema.safeParse(draft.payload);
            if (!parsed.success) {
              await reject(
                `Draft could not be accepted: ${parsed.error.issues
                  .map((issue) => issue.message)
                  .join('; ')}`,
              );
              continue;
            }

            // The authority is consulted now, at sync time, because now is when
            // there is a connection. A vehicle captured in the field therefore
            // still gets checked — it is not permanently unverified just for
            // having been recorded offline.
            const captured = await vehicles.upsertVehicle({
              input: parsed.data,
              actorId: req.auth!.userId,
              actorRole: req.auth!.role,
            });
            await accept('vehicle', captured.vehicleId, captured.message);
            continue;
          }

          // Unreachable while every member of DRAFT_TYPES is handled above. If a
          // type is ever added without a handler, this rejects it loudly instead
          // of storing it where nothing will ever look.
          await reject(
            `This version of the platform cannot process a "${draft.draftType}" capture. ` +
              'It has not been discarded — quote this reference to support.',
          );
        } catch (error) {
          /*
           * A refusal the platform composed is worth showing; a fault is not.
           *
           * This used to reject with `error.message`, whatever it happened to
           * be, and store it for good. "This person is already registered as
           * Rifkatu Bala (TIN 481...)" is exactly what an agent needs. `duplicate
           * key value violates unique constraint "taxpayers_tin_key"` is not:
           * it tells them nothing they can act on, and tells anyone reading
           * over their shoulder the names of our tables.
           */
          if (error instanceof AppError) {
            await reject(error.message);
          } else {
            log.error('offline draft could not be processed', {
              component: 'drafts',
              draftId: storedId,
              clientReference: draft.clientReference,
              error,
            });
            await reject(
              'This capture could not be processed. It is still on your phone — quote ' +
                `reference ${draft.clientReference} to support.`,
            );
          }
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
