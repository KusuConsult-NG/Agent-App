/**
 * Government portal endpoints: dashboards, reconciliation, approvals, fraud,
 * audit, reports and incentive programmes (PRD §37-§39, §45-§49, §67, §72).
 */

import { Router } from 'express';
import { z } from 'zod';
import { parseKobo } from '@psirs/shared';
import { pool, query, queryOne, withTransaction } from '../db/pool';
import { authenticate, requirePermission, requireStepUp } from '../middleware/auth';
import { asyncHandler, koboSchema, uuidSchema, validateBody, validateQuery } from '../middleware/validate';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { nextTicketNumber } from '../lib/references';
import { recordAudit, verifyAuditChain } from '../services/audit';
import * as reconciliation from '../services/reconciliation';
import * as reports from '../services/reports';
import * as incentives from '../services/incentives';
import * as commission from '../services/commission';
import { leakageDashboard, runFraudSweep } from '../services/fraud';
import { integrationStatus } from '../integrations';

export const governmentRouter = Router();

governmentRouter.use(authenticate);

// ---------------------------------------------------------------------------
// Dashboards and intelligence
// ---------------------------------------------------------------------------

governmentRouter.get(
  '/dashboard',
  requirePermission('dashboard:executive', 'report:read:all'),
  asyncHandler(async (_req, res) => {
    res.json(await reports.executiveDashboard(pool));
  }),
);

governmentRouter.get(
  '/intelligence/geography',
  requirePermission('report:read:all', 'report:read:territory'),
  validateQuery(
    z.object({
      lgaId: uuidSchema.optional(),
      wardId: uuidSchema.optional(),
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
    }),
    async (_req, res, data) => {
      res.json(
        await reports.geographicIntelligence(pool, {
          lgaId: data.lgaId,
          wardId: data.wardId,
          from: data.from ? new Date(data.from) : undefined,
          to: data.to ? new Date(data.to) : undefined,
        }),
      );
    },
  ),
);

governmentRouter.get(
  '/kpis',
  requirePermission('report:read:all'),
  asyncHandler(async (_req, res) => {
    res.json(await reports.kpis(pool));
  }),
);

governmentRouter.get(
  '/leakage',
  requirePermission('fraud:read'),
  asyncHandler(async (_req, res) => {
    res.json(await leakageDashboard(pool));
  }),
);

governmentRouter.get(
  '/transactions',
  requirePermission('payment:read:all'),
  validateQuery(
    z.object({
      status: z.string().optional(),
      lgaId: uuidSchema.optional(),
      agentId: uuidSchema.optional(),
      revenueItemId: uuidSchema.optional(),
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
      limit: z.coerce.number().int().min(1).max(500).default(100),
      format: z.enum(['json', 'csv']).default('json'),
    }),
    async (_req, res, data) => {
      const rows = await query(
        pool,
        `SELECT t.transaction_reference, t.amount_kobo, t.service_charge_kobo, t.status,
                t.created_at, t.verified_at, t.settled_at,
                ri.name AS revenue_item, rc.name AS revenue_category,
                l.name AS lga, ag.agent_code,
                COALESCE(tp.business_name, tp.first_name || ' ' || tp.last_name) AS taxpayer_name,
                tp.tin, r.receipt_number, p.gateway_reference, p.payment_method
           FROM transactions t
           JOIN revenue_items ri ON ri.id = t.revenue_item_id
           JOIN revenue_categories rc ON rc.id = ri.category_id
           JOIN lgas l ON l.id = t.lga_id
           JOIN taxpayers tp ON tp.id = t.taxpayer_id
           LEFT JOIN agents ag ON ag.id = t.agent_id
           LEFT JOIN receipts r ON r.transaction_id = t.id
           LEFT JOIN payments p ON p.transaction_id = t.id AND p.status = 'VERIFIED'
          WHERE ($1::text IS NULL OR t.status = $1)
            AND ($2::uuid IS NULL OR t.lga_id = $2)
            AND ($3::uuid IS NULL OR t.agent_id = $3)
            AND ($4::uuid IS NULL OR t.revenue_item_id = $4)
            AND ($5::timestamptz IS NULL OR t.created_at >= $5)
            AND ($6::timestamptz IS NULL OR t.created_at <= $6)
          ORDER BY t.created_at DESC LIMIT $7`,
        [
          data.status ?? null,
          data.lgaId ?? null,
          data.agentId ?? null,
          data.revenueItemId ?? null,
          data.from ?? null,
          data.to ?? null,
          data.limit,
        ],
      );

      if (data.format === 'csv') {
        res.setHeader('content-type', 'text/csv');
        res.setHeader('content-disposition', 'attachment; filename="transactions.csv"');
        res.send(reports.toCsv(rows));
        return;
      }
      res.json(rows);
    },
  ),
);

