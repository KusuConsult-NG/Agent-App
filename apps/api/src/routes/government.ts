/**
 * Government portal endpoints: dashboards, reconciliation, approvals, fraud,
 * audit, reports and incentive programmes (PRD §37-§39, §45-§49, §67, §72).
 */

import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { ECONOMIC_SECTOR_CODES, parseKobo } from '@psirs/shared';
import { LOCK_NAMESPACE, pool, query, queryOne, withJobLock, withTransaction } from '../db/pool';
import { authenticate, requirePermission, requireStepUp } from '../middleware/auth';
import {
  asyncHandler,
  koboSchema,
  type RouteRequest,
  uuidSchema,
  validateBody,
  validateQuery,
} from '../middleware/validate';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { recordAudit, verifyAuditChain } from '../services/audit';
import * as auth from '../services/auth';
import * as agents from '../services/agents';
import * as reconciliation from '../services/reconciliation';
import * as reports from '../services/reports';
import { resolveReportScope, territoriesForOfficer } from '../services/report-scope';
import * as incentives from '../services/incentives';
import * as support from '../services/support';
import * as commission from '../services/commission';
import { leakageDashboard, runFraudSweep } from '../services/fraud';
import * as cases from '../services/cases';
import * as investigation from '../services/investigation';
import * as targets from '../services/targets';
import * as organisation from '../services/organisation';
import * as periods from '../services/periods';
import * as rbacStore from '../services/rbac-store';
import * as workbench from '../services/audit-workbench';
import * as exporting from '../services/export';
import { integrationStatus } from '../integrations';
import { jobHealth } from '../services/jobs';
import { sendDueReminders } from '../services/reminders';

export const governmentRouter = Router();

governmentRouter.use(authenticate);

// ---------------------------------------------------------------------------
// Whether the unattended work is running
// ---------------------------------------------------------------------------

/**
 * The state of every background job, whether or not it has ever run.
 *
 * `audit:read` rather than `system:configure`. Fixing a stopped sweep is an
 * administrator's job, but whether the reconciliation control actually operated
 * is an audit fact — an auditor who cannot see it is being asked to take the
 * platform's word for the one thing they are there to check. The four roles
 * that hold the permission are the four that have a reason to ask.
 */
governmentRouter.get(
  '/workers',
  requirePermission('audit:read'),
  asyncHandler(async (_req, res) => {
    res.json(await jobHealth());
  }),
);

// ---------------------------------------------------------------------------
// Dashboards and intelligence
// ---------------------------------------------------------------------------

governmentRouter.get(
  '/dashboard',
  // report:read:territory is here because a supervisor holds it and held no
  // other way in: this endpoint answered 403 for them and the portal menu hid
  // it, so the role that runs a territory had no dashboard at all. What they
  // get is narrowed by `resolveReportScope`, not by which endpoint they reach.
  requirePermission('dashboard:executive', 'report:read:all', 'report:read:territory'),
  asyncHandler(async (req, res) => {
    const scope = await resolveReportScope(pool, req.auth!);
    res.json(await reports.executiveDashboard(pool, scope));
  }),
);

/*
 * What each levy brought in, and who has not paid it.
 *
 * Two questions an officer asks constantly and could ask nowhere: how much did
 * Development Levy raise in this LGA last month, and which of the people
 * assessed under Market Levy still owe. The dashboard grouped revenue by
 * category already, but statewide, for all time, and no further down than the
 * category — enough for a commissioner and not enough to plan a week's work.
 */
governmentRouter.get(
  '/revenue/by-category',
  requirePermission('report:read:all', 'report:read:territory', 'dashboard:executive'),
  validateQuery(
    z.object({
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
      lgaId: uuidSchema.optional(),
      agentId: uuidSchema.optional(),
      categoryId: uuidSchema.optional(),
    }),
    async (req, res, data) => {
      const scope = await resolveReportScope(pool, req.auth!);
      res.json(await reports.revenueByCategory(pool, data, scope));
    },
  ),
);

governmentRouter.get(
  '/revenue/defaulters',
  requirePermission('report:read:all', 'report:read:territory', 'taxpayer:read:all'),
  validateQuery(
    z.object({
      categoryId: uuidSchema.optional(),
      revenueItemId: uuidSchema.optional(),
      lgaId: uuidSchema.optional(),
      limit: z.coerce.number().int().min(1).max(500).default(100),
    }),
    async (req, res, data) => {
      const scope = await resolveReportScope(pool, req.auth!);
      res.json(await reports.defaultersByCategory(pool, data, scope));
    },
  ),
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
    async (req, res, data) => {
      const scope = await resolveReportScope(pool, req.auth!);
      res.json(
        await reports.geographicIntelligence(pool, {
          lgaId: data.lgaId,
          wardId: data.wardId,
          from: data.from ? new Date(data.from) : undefined,
          to: data.to ? new Date(data.to) : undefined,
        }, scope),
      );
    },
  ),
);

/**
 * The revenue summary an administrator opens.
 *
 * One call rather than five, because these are read together: what was
 * collected, whose it is, where it came from, who collected it, and how much
 * of it can be placed on a map at all. Scoped like every other report — a
 * supervisor sees their territories.
 */
governmentRouter.get(
  '/revenue/summary',
  requirePermission('report:read:all', 'report:read:territory'),
  validateQuery(
    z.object({
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
    }),
    async (req, res, data) => {
      const scope = await resolveReportScope(pool, req.auth!);
      const window = {
        from: data.from ? new Date(data.from) : undefined,
        to: data.to ? new Date(data.to) : undefined,
      };
      const [byMda, areas, agents, coverage, localGovernment] = await Promise.all([
        reports.revenueByMda(pool, window, scope),
        reports.revenueGenerationAreas(pool, window, scope),
        reports.agentCollectionMap(pool, window, scope),
        reports.collectionMappingCoverage(pool, window, scope),
        // PSIRS collects for the Councils, so what each is owed belongs on
        // the same page as what was collected.
        reports.localGovernmentRemittance(pool, window, scope),
      ]);
      res.json({ byMda, areas, agents, coverage, localGovernment, scope });
    },
  ),
);

/**
 * The home screen for whoever is signed in.
 *
 * Every officer landed on the same executive dashboard. It is a good screen
 * and the wrong first screen for four of the five roles that saw it — an
 * auditor opening the platform does not need this morning's collections and a
 * finance officer does not need the agent clearance queue.
 *
 * Dispatching on role rather than assembling everything and letting the client
 * choose: the queries are different work, and a finance officer should not pay
 * for the auditor's counts to be computed.
 */
