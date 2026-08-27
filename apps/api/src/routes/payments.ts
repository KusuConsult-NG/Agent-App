/**
 * Payment, receipt, document and public verification endpoints.
 *
 * Note what is missing: there is no endpoint that sets a payment status. The
 * only "confirm" route asks the server to go and verify with the gateway, and
 * returns whatever the gateway says (PRD §95).
 */

import { Router } from 'express';
import { z } from 'zod';
import { serialiseKobo } from '@psirs/shared';
import { pool, query, queryOne } from '../db/pool';
import { signWebhookPayload } from '../lib/crypto';
import { config } from '../config';
import {
  authenticate,
  requireActiveAgent,
  requirePermission,
  requireSupportedAppVersion,
} from '../middleware/auth';
import { idempotent } from '../middleware/idempotency';
import { rateLimit } from '../middleware/security';
import { asyncHandler, uuidSchema, validateBody, validateQuery } from '../middleware/validate';
import { assertOwnRecord, callerAgentId, seesEverything } from '../lib/ownership';
import { notFound, forbidden, badRequest } from '../lib/errors';
import * as payments from '../services/payments';
import * as receipts from '../services/receipts';
import { storage, signDocumentUrl, verifyDocumentSignature } from '../services/storage';
import { developmentGatewayControls, isMockGateway } from '../integrations/gateway';

export const paymentRouter = Router();

// ---------------------------------------------------------------------------
// Webhook — unauthenticated by design, authenticated by signature (PRD §53)
// ---------------------------------------------------------------------------

export const webhookRouter = Router();

// Remita does not sign callbacks, so this endpoint accepts deliveries it cannot
// cryptographically attribute. That is safe — a delivery only prompts a status
// query — but it should not be an unmetered way to make the platform call out.
webhookRouter.post(
  '/payments',
  rateLimit({ max: 240, windowMs: 60_000, keyPrefix: 'webhook', keyBy: 'ip' }),
  asyncHandler(async (req, res) => {
    const result = await payments.handleWebhook({
      // The RAW body, exactly as received: a signature covers these bytes.
      rawBody: req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {})),
      signature: req.header('x-psirs-signature') ?? req.header('x-remita-signature'),
      // The active gateway decides what authenticates a delivery, so it gets
      // the headers and source address rather than one pre-chosen header.
      headers: req.headers as Record<string, string | undefined>,
      sourceIp: req.clientIp,
      parsedBody: req.body,
    });

    // Always 200 on an accepted delivery, including duplicates, so the gateway
    // stops retrying (PRD §53).
    res.status(result.acknowledged ? 200 : 400).json({
      received: result.acknowledged,
      duplicate: result.duplicate,
      note: result.note,
    });
  }),
);

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

paymentRouter.use(authenticate);

paymentRouter.post(
  '/initiate',
  requirePermission('payment:initiate'),
  requireSupportedAppVersion,
  requireActiveAgent(),
  idempotent('payment.initiate', { required: true }),
  validateBody(
    z.object({
      transactionId: uuidSchema,
      paymentMethod: z.enum(['CARD', 'BANK_TRANSFER', 'USSD', 'ACCOUNT_TRANSFER', 'POS']).optional(),
      callbackUrl: z.string().url().optional(),
    }),
    async (req, res, data) => {
      const result = await payments.initiatePayment({
        transactionId: data.transactionId,
        paymentMethod: data.paymentMethod ?? null,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        deviceId: req.agent?.deviceId ?? null,
        ipAddress: req.clientIp,
        callbackUrl: data.callbackUrl,
      });

      res.status(201).json({ ...result, amountKobo: serialiseKobo(result.amountKobo) });
    },
  ),
);

/**
 * Ask the server to verify a payment with the gateway.
 *
 * The agent taps "I have paid" and this runs; it does not assert anything.
 * If the gateway still says pending, the response is the explicit
 * PAYMENT_UNCONFIRMED contract from PRD §60.
 */