// ---------------------------------------------------------------------------
// Reconciliation and settlement (PRD §46, §47)
// ---------------------------------------------------------------------------

governmentRouter.post(
  '/reconciliation/run',
  requirePermission('payment:reconcile'),
  validateBody(
    z.object({ from: z.string().datetime(), to: z.string().datetime() }),
    async (req, res, data) => {
      const result = await reconciliation.runReconciliation({
        from: new Date(data.from),
        to: new Date(data.to),
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
      });
      res.json(result);
    },
  ),
);

/** Verify payments the gateway completed but no webhook ever reported. */
governmentRouter.post(
  '/reconciliation/recover',
  requirePermission('payment:reconcile'),
  validateBody(
    z.object({
      from: z.string().datetime(),
      to: z.string().datetime(),
      limit: z.number().int().min(1).max(500).default(200),
    }),
    async (_req, res, data) => {
      const result = await reconciliation.recoverUnverifiedPayments({
        from: new Date(data.from),
        to: new Date(data.to),
        limit: data.limit,
      });
      res.json(result);
    },
  ),
);

governmentRouter.get(
  '/reconciliation/exceptions',
  requirePermission('payment:reconcile', 'audit:read'),
  validateQuery(
    z.object({ status: z.string().optional(), limit: z.coerce.number().int().max(500).default(100) }),
    async (_req, res, data) => {
      res.json(await reconciliation.exceptionQueue(pool, data));
    },
  ),
);

governmentRouter.post(
  '/reconciliation/exceptions/:id/resolve',
  requirePermission('payment:reconcile'),
  validateBody(
    z.object({ resolution: z.string().min(10, 'Explain how the exception was resolved') }),
    async (req, res, data) => {
      await reconciliation.resolveException({
        recordId: req.params.id,
        resolution: data.resolution,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
      });
      res.json({ resolved: true });
    },
  ),
);

governmentRouter.get(
  '/settlements',
  requirePermission('report:financial', 'payment:reconcile'),
  asyncHandler(async (_req, res) => {
    res.json(await reconciliation.settlementDashboard(pool));
  }),
);

governmentRouter.post(
  '/settlements',
  requirePermission('payment:reconcile'),
  validateBody(
    z.object({
      settlementDate: z.string().date(),
      gatewayReferences: z.array(z.string()).min(1),
      receivedAmountKobo: koboSchema,
      bankReference: z.string().min(3).max(80),
      governmentAccountId: uuidSchema.optional(),
    }),
    async (req, res, data) => {
      const result = await reconciliation.recordSettlement({
        settlementDate: new Date(data.settlementDate),
        gatewayReferences: data.gatewayReferences,
        receivedAmountKobo: data.receivedAmountKobo,
        bankReference: data.bankReference,
        governmentAccountId: data.governmentAccountId ?? null,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
      });
      res.status(201).json(result);
    },
  ),
);

// ---------------------------------------------------------------------------
// Maker-checker approvals (PRD §69, §70)
// ---------------------------------------------------------------------------

