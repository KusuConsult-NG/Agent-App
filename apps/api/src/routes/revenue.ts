/** Revenue catalogue, assessment and invoicing endpoints (PRD §52). */

import { Router } from 'express';
import { z } from 'zod';
import { serialiseKobo } from '@psirs/shared';
import { pool, query, queryOne, withTransaction } from '../db/pool';
import { authenticate, requirePermission, requireActiveAgent, requireStepUp } from '../middleware/auth';
import { idempotent } from '../middleware/idempotency';
import { asyncHandler, koboSchema, uuidSchema, validateBody, validateQuery } from '../middleware/validate';
import { assertOwnRecord, callerAgentId, seesEverything } from '../lib/ownership';
import { notFound, badRequest } from '../lib/errors';
import * as revenue from '../services/revenue';
import { recordAudit } from '../services/audit';
import { registerDocument, renderInvoicePdf } from '../services/documents';
import { signDocumentUrl } from '../services/storage';

export const revenueRouter = Router();

revenueRouter.use(authenticate);

// --- Catalogue --------------------------------------------------------------

revenueRouter.get(
  '/authorities',
  requirePermission('catalogue:read'),
  asyncHandler(async (_req, res) => {
    res.json(
      await query(
        pool,
        `SELECT id, name, name_ha, code, tier FROM revenue_authorities WHERE status = 'ACTIVE' ORDER BY tier, name`,
      ),
    );
  }),
);

revenueRouter.get(
  '/categories',
  requirePermission('catalogue:read'),
  validateQuery(z.object({ authorityId: uuidSchema.optional() }), async (_req, res, data) => {
    res.json(await revenue.listCategories(pool, data));
  }),
);

revenueRouter.get(
  '/items',
  requirePermission('catalogue:read'),
  validateQuery(
    z.object({
      categoryId: uuidSchema.optional(),
      taxpayerType: z.enum(['INDIVIDUAL', 'BUSINESS']).optional(),
      lgaId: uuidSchema.optional(),
      search: z.string().optional(),
      includeWithdrawn: z.coerce.boolean().optional(),
    }),
    async (req, res, data) => {
      // Seeing what has been withdrawn is part of configuring the catalogue,
      // not part of reading it: an agent asking for the withdrawn items gets
      // the catalogue they can actually sell from.
      const includeWithdrawn = data.includeWithdrawn === true && req.auth!.permissions.includes('catalogue:configure');
      res.json(await revenue.listItems(pool, { ...data, includeWithdrawn }));
    },
  ),
);

revenueRouter.get(
  '/items/:id/rates',
  requirePermission('catalogue:read'),
  asyncHandler(async (req, res) => {
    res.json(
      await query(
        pool,
        `SELECT id, version, rate_type, fixed_amount_kobo, rate_basis_points, tiers, formula,
                minimum_amount_kobo, maximum_amount_kobo, effective_from, effective_to, created_at
           FROM revenue_item_rates WHERE revenue_item_id = $1 ORDER BY version DESC`,
        [req.params.id],
      ),
    );
  }),
);

/**
 * Change a rate (PRD §9, §69).
 *
 * Never an UPDATE: the current version is closed with an effective_to and a new
 * version is inserted. Historical assessments keep pointing at the old version,
 * so what was owed then stays what was owed then.
 */