governmentRouter.get(
  '/home',
  asyncHandler(async (req, res) => {
    const role = req.auth!.role;
    /*
     * Counts and the work behind them, together.
     *
     * A screen that says "3 agents awaiting clearance" and sends the officer
     * elsewhere to see which three is an index. The counts answer "is there
     * anything"; the items answer "what", so the top of each queue can be
     * acted on where it is found.
     */
    const blocks =
      role === 'admin'
        ? {
            role,
            admin: await reports.adminHome(pool),
            work: await reports.adminWorkItems(pool),
          }
        : role === 'revenue_officer'
          ? {
              role,
              revenue: await reports.revenueOfficerHome(pool),
              work: await reports.revenueOfficerWorkItems(pool),
            }
          : role === 'finance_officer'
            ? {
                role,
                finance: await reports.financeOfficerHome(pool),
                work: await reports.financeOfficerWorkItems(pool),
              }
            : role === 'auditor'
              ? {
                  role,
                  audit: await reports.auditorHome(pool),
                  work: await reports.auditorWorkItems(pool),
                }
              : { role };
    res.json(blocks);
  }),
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
      format: z.enum(['json', 'csv', 'xlsx', 'pdf']).default('json'),
    }),
    async (req, res, data) => {
      const rows = await query(
        pool,
        `SELECT t.transaction_reference, t.amount_kobo, t.service_charge_kobo, t.status,
                t.created_at, t.verified_at, t.settled_at,
                ri.name AS revenue_item, ri.name_ha AS revenue_item_ha,
                rc.name AS revenue_category, rc.name_ha AS revenue_category_ha,
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

      await deliver(req, res, {
        rows,
        format: data.format,
        subject: 'Transactions',
        filename: 'transactions',
        parameters: {
          status: data.status,
          lgaId: data.lgaId,
          agentId: data.agentId,
          revenueItemId: data.revenueItemId,
          from: data.from,
          to: data.to,
        },
      });
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

/**
 * Collections the gateway confirmed and has not yet handed over.
 *
 * Separate from the exception queue because it is not an exception: it is money
 * in transit, and the officer's job with it is to know the figure rather than to
 * act on each row. Anything past the settlement window has moved to the
 * exception queue instead, which is where somebody does have to act.
 */
governmentRouter.get(
  '/reconciliation/awaiting-settlement',
  requirePermission('payment:reconcile', 'report:financial', 'audit:read'),
  asyncHandler(async (_req, res) => {
    res.json(await reconciliation.awaitingSettlement(pool));
  }),
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

/**
 * Close a disputed settlement (PRD §47).
 *
 * A settlement whose figures did not match settles none of its collections, so
 * this is the way out: state what finally arrived and the bank reference that
 * proves it. `reconcileSettlement` refuses it unless the money now accounts
 * for the batch, and refuses the officer who recorded the settlement in the
 * first place.
 */
governmentRouter.post(
  '/settlements/:id/reconcile',
  requirePermission('payment:reconcile'),
  validateBody(
    z.object({
      receivedAmountKobo: koboSchema,
      bankReference: z.string().min(3).max(80),
      note: z.string().min(10, 'Record what the variance turned out to be'),
    }),
    async (req, res, data) => {
      res.json(
        await reconciliation.reconcileSettlement({
          settlementId: req.params.id,
          receivedAmountKobo: data.receivedAmountKobo,
          bankReference: data.bankReference,
          note: data.note,
          actorId: req.auth!.userId,
          actorRole: req.auth!.role,
        }),
      );
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
                  -- The id as well as the name. The portal decided whether to
                  -- offer Approve by comparing the requester's *name* against
                  -- the signed-in user's, which it had to because the id was
                  -- never sent. Two officers who share a name is not a rare
                  -- thing in one revenue office.
                  a.requested_by AS requested_by_user_id,
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

        /*
         * A bank account change is carried out here, in the same transaction
         * that records the decision, rather than by a route of its own.
         *
         * The alternative — marking the approval APPROVED and leaving a
         * separate endpoint to do the work — is how an approval comes to say a
         * decision was carried out while the money still goes somewhere else.
         * Deciding and doing are one act or they are a discrepancy waiting to
         * be found by an auditor.
         *
         * It also means the separation-of-duties checks above guard the change
         * itself and not merely the paperwork about it: the officer who asked
         * for the change cannot approve it, and the one who reviewed it cannot
         * authorise it, because those checks stand between this line and the
         * request. If execution refuses — an account the bank never confirmed,
         * a payout still in flight — it throws, and the whole transaction
         * including the decision is rolled back. An approval is never recorded
         * for a change that did not happen.
         */
        let applied: { accountNumberMasked: string; bankName: string } | null = null;

        /*
         * A commission payout is carried out here too, for the reason the
         * comment above gives: deciding and doing are one act or they are a
         * discrepancy waiting to be found.
         *
         * This branch did not exist. A rejection marked the approval REJECTED
         * and left everything requestPayout had done standing — the
         * commissions APPROVED against a payout that would never happen, where
         * nothing could ever pick them up again, and the agent's clawback
         * written off against a payment that was never made.
         */
        if (approval.approval_type === 'COMMISSION_PAYOUT') {
          const payout = await queryOne<{ id: string; status: string }>(
            client,
            'SELECT id, status FROM commission_payouts WHERE approval_id = $1 FOR UPDATE',
            [req.params.id],
          );
          if (!payout) throw notFound('The payout this approval belongs to');

          if (nextStatus === 'REJECTED') {
            await commission.refusePayout(client, {
              payoutId: payout.id,
              actorId: req.auth!.userId,
              actorRole: req.auth!.role,
              reason: data.reason,
            });
          } else if (nextStatus === 'APPROVED') {
            // So the two routes that can approve a payout agree about it.
            await client.query(
              `UPDATE commission_payouts
                  SET status = 'APPROVED', approved_by = $2, approved_at = now()
                WHERE id = $1 AND status = 'REQUESTED'`,
              [payout.id, req.auth!.userId],
            );
          }
        }

        if (approval.approval_type === 'BANK_ACCOUNT_CHANGE') {
          if (nextStatus === 'APPROVED') {
            applied = await agents.executeBankAccountChange(client, {
              approvalId: req.params.id,
              actorId: req.auth!.userId,
              actorRole: req.auth!.role,
            });
          } else if (nextStatus === 'REJECTED') {
            await agents.refuseBankAccountChange(client, {
              approvalId: req.params.id,
              actorId: req.auth!.userId,
              actorRole: req.auth!.role,
              reason: data.reason,
            });
          }
        }

        return {
          status: nextStatus,
          approvalType: approval.approval_type,
          ...(applied
            ? {
                message:
                  `Commission for this agent will now be paid into ${applied.bankName} ` +
                  `${applied.accountNumberMasked}. The previous account has been kept on record.`,
              }
            : {}),
        };
      });

      res.json(result);
    },
  ),
);

// ---------------------------------------------------------------------------
// Government users
// ---------------------------------------------------------------------------

/**
 * The officers whose access an administrator can change.
 *
 * Agents are excluded: their access follows the clearance pipeline, and
 * listing them here would invite somebody to change by role what activation
 * and suspension are meant to decide.
 */
governmentRouter.get(
  '/users',
  requirePermission('user:manage'),
  asyncHandler(async (req, res) => {
    const users = await query<{
      id: string;
      full_name: string;
      phone: string;
      role: string;
      status: string;
      last_login_at: Date | null;
    }>(
      pool,
      `SELECT id, full_name, phone, role, status, last_login_at
         FROM users WHERE role <> 'agent' ORDER BY full_name`,
    );
    res.json({
      users: users.map((user) => ({
        ...user,
        // So a screen can grey out the one row that can never be changed here
        // rather than offering a control that always refuses.
        isSelf: user.id === req.auth!.userId,
      })),
    });
  }),
);

/**
 * Change what an officer is allowed to do.
 *
 * Step-up as well as `user:manage`, because this is the action that turns one
 * compromised administrator session into any level of access at all. Nobody
 * may change their own role; the service refuses it before anything else.
 */
governmentRouter.post(
  '/users/:id/role',
  requirePermission('user:manage'),
  requireStepUp('user.role.change'),
  validateBody(
    z.object({
      role: z.enum(['admin', 'supervisor', 'revenue_officer', 'finance_officer', 'auditor']),
      reason: z
        .string()
        .trim()
        .min(10, 'Say why this access is changing, in at least 10 characters'),
    }),
    async (req, res, data) => {
      res.json(
        await auth.changeUserRole({
          targetUserId: req.params.id,
          newRole: data.role,
          actorId: req.auth!.userId,
          actorRole: req.auth!.role,
          reason: data.reason,
        }),
      );
    },
  ),
);

/**
 * Close, suspend or reopen an officer's account.
 *
 * Step-up alongside `user:manage`, for the same reason a role change asks for
 * it: this is the lever that decides whether a person can sign in at all, and
 * one compromised administrator session should not be enough to work it.
 */
governmentRouter.post(
  '/users/:id/status',
  requirePermission('user:manage'),
  requireStepUp('user.role.change'),
  validateBody(
    z.object({
      status: z.enum(['ACTIVE', 'SUSPENDED', 'CLOSED']),
      reason: z
        .string()
        .trim()
        .min(10, 'Say why this account is changing, in at least 10 characters'),
    }),
    async (req, res, data) => {
      res.json(
        await auth.setUserStatus({
          targetUserId: req.params.id,
          status: data.status,
          actorId: req.auth!.userId,
          actorRole: req.auth!.role,
          reason: data.reason,
        }),
      );
    },
  ),
);

/**
 * The territories an officer sees reports for, and the list to choose from.
 *
 * Without this the scoping added in migration 023 would be inert: every
 * supervisor would sit permanently unassigned, seeing nothing, with no way for
 * an administrator to change it. A control that can only be exercised with
 * `psql` is not a control.
 */
governmentRouter.get(
  '/users/:id/territories',
  requirePermission('user:manage'),
  asyncHandler(async (req, res) => {
    res.json({
      assigned: await territoriesForOfficer(pool, req.params.id),
      available: await query(
        pool,
        `SELECT t.id, t.name, t.name_ha, t.code, l.name AS lga_name
           FROM territories t JOIN lgas l ON l.id = t.lga_id
          WHERE t.status = 'ACTIVE'
          ORDER BY l.name, t.name`,
      ),
    });
  }),
);

/**
 * Set them.
 *
 * `user:manage` and a reason, the same as a role change, because this decides
 * how much of the state's revenue an officer can see. It does not require
 * step-up: a role change can manufacture any level of access from one
 * compromised session, whereas this only moves an officer between territories
 * they could already have been assigned to — a narrower lever, and one an
 * administrator uses often enough that step-up on every reassignment would
 * train them to approve prompts without reading them.
 */
governmentRouter.post(
  '/users/:id/territories',
  requirePermission('user:manage'),
  validateBody(
    z.object({
      territoryIds: z.array(uuidSchema),
      reason: z
        .string()
        .trim()
        .min(10, 'Say why this coverage is changing, in at least 10 characters'),
    }),
    async (req, res, data) => {
      res.json(
        await auth.setOfficerTerritories({
          targetUserId: req.params.id,
          territoryIds: data.territoryIds,
          actorId: req.auth!.userId,
          actorRole: req.auth!.role,
          reason: data.reason,
        }),
      );
    },
  ),
);

/**
 * Refunds a taxpayer is still owed.
 *
 * A reversal voids the receipt immediately; returning the money depends on the
 * gateway, and anything it has not confirmed belongs on somebody's desk rather
 * than in a status nobody reads.
 */
governmentRouter.get(
  '/refunds/outstanding',
  requirePermission('payment:read:all'),
  asyncHandler(async (_req, res) => {
    res.json({ refunds: await reconciliation.outstandingRefunds(pool) });
  }),
);

governmentRouter.post(
  '/refunds/retry',
  requirePermission('payment:reconcile'),
  asyncHandler(async (req, res) => {
    const result = await reconciliation.retryOutstandingRefunds({
      actorId: req.auth!.userId,
      actorRole: req.auth!.role,
    });
    res.json({
      ...result,
      // The other two catch-up endpoints say what happened in a sentence; this
      // one returned bare counts, which left the screen to invent the wording
      // for the case that matters most — money still not returned.
      message:
        result.stillOutstanding === 0
          ? `${result.completed} refund(s) returned to taxpayers.`
          : `${result.completed} returned; ${result.stillOutstanding} still owed. ` +
            'Those taxpayers have not had their money back yet.',
    });
  }),
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
        const payout = await queryOne<{
          id: string;
          status: string;
          approval_id: string | null;
          requested_by: string | null;
        }>(
          client,
          'SELECT id, status, approval_id, requested_by FROM commission_payouts WHERE id = $1 FOR UPDATE',
          [req.params.id],
        );
        if (!payout) throw notFound('That payout');
        if (payout.requested_by === req.auth!.userId) {
          throw forbidden('You cannot approve a payout you requested yourself.');
        }

        /*
         * The approval this payout belongs to has the last word.
         *
         * This route wrote APPROVED without ever reading it, so a refusal
         * another officer had already recorded through /approvals/:id/decide
         * could be stepped over by calling this one — and the payout carried no
         * trace of the refusal for the second officer to notice.
         */
        if (payout.status !== 'REQUESTED') {
          throw conflict(
            'PAYOUT_NOT_APPROVABLE',
            `This payout is already ${payout.status.toLowerCase()}.`,
          );
        }
        if (payout.approval_id) {
          const approval = await queryOne<{ status: string }>(
            client,
            'SELECT status FROM approvals WHERE id = $1 FOR UPDATE',
            [payout.approval_id],
          );
          if (approval && !['REQUESTED', 'REVIEWED'].includes(approval.status)) {
            throw conflict(
              'APPROVAL_ALREADY_DECIDED',
              `The approval for this payout is already ${approval.status.toLowerCase()}.`,
            );
          }
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

/**
 * Record that the bank did not make the transfer (PRD §28).
 *
 * The other half of completing a payout. Without it an approved payout the
 * bank refused could only be left APPROVED for good — where the commissions in
 * it can never be picked up again — or marked paid, which says a transfer
 * happened when it did not.
 */
governmentRouter.post(
  '/commissions/payouts/:id/fail',
  requirePermission('commission:manage'),
  validateBody(
    z.object({
      reason: z.string().min(10, 'Record what the bank said, so the agent can be told'),
    }),
    async (req, res, data) => {
      res.json(
        await commission.failPayout({
          payoutId: req.params.id,
          reason: data.reason,
          actorId: req.auth!.userId,
          actorRole: req.auth!.role,
        }),
      );
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
        const flag = await queryOne<{
          id: string;
          status: string;
          agent_id: string | null;
          reviewed_by: string | null;
        }>(
          client,
          'SELECT id, status, agent_id, reviewed_by FROM fraud_flags WHERE id = $1',
          [req.params.id],
        );
        if (!flag) throw notFound('That fraud flag');

        /*
         * Reversing an upheld investigation takes a second officer.
         *
         * Confirming freezes the agent's commission and dismissing hands it
         * back, and both sat behind one permission and one person — so the
         * officer who upheld an investigation could, at any later moment,
         * release everything it was holding on their own say-so. Every
         * comparable release here already asks for somebody else: an officer
         * cannot change their own role, approve the bank account change they
         * requested, or authorise their own payout.
         *
         * Only the reversal is restricted. The same officer may still reopen
         * the flag for review, so the way to a second opinion stays open, and
         * a flag nobody has upheld is theirs to dismiss as before.
         */
        if (
          data.decision === 'DISMISSED' &&
          flag.status === 'CONFIRMED' &&
          flag.reviewed_by === req.auth!.userId
        ) {
          throw forbidden(
            'You confirmed this flag, so another officer has to be the one to dismiss it. ' +
              'Dismissing it releases the commission your confirmation froze.',
            'Reopen it for review with your findings, and ask a colleague to close it.',
          );
        }

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
            reason: commission.fraudFlagHoldReason(req.params.id),
            actorId: req.auth!.userId,
          });
        }

        // And clearing the agent has to give it back. Freezing on CONFIRMED
        // without releasing on DISMISSED left an investigated-and-cleared agent
        // unable to be paid for settled, reconciled work by any route short of
        // a manual database write.
        if (data.decision === 'DISMISSED') {
          await commission.releaseCommissionHold(client, {
            holdReason: commission.fraudFlagHoldReason(req.params.id),
            reason: `Fraud flag ${req.params.id} dismissed after review`,
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
      format: z.enum(['json', 'csv', 'xlsx', 'pdf']).default('json'),
    }),
    async (req, res, data) => {
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

      await deliver(req, res, {
        rows,
        format: data.format,
        subject: 'Audit log',
        filename: 'audit-log',
        parameters: {
          entityType: data.entityType,
          entityId: data.entityId,
          actorId: data.actorId,
          action: data.action,
          from: data.from,
          to: data.to,
        },
      });
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
        await reports.transactionsByAgent(
          pool,
          { agentId: data.agentId, from: new Date(data.from), to: new Date(data.to) },
          await resolveReportScope(pool, _req.auth!),
        ),
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
        await reports.reversedAfterSuccess(
          pool,
          {
            from: data.from ? new Date(data.from) : undefined,
            to: data.to ? new Date(data.to) : undefined,
          },
          await resolveReportScope(pool, _req.auth!),
        ),
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
    res.json(
      await reports.receiptsByRevenueItem(pool, data, await resolveReportScope(pool, _req.auth!)),
    );
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
      /*
       * Which sectors the programme is for. Empty or absent means all of them,
       * as with targetLgaIds. Validated against the shared vocabulary so a
       * typo is refused here rather than by a constraint at insert time.
       */
      targetSectors: z.array(z.enum(ECONOMIC_SECTOR_CODES)).max(30).optional(),
      /*
       * Reaching people through the body they already belong to. When set,
       * only a taxpayer whose membership the group's leader has confirmed is
       * in scope — an agent's unconfirmed claim is not enough.
       */
      requiresGroupMembership: z.boolean().optional(),
      targetGroupTypes: z
        .array(
          z.enum([
            'FARMERS_COOPERATIVE',
            'MARKET_ASSOCIATION',
            'TRANSPORT_UNION',
            'ARTISAN_GUILD',
            'TRADERS_ASSOCIATION',
            'FISHERIES_GROUP',
            'LIVESTOCK_ASSOCIATION',
            'OTHER',
          ]),
        )
        .optional(),
      minimumScore: z.number().int().min(0).max(100).optional(),
      minimumCompliancePeriods: z.number().int().min(0).optional(),
      requiresNoArrears: z.boolean().optional(),
      startDate: z.string().date(),
      endDate: z.string().date().optional(),
      approvalAuthority: z.string().min(3).max(150),
      /*
       * PRD §40's two lawful ways to link an essential service to compliance.
       * ADDITIVE_BENEFIT raises the tier for compliant taxpayers and never
       * withdraws the service; ELIGIBILITY_GATE can deny, and then the legal
       * authority for denying has to be recorded.
       *
       * This was missing from the schema while the service, the §40 guard and
       * the database all understood it, and zod strips unknown keys without
       * complaint. So every programme created through the API became a gate,
       * and the additive option — the one that cannot take health cover away
       * from a citizen in arrears — could not be chosen at all. An officer
       * building an additive programme was pushed into recording a legal basis
       * for a denial their programme does not make.
       */
      linkageMode: z.enum(['ELIGIBILITY_GATE', 'ADDITIVE_BENEFIT']).optional(),
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
        // Confirm the programme exists before recording that it changed. The
        // update alone matches nothing for a wrong id and says so to no one,
        // leaving an audit entry that reports a change to a programme that is
        // not there — sealed and hash-linked like any true one.
        const programme = await queryOne<{ id: string; status: string }>(
          client,
          'SELECT id, status FROM incentive_programmes WHERE id = $1 FOR UPDATE',
          [req.params.id],
        );
        if (!programme) throw notFound('That programme');

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
          oldValue: { status: programme.status },
          newValue: { status: data.status },
        });
      });
      res.json({ status: data.status });
    },
  ),
);

// ---------------------------------------------------------------------------
// Social programme beneficiaries and evaluation
// ---------------------------------------------------------------------------

governmentRouter.get(
  '/programmes/:id/beneficiaries',
  requirePermission('incentive:read:all'),
  validateQuery(
    z.object({
      eligible: z.enum(['true', 'false']).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }),
    async (req, res, data) => {
      const eligibleOnly = data.eligible !== 'false'; // default: only eligible
      const rows = await query<{
        taxpayer_id: string;
        tin: string | null;
        name: string;
        lga_name: string;
        score: number | null;
        eligible: boolean;
        reasons: unknown;
        evaluated_at: Date;
      }>(
        pool,
        `SELECT
           pe.taxpayer_id,
           t.tin,
           COALESCE(t.business_name, t.first_name || ' ' || COALESCE(t.last_name,'')) AS name,
           l.name AS lga_name,
           tc.score,
           pe.eligible,
           pe.reasons,
           pe.evaluated_at
         FROM programme_eligibility pe
         JOIN taxpayers t ON t.id = pe.taxpayer_id
         JOIN lgas l ON l.id = t.lga_id
         LEFT JOIN taxpayer_compliance tc ON tc.taxpayer_id = pe.taxpayer_id
         WHERE pe.programme_id = $1
           AND ($4::boolean IS NULL OR pe.eligible = $4)
         ORDER BY tc.score DESC NULLS LAST
         LIMIT $2 OFFSET $3`,
        [req.params.id, data.limit, data.offset, eligibleOnly ? true : null],
      );
      res.json({ beneficiaries: rows, total: rows.length, limit: data.limit, offset: data.offset });
    },
  ),
);

governmentRouter.post(
  '/programmes/:id/evaluate-all',
  requirePermission('incentive:configure'),
  asyncHandler(async (req, res) => {
    const programme = await queryOne<{ id: string; name: string; name_ha: string | null }>(
      pool,
      `SELECT id, name, name_ha FROM incentive_programmes WHERE id = $1`,
      [req.params.id],
    );
    if (!programme) throw notFound('Incentive programme');

    /*
     * Answer now, evaluate afterwards.
     *
     * The comment here said "queue in background" and the code did no such
     * thing: it walked every active taxpayer with a TIN inside the request,
     * one `await` at a time, holding a connection for as long as that took. On
     * a real register that is minutes, and a reverse proxy gives up long before
     * the loop does — so the officer sees a 504, the work carries on
     * invisibly, and pressing the button again starts a second pass over the
     * same people.
     *
     * The advisory lock is what makes the second press harmless. A programme
     * already being evaluated answers 409 rather than starting again beside
     * itself.
     */
    const programmeId = req.params.id;
    const actorId = req.auth!.userId;
    const actorRole = req.auth!.role;
    const lockName = `incentive-evaluate-all:${programmeId}`;

    const started = await queryOne<{ locked: boolean }>(
      pool,
      'SELECT pg_try_advisory_lock($1, hashtext($2)) AS locked',
      [LOCK_NAMESPACE.WORKER, lockName],
    );
    if (!started?.locked) {
      throw conflict(
        'EVALUATION_ALREADY_RUNNING',
        'This programme is already being evaluated. Wait for that pass to finish.',
        'The result appears against each taxpayer as it is worked through.',
      );
    }
    await pool
      .query('SELECT pg_advisory_unlock($1, hashtext($2))', [LOCK_NAMESPACE.WORKER, lockName])
      .catch(() => undefined);

    res.status(202).json({
      programme: programme.name,
      status: 'ACCEPTED',
      message:
        'Evaluation started. Eligibility appears against each taxpayer as they are worked ' +
        'through; this page does not wait for it.',
    });

    /*
     * Deliberately not awaited, and every failure swallowed into the audit
     * record rather than thrown: the response has already gone, so an
     * unhandled rejection here would take the process down rather than reach
     * anybody who could act on it.
     */
    void withJobLock(lockName, async () => {
      const taxpayerIds = await query<{ id: string }>(
        pool,
        `SELECT id FROM taxpayers WHERE status = 'ACTIVE' AND tin IS NOT NULL`,
      );

      let evaluated = 0;
      let failed = 0;
      for (const { id: taxpayerId } of taxpayerIds) {
        try {
          await incentives.evaluateEligibility({ programmeId, taxpayerId });
          evaluated += 1;
        } catch {
          // One taxpayer failing must not abort the batch, but it is counted:
          // "evaluated 900 of 1000" is a different fact from "evaluated 900".
          failed += 1;
        }
      }

      await withTransaction(async (client) => {
        await recordAudit(client, {
          actorId,
          actorRole,
          action: 'incentive.bulk_evaluated',
          entityType: 'incentive_programme',
          entityId: programmeId,
          newValue: { evaluated, failed, considered: taxpayerIds.length },
        });
      });
    }).catch(() => undefined);
  }),
);

// ---------------------------------------------------------------------------
// Tax reminder trigger (on-demand)
// ---------------------------------------------------------------------------

governmentRouter.post(
  '/reminders/send-due',
  requirePermission('support:manage'),
  asyncHandler(async (_req, res) => {
    const result = await sendDueReminders();
    res.json({
      ...result,
      message: `${result.sent} reminder(s) queued, ${result.skipped} skipped (errors or daily levies).`,
    });
  }),
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
        `SELECT t.id, t.name, t.name_ha, t.code, l.name AS lga_name,
                (SELECT count(*) FROM agents a WHERE a.territory_id = t.id) AS agent_count
           FROM territories t JOIN lgas l ON l.id = t.lga_id
          WHERE t.status = 'ACTIVE' ORDER BY l.name, t.name`,
      ),
    );
  }),
);

// ---------------------------------------------------------------------------
// Finding one thing, and seeing the whole of it
// ---------------------------------------------------------------------------

/**
 * The signed-in officer, as the services below want them.
 *
 * Permissions travel with the viewer rather than being re-derived from the
 * role, so gating a section of a 360 view and gating the screen that section
 * came from are the same decision made from the same source.
 */
/**
 * Send a result set in whichever format was asked for, and record that it left.
 *
 * The three formats share one path deliberately. When CSV was the only answer
 * the check for it sat inline at the end of a handler, and adding two more
 * would have meant three copies of the same content-type, filename and audit
 * decision in every endpoint that exports -- with the audit line being the one
 * a hurried copy would drop.
 *
 * `json` is the screen and is deliberately not an export: it is the same rows
 * an officer is already looking at, it stays inside the session, and treating
 * every page of a table as a data export would fill the audit log with noise
 * and make the entries that matter unfindable. Reads worth recording are
 * recorded through `recordReportView`, which the report screens call by name.
 */
async function deliver(
  req: RouteRequest,
  res: Response,
  options: {
    rows: Record<string, unknown>[];
    format: 'json' | exporting.ExportFormat;
    subject: string;
    filename: string;
    parameters: Record<string, unknown>;
  },
): Promise<void> {
  const { rows, format, subject, filename, parameters } = options;
  if (format === 'json') {
    res.json(rows);
    return;
  }

  /*
   * The gate is here rather than on the route, because the format is a query
   * parameter and the permission is about the format. Putting `data:export` on
   * the route would take the screen away from an officer to stop them taking
   * the file, which is the opposite of what it is for.
   */
  if (!req.auth!.permissions.includes('data:export')) {
    throw forbidden(
      'Your role may read this on screen and may not export it.',
      'Ask an administrator to grant your role the export permission.',
    );
  }

  /*
   * The limit is checked and the export recorded before a byte is written,
   * inside a transaction, so a refusal is a clean 403 rather than a half-sent
   * file -- and so an export that fails to be recorded does not happen.
   */
  await withTransaction((client) =>
    exporting.recordExport(
      client,
      {
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        subject,
        format,
        parameters,
      },
      rows.length,
    ),
  );

  if (format === 'csv') {
    res.setHeader('content-type', 'text/csv');
    res.setHeader('content-disposition', `attachment; filename="${filename}.csv"`);
    res.send(reports.toCsv(rows));
    return;
  }

  if (format === 'xlsx') {
    res.setHeader(
      'content-type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('content-disposition', `attachment; filename="${filename}.xlsx"`);
    res.send(exporting.toXlsx(rows, subject));
    return;
  }

  const pdf = await exporting.renderReportPdf({
    title: subject,
    rows,
    parameters,
    generatedBy: `${req.auth!.role} ${req.auth!.userId}`,
  });
  res.setHeader('content-type', 'application/pdf');
  res.setHeader('content-disposition', `attachment; filename="${filename}.pdf"`);
  res.send(pdf);
}

function officer(req: RouteRequest): investigation.Viewer {
  return {
    userId: req.auth!.userId,
    role: req.auth!.role,
    permissions: req.auth!.permissions,
  };
}

/*
 * One box, every kind of government reference.
 *
 * The permission here is deliberately the weakest one any portal role holds —
 * `catalogue:read`, which all five have — because this endpoint grants nothing
 * on its own. Each *kind* of result is gated separately inside `globalSearch`
 * on the permission its own screen requires, so a supervisor searching a
 * receipt number gets the receipt and no settlement, and an officer who cannot
 * open the users screen cannot enumerate staff from here either.
 *
 * Gating the endpoint itself on something stronger would only mean the roles
 * that hold less get no search at all, while changing nothing about what any
 * of them can see through it.
 */
governmentRouter.get(
  '/search',
  requirePermission('catalogue:read'),
  validateQuery(
    z.object({
      q: z.string().trim().min(2).max(120),
      limit: z.coerce.number().int().min(1).max(25).default(5),
    }),
    async (req, res, data) => {
      const scope = await resolveReportScope(pool, req.auth!);
      res.json(await investigation.globalSearch(pool, officer(req), { term: data.q, limit: data.limit }, scope));
    },
  ),
);

/*
 * Transaction 360.
 *
 * Gated on being able to see a transaction at all; everything beyond that —
 * the payments, the settlement, the commission, the audit history — is gated
 * section by section inside the service, and the answer names what it withheld
 * so an investigator can tell an empty section from a hidden one.
 *
 * `:key` is an id or a reference. An officer arriving from a citizen's SMS has
 * the reference and one arriving from a list has the id, and making them care
 * which is a needless way to lose people.
 */
governmentRouter.get(
  '/transactions/:key/full',
  requirePermission('payment:read:all', 'report:read:all', 'report:read:territory'),
  asyncHandler(async (req, res) => {
    const scope = await resolveReportScope(pool, req.auth!);
    res.json(await investigation.transaction360(pool, officer(req), req.params.key!, scope));
  }),
);

/*
 * The taxpayer base as a population, not as a count.
 *
 * "Active" here means paying within the window, not `status = 'ACTIVE'` — see
 * the service. A register full of people who last paid two years ago reports
 * 100% active under the other reading, which is the reading the dashboard had.
 */
governmentRouter.get(
  '/taxpayers/analytics',
  requirePermission('report:read:all', 'report:read:territory', 'taxpayer:read:all'),
  validateQuery(
    z.object({
      lgaId: uuidSchema.optional(),
      wardId: uuidSchema.optional(),
      categoryId: uuidSchema.optional(),
    }),
    async (req, res, data) => {
      const scope = await resolveReportScope(pool, req.auth!);
      res.json(await reports.taxpayerAnalytics(pool, data, scope));
    },
  ),
);

/** Commission by place and by month, which is how a Council asks about it. */
governmentRouter.get(
  '/commissions/by-place',
  requirePermission('commission:read:all'),
  validateQuery(
    z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() }),
    async (req, res, data) => {
      const scope = await resolveReportScope(pool, req.auth!);
      res.json(await reports.commissionByPlaceAndPeriod(pool, data, scope));
    },
  ),
);

// ---------------------------------------------------------------------------
// Revenue targets and forecasting
// ---------------------------------------------------------------------------

/*
 * Target versus actual.
 *
 * Every reporting role reads this: an achievement percentage is meaningless to
 * a finance officer who can see the actual and not the number it is measured
 * against. Setting one is `target:manage` and sits with the administrator and
 * the revenue officer alone.
 */
governmentRouter.get(
  '/targets',
  requirePermission('target:read:all'),
  validateQuery(
    z.object({
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
      scope: z.enum(targets.TARGET_SCOPES).optional(),
      periodKind: z.enum(targets.TARGET_PERIODS).optional(),
      lgaId: uuidSchema.optional(),
      includeInactive: z.coerce.boolean().optional(),
    }),
    async (req, res, data) => {
      const scope = await resolveReportScope(pool, req.auth!);
      res.json(await targets.targetProgress(pool, data, scope));
    },
  ),
);

/** The state figure beside the sum of what was apportioned below it. */
governmentRouter.get(
  '/targets/rollup',
  requirePermission('target:read:all'),
  validateQuery(
    z.object({ periodStart: z.coerce.date(), periodEnd: z.coerce.date() }),
    async (_req, res, data) => {
      res.json(await targets.targetRollup(pool, data));
    },
  ),
);

/*
 * The calendar period a label names, resolved on the server.
 *
 * A client computing "this month" from its own clock can be wrong about it, and
 * a target set against the wrong dates is silently wrong for a month.
 */
governmentRouter.get(
  '/targets/period',
  requirePermission('target:read:all'),
  validateQuery(
    z.object({
      kind: z.enum(targets.TARGET_PERIODS),
      anchor: z.coerce.date().optional(),
    }),
    async (_req, res, data) => {
      const period = targets.resolvePeriod(data.kind, data.anchor);
      res.json({
        kind: data.kind,
        periodStart: period.start.toISOString().slice(0, 10),
        periodEnd: period.end.toISOString().slice(0, 10),
      });
    },
  ),
);

governmentRouter.post(
  '/targets',
  requirePermission('target:manage'),
  validateBody(
    z.object({
      scope: z.enum(targets.TARGET_SCOPES),
      lgaId: uuidSchema.nullish(),
      categoryId: uuidSchema.nullish(),
      revenueItemId: uuidSchema.nullish(),
      agentId: uuidSchema.nullish(),
      periodKind: z.enum(targets.TARGET_PERIODS),
      periodStart: z.coerce.date(),
      periodEnd: z.coerce.date(),
      amountKobo: koboSchema,
      note: z.string().trim().max(1000).optional(),
    }),
    async (req, res, data) => {
      const result = await targets.setTarget(
        { userId: req.auth!.userId, role: req.auth!.role },
        { ...data, amountKobo: BigInt(data.amountKobo) },
      );
      res.status(201).json(result);
    },
  ),
);

governmentRouter.post(
  '/targets/:id/withdraw',
  requirePermission('target:manage'),
  validateBody(
    z.object({ reason: z.string().trim().min(10).max(1000) }),
    async (req, res, data) => {
      await targets.withdrawTarget(
        { userId: req.auth!.userId, role: req.auth!.role },
        req.params.id!,
        data.reason,
      );
      res.status(204).end();
    },
  ),
);

/*
 * A forecast, labelled as one.
 *
 * The payload carries `is_forecast`, the `basis` it was computed from and a
 * confidence, because a projection presented as a bare figure is how an
 * estimate becomes a number somebody budgets against. The brief asks
 * specifically that this be clearly labelled and not treated as guaranteed
 * revenue.
 */
governmentRouter.get(
  '/forecast',
  requirePermission('target:read:all', 'report:read:all', 'report:read:territory'),
  validateQuery(
    z.object({
      periodKind: z.enum(targets.TARGET_PERIODS).default('MONTHLY'),
      periodStart: z.coerce.date().optional(),
      periodEnd: z.coerce.date().optional(),
      lgaId: uuidSchema.nullish(),
      categoryId: uuidSchema.nullish(),
      revenueItemId: uuidSchema.nullish(),
    }),
    async (req, res, data) => {
      const scope = await resolveReportScope(pool, req.auth!);
      const period =
        data.periodStart && data.periodEnd
          ? { start: data.periodStart, end: data.periodEnd }
          : targets.resolvePeriod(data.periodKind);
      res.json(
        await targets.forecast(
          pool,
          {
            periodStart: period.start,
            periodEnd: period.end,
            lgaId: data.lgaId,
            categoryId: data.categoryId,
            revenueItemId: data.revenueItemId,
          },
          scope,
        ),
      );
    },
  ),
);

// ---------------------------------------------------------------------------
// Roles and permissions, which are now data
// ---------------------------------------------------------------------------

/*
 * The map an administrator can change without a deployment.
 *
 * Reading it is `user:manage` — the same permission that already governs who
 * holds which role, and the delegation of authority is not something every
 * officer needs to browse.
 */
governmentRouter.get(
  '/roles',
  requirePermission('user:manage'),
  asyncHandler(async (_req, res) => {
    res.json({
      roles: await rbacStore.listRoles(pool),
      /*
       * Every permission that exists, not only those currently granted.
       *
       * Listing only what is held would make the unheld ones ungrantable,
       * which is the opposite of the point.
       */
      grantable: rbacStore.grantablePermissions(),
    });
  }),
);

governmentRouter.post(
  '/roles',
  requirePermission('user:manage'),
  requireStepUp('user.role.change'),
  validateBody(
    z.object({
      name: z.string().trim().min(3).max(40),
      label: z.string().trim().min(2).max(80),
      labelHa: z.string().trim().max(80).nullish(),
      description: z.string().trim().max(500).nullish(),
      isPortal: z.boolean().default(false),
      /*
       * Starting from an existing role rather than from nothing.
       *
       * A role created empty gets given everything a week later, one emergency
       * at a time. Copying the nearest role and taking things away is the safer
       * habit, so it is the easy one.
       */
      copyFrom: z.string().trim().max(40).nullish(),
    }),
    async (req, res, data) => {
      const result = await rbacStore.createRole(
        { userId: req.auth!.userId, role: req.auth!.role },
        data,
      );
      res.status(201).json(result);
    },
  ),
);

/*
 * Closing a role, and reopening one.
 *
 * Both step-up, for the same reason granting is: since migration 060 a retired
 * role cannot be assigned to anybody, so retiring one takes a route into the
 * organisation away and restoring it hands that route back. Neither should be
 * one click from a session somebody walked away from.
 */
governmentRouter.post(
  '/roles/:name/retire',
  requirePermission('user:manage'),
  requireStepUp('user.role.change'),
  validateBody(
    z.object({ reason: z.string().trim().min(10).max(1000) }),
    async (req, res, data) => {
      await rbacStore.retireRole(
        { userId: req.auth!.userId, role: req.auth!.role },
        req.params.name!,
        data.reason,
      );
      res.status(204).end();
    },
  ),
);

governmentRouter.post(
  '/roles/:name/restore',
  requirePermission('user:manage'),
  requireStepUp('user.role.change'),
  validateBody(
    z.object({ reason: z.string().trim().min(10).max(1000) }),
    async (req, res, data) => {
      await rbacStore.restoreRole(
        { userId: req.auth!.userId, role: req.auth!.role },
        req.params.name!,
        data.reason,
      );
      res.status(204).end();
    },
  ),
);

/*
 * Granting and revoking, both step-up.
 *
 * This is the platform's delegation of authority; changing it is at least as
 * consequential as changing one officer's role, which already requires step-up.
 */
governmentRouter.post(
  '/roles/:name/grant',
  requirePermission('user:manage'),
  requireStepUp('user.role.change'),
  validateBody(
    z.object({
      permission: z.string().trim().min(3).max(60),
      reason: z.string().trim().min(10).max(1000),
    }),
    async (req, res, data) => {
      await rbacStore.grant(
        { userId: req.auth!.userId, role: req.auth!.role },
        { role: req.params.name!, ...data },
      );
      res.status(204).end();
    },
  ),
);

/*
 * Revoking ends the sessions of everybody holding the role.
 *
 * The grant map is cached for thirty seconds, and thirty seconds is a long time
 * for an officer whose authority has just been withdrawn to keep exercising it.
 * Signing them out makes the withdrawal immediate, and is a visible and correct
 * consequence of it.
 */
governmentRouter.post(
  '/roles/:name/revoke',
  requirePermission('user:manage'),
  requireStepUp('user.role.change'),
  validateBody(
    z.object({
      permission: z.string().trim().min(3).max(60),
      reason: z.string().trim().min(10).max(1000),
    }),
    async (req, res, data) => {
      res.json(
        await rbacStore.revoke(
          { userId: req.auth!.userId, role: req.auth!.role },
          { role: req.params.name!, ...data },
        ),
      );
    },
  ),
);

// ---------------------------------------------------------------------------
// Financial periods
// ---------------------------------------------------------------------------

/*
 * Whether a month is closed is not a privileged fact.
 *
 * An officer looking at a March figure needs to know whether March can still
 * move, so reading periods is open to every reporting role. Closing is finance;
 * reopening is the administrator — deliberately not the same person, because
 * the officer who closes the books also being the one who can unclose them
 * removes most of what a period lock is for.
 */
governmentRouter.get(
  '/periods',
  requirePermission('period:read'),
  validateQuery(
    z.object({ limit: z.coerce.number().int().min(1).max(120).default(36) }),
    async (_req, res, data) => {
      res.json(await periods.listPeriods(pool, data));
    },
  ),
);

/** What a period holds right now — the same query the close writes down. */
governmentRouter.get(
  '/periods/figures',
  requirePermission('period:read'),
  validateQuery(
    z.object({ periodStart: z.coerce.date(), periodEnd: z.coerce.date() }),
    async (_req, res, data) => {
      res.json(await periods.periodFigures(pool, data.periodStart, data.periodEnd));
    },
  ),
);

governmentRouter.post(
  '/periods',
  requirePermission('period:close'),
  validateBody(
    z.object({
      periodStart: z.coerce.date(),
      periodEnd: z.coerce.date(),
      label: z.string().trim().max(40).optional(),
    }),
    async (req, res, data) => {
      const result = await periods.openPeriod(
        { userId: req.auth!.userId, role: req.auth!.role },
        data,
      );
      res.status(201).json(result);
    },
  ),
);

governmentRouter.post(
  '/periods/:id/begin-closing',
  requirePermission('period:close'),
  asyncHandler(async (req, res) => {
    res.json(
      await periods.beginClosing(
        { userId: req.auth!.userId, role: req.auth!.role },
        req.params.id!,
      ),
    );
  }),
);

/*
 * Closing, which the database then enforces.
 *
 * `requireStepUp` because after this the four tables that decide what the month
 * collected refuse to be written — that is a bigger decision than most, and the
 * platform already reserves step-up for exactly this size of action.
 */
governmentRouter.post(
  '/periods/:id/close',
  requirePermission('period:close'),
  requireStepUp('financial.period.close'),
  validateBody(
    z.object({
      note: z.string().trim().min(10).max(2000),
      /*
       * Closing over an unresolved exception freezes a figure already known to
       * be wrong. It is sometimes the right call — a deadline is a deadline —
       * and it is never a silent one.
       */
      overrideReason: z.string().trim().min(10).max(2000).optional(),
    }),
    async (req, res, data) => {
      res.json(
        await periods.closePeriod(
          { userId: req.auth!.userId, role: req.auth!.role },
          req.params.id!,
          data,
        ),
      );
    },
  ),
);

governmentRouter.post(
  '/periods/:id/reopen',
  requirePermission('period:reopen'),
  requireStepUp('financial.period.reopen'),
  validateBody(
    z.object({ reason: z.string().trim().min(10).max(2000) }),
    async (req, res, data) => {
      res.json(
        await periods.reopenPeriod(
          { userId: req.auth!.userId, role: req.auth!.role },
          req.params.id!,
          data.reason,
        ),
      );
    },
  ),
);

// ---------------------------------------------------------------------------
// The organisation the officers work in
// ---------------------------------------------------------------------------

/*
 * Reading the structure is open to every portal role; changing it is not.
 *
 * `case:read:all` is the gate, and the choice is deliberate on both sides.
 * It is held by exactly the five portal roles and by no field agent, which is
 * the boundary that matters — the organisation chart is not an agent's to
 * read. And it is *not* `report:read:territory`, which would be the obvious
 * pair: a route that accepts that permission is promising to narrow its answer
 * to the caller's territories, and the chart is not territory data. Claiming a
 * scope and then not applying it is the leak `a-report-that-forgets-whose-it-
 * is.test.ts` exists to catch, and it is right to.
 *
 * Creating a department, or moving somebody, is `user:manage`: the
 * administrator's permission, and the same one that governs who holds which
 * role.
 */
governmentRouter.get(
  '/departments',
  requirePermission('case:read:all'),
  asyncHandler(async (_req, res) => {
    res.json(await organisation.listDepartments(pool));
  }),
);

governmentRouter.post(
  '/departments',
  requirePermission('user:manage'),
  validateBody(
    z.object({
      code: z.string().trim().min(2).max(20),
      name: z.string().trim().min(2).max(120),
      nameHa: z.string().trim().max(120).nullish(),
      description: z.string().trim().max(1000).nullish(),
      function: z.enum(organisation.DEPARTMENT_FUNCTIONS),
      headUserId: uuidSchema.nullish(),
      parentId: uuidSchema.nullish(),
    }),
    async (req, res, data) => {
      const result = await organisation.createDepartment(
        { userId: req.auth!.userId, role: req.auth!.role },
        data,
      );
      res.status(201).json(result);
    },
  ),
);

governmentRouter.post(
  '/departments/:id/update',
  requirePermission('user:manage'),
  validateBody(
    z.object({
      name: z.string().trim().min(2).max(120).optional(),
      nameHa: z.string().trim().max(120).nullish(),
      description: z.string().trim().max(1000).nullish(),
      headUserId: uuidSchema.nullish(),
      parentId: uuidSchema.nullish(),
      status: z.enum(['ACTIVE', 'CLOSED']).optional(),
    }),
    async (req, res, data) => {
      await organisation.updateDepartment(
        { userId: req.auth!.userId, role: req.auth!.role },
        req.params.id!,
        data,
      );
      res.status(204).end();
    },
  ),
);

governmentRouter.get(
  '/offices',
  requirePermission('case:read:all'),
  asyncHandler(async (_req, res) => {
    res.json(await organisation.listOffices(pool));
  }),
);

governmentRouter.post(
  '/offices',
  requirePermission('user:manage'),
  validateBody(
    z.object({
      code: z.string().trim().min(2).max(20),
      name: z.string().trim().min(2).max(120),
      nameHa: z.string().trim().max(120).nullish(),
      lgaId: uuidSchema,
      address: z.string().trim().max(300).nullish(),
      phone: z.string().trim().max(30).nullish(),
      coversLgaIds: z.array(uuidSchema).max(17).optional(),
      headUserId: uuidSchema.nullish(),
    }),
    async (req, res, data) => {
      const result = await organisation.createOffice(
        { userId: req.auth!.userId, role: req.auth!.role },
        data,
      );
      res.status(201).json(result);
    },
  ),
);

/*
 * Move an officer, and leave a dated record of every part that moved.
 *
 * One transfer row per thing that actually changed rather than one saying
 * "posting changed": "when did she move to Finance" and "when did he stop
 * reporting to Bala" are separate questions, and a combined row makes both a
 * JSON dig.
 */
governmentRouter.post(
  '/users/:id/posting',
  requirePermission('user:manage'),
  validateBody(
    z.object({
      departmentId: uuidSchema.nullish(),
      revenueOfficeId: uuidSchema.nullish(),
      supervisorId: uuidSchema.nullish(),
      jobTitle: z.string().trim().max(120).nullish(),
      staffNumber: z.string().trim().max(40).nullish(),
      reason: z.string().trim().min(10).max(1000),
      effectiveFrom: z.coerce.date().optional(),
    }),
    async (req, res, data) => {
      const result = await organisation.repost(
        { userId: req.auth!.userId, role: req.auth!.role },
        req.params.id!,
        data,
      );
      res.json(result);
    },
  ),
);

/** One officer's posting history. `audit:read` sees it too — it is evidence. */
governmentRouter.get(
  '/users/:id/transfers',
  requirePermission('user:manage', 'audit:read'),
  asyncHandler(async (req, res) => {
    res.json(await organisation.transfersFor(pool, req.params.id!));
  }),
);

/*
 * Who was posted where, and when.
 *
 * The question a revenue dispute asks — "who was responsible for Jos North in
 * March" — and the reason postings are a table rather than a log.
 */
governmentRouter.get(
  '/transfers',
  requirePermission('user:manage', 'audit:read'),
  validateQuery(
    z.object({
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
      kind: z.enum(organisation.TRANSFER_KINDS).optional(),
    }),
    async (_req, res, data) => {
      res.json(await organisation.postingHistory(pool, data));
    },
  ),
);

// ---------------------------------------------------------------------------
// Cases: the work that crosses a department
// ---------------------------------------------------------------------------

/** Everything waiting for this officer, wherever it came from. */
governmentRouter.get(
  '/my-work',
  requirePermission('case:read:all'),
  asyncHandler(async (req, res) => {
    res.json(await cases.myWork(pool, officer(req)));
  }),
);

governmentRouter.get(
  '/cases',
  requirePermission('case:read:all'),
  validateQuery(
    z.object({
      status: z.enum(cases.CASE_STATUSES).optional(),
      open: z.coerce.boolean().optional(),
      department: z.enum(cases.CASE_DEPARTMENTS).optional(),
      assigneeId: uuidSchema.optional(),
      category: z.enum(cases.CASE_CATEGORIES).optional(),
      priority: z.enum(cases.CASE_PRIORITIES).optional(),
      riskLevel: z.enum(cases.CASE_RISK_LEVELS).optional(),
      transactionId: uuidSchema.optional(),
      agentId: uuidSchema.optional(),
      taxpayerId: uuidSchema.optional(),
      overdue: z.coerce.boolean().optional(),
      limit: z.coerce.number().int().min(1).max(200).default(100),
    }),
    async (_req, res, data) => {
      res.json(await cases.listCases(pool, data));
    },
  ),
);

governmentRouter.get(
  '/cases/:id',
  requirePermission('case:read:all'),
  asyncHandler(async (req, res) => {
    res.json(await cases.getCase(pool, officer(req), req.params.id!));
  }),
);

governmentRouter.post(
  '/cases',
  requirePermission('case:create'),
  validateBody(
    z.object({
      subject: z.string().trim().min(5).max(200),
      description: z.string().trim().max(4000).optional(),
      category: z.enum(cases.CASE_CATEGORIES).default('GENERAL'),
      riskLevel: z.enum(cases.CASE_RISK_LEVELS).default('MEDIUM'),
      priority: z.enum(cases.CASE_PRIORITIES).default('NORMAL'),
      department: z.enum(cases.CASE_DEPARTMENTS).nullish(),
      departmentId: uuidSchema.nullish(),
      assigneeId: uuidSchema.nullish(),
      transactionId: uuidSchema.nullish(),
      agentId: uuidSchema.nullish(),
      taxpayerId: uuidSchema.nullish(),
      subjectUserId: uuidSchema.nullish(),
      lgaId: uuidSchema.nullish(),
      sourceType: z.enum(['MANUAL', 'FRAUD_FLAG', 'RECONCILIATION_EXCEPTION',
                          'SUPPORT_TICKET', 'APPROVAL']).default('MANUAL'),
      sourceId: uuidSchema.nullish(),
      dueAt: z.coerce.date().nullish(),
    }),
    async (req, res, data) => {
      res.status(201).json(await cases.openCase(pool, officer(req), data));
    },
  ),
);

/*
 * A comment, or an internal note.
 *
 * `case:contribute` rather than `case:manage`: the whole point of the workspace
 * is that a finance officer can answer a question on an auditor's case without
 * being given authority over it. Adding text does not move the case.
 */
governmentRouter.post(
  '/cases/:id/comments',
  requirePermission('case:contribute'),
  validateBody(
    z.object({
      body: z.string().trim().min(1).max(4000),
      internal: z.boolean().default(false),
      mentions: z.array(uuidSchema).max(20).optional(),
    }),
    async (req, res, data) => {
      await cases.comment(pool, officer(req), req.params.id!, data);
      res.status(204).end();
    },
  ),
);

governmentRouter.post(
  '/cases/:id/evidence',
  requirePermission('case:contribute'),
  validateBody(
    z.object({
      documentId: uuidSchema,
      body: z.string().trim().max(1000).optional(),
    }),
    async (req, res, data) => {
      await cases.attachEvidence(pool, officer(req), req.params.id!, data);
      res.status(204).end();
    },
  ),
);

/*
 * The three that move a case, and all three are `case:contribute` on the route.
 *
 * The real gate is inside the service: `case:manage`, or having opened this
 * case, or having it assigned to you. That cannot be expressed as a permission
 * on a route because it is a fact about the row, and putting `case:manage` here
 * instead would mean a finance officer could raise a settlement discrepancy and
 * then be unable to resolve it — a suggestion box, not a queue.
 */
governmentRouter.post(
  '/cases/:id/assign',
  requirePermission('case:contribute'),
  validateBody(
    z.object({
      assigneeId: uuidSchema.nullable(),
      department: z.enum(cases.CASE_DEPARTMENTS).nullish(),
      departmentId: uuidSchema.nullish(),
      reason: z.string().trim().max(1000).optional(),
    }),
    async (req, res, data) => {
      await cases.assign(pool, officer(req), req.params.id!, data);
      res.status(204).end();
    },
  ),
);

governmentRouter.post(
  '/cases/:id/status',
  requirePermission('case:contribute'),
  validateBody(
    z.object({
      status: z.enum(cases.CASE_STATUSES),
      resolution: z.string().trim().max(4000).optional(),
      reason: z.string().trim().max(1000).optional(),
    }),
    async (req, res, data) => {
      await cases.setStatus(pool, officer(req), req.params.id!, data);
      res.status(204).end();
    },
  ),
);

/*
 * Escalate: up the reporting line, to a person.
 *
 * ESCALATED used to be a status and nothing more — the case changed colour and
 * stayed on the same desk. This resolves who is above, moves it to them, and
 * records how the platform decided that. When there is nobody above, it refuses
 * rather than marking the case escalated and leaving it where it was.
 */
governmentRouter.post(
  '/cases/:id/escalate',
  requirePermission('case:contribute'),
  validateBody(
    z.object({ reason: z.string().trim().min(10).max(1000) }),
    async (req, res, data) => {
      res.json(await cases.escalate(pool, officer(req), req.params.id!, data));
    },
  ),
);

governmentRouter.post(
  '/cases/:id/priority',
  requirePermission('case:contribute'),
  validateBody(
    z.object({
      priority: z.enum(cases.CASE_PRIORITIES).optional(),
      dueAt: z.coerce.date().nullish(),
      reason: z.string().trim().max(1000).optional(),
    }),
    async (req, res, data) => {
      await cases.setPriority(pool, officer(req), req.params.id!, data);
      res.status(204).end();
    },
  ),
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

/**
 * The signed-in officer or agent, as the support service wants them.
 *
 * Permissions travel with the viewer rather than being re-derived from the
 * role, so scoping a query to "their own tickets" and gating a screen are the
 * same decision made from the same source.
 */
// ---------------------------------------------------------------------------
// The auditor's workbench: samples and signed reports (Addendum §25, §26)
// ---------------------------------------------------------------------------

/*
 * Its own viewer, rather than `officer(req)`.
 *
 * The workbench scopes its draws and its reports through `resolveReportScope`,
 * which needs the permission list at its declared type; `investigation.Viewer`
 * widens it to `string[]`, and widening it here would mean casting it back at
 * the point where the territory filter is chosen. That is the last place worth
 * having a cast.
 */
function auditor(req: RouteRequest): workbench.Viewer {
  return {
    userId: req.auth!.userId,
    role: req.auth!.role,
    permissions: req.auth!.permissions,
  };
}

/*
 * Drawing a sample.
 *
 * Scoped like every other report: a supervisor drawing a sample gets one from
 * their own territories, and the scope they drew under is written into the
 * criteria so a reader knows which population the denominator refers to.
 */
governmentRouter.post(
  '/audit/samples',
  requirePermission('audit:sample'),
  validateBody(
    z.object({
      title: z.string().trim().min(5).max(200),
      method: z.enum(['RANDOM', 'SYSTEMATIC', 'HIGHEST_VALUE']).default('RANDOM'),
      size: z.coerce.number().int().min(1).max(500),
      seed: z.string().trim().min(4).max(100).nullish(),
      criteria: z
        .object({
          from: z.string().date().nullish(),
          to: z.string().date().nullish(),
          revenueCategoryId: uuidSchema.nullish(),
          lgaId: uuidSchema.nullish(),
          agentId: uuidSchema.nullish(),
          minimumKobo: z.string().regex(/^\d+$/).nullish(),
          maximumKobo: z.string().regex(/^\d+$/).nullish(),
          status: z.string().trim().max(40).nullish(),
        })
        .default({}),
    }),
    async (req, res, data) => {
      res.status(201).json(await workbench.drawSample(auditor(req), data));
    },
  ),
);

governmentRouter.get(
  '/audit/samples',
  requirePermission('audit:sample'),
  validateQuery(
    z.object({
      status: z.enum(['DRAWN', 'IN_REVIEW', 'COMPLETED']).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }),
    async (_req, res, data) => {
      res.json({ samples: await workbench.listSamples(pool, data) });
    },
  ),
);

governmentRouter.get(
  '/audit/samples/:id',
  requirePermission('audit:sample'),
  asyncHandler(async (req, res) => {
    res.json(await workbench.getSample(pool, req.params.id));
  }),
);

governmentRouter.post(
  '/audit/samples/items/:id/finding',
  requirePermission('audit:sample'),
  validateBody(
    z.object({
      outcome: z.enum(['CLEAN', 'EXCEPTION', 'NOT_AVAILABLE']),
      finding: z.string().trim().max(2000).nullish(),
      caseId: uuidSchema.nullish(),
    }),
    async (req, res, data) => {
      await workbench.recordFinding(auditor(req), req.params.id!, data);
      res.json({ recorded: true });
    },
  ),
);

governmentRouter.post(
  '/audit/samples/:id/complete',
  requirePermission('audit:sample'),
  validateBody(
    z.object({ note: z.string().trim().min(10).max(2000) }),
    async (req, res, data) => {
      await workbench.completeSample(auditor(req), req.params.id!, data.note);
      res.json({ completed: true });
    },
  ),
);

governmentRouter.post(
  '/audit/reports',
  requirePermission('audit:report'),
  validateBody(
    z.object({
      reportType: z.enum(workbench.REPORT_TYPES),
      title: z.string().trim().min(5).max(200),
      parameters: z
        .object({
          from: z.string().date().nullish(),
          to: z.string().date().nullish(),
          lgaId: uuidSchema.nullish(),
          agentId: uuidSchema.nullish(),
          sampleId: uuidSchema.nullish(),
          userId: uuidSchema.nullish(),
        })
        .default({}),
    }),
    async (req, res, data) => {
      res.status(201).json(await workbench.generateReport(auditor(req), data));
    },
  ),
);

governmentRouter.get(
  '/audit/reports',
  requirePermission('audit:report'),
  validateQuery(
    z.object({
      reportType: z.enum(workbench.REPORT_TYPES).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }),
    async (_req, res, data) => {
      res.json({ reports: await workbench.listReports(pool, data) });
    },
  ),
);

/*
 * Reading a report is itself recorded.
 *
 * "Reports generated" was marked partial in the officer-readiness assessment
 * because exports were audited and report views were not: the log could show
 * that nobody had taken a copy of a taxpayer's history while an officer had
 * read it forty times.
 */
governmentRouter.get(
  '/audit/reports/:id',
  requirePermission('audit:report'),
  asyncHandler(async (req, res) => {
    const report = await workbench.getReport(pool, req.params.id!);
    await withTransaction((client) =>
      exporting.recordReportView(
        client,
        {
          actorId: req.auth!.userId,
          actorRole: req.auth!.role,
          subject: String(report.report_number),
          parameters: (report.parameters ?? {}) as Record<string, unknown>,
        },
        Number(report.row_count),
      ),
    );
    res.json(report);
  }),
);

/*
 * And a signed report, as a file somebody can put in a folder.
 *
 * The rows come out of the frozen payload rather than being re-queried, which
 * is the whole point of the object: the PDF a reviewer opens in June carries
 * the figures signed in March, and its checksum line lets them confirm that
 * without taking the platform's word for it.
 */
governmentRouter.get(
  '/audit/reports/:id/export',
  requirePermission('audit:report'),
  validateQuery(
    z.object({ format: z.enum(['csv', 'xlsx', 'pdf']).default('pdf') }),
    async (req, res, data) => {
      const report = await workbench.getReport(pool, req.params.id!);
      const rows = ((report.payload as { rows?: Record<string, unknown>[] })?.rows ??
        []) as Record<string, unknown>[];

      if (data.format === 'pdf') {
        if (!req.auth!.permissions.includes('data:export')) {
          throw forbidden(
            'Your role may read this on screen and may not export it.',
            'Ask an administrator to grant your role the export permission.',
          );
        }
        await withTransaction((client) =>
          exporting.recordExport(
            client,
            {
              actorId: req.auth!.userId,
              actorRole: req.auth!.role,
              subject: String(report.report_number),
              format: 'pdf',
              parameters: (report.parameters ?? {}) as Record<string, unknown>,
            },
            rows.length,
          ),
        );
        const pdf = await exporting.renderReportPdf({
          title: String(report.title),
          rows,
          parameters: (report.parameters ?? {}) as Record<string, unknown>,
          generatedBy: String(report.generated_by_name ?? 'PSIRS'),
          reportNumber: String(report.report_number),
          checksum: String(report.checksum),
        });
        res.setHeader('content-type', 'application/pdf');
        res.setHeader(
          'content-disposition',
          `attachment; filename="${String(report.report_number).replace(/\//g, '-')}.pdf"`,
        );
        res.send(pdf);
        return;
      }

      await deliver(req, res, {
        rows,
        format: data.format,
        subject: String(report.title),
        filename: String(report.report_number).replace(/\//g, '-'),
        parameters: (report.parameters ?? {}) as Record<string, unknown>,
      });
    },
  ),
);

/*
 * Signing, and withdrawing.
 *
 * Both step-up. A signature is an officer's name on figures that will be read
 * as settled, and a withdrawal takes a signed report out of circulation; a
 * session somebody walked away from should be able to do neither.
 */
governmentRouter.post(
  '/audit/reports/:id/sign',
  requirePermission('audit:sign'),
  requireStepUp('audit.report.sign'),
  validateBody(
    z.object({ note: z.string().trim().min(10).max(2000) }),
    async (req, res, data) => {
      await workbench.signReport(auditor(req), req.params.id!, data.note);
      res.json({ signed: true });
    },
  ),
);

governmentRouter.post(
  '/audit/reports/:id/withdraw',
  requirePermission('audit:report'),
  requireStepUp('audit.report.sign'),
  validateBody(
    z.object({ reason: z.string().trim().min(10).max(2000) }),
    async (req, res, data) => {
      await workbench.withdrawReport(auditor(req), req.params.id!, data.reason);
      res.json({ withdrawn: true });
    },
  ),
);

function viewerFrom(req: RouteRequest): support.Viewer {
  return {
    userId: req.auth!.userId,
    role: req.auth!.role,
    permissions: req.auth!.permissions,
  };
}

export const supportRouter = Router();

supportRouter.use(authenticate);

/** Anyone signed in may raise a ticket; that is the point of the channel. */
supportRouter.post(
  '/tickets',
  validateBody(
    z.object({
      category: z.enum(support.TICKET_CATEGORIES),
      subject: z.string().min(5).max(200),
      description: z.string().min(10).max(4000),
      transactionReference: z.string().max(40).optional(),
      priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
    }),
    async (req, res, data) => {
      const ticket = await support.raiseTicket({ input: data, viewer: viewerFrom(req) });
      res.status(201).json(ticket);
    },
  ),
);

supportRouter.get(
  '/tickets',
  validateQuery(
    z.object({
      status: z.string().optional(),
      category: z.string().optional(),
      assignedToMe: z.coerce.boolean().optional(),
      limit: z.coerce.number().int().max(200).default(50),
    }),
    async (req, res, data) => {
      res.json(await support.listTickets(pool, { ...data, viewer: viewerFrom(req) }));
    },
  ),
);

supportRouter.get(
  '/tickets/:id',
  asyncHandler(async (req, res) => {
    const ticket = await support.ticketDetail(pool, {
      ticketId: req.params.id,
      viewer: viewerFrom(req),
    });
    // 404 rather than 403 when it is somebody else's: whether a ticket exists
    // is itself information the raiser is entitled to keep.
    if (!ticket) throw notFound('That ticket');
    res.json(ticket);
  }),
);

supportRouter.post(
  '/tickets/:id/messages',
  validateBody(
    z.object({ body: z.string().min(2).max(4000), internal: z.boolean().default(false) }),
    async (req, res, data) => {
      const result = await support.addMessage({
        ticketId: req.params.id,
        viewer: viewerFrom(req),
        body: data.body,
        internal: data.internal,
      });
      res.status(201).json(result);
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
      await support.updateTicket({ ticketId: req.params.id, viewer: viewerFrom(req), ...data });
      res.json({ updated: true });
    },
  ),
);

export { parseKobo };