governmentRouter.get(
  '/approvals',
  requirePermission('approval:review', 'approval:authorise', 'audit:read'),
  validateQuery(
    z.object({ status: z.string().optional(), type: z.string().optional() }),
    async (_req, res, data) => {
      res.json(
        await query(
          pool,
          `SELECT a.id, a.approval_type, a.entity_type, a.entity_id, a.payload, a.status,
                  a.requested_reason, a.requested_at, a.review_note, a.decision_reason,
                  requester.full_name AS requested_by_name,
                  reviewer.full_name AS reviewed_by_name,
                  approver.full_name AS approved_by_name
             FROM approvals a
             JOIN users requester ON requester.id = a.requested_by
             LEFT JOIN users reviewer ON reviewer.id = a.reviewed_by
             LEFT JOIN users approver ON approver.id = a.approved_by
            WHERE ($1::text IS NULL OR a.status = $1)
              AND ($2::text IS NULL OR a.approval_type = $2)
            ORDER BY a.requested_at DESC LIMIT 200`,
          [data.status ?? null, data.type ?? null],
        ),
      );
    },
  ),
);

governmentRouter.post(
  '/approvals',
  requirePermission('approval:request'),
  validateBody(
    z.object({
      approvalType: z.enum([
        'AGENT_ACTIVATION',
        'AGENT_SUSPENSION',
        'COMMISSION_ADJUSTMENT',
        'COMMISSION_PAYOUT',
        'REFUND',
        'PAYMENT_REVERSAL',
        'REVENUE_RATE_CHANGE',
        'MANUAL_CORRECTION',
        'BANK_ACCOUNT_CHANGE',
        'TAXPAYER_ADJUSTMENT',
        'AGENT_OVERRIDE_ACTIVATION',
      ]),
      entityType: z.string().min(2).max(60),
      entityId: z.string().min(1).max(80),
      payload: z.record(z.string(), z.unknown()).default({}),
      reason: z.string().min(10, 'Explain what is being requested and why'),
    }),
    async (req, res, data) => {
      const approval = await withTransaction(async (client) => {
        const row = await queryOne<{ id: string }>(
          client,
          `INSERT INTO approvals
             (approval_type, entity_type, entity_id, payload, requested_by, requested_reason)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [
            data.approvalType,
            data.entityType,
            data.entityId,
            JSON.stringify(data.payload),
            req.auth!.userId,
            data.reason,
          ],
        );
        await recordAudit(client, {
          actorId: req.auth!.userId,
          actorRole: req.auth!.role,
          action: 'approval.requested',
          entityType: 'approval',
          entityId: row!.id,
          newValue: { approvalType: data.approvalType, entityId: data.entityId },
          reason: data.reason,
        });
        return row!;
      });

      res.status(201).json({ approvalId: approval.id, status: 'REQUESTED' });
    },
  ),
);

governmentRouter.post(
  '/approvals/:id/decide',
  requirePermission('approval:review', 'approval:authorise'),
  validateBody(
    z.object({
      decision: z.enum(['REVIEW', 'APPROVE', 'REJECT']),
      reason: z.string().min(10, 'Give a reason for the decision'),
    }),
    async (req, res, data) => {
      const result = await withTransaction(async (client) => {
        const approval = await queryOne<{
          id: string;
          status: string;
          requested_by: string;
          reviewed_by: string | null;
          approval_type: string;
        }>(
          client,
          'SELECT id, status, requested_by, reviewed_by, approval_type FROM approvals WHERE id = $1 FOR UPDATE',
          [req.params.id],
        );
        if (!approval) throw notFound('That approval request');

        // Segregation of duties, checked here as well as by the CHECK
        // constraints — the requester can never review or approve their own.
        if (approval.requested_by === req.auth!.userId) {
          throw forbidden(
            'You raised this request, so you cannot review or approve it. Another officer must decide.',
          );
        }
        if (data.decision === 'APPROVE' && approval.reviewed_by === req.auth!.userId) {
          throw forbidden('The officer who reviewed a request may not also authorise it.');
        }
        if (!['REQUESTED', 'REVIEWED'].includes(approval.status)) {
          throw conflict(
            'APPROVAL_ALREADY_DECIDED',
            `This request is already ${approval.status.toLowerCase()}.`,
          );
        }

        const nextStatus =
          data.decision === 'REVIEW' ? 'REVIEWED' : data.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';

        await client.query(
          `UPDATE approvals
              SET status = $2,
                  reviewed_by = CASE WHEN $2 = 'REVIEWED' THEN $3 ELSE reviewed_by END,
                  reviewed_at = CASE WHEN $2 = 'REVIEWED' THEN now() ELSE reviewed_at END,
                  review_note = CASE WHEN $2 = 'REVIEWED' THEN $4 ELSE review_note END,
                  approved_by = CASE WHEN $2 IN ('APPROVED','REJECTED') THEN $3 ELSE approved_by END,
                  approved_at = CASE WHEN $2 IN ('APPROVED','REJECTED') THEN now() ELSE approved_at END,
                  decision_reason = CASE WHEN $2 IN ('APPROVED','REJECTED') THEN $4 ELSE decision_reason END
            WHERE id = $1`,
          [req.params.id, nextStatus, req.auth!.userId, data.reason],
        );

        await recordAudit(client, {
          actorId: req.auth!.userId,
          actorRole: req.auth!.role,
          action: `approval.${nextStatus.toLowerCase()}`,
          entityType: 'approval',
          entityId: req.params.id,
          oldValue: { status: approval.status },
          newValue: { status: nextStatus },
          reason: data.reason,
        });

        return { status: nextStatus, approvalType: approval.approval_type };
      });

      res.json(result);
    },
  ),
);

/** Execute an approved reversal or refund (PRD §71). */
governmentRouter.post(
  '/approvals/:id/execute-reversal',
  requirePermission('payment:reverse:approve'),
  requireStepUp('payment.reversal.approve'),
  asyncHandler(async (req, res) => {
    const result = await reconciliation.executeReversal({
      approvalId: req.params.id,
      actorId: req.auth!.userId,
      actorRole: req.auth!.role,
    });
    res.json(result);
  }),
);

// ---------------------------------------------------------------------------
// Commission administration
// ---------------------------------------------------------------------------

governmentRouter.post(
  '/commissions/promote',
  requirePermission('commission:manage'),
  asyncHandler(async (_req, res) => {
    const promoted = await commission.promoteEligibleCommissions();
    res.json({ promoted, message: `${promoted} commission record(s) became eligible for payout.` });
  }),
);

governmentRouter.get(
  '/commissions/payouts',
  requirePermission('commission:read:all'),
  validateQuery(z.object({ status: z.string().optional() }), async (_req, res, data) => {
    res.json(
      await query(
        pool,
        `SELECT p.id, p.payout_reference, p.amount_kobo, p.commission_count, p.status,
                p.bank_reference, p.requested_at, p.approved_at, p.paid_at,
                a.agent_code, u.full_name, b.bank_name, b.account_number, b.verification_status
           FROM commission_payouts p
           JOIN agents a ON a.id = p.agent_id
           JOIN users u ON u.id = a.user_id
           JOIN bank_accounts b ON b.id = p.bank_account_id
          WHERE ($1::text IS NULL OR p.status = $1)
          ORDER BY p.requested_at DESC LIMIT 200`,
        [data.status ?? null],
      ),
    );
  }),
);

governmentRouter.post(
  '/commissions/payouts/:id/approve',
  requirePermission('commission:payout:approve'),
  validateBody(
    z.object({ reason: z.string().min(5, 'Give a reason for the approval') }),
    async (req, res, data) => {
      await withTransaction(async (client) => {
        const payout = await queryOne<{ id: string; approval_id: string | null; requested_by: string | null }>(
          client,
          'SELECT id, approval_id, requested_by FROM commission_payouts WHERE id = $1 FOR UPDATE',
          [req.params.id],
        );
        if (!payout) throw notFound('That payout');
        if (payout.requested_by === req.auth!.userId) {
          throw forbidden('You cannot approve a payout you requested yourself.');
        }

        await client.query(
          `UPDATE commission_payouts SET status = 'APPROVED', approved_by = $2, approved_at = now()
            WHERE id = $1`,
          [req.params.id, req.auth!.userId],
        );

        if (payout.approval_id) {
          await client.query(
            `UPDATE approvals SET status = 'APPROVED', approved_by = $2, approved_at = now(),
                    decision_reason = $3
              WHERE id = $1`,
            [payout.approval_id, req.auth!.userId, data.reason],
          );
        }

        await recordAudit(client, {
          actorId: req.auth!.userId,
          actorRole: req.auth!.role,
          action: 'commission.payout_approved',
          entityType: 'commission_payout',
          entityId: req.params.id,
          reason: data.reason,
        });
      });

      res.json({ approved: true });
    },
  ),
);

governmentRouter.post(
  '/commissions/payouts/:id/complete',
  requirePermission('commission:manage'),
  validateBody(
    z.object({ bankReference: z.string().min(3).max(80) }),
    async (req, res, data) => {
      await commission.completePayout({
        payoutId: req.params.id,
        bankReference: data.bankReference,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
      });
      res.json({ paid: true });
    },
  ),
);

// ---------------------------------------------------------------------------
// Fraud (PRD §32, §72)
// ---------------------------------------------------------------------------

governmentRouter.get(
  '/fraud/flags',
  requirePermission('fraud:read'),
  validateQuery(
    z.object({
      status: z.string().optional(),
      severity: z.string().optional(),
      limit: z.coerce.number().int().max(500).default(100),
    }),
    async (_req, res, data) => {
      res.json(
        await query(
          pool,
          `SELECT f.id, f.rule, f.severity, f.entity_type, f.entity_id, f.detail, f.status,
                  f.created_at, f.resolution_note, a.agent_code, u.full_name AS agent_name,
                  t.transaction_reference
             FROM fraud_flags f
             LEFT JOIN agents a ON a.id = f.agent_id
             LEFT JOIN users u ON u.id = a.user_id
             LEFT JOIN transactions t ON t.id = f.transaction_id
            WHERE ($1::text IS NULL OR f.status = $1)
              AND ($2::text IS NULL OR f.severity = $2)
            ORDER BY f.created_at DESC LIMIT $3`,
          [data.status ?? null, data.severity ?? null, data.limit],
        ),
      );
    },
  ),
);

governmentRouter.post(
  '/fraud/flags/:id/review',
  requirePermission('fraud:manage'),
  validateBody(
    z.object({
      decision: z.enum(['UNDER_REVIEW', 'CONFIRMED', 'DISMISSED']),
      note: z.string().min(10, 'Record what was found'),
    }),
    async (req, res, data) => {
      await withTransaction(async (client) => {
        const flag = await queryOne<{ id: string; status: string; agent_id: string | null }>(
          client,
          'SELECT id, status, agent_id FROM fraud_flags WHERE id = $1',
          [req.params.id],
        );
        if (!flag) throw notFound('That fraud flag');

        await client.query(
          `UPDATE fraud_flags SET status = $2, resolution_note = $3, reviewed_by = $4, reviewed_at = now()
            WHERE id = $1`,
          [req.params.id, data.decision, data.note, req.auth!.userId],
        );

        // A confirmed flag freezes the agent's incentive but does not stop them
        // serving taxpayers; suspension is a separate, deliberate decision.
        if (data.decision === 'CONFIRMED' && flag.agent_id) {
          await commission.holdCommissionsForAgent(client, {
            agentId: flag.agent_id,
            reason: `Confirmed fraud flag ${req.params.id}`,
            actorId: req.auth!.userId,
          });
        }

        await recordAudit(client, {
          actorId: req.auth!.userId,
          actorRole: req.auth!.role,
          action: 'fraud.flag_reviewed',
          entityType: 'fraud_flag',
          entityId: req.params.id,
          oldValue: { status: flag.status },
          newValue: { status: data.decision },
          reason: data.note,
        });
      });

      res.json({ reviewed: true });
    },
  ),
);

governmentRouter.post(
  '/fraud/sweep',
  requirePermission('fraud:manage'),
  asyncHandler(async (_req, res) => {
    const result = await withTransaction((client) => runFraudSweep(client));
    res.json(result);
  }),
);

// ---------------------------------------------------------------------------
// Audit (PRD §45, §67)
// ---------------------------------------------------------------------------

governmentRouter.get(
  '/audit',
  requirePermission('audit:read'),
  validateQuery(
    z.object({
      entityType: z.string().optional(),
      entityId: z.string().optional(),
      actorId: uuidSchema.optional(),
      action: z.string().optional(),
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
      limit: z.coerce.number().int().max(500).default(100),
      format: z.enum(['json', 'csv']).default('json'),
    }),
    async (_req, res, data) => {
      const rows = await query(
        pool,
        `SELECT a.sequence_no, a.created_at, a.action, a.entity_type, a.entity_id, a.result,
                a.reason, a.old_value, a.new_value, a.ip_address, a.device_id,
                u.full_name AS actor_name, a.actor_role, a.hash
           FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
          WHERE ($1::text IS NULL OR a.entity_type = $1)
            AND ($2::text IS NULL OR a.entity_id = $2)
            AND ($3::uuid IS NULL OR a.actor_id = $3)
            AND ($4::text IS NULL OR a.action = $4)
            AND ($5::timestamptz IS NULL OR a.created_at >= $5)
            AND ($6::timestamptz IS NULL OR a.created_at <= $6)
          ORDER BY a.sequence_no DESC LIMIT $7`,
        [
          data.entityType ?? null,
          data.entityId ?? null,
          data.actorId ?? null,
          data.action ?? null,
          data.from ?? null,
          data.to ?? null,
          data.limit,
        ],
      );

      if (data.format === 'csv') {
        res.setHeader('content-type', 'text/csv');
        res.setHeader('content-disposition', 'attachment; filename="audit-log.csv"');
        res.send(reports.toCsv(rows));
        return;
      }
      res.json(rows);
    },
  ),
);

/** Replay the audit hash chain to prove it has not been tampered with. */
governmentRouter.get(
  '/audit/verify',
  requirePermission('audit:read'),
  validateQuery(
    z.object({
      fromSequence: z.coerce.number().int().min(0).default(0),
      limit: z.coerce.number().int().max(50_000).default(10_000),
    }),
    async (_req, res, data) => {
      const result = await verifyAuditChain(pool, {
        fromSequence: data.fromSequence,
        limit: data.limit,
      });
      res.json({
        ...result,
        message: result.valid
          ? `Audit chain verified over ${result.entriesChecked} entries. No tampering detected.`
          : `Audit chain broken at entry ${result.brokenAtSequence}: ${result.detail}`,
      });
    },
  ),
);

// PRD §67's worked examples, each as an endpoint.
governmentRouter.get(
  '/audit/queries/agent-transactions',
  requirePermission('audit:read', 'report:read:all'),
  validateQuery(
    z.object({ agentId: uuidSchema, from: z.string().datetime(), to: z.string().datetime() }),
    async (_req, res, data) => {
      res.json(
        await reports.transactionsByAgent(pool, {
          agentId: data.agentId,
          from: new Date(data.from),
          to: new Date(data.to),
        }),
      );
    },
  ),
);

governmentRouter.get(
  '/audit/queries/reversed-after-success',
  requirePermission('audit:read', 'report:read:all'),
  validateQuery(
    z.object({ from: z.string().datetime().optional(), to: z.string().datetime().optional() }),
    async (_req, res, data) => {
      res.json(
        await reports.reversedAfterSuccess(pool, {
          from: data.from ? new Date(data.from) : undefined,
          to: data.to ? new Date(data.to) : undefined,
        }),
      );
    },
  ),
);

// `catalogue:configure`, not `catalogue:read`: reading the catalogue is
// something every agent does to price a charge, but the history of who changed
// a government rate, when and why is administrative information.
governmentRouter.get(
  '/audit/queries/rate-changes',
  requirePermission('audit:read', 'catalogue:configure'),
  validateQuery(z.object({ revenueItemId: uuidSchema.optional() }), async (_req, res, data) => {
    res.json(await reports.rateChangeHistory(pool, data));
  }),
);

governmentRouter.get(
  '/audit/queries/taxpayer-access',
  requirePermission('audit:read'),
  validateQuery(z.object({ taxpayerId: uuidSchema }), async (_req, res, data) => {
    res.json(await reports.taxpayerAccessLog(pool, data.taxpayerId));
  }),
);

governmentRouter.get(
  '/audit/queries/receipts-by-item',
  requirePermission('audit:read', 'report:read:all'),
  validateQuery(z.object({ revenueItemCode: z.string().min(2) }), async (_req, res, data) => {
    res.json(await reports.receiptsByRevenueItem(pool, data));
  }),
);

// ---------------------------------------------------------------------------
// Incentive programmes (PRD §41)
// ---------------------------------------------------------------------------

governmentRouter.get(
  '/programmes',
  requirePermission('incentive:read:all', 'incentive:configure'),
  validateQuery(z.object({ status: z.string().optional() }), async (_req, res, data) => {
    res.json(await incentives.listProgrammes(pool, data));
  }),
);

governmentRouter.post(
  '/programmes',
  requirePermission('incentive:configure'),
  validateBody(
    z.object({
      name: z.string().min(3).max(150),
      code: z.string().min(2).max(40),
      description: z.string().max(1000).optional(),
      benefitType: z.string().min(2).max(60),
      benefitDescription: z.string().max(500).optional(),
      targetLgaIds: z.array(uuidSchema).optional(),
      targetTaxpayerTypes: z.array(z.enum(['INDIVIDUAL', 'BUSINESS'])).optional(),
      minimumScore: z.number().int().min(0).max(100).optional(),
      minimumCompliancePeriods: z.number().int().min(0).optional(),
      requiresNoArrears: z.boolean().optional(),
      startDate: z.string().date(),
      endDate: z.string().date().optional(),
      approvalAuthority: z.string().min(3).max(150),
      essentialServiceLegalBasis: z.string().max(500).optional(),
    }),
    async (req, res, data) => {
      const result = await incentives.createProgramme({
        input: data,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
      });
      res.status(201).json(result);
    },
  ),
);

governmentRouter.post(
  '/programmes/:id/evaluate',
  requirePermission('incentive:configure', 'incentive:read:all'),
  validateBody(z.object({ taxpayerId: uuidSchema }), async (req, res, data) => {
    const result = await incentives.evaluateEligibility({
      programmeId: req.params.id,
      taxpayerId: data.taxpayerId,
    });
    res.json(result);
  }),
);

governmentRouter.post(
  '/programmes/:id/status',
  requirePermission('incentive:configure'),
  validateBody(
    z.object({ status: z.enum(['DRAFT', 'ACTIVE', 'CLOSED']) }),
    async (req, res, data) => {
      await withTransaction(async (client) => {
        await client.query('UPDATE incentive_programmes SET status = $2 WHERE id = $1', [
          req.params.id,
          data.status,
        ]);
        await recordAudit(client, {
          actorId: req.auth!.userId,
          actorRole: req.auth!.role,
          action: 'incentive.programme_status_changed',
          entityType: 'incentive_programme',
          entityId: req.params.id,
          newValue: { status: data.status },
        });
      });
      res.json({ status: data.status });
    },
  ),
);

// ---------------------------------------------------------------------------
// Reference data and platform status
// ---------------------------------------------------------------------------

// LGAs and wards are served publicly from /api/v1/reference — both front-ends
// need them before sign-in, and they identify no one.

governmentRouter.get(
  '/reference/territories',
  requirePermission('agent:read:all', 'agent:read:assigned'),
  asyncHandler(async (_req, res) => {
    res.json(
      await query(
        pool,
        `SELECT t.id, t.name, t.code, l.name AS lga_name,
                (SELECT count(*) FROM agents a WHERE a.territory_id = t.id) AS agent_count
           FROM territories t JOIN lgas l ON l.id = t.lga_id
          WHERE t.status = 'ACTIVE' ORDER BY l.name, t.name`,
      ),
    );
  }),
);

/** Source-of-truth map and integration state (PRD §82). */
governmentRouter.get(
  '/platform/integrations',
  requirePermission('system:configure', 'audit:read'),
  asyncHandler(async (_req, res) => {
    res.json(integrationStatus());
  }),
);

// ---------------------------------------------------------------------------
// Support tickets (PRD §77, §78)
// ---------------------------------------------------------------------------

export const supportRouter = Router();

supportRouter.use(authenticate);

supportRouter.post(
  '/tickets',
  validateBody(
    z.object({
      category: z.enum([
        'PAYMENT_ISSUE',
        'TIN_ISSUE',
        'VEHICLE_ISSUE',
        'RECEIPT_ISSUE',
        'TECHNICAL_ISSUE',
        'TAXPAYER_COMPLAINT',
        'INCORRECT_ASSESSMENT',
        'AGENT_MISCONDUCT',
        'UNAUTHORISED_CHARGE',
      ]),
      subject: z.string().min(5).max(200),
      description: z.string().min(10).max(4000),
      transactionReference: z.string().max(40).optional(),
      priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
    }),
    async (req, res, data) => {

      const ticket = await withTransaction(async (client) => {
        let transactionId: string | null = null;
        let agentId: string | null = null;
        let taxpayerId: string | null = null;

        if (data.transactionReference) {
          const transaction = await queryOne<{ id: string; agent_id: string | null; taxpayer_id: string }>(
            client,
            'SELECT id, agent_id, taxpayer_id FROM transactions WHERE transaction_reference = $1',
            [data.transactionReference],
          );
          if (!transaction) {
            throw badRequest(`No transaction found with reference ${data.transactionReference}.`);
          }
          transactionId = transaction.id;
          agentId = transaction.agent_id;
          taxpayerId = transaction.taxpayer_id;
        }

        const ticketNumber = await nextTicketNumber(client);
        const row = await queryOne<{ id: string }>(
          client,
          `INSERT INTO support_tickets
             (ticket_number, raised_by, raiser_role, category, subject, description,
              transaction_id, agent_id, taxpayer_id, priority)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
          [
            ticketNumber,
            req.auth!.userId,
            req.auth!.role,
            data.category,
            data.subject,
            data.description,
            transactionId,
            agentId,
            taxpayerId,
            data.priority,
          ],
        );

        return { id: row!.id, ticketNumber };
      });

      res.status(201).json(ticket);
    },
  ),
);