paymentRouter.post(
  '/:paymentId/confirm',
  requirePermission('payment:initiate', 'payment:read:all'),
  rateLimit({ max: 30, keyPrefix: 'payment-confirm' }),
  asyncHandler(async (req, res) => {
    const result = await payments.confirmPayment({
      paymentId: req.params.paymentId,
      source: 'POLL',
      actorId: req.auth!.userId,
      actorRole: req.auth!.role,
    });

    // The renewal itself is issued by confirmPayment, so it happens whichever
    // way the payment was confirmed rather than only when an agent's app asks.
    // All that is left here is the download link, which is a transport concern.
    if (result.vehicleDocument) {
      res.json({
        ...result,
        vehicleDocument: {
          ...result.vehicleDocument,
          downloadUrl: signDocumentUrl(result.vehicleDocument.documentId),
        },
      });
      return;
    }

    res.json(result);
  }),
);

/**
 * Recover a transaction's true state (Addendum §44).
 * Works after the browser closed, the device died, or the agent signed out.
 */
paymentRouter.get(
  '/transactions/:reference/status',
  requirePermission('payment:read:own', 'payment:read:all'),
  asyncHandler(async (req, res) => {
    const status = await payments.getTransactionStatus(pool, req.params.reference);
    assertOwnRecord(
      req,
      'payment:read:all',
      (status.transaction as { agent_id?: string | null }).agent_id ?? null,
      'That transaction',
    );
    res.json(status);
  }),
);

paymentRouter.get(
  '/',
  requirePermission('payment:read:all'),
  validateQuery(
    z.object({
      status: z.string().optional(),
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }),
    async (_req, res, data) => {
      res.json(
        await query(
          pool,
          `SELECT p.id, p.payment_reference, p.gateway, p.gateway_reference, p.amount_kobo,
                  p.status, p.payment_method, p.paid_at, p.verified_at, p.verified_by_source,
                  t.transaction_reference, t.status AS transaction_status
             FROM payments p JOIN transactions t ON t.id = p.transaction_id
            WHERE ($1::text IS NULL OR p.status = $1)
              AND ($2::timestamptz IS NULL OR p.created_at >= $2)
              AND ($3::timestamptz IS NULL OR p.created_at <= $3)
            ORDER BY p.created_at DESC LIMIT $4`,
          [data.status ?? null, data.from ?? null, data.to ?? null, data.limit],
        ),
      );
    },
  ),
);

// ---------------------------------------------------------------------------
// Development-only gateway simulation
// ---------------------------------------------------------------------------

/**
 * Simulate a gateway outcome so the full flow can be exercised end to end
 * without a live processor. Refuses to exist unless the mock gateway is
 * selected, and config.ts refuses to boot in production with it selected.
 */
paymentRouter.post(
  '/simulate',
  validateBody(
    z.object({
      gatewayReference: z.string().min(4),
      outcome: z.enum(['SUCCESS', 'FAILED', 'ABANDONED', 'REVERSED']),
      failureReason: z.string().optional(),
      deliverWebhook: z.boolean().default(true),
    }),
    async (req, res, data) => {
      if (!isMockGateway() || config.isProduction) {
        throw forbidden('Payment simulation is only available with the development gateway.');
      }

      const updated = await developmentGatewayControls.simulateOutcome({
        gatewayReference: data.gatewayReference,
        outcome: data.outcome,
        failureReason: data.failureReason,
      });
      if (!updated) throw notFound('That gateway reference');

      let webhookResult: unknown = null;

      if (data.deliverWebhook) {
        // Build and sign a webhook exactly as the gateway would, then feed it
        // through the real handler — the simulation gets no shortcut.
        const eventType =
          data.outcome === 'SUCCESS'
            ? 'charge.success'
            : data.outcome === 'REVERSED'
              ? 'charge.reversed'
              : 'charge.failed';
        const payload = {
          id: `evt_${data.gatewayReference}_${data.outcome}`,
          event: eventType,
          data: {
            reference: data.gatewayReference,
            amount: updated.amount_kobo,
            paid_at: updated.paid_at?.toISOString() ?? null,
            channel: 'CARD',
          },
        };
        const raw = Buffer.from(JSON.stringify(payload));
        webhookResult = await payments.handleWebhook({
          rawBody: raw,
          signature: signWebhookPayload(raw),
          parsedBody: payload,
        });
      }

      res.json({ gatewayStatus: updated.status, webhook: webhookResult });
    },
  ),
);

// ---------------------------------------------------------------------------
// Receipts and documents
// ---------------------------------------------------------------------------

export const receiptRouter = Router();

receiptRouter.use(authenticate);

