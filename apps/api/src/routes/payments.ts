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
import { notFound, forbidden, badRequest } from '../lib/errors';
import * as payments from '../services/payments';
import * as receipts from '../services/receipts';
import { storage, signDocumentUrl, verifyDocumentSignature } from '../services/storage';
import { developmentGatewayControls, isMockGateway } from '../integrations/gateway';
import { completeRenewal } from '../services/vehicles';

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
  rateLimit({ max: 240, windowMs: 60_000, keyPrefix: 'webhook' }),
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

    // A vehicle renewal issues its document as soon as its payment verifies.
    if (result.status === 'VERIFIED') {
      const renewal = await queryOne<{ id: string }>(
        pool,
        `SELECT id FROM vehicle_renewals WHERE transaction_id = $1 AND document_id IS NULL`,
        [result.transactionId],
      );
      if (renewal) {
        const document = await completeRenewal({
          renewalId: renewal.id,
          actorId: req.auth!.userId,
          actorRole: req.auth!.role,
        });
        res.json({ ...result, vehicleDocument: { ...document, downloadUrl: signDocumentUrl(document.documentId) } });
        return;
      }
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
    res.json(await payments.getTransactionStatus(pool, req.params.reference));
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
  SELECT r.*, t.transaction_reference, ri.name AS revenue_item,
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
    async (_req, res, data) => {
      const receipt = await queryOne<{ document_id: string | null }>(
        pool,
        `${RECEIPT_DETAIL_SQL} WHERE r.receipt_number = $1`,
        [data.number],
      );
      if (!receipt) throw notFound('That receipt');
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
    const document = await queryOne(
      pool,
      `SELECT id, document_number, document_type, owner_type, owner_id, issued_at, expires_at,
              status, version, issuing_authority, verification_code, byte_size
         FROM documents WHERE id = $1`,
      [req.params.id],
    );
    if (!document) throw notFound('That document');
    res.json({ ...document, downloadUrl: signDocumentUrl(req.params.id) });
  }),
);

// ---------------------------------------------------------------------------
// Public verification portal (PRD §20, §43) — no authentication
// ---------------------------------------------------------------------------

export const verificationRouter = Router();

verificationRouter.use(rateLimit({ max: 60, keyPrefix: 'verify' }));

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