supportRouter.get(
  '/tickets',
  validateQuery(
    z.object({ status: z.string().optional(), limit: z.coerce.number().int().max(200).default(50) }),
    async (req, res, data) => {
      // A raiser sees only their own tickets; support staff see everything.
      const scopeToSelf = !req.auth!.permissions.includes('support:read:all');
      res.json(
        await query(
          pool,
          `SELECT t.id, t.ticket_number, t.category, t.subject, t.status, t.priority,
                  t.created_at, t.resolved_at, u.full_name AS raised_by_name,
                  tr.transaction_reference
             FROM support_tickets t
             JOIN users u ON u.id = t.raised_by
             LEFT JOIN transactions tr ON tr.id = t.transaction_id
            WHERE ($1::uuid IS NULL OR t.raised_by = $1)
              AND ($2::text IS NULL OR t.status = $2)
            ORDER BY t.created_at DESC LIMIT $3`,
          [scopeToSelf ? req.auth!.userId : null, data.status ?? null, data.limit],
        ),
      );
    },
  ),
);

supportRouter.post(
  '/tickets/:id/update',
  requirePermission('support:manage'),
  validateBody(
    z.object({
      status: z.enum(['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']),
      resolution: z.string().max(2000).optional(),
      assignedTo: uuidSchema.optional(),
    }),
    async (req, res, data) => {
      if (data.status === 'RESOLVED' && !data.resolution) {
        throw badRequest('Record how the issue was resolved before marking the ticket resolved.');
      }

      await withTransaction(async (client) => {
        await client.query(
          `UPDATE support_tickets
              SET status = $2, resolution = COALESCE($3, resolution),
                  assigned_to = COALESCE($4, assigned_to),
                  resolved_at = CASE WHEN $2 = 'RESOLVED' THEN now() ELSE resolved_at END
            WHERE id = $1`,
          [req.params.id, data.status, data.resolution ?? null, data.assignedTo ?? null],
        );
        await recordAudit(client, {
          actorId: req.auth!.userId,
          actorRole: req.auth!.role,
          action: 'support.ticket_updated',
          entityType: 'support_ticket',
          entityId: req.params.id,
          newValue: { status: data.status },
        });
      });

      res.json({ updated: true });
    },
  ),
);

export { parseKobo };