receiptRouter.get(
  '/',
  requirePermission('receipt:read:own', 'receipt:read:all'),
  validateQuery(
    z.object({
      taxpayerId: uuidSchema.optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }),
    async (req, res, data) => {
      // Agents see receipts for transactions they facilitated; officers see all.
      const agentScoped = req.auth!.role === 'agent';
      res.json(
        await query(
          pool,
          `SELECT r.id, r.receipt_number, r.amount_kobo, r.issued_at, r.status,
                  r.verification_code, r.document_id,
                  t.transaction_reference, ri.name AS revenue_item,
                  COALESCE(tp.business_name, tp.first_name || ' ' || tp.last_name) AS taxpayer_name
             FROM receipts r
             JOIN transactions t ON t.id = r.transaction_id
             JOIN revenue_items ri ON ri.id = t.revenue_item_id
             JOIN taxpayers tp ON tp.id = r.taxpayer_id
            WHERE ($1::uuid IS NULL OR r.taxpayer_id = $1)
              AND ($2::uuid IS NULL OR t.agent_id = $2)
            ORDER BY r.issued_at DESC LIMIT $3`,
          [data.taxpayerId ?? null, agentScoped ? (req.auth!.agentId ?? null) : null, data.limit],
        ),
      );
    },
  ),
);

const RECEIPT_DETAIL_SQL = `
  SELECT r.*, t.transaction_reference, t.agent_id AS collected_by_agent_id,
         ri.name AS revenue_item,
         p.gateway_reference, p.payment_method, p.paid_at
    FROM receipts r
    JOIN transactions t ON t.id = r.transaction_id
    JOIN revenue_items ri ON ri.id = t.revenue_item_id
    JOIN payments p ON p.id = r.payment_id`;

/**
 * Look up a receipt by its printed number.
 *
 * A separate route because receipt numbers are slash-delimited by design
 * (PRD §58: PSIRS/2026/000123) and so cannot travel as a path segment.
 */
receiptRouter.get(
  '/lookup',
  requirePermission('receipt:read:own', 'receipt:read:all'),
  validateQuery(
    z.object({ number: z.string().min(4).max(64) }),
    async (req, res, data) => {
      const receipt = await queryOne<{ document_id: string | null }>(
        pool,
        `${RECEIPT_DETAIL_SQL} WHERE r.receipt_number = $1`,
        [data.number],
      );
      if (!receipt) throw notFound('That receipt');
      assertOwnRecord(
        req,
        'receipt:read:all',
        (receipt as { collected_by_agent_id?: string | null }).collected_by_agent_id ?? null,
        'That receipt',
      );
      res.json({
        ...receipt,
        downloadUrl: receipt.document_id ? signDocumentUrl(receipt.document_id) : null,
      });
    },
  ),
);

receiptRouter.get(
  '/:id',
  requirePermission('receipt:read:own', 'receipt:read:all'),
  asyncHandler(async (req, res) => {
    // Typed as uuid so a malformed id is a clean 404 rather than a database
    // cast error surfacing as a 500.
    const receipt = await queryOne<{ document_id: string | null }>(
      pool,
      `${RECEIPT_DETAIL_SQL} WHERE r.id = $1::uuid`,
      [req.params.id],
    ).catch(() => null);
    if (!receipt) throw notFound('That receipt');
    assertOwnRecord(
      req,
      'receipt:read:all',
      (receipt as { collected_by_agent_id?: string | null }).collected_by_agent_id ?? null,
      'That receipt',
    );

    res.json({
      ...receipt,
      downloadUrl: receipt.document_id ? signDocumentUrl(receipt.document_id) : null,
    });
  }),
);

export const documentRouter = Router();

/**
 * Download a document with a signed, expiring URL (PRD §64).
 *
 * Deliberately not behind `authenticate`: the signature is the authorisation,
 * which lets a taxpayer open a receipt link on a phone without an account. The
 * link is short-lived and cannot be edited to point elsewhere.
 */