revenueRouter.post(
  '/items/:id/rates',
  requirePermission('catalogue:configure'),
  requireStepUp('catalogue.rate.change'),
  validateBody(
    z.object({
      rateType: z.enum(['FIXED', 'PERCENTAGE', 'TIERED', 'FORMULA']),
      fixedAmountKobo: koboSchema.optional(),
      rateBasisPoints: z.number().int().min(0).max(10000).optional(),
      tiers: z.unknown().optional(),
      formula: z.string().max(500).optional(),
      minimumAmountKobo: koboSchema.optional(),
      maximumAmountKobo: koboSchema.optional(),
      effectiveFrom: z.string().datetime(),
      reason: z.string().min(10, 'Give a reason for the rate change'),
      approvalId: uuidSchema.optional(),
      /*
       * Whose rate this is.
       *
       * Eleven items are local government revenue whose figure comes from a
       * Council's bye-law, so a rate change now names the Council it applies
       * to. Omitted, it changes the statewide default — which is right for
       * state revenue and wrong for a Part III item, so those carry no
       * default for it to reach.
       */
      lgaId: uuidSchema.optional(),
    })
      /*
       * The parameters have to match the type, and the officer has to be told
       * which one is missing.
       *
       * `rate_definition_present` and `rate_band_valid` on the table already
       * refuse most of this, and they should — a rule about money belongs
       * where the money is. What an officer got back was the generic
       * constraint answer: "This action was blocked by a financial integrity
       * rule. Nothing has been changed. Contact support." For a field they
       * left blank on the form in front of them, that is a dead end dressed as
       * an incident, and the fix is one they could have made in five seconds
       * if anything had named it.
       *
       * One case the table cannot see at all. `tiers` is a JSON column, so a
       * band list of `{"tiers": []}` is not null and satisfies the constraint.
       * That rate goes live on its effective date and then throws in the
       * field: the agent standing in front of a citizen is told the item "has
       * no rate bands configured", which is true, is about our configuration,
       * and is not something they can do anything about.
       */
      .superRefine((data, ctx) => {
        const required = {
          FIXED: ['fixedAmountKobo', 'A fixed rate needs the amount payable'],
          PERCENTAGE: ['rateBasisPoints', 'A percentage rate needs the percentage, in basis points'],
          TIERED: ['tiers', 'A tiered rate needs its bands'],
          FORMULA: ['formula', 'A formula rate needs the formula'],
        } as const;

        const [field, message] = required[data.rateType];
        if (data[field] === undefined || data[field] === null || data[field] === '') {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message });
        }

        if (data.rateType === 'TIERED' && data.tiers !== undefined) {
          const raw = data.tiers as { tiers?: unknown[] } | unknown[];
          const bands = Array.isArray(raw) ? raw : Array.isArray(raw?.tiers) ? raw.tiers : null;
          if (bands === null || bands.length === 0) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['tiers'],
              message:
                'A tiered rate needs at least one band. A rate with none is accepted here and ' +
                'then cannot be assessed in the field.',
            });
          }
        }

        if (
          data.minimumAmountKobo !== undefined &&
          data.maximumAmountKobo !== undefined &&
          data.minimumAmountKobo > data.maximumAmountKobo
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['minimumAmountKobo'],
            message:
              'The minimum is above the maximum. Charging applies the minimum and then the ' +
              'maximum, so the maximum would win and the minimum would do nothing.',
          });
        }
      }),
    async (req, res, data) => {
      const effectiveFrom = new Date(data.effectiveFrom);
      if (effectiveFrom.getTime() < Date.now() - 60_000) {
        throw badRequest(
          'A rate change cannot take effect in the past. Historical assessments must remain valid at their original rate.',
        );
      }

      const result = await withTransaction(async (client) => {
        const item = await queryOne<{ id: string; name: string }>(
          client,
          'SELECT id, name FROM revenue_items WHERE id = $1',
          [req.params.id],
        );
        if (!item) throw notFound('That revenue item');

        const current = await queryOne<{ id: string; version: number }>(
          client,
          `SELECT id, version FROM revenue_item_rates
            WHERE revenue_item_id = $1 AND effective_to IS NULL
              AND lga_id IS NOT DISTINCT FROM $2
            ORDER BY version DESC LIMIT 1 FOR UPDATE`,
          [req.params.id, data.lgaId ?? null],
        );

        // Version numbers count per item per Council, so a Council setting its
        // first rate starts at 1 even where seventeen others already have one.
        const highest = await queryOne<{ version: number }>(
          client,
          `SELECT COALESCE(MAX(version), 0) AS version FROM revenue_item_rates
            WHERE revenue_item_id = $1 AND lga_id IS NOT DISTINCT FROM $2`,
          [req.params.id, data.lgaId ?? null],
        );

        if (current) {
          await client.query('UPDATE revenue_item_rates SET effective_to = $2 WHERE id = $1', [
            current.id,
            effectiveFrom,
          ]);
        }

        const version = (highest?.version ?? 0) + 1;
        const inserted = await queryOne<{ id: string }>(
          client,
          `INSERT INTO revenue_item_rates
             (revenue_item_id, lga_id, version, rate_type, fixed_amount_kobo, rate_basis_points,
              tiers, formula, minimum_amount_kobo, maximum_amount_kobo, effective_from,
              approval_id, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
          [
            req.params.id,
            data.lgaId ?? null,
            version,
            data.rateType,
            data.fixedAmountKobo?.toString() ?? null,
            data.rateBasisPoints ?? null,
            data.tiers ? JSON.stringify(data.tiers) : null,
            data.formula ?? null,
            data.minimumAmountKobo?.toString() ?? null,
            data.maximumAmountKobo?.toString() ?? null,
            effectiveFrom,
            data.approvalId ?? null,
            req.auth!.userId,
          ],
        );

        await recordAudit(client, {
          actorId: req.auth!.userId,
          actorRole: req.auth!.role,
          action: 'catalogue.rate_changed',
          entityType: 'revenue_item',
          entityId: req.params.id,
          oldValue: current ? { version: current.version } : null,
          newValue: {
            version,
            lgaId: data.lgaId ?? null,
            rateType: data.rateType,
            fixedAmountKobo: data.fixedAmountKobo?.toString() ?? null,
            rateBasisPoints: data.rateBasisPoints ?? null,
            effectiveFrom: effectiveFrom.toISOString(),
          },
          reason: data.reason,
          ipAddress: req.clientIp,
        });

        return { rateId: inserted!.id, version, effectiveFrom };
      });

      res.status(201).json(result);
    },
  ),
);

revenueRouter.post(
  '/items',
  requirePermission('catalogue:configure'),
  validateBody(
    z.object({
      categoryId: uuidSchema,
      mdaId: uuidSchema.optional(),
      code: z.string().min(2).max(40),
      name: z.string().min(2).max(200),
      description: z.string().max(1000).optional(),
      applicableTaxpayerTypes: z.array(z.enum(['INDIVIDUAL', 'BUSINESS'])).default(['INDIVIDUAL', 'BUSINESS']),
      applicableLgaIds: z.array(uuidSchema).default([]),
      frequency: z.enum(['ONE_OFF', 'DAILY', 'MONTHLY', 'QUARTERLY', 'ANNUAL']).default('ANNUAL'),
      requiredDocuments: z.array(z.string()).default([]),
      selfAssessable: z.boolean().default(false),
      commissionEligible: z.boolean().default(true),
      serviceChargeKobo: koboSchema.optional(),
    }),
    async (req, res, data) => {
      const item = await withTransaction(async (client) => {
        const row = await queryOne<{ id: string }>(
          client,
          `INSERT INTO revenue_items
             (category_id, mda_id, code, name, description, applicable_taxpayer_types,
              applicable_lga_ids, frequency, required_documents, assessment_rules,
              self_assessable, commission_eligible, status, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'ACTIVE',$13) RETURNING id`,
          [
            data.categoryId,
            data.mdaId ?? null,
            data.code,
            data.name,
            data.description ?? null,
            data.applicableTaxpayerTypes,
            data.applicableLgaIds,
            data.frequency,
            data.requiredDocuments,
            JSON.stringify(
              data.serviceChargeKobo ? { serviceChargeKobo: data.serviceChargeKobo.toString() } : {},
            ),
            data.selfAssessable,
            data.commissionEligible,
            req.auth!.userId,
          ],
        );

        await recordAudit(client, {
          actorId: req.auth!.userId,
          actorRole: req.auth!.role,
          action: 'catalogue.item_created',
          entityType: 'revenue_item',
          entityId: row!.id,
          newValue: { code: data.code, name: data.name },
        });

        return row!;
      });

      res.status(201).json({ revenueItemId: item.id });
    },
  ),
);

// --- Quote, assessment, invoice --------------------------------------------

/** Price a revenue item without creating anything (PRD §15). */
revenueRouter.post(
  '/quote',
  requirePermission('assessment:create'),
  validateBody(
    z.object({
      revenueItemId: uuidSchema,
      inputs: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
      /*
       * The taxpayer, not the LGA.
       *
       * Eleven items now carry a rate per Local Government Area, so a quote
       * has to know where the taxpayer is. It takes the taxpayer's id and
       * looks the place up here rather than accepting an lgaId from the
       * client — otherwise an agent could quote a trader at whichever
       * Council's figure suited them, and the quote is what the trader is
       * shown before they agree to pay.
       *
       * Optional, because the catalogue browser quotes with nothing in hand.
       * Omitted, resolution finds the statewide default — and a Part III item
       * has none, so it refuses rather than guessing a Council.
       */
      taxpayerId: uuidSchema.optional(),
    }),
    async (_req, res, data) => {
      const lgaId = data.taxpayerId
        ? (
            await queryOne<{ lga_id: string }>(
              pool,
              'SELECT lga_id FROM taxpayers WHERE id = $1',
              [data.taxpayerId],
            )
          )?.lga_id ?? null
        : null;
      const result = await revenue.quote(pool, { ...data, lgaId });
      res.json({
        ...result,
        amountKobo: serialiseKobo(result.amountKobo),
        serviceChargeKobo: serialiseKobo(result.serviceChargeKobo),
        totalKobo: serialiseKobo(result.totalKobo),
      });
    },
  ),
);

revenueRouter.post(
  '/assessments',
  requirePermission('assessment:create'),
  requireActiveAgent(),
  idempotent('assessment.create'),
  validateBody(
    z.object({
      taxpayerId: uuidSchema,
      revenueItemId: uuidSchema,
      inputs: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
      periodStart: z.string().date().optional(),
      periodEnd: z.string().date().optional(),
      periodLabel: z.string().max(100).optional(),
      assessmentType: z.enum(['AGENT_ASSISTED', 'SELF_ASSESSMENT', 'OFFICER']).optional(),
      latitude: z.number().min(-90).max(90).optional(),
      longitude: z.number().min(-180).max(180).optional(),
    }),
    async (req, res, data) => {
      const result = await revenue.createAssessment({
        ...data,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        agentId: req.agent?.agentId ?? null,
        territoryId: req.agent?.territoryId ?? null,
        deviceId: req.agent?.deviceId ?? null,
        channel: req.auth!.role === 'agent' ? 'AGENT_PWA' : 'OFFICER',
        ipAddress: req.clientIp,
      });

      res.status(201).json({
        ...result,
        amountKobo: serialiseKobo(result.amountKobo),
        serviceChargeKobo: serialiseKobo(result.serviceChargeKobo),
        totalKobo: serialiseKobo(result.totalKobo),
      });
    },
  ),
);

revenueRouter.get(
  '/assessments/:id',
  requirePermission('assessment:read:own', 'assessment:read:all'),
  asyncHandler(async (req, res) => {
    const assessment = await queryOne(
      pool,
      `SELECT a.*, ri.name AS revenue_item, ri.name_ha AS revenue_item_ha,
              rc.name AS revenue_category, rc.name_ha AS revenue_category_ha,
              i.invoice_number, i.status AS invoice_status, i.expires_at
         FROM assessments a
         JOIN revenue_items ri ON ri.id = a.revenue_item_id
         JOIN revenue_categories rc ON rc.id = ri.category_id
         LEFT JOIN invoices i ON i.assessment_id = a.id
        WHERE a.id = $1`,
      [req.params.id],
    );
    if (!assessment) throw notFound('That assessment');
    assertOwnRecord(
      req,
      'assessment:read:all',
      (assessment as { agent_id?: string | null }).agent_id ?? null,
      'That assessment',
    );
    res.json(assessment);
  }),
);

revenueRouter.get(
  '/invoices/:id',
  requirePermission('invoice:read:own', 'invoice:read:all'),
  asyncHandler(async (req, res) => {
    const invoice = await queryOne(
      pool,
      `SELECT i.*, a.assessment_number, a.period_label, a.computation_trace,
              ri.name AS revenue_item, ri.name_ha AS revenue_item_ha,
              rc.name AS revenue_category, rc.name_ha AS revenue_category_ha,
              t.transaction_reference, t.status AS transaction_status
         FROM invoices i
         JOIN assessments a ON a.id = i.assessment_id
         JOIN revenue_items ri ON ri.id = a.revenue_item_id
         JOIN revenue_categories rc ON rc.id = ri.category_id
         LEFT JOIN transactions t ON t.invoice_id = i.id
        WHERE i.id = $1`,
      [req.params.id],
    );
    if (!invoice) throw notFound('That invoice');
    assertOwnRecord(req, 'invoice:read:all', (invoice as { agent_id?: string | null }).agent_id ?? null, 'That invoice');
    res.json(invoice);
  }),
);

/** Render the invoice as a PDF the taxpayer can keep (PRD §15, §23). */
revenueRouter.post(
  '/invoices/:id/document',
  requirePermission('invoice:read:own', 'invoice:read:all'),
  asyncHandler(async (req, res) => {
    const result = await withTransaction(async (client) => {
      const invoice = await queryOne<Record<string, string | null>>(
        client,
        `SELECT i.id, i.invoice_number, i.amount_kobo, i.service_charge_kobo, i.total_amount_kobo,
                i.verification_code, i.issued_at, i.expires_at, i.taxpayer_id,
                a.assessment_number, a.period_label, a.computation_trace,
                ri.name AS revenue_item, ri.name_ha AS revenue_item_ha,
                rc.name AS revenue_category, rc.name_ha AS revenue_category_ha,
                m.name AS mda_name, m.name_ha AS mda_name_ha,
                l.name AS lga_name, ag.agent_code, i.agent_id,
                tp.first_name, tp.last_name, tp.business_name, tp.tin
           FROM invoices i
           JOIN assessments a ON a.id = i.assessment_id
           JOIN revenue_items ri ON ri.id = a.revenue_item_id
           JOIN revenue_categories rc ON rc.id = ri.category_id
           LEFT JOIN mdas m ON m.id = ri.mda_id
           JOIN lgas l ON l.id = a.lga_id
           JOIN taxpayers tp ON tp.id = i.taxpayer_id
           LEFT JOIN agents ag ON ag.id = i.agent_id
          WHERE i.id = $1`,
        [req.params.id],
      );
      if (!invoice) throw notFound('That invoice');
      assertOwnRecord(req, 'invoice:read:all', (invoice.agent_id as string | null) ?? null, 'That invoice');

      const existing = await queryOne<{ id: string; document_number: string }>(
        client,
        `SELECT id, document_number FROM documents
          WHERE entity_type = 'invoice' AND entity_id = $1 AND status = 'ISSUED'`,
        [req.params.id],
      );
      if (existing) return { documentId: existing.id, documentNumber: existing.document_number };

      const pdf = await renderInvoicePdf({
        invoiceNumber: invoice.invoice_number as string,
        assessmentNumber: invoice.assessment_number as string,
        taxpayerName:
          (invoice.business_name as string) ??
          `${invoice.first_name ?? ''} ${invoice.last_name ?? ''}`.trim(),
        tin: invoice.tin as string | null,
        revenueCategory: invoice.revenue_category as string,
        revenueItem: invoice.revenue_item as string,
        mdaName: invoice.mda_name as string | null,
        amountKobo: BigInt(invoice.amount_kobo as string),
        serviceChargeKobo: BigInt(invoice.service_charge_kobo as string),
        totalKobo: BigInt(invoice.total_amount_kobo as string),
        periodLabel: invoice.period_label as string | null,
        issuedAt: new Date(invoice.issued_at as unknown as string),
        expiresAt: invoice.expires_at ? new Date(invoice.expires_at as unknown as string) : null,
        agentCode: invoice.agent_code as string | null,
        lgaName: invoice.lga_name as string,
        verificationCode: invoice.verification_code as string,
        trace: (invoice.computation_trace as unknown as { step: string; detail: string; amount?: string }[]) ?? [],
      });

      return registerDocument(client, {
        documentType: 'INVOICE',
        ownerType: 'TAXPAYER',
        ownerId: invoice.taxpayer_id as string,
        entityType: 'invoice',
        entityId: req.params.id,
        bytes: pdf,
        verificationCode: invoice.verification_code as string,
        numberPrefix: 'PSIRS-INV',
      });
    });

    res.status(201).json({ ...result, downloadUrl: signDocumentUrl(result.documentId) });
  }),
);

revenueRouter.get(
  '/taxpayers/:id/obligations',
  requirePermission('invoice:read:own', 'invoice:read:all', 'taxpayer:read:assigned'),
  /*
   * Deliberately NOT narrowed to the agent who registered the taxpayer.
   *
   * This route looked like the others when the `:own` scoping was swept, and
   * it is not. `agent-scope.test.ts` states the intent — "serving a walk-up
   * taxpayer requires finding them and knowing their obligations; that much is
   * the job" — and a taxpayer who approaches a different agent must still be
   * servable. Refusing here would push that agent into raising a second
   * assessment for a debt that already exists.
   *
   * What is withheld from another agent is the collection *history*: the
   * taxpayer profile returns no transactions or receipts they did not
   * facilitate. Outstanding obligations are what the taxpayer owes government,
   * and they are in front of the agent asking.
   */
  asyncHandler(async (req, res) => {
    res.json(await revenue.getObligations(pool, req.params.id));
  }),
);

/**
 * Withdraw a revenue item from the catalogue, or put it back (PRD §8).
 *
 * `catalogue:configure` rather than a new permission: whoever may publish an
 * item is the person who may withdraw it, and splitting the two would leave
 * the catalogue in the hands of somebody who can only add to it.
 */
revenueRouter.post(
  '/items/:itemId/status',
  requirePermission('catalogue:configure'),
  validateBody(
    z.object({
      status: z.enum(['ACTIVE', 'SUSPENDED', 'RETIRED']),
      reason: z
        .string()
        .min(5, 'Say why the item is being withdrawn, or what changed before restoring it'),
    }),
    async (req, res, data) => {
      const result = await revenue.setRevenueItemStatus({
        itemId: req.params.itemId,
        status: data.status,
        reason: data.reason,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
      });
      res.json({
        ...result,
        message:
          data.status === 'ACTIVE'
            ? `${result.name} is back in the catalogue and can be assessed again.`
            : data.status === 'SUSPENDED'
              ? `${result.name} is suspended. No new assessment can be raised against it; ` +
                'invoices already issued stay payable.'
              : `${result.name} has been retired. Invoices already issued stay payable, and the ` +
                'item cannot be brought back.',
      });
    },
  ),
);