documentRouter.get(
  '/:id/download',
  validateQuery(
    z.object({ expires: z.string(), signature: z.string() }),
    async (req, res, data) => {
      if (!verifyDocumentSignature(req.params.id, data.expires, data.signature)) {
        throw forbidden(
          'This download link is not valid or has expired. Open the document again to get a fresh link.',
        );
      }

      const document = await queryOne<{
        storage_reference: string;
        content_type: string;
        document_number: string;
        document_type: string;
      }>(
        pool,
        'SELECT storage_reference, content_type, document_number, document_type FROM documents WHERE id = $1',
        [req.params.id],
      );
      if (!document) throw notFound('That document');

      const bytes = await storage.get(document.storage_reference);

      await pool
        .query(
          `INSERT INTO document_access_logs (document_id, accessed_by, access_type, ip_address)
           VALUES ($1,$2,'DOWNLOAD',$3)`,
          [req.params.id, req.auth?.userId ?? null, req.clientIp],
        )
        .catch(() => undefined);

      res.setHeader('content-type', document.content_type);
      res.setHeader(
        'content-disposition',
        `inline; filename="${document.document_number.replace(/[/]/g, '-')}.pdf"`,
      );
      res.send(bytes);
    },
  ),
);

documentRouter.get(
  '/:id',
  authenticate,
  requirePermission('document:read:own', 'document:read:all'),
  asyncHandler(async (req, res) => {
    /*
     * The worst of the six, because it does not only describe the document —
     * it returns a signed URL that downloads it. An unrelated agent could read
     * the record for a taxpayer-owned receipt or invoice and pull the PDF,
     * with that citizen's name, TIN, amounts and computation trace in it.
     *
     * A document has no agent of its own, so the scope comes from whatever it
     * was issued for: the invoice or renewal's agent, or the agent on the
     * transaction behind a receipt. A document issued *to* an agent is theirs.
     */
    const document = await queryOne<Record<string, unknown> & { issued_for_agent_id: string | null }>(
      pool,
      `SELECT d.id, d.document_number, d.document_type, d.owner_type, d.owner_id,
              d.issued_at, d.expires_at, d.status, d.version, d.issuing_authority,
              d.verification_code, d.byte_size,
              CASE
                WHEN d.owner_type = 'AGENT' THEN d.owner_id
                WHEN d.entity_type = 'invoice' THEN inv.agent_id
                WHEN d.entity_type = 'receipt' THEN rt.agent_id
                WHEN d.entity_type = 'vehicle_renewal' THEN vr.agent_id
                WHEN d.entity_type = 'transaction' THEN txn.agent_id
              END AS issued_for_agent_id
         FROM documents d
         LEFT JOIN invoices inv ON d.entity_type = 'invoice' AND inv.id = d.entity_id
         LEFT JOIN receipts rc ON d.entity_type = 'receipt' AND rc.id = d.entity_id
         LEFT JOIN transactions rt ON rt.id = rc.transaction_id
         LEFT JOIN vehicle_renewals vr ON d.entity_type = 'vehicle_renewal' AND vr.id = d.entity_id
         /*
          * An acknowledgement of payment hangs off the transaction itself, not
          * off a receipt that does not exist yet. Without this branch the agent
          * who took the money is refused the one document they have to show the
          * taxpayer standing in front of them.
          */
         LEFT JOIN transactions txn ON d.entity_type = 'transaction' AND txn.id = d.entity_id
        WHERE d.id = $1`,
      [req.params.id],
    );
    if (!document) throw notFound('That document');
    assertOwnRecord(req, 'document:read:all', document.issued_for_agent_id, 'That document');

    const { issued_for_agent_id: _scope, ...record } = document;
    res.json({ ...record, downloadUrl: signDocumentUrl(req.params.id) });
  }),
);

// ---------------------------------------------------------------------------
// Public verification portal (PRD §20, §43) — no authentication
// ---------------------------------------------------------------------------

export const verificationRouter = Router();

verificationRouter.use(rateLimit({ max: 60, keyPrefix: 'verify', keyBy: 'ip' }));

verificationRouter.get(
  '/:code',
  asyncHandler(async (req, res) => {
    const code = req.params.code;
    if (!code || code.length > 64) throw badRequest('Enter a receipt number or verification code.');

    const result = await receipts.verifyPublicly(pool, code);
    await receipts.logVerificationAttempt(pool, {
      lookupType: result.documentType === 'RECEIPT' || result.receiptNumber ? 'RECEIPT' : 'DOCUMENT',
      lookupValue: code,
      result: result.status,
      ipAddress: req.clientIp,
    });

    res.status(result.status === 'NOT_FOUND' ? 404 : 200).json(result);
  }),
);
