/**
 * Payments — the enforcement point for PRD §95.
 *
 *   "No person, including an agent, should be able to make a government
 *    revenue transaction appear successful unless the underlying financial
 *    transaction has been independently confirmed by the payment/revenue
 *    infrastructure."
 *
 * Everything in this file follows from that sentence:
 *
 *   * `initiatePayment` creates an intent. It never sets a success state.
 *   * `confirmPayment` is the ONLY function that can mark a payment VERIFIED,
 *     and it does so only after asking the gateway and getting SUCCESS with a
 *     matching amount. It takes no "status" argument from any caller.
 *   * `handleWebhook` authenticates the delivery through the active gateway,
 *     records it, then routes through `confirmPayment` — a webhook is a prompt
 *     to go and verify, never an instruction to be trusted. Gateways differ in
 *     whether they sign callbacks; none of them get to assert an outcome.
 *   * Receipt issue and commission accrual happen inside the same database
 *     transaction as verification, so evidence and incentive can never drift
 *     apart from the money.
 */

import type { PoolClient } from 'pg';
import {
  assertPaymentTransition,
  parseKobo,
  type Kobo,
  type PaymentMethod,
  type PaymentState,
} from '@psirs/shared';
import { advisoryLock, LOCK_NAMESPACE, pool, queryOne, query, withTransaction } from '../db/pool';
import type { Db } from '../db/pool';
import { config } from '../config';
import { gateway } from '../integrations/gateway';
import {
  AppError,
  conflict,
  notFound,
  paymentFailed,
  paymentUnconfirmed,
} from '../lib/errors';
import { nextPaymentReference } from '../lib/references';
import { recordAudit } from './audit';
import { accrueCommission } from './commission';
import { issueReceipt } from './receipts';
import { completeRenewal } from './vehicles';
import { transitionTransaction } from './revenue';
import { evaluateTransactionRisk } from './fraud';
import { queueNotification } from './notifications';

export interface InitiatePaymentParams {
  transactionId: string;
  paymentMethod?: PaymentMethod | null;
  actorId: string;
  actorRole: string;
  deviceId?: string | null;
  ipAddress?: string | null;
  callbackUrl?: string;
}

export interface InitiatePaymentResult {
  paymentId: string;
  paymentReference: string;
  gatewayReference: string;
  authorisationUrl: string;
  amountKobo: Kobo;
  status: PaymentState;
}

export async function initiatePayment(
  params: InitiatePaymentParams,
): Promise<InitiatePaymentResult> {
  return withTransaction(async (client) => {
    const transaction = await queryOne<{
      id: string;
      transaction_reference: string;
      status: string;
      total_amount_kobo: string;
      taxpayer_id: string;
      invoice_id: string;
      phone: string;
      email: string | null;
      invoice_status: string;
      invoice_expires_at: Date | null;
    }>(
      client,
      `SELECT t.id, t.transaction_reference, t.status, t.total_amount_kobo, t.taxpayer_id,
              t.invoice_id, tp.phone, tp.email, i.status AS invoice_status,
              i.expires_at AS invoice_expires_at
         FROM transactions t
         JOIN taxpayers tp ON tp.id = t.taxpayer_id
         JOIN invoices i ON i.id = t.invoice_id
        WHERE t.id = $1
        FOR UPDATE OF t`,
      [params.transactionId],
    );

    if (!transaction) throw notFound('That transaction');

    if (transaction.invoice_status === 'PAID') {
      throw conflict(
        'INVOICE_ALREADY_PAID',
        'This invoice has already been paid. Do not collect payment again.',
        'Open the receipt from the transaction history.',
      );
    }
    if (transaction.invoice_status === 'CANCELLED' || transaction.invoice_status === 'EXPIRED') {
      throw conflict(
        'INVOICE_NOT_PAYABLE',
        `This invoice is ${transaction.invoice_status.toLowerCase()} and can no longer be paid. ` +
          'Raise a new assessment.',
      );
    }
    if (
      transaction.invoice_expires_at &&
      transaction.invoice_expires_at.getTime() < Date.now()
    ) {
      throw conflict(
        'INVOICE_EXPIRED',
        'This invoice has expired. Raise a new assessment for the taxpayer.',
      );
    }

    // A payment already in flight is returned rather than duplicated: the
    // partial unique index would reject a second row anyway, but returning the
    // existing intent is what the agent actually needs (PRD §61).
    const inFlight = await queryOne<{
      id: string;
      payment_reference: string;
      gateway_reference: string | null;
      status: PaymentState;
      amount_kobo: string;
      authorisation_url: string | null;
    }>(
      client,
      `SELECT id, payment_reference, gateway_reference, status, amount_kobo, authorisation_url
         FROM payments
        WHERE transaction_id = $1 AND status IN ('INITIATED','PENDING','SUCCESSFUL','VERIFIED')`,
      [params.transactionId],
    );

    if (inFlight) {
      if (inFlight.status === 'VERIFIED') {
        throw conflict(
          'PAYMENT_ALREADY_VERIFIED',
          'This transaction has already been paid and verified. Do not collect payment again.',
        );
      }
      return {
        paymentId: inFlight.id,
        paymentReference: inFlight.payment_reference,
        gatewayReference: inFlight.gateway_reference ?? '',
        authorisationUrl: inFlight.authorisation_url ?? '',
        amountKobo: parseKobo(inFlight.amount_kobo),
        status: inFlight.status,
      };
    }

    if (!['INVOICE_GENERATED', 'PAYMENT_INITIATED'].includes(transaction.status)) {
      throw conflict(
        'TRANSACTION_NOT_PAYABLE',
        `This transaction is in state ${transaction.status} and cannot accept a payment now.`,
      );
    }

    const amount = parseKobo(transaction.total_amount_kobo);
    const paymentReference = await nextPaymentReference(client);

    const initiation = await gateway.initiate({
      paymentReference,
      amountKobo: amount,
      email: transaction.email,
      phone: transaction.phone,
      paymentMethod: params.paymentMethod ?? null,
      callbackUrl: params.callbackUrl ?? config.payments.callbackUrl,
      metadata: {
        transactionReference: transaction.transaction_reference,
        transactionId: transaction.id,
        taxpayerId: transaction.taxpayer_id,
      },
    });

    const payment = await queryOne<{ id: string }>(
      client,
      `INSERT INTO payments
         (transaction_id, payment_reference, gateway, gateway_reference, payment_method,
          amount_kobo, status, gateway_response, authorisation_url)
       VALUES ($1,$2,$3,$4,$5,$6,'PENDING',$7,$8)
       RETURNING id`,
      [
        transaction.id,
        paymentReference,
        gateway.name,
        initiation.gatewayReference,
        params.paymentMethod ?? null,
        amount.toString(),
        JSON.stringify(initiation.raw),
        initiation.authorisationUrl,
      ],
    );

    if (transaction.status === 'INVOICE_GENERATED') {
      await transitionTransaction(client, {
        transactionId: transaction.id,
        to: 'PAYMENT_INITIATED',
        actorId: params.actorId,
        source: 'AGENT',
        metadata: { paymentReference, gatewayReference: initiation.gatewayReference },
      });
    }
    await transitionTransaction(client, {
      transactionId: transaction.id,
      to: 'PAYMENT_PENDING',
      actorId: params.actorId,
      source: 'AGENT',
      metadata: { paymentReference },
    });

    await recordAudit(client, {
      actorId: params.actorId,
      actorRole: params.actorRole,
      action: 'payment.initiated',
      entityType: 'payment',
      entityId: payment!.id,
      newValue: {
        paymentReference,
        gatewayReference: initiation.gatewayReference,
        amountKobo: amount.toString(),
        transactionReference: transaction.transaction_reference,
      },
      ipAddress: params.ipAddress ?? null,
      deviceId: params.deviceId ?? null,
    });

    return {
      paymentId: payment!.id,
      paymentReference,
      gatewayReference: initiation.gatewayReference,
      authorisationUrl: initiation.authorisationUrl,
      amountKobo: amount,
      status: 'PENDING',
    };
  });
}

async function transitionPayment(
  client: PoolClient,
  params: {
    paymentId: string;
    to: PaymentState;
    from: PaymentState;
    verifiedBySource?: 'WEBHOOK' | 'POLL' | 'RECONCILIATION';
    gatewayReference?: string | null;
    paymentMethod?: PaymentMethod | null;
    paidAt?: Date | null;
    failureReason?: string | null;
    response?: unknown;
  },
): Promise<void> {
  assertPaymentTransition(params.from, params.to);

  await client.query(
    `UPDATE payments
        SET status = $2,
            gateway_reference = COALESCE($3, gateway_reference),
            payment_method = COALESCE($4, payment_method),
            paid_at = COALESCE($5, paid_at),
            verified_at = CASE WHEN $2 = 'VERIFIED' THEN now() ELSE verified_at END,
            verified_by_source = CASE WHEN $2 = 'VERIFIED' THEN $6 ELSE verified_by_source END,
            failure_reason = COALESCE($7, failure_reason),
            reversed_at = CASE WHEN $2 IN ('REVERSED','REFUNDED') THEN now() ELSE reversed_at END,
            verification_response = CASE WHEN $2 IN ('SUCCESSFUL','VERIFIED')
                                         THEN $8::jsonb ELSE verification_response END
      WHERE id = $1`,
    [
      params.paymentId,
      params.to,
      params.gatewayReference ?? null,
      params.paymentMethod ?? null,
      params.paidAt ?? null,
      params.verifiedBySource ?? null,
      params.failureReason ?? null,
      params.response === undefined ? null : JSON.stringify(params.response),
    ],
  );
}

export interface ConfirmationResult {
  status: 'VERIFIED' | 'PENDING' | 'FAILED';
  paymentId: string;
  transactionId: string;
  transactionReference: string;
  receiptNumber?: string;
  receiptId?: string;
  documentId?: string;
  commissionKobo?: string;
  message: string;
  /** Present when this payment was for a vehicle renewal, which it then issues. */
  vehicleDocument?: {
    documentId: string;
    documentNumber: string;
    verificationCode: string;
    expiryDate: Date;
  };
}

/**
 * Ask the payment infrastructure whether this money actually arrived, and act
 * on the answer.
 *
 * There is deliberately no parameter here through which a caller can assert an
 * outcome. Every route into this function — agent taps "I've paid", taxpayer
 * returns from the gateway page, webhook arrives, reconciliation sweep — ends
 * up making the same independent verification call.
 */
export async function confirmPayment(params: {
  paymentId: string;
  source: 'WEBHOOK' | 'POLL' | 'RECONCILIATION';
  actorId?: string | null;
  actorRole?: string | null;
}): Promise<ConfirmationResult> {
  const result = await verifyAndRecord(params);

  // What the citizen actually bought. Issuing it lived in the route the agent's
  // app calls when it taps "check payment status", so a renewal confirmed by
  // webhook — the ordinary path, and the one this platform treats as
  // authoritative — took the money, issued the receipt, and never issued the
  // renewal or told the vehicle authority. The taxpayer was left holding a
  // government receipt for a renewal that had not happened.
  //
  // It belongs here, where the docstring above already says every confirmation
  // route converges. Outside the transaction because it calls the vehicle
  // authority over the network, and that must not be done holding a
  // SERIALIZABLE transaction open.
  if (result.status === 'VERIFIED') {
    await issueRenewalFor(result, params);
  }

  return result;
}

/**
 * Complete any vehicle renewal waiting on this payment.
 *
 * Guarded on `document_id IS NULL`, so a redelivered webhook or a later poll
 * issues nothing twice — and a renewal stranded by an earlier failure is
 * repaired by the next confirmation to arrive rather than staying stuck.
 *
 * A failure here must not turn a confirmed payment into an error: the money is
 * verified and the receipt exists whatever the vehicle authority does. It is
 * recorded and left for the retry job, which is what that job is for.
 */
async function issueRenewalFor(
  result: ConfirmationResult,
  params: { actorId?: string | null; actorRole?: string | null },
): Promise<void> {
  const renewal = await queryOne<{ id: string }>(
    pool,
    'SELECT id FROM vehicle_renewals WHERE transaction_id = $1 AND document_id IS NULL',
    [result.transactionId],
  );
  if (!renewal) return;

  try {
    result.vehicleDocument = await completeRenewal({
      renewalId: renewal.id,
      actorId: params.actorId ?? null,
      actorRole: params.actorRole ?? 'system',
    });
  } catch (error) {
    console.error(
      `[payments] payment ${result.paymentId} verified but its vehicle renewal could not be issued`,
      error,
    );
  }
}

async function verifyAndRecord(params: {
  paymentId: string;
  source: 'WEBHOOK' | 'POLL' | 'RECONCILIATION';
  actorId?: string | null;
  actorRole?: string | null;
}): Promise<ConfirmationResult> {
  return withTransaction(
    async (client) => {
      const payment = await queryOne<{
        id: string;
        transaction_id: string;
        payment_reference: string;
        gateway_reference: string | null;
        amount_kobo: string;
        status: PaymentState;
        transaction_reference: string;
        transaction_status: string;
        invoice_id: string;
        agent_id: string | null;
      }>(
        client,
        `SELECT p.id, p.transaction_id, p.payment_reference, p.gateway_reference,
                p.amount_kobo, p.status, t.transaction_reference, t.status AS transaction_status,
                t.invoice_id, t.agent_id
           FROM payments p JOIN transactions t ON t.id = p.transaction_id
          WHERE p.id = $1
          FOR UPDATE OF p`,
        [params.paymentId],
      );

      if (!payment) throw notFound('That payment');

      // Serialise concurrent confirmations of one payment (simultaneous webhook
      // and poll) so only one of them performs the state change.
      await advisoryLock(client, LOCK_NAMESPACE.PAYMENT, payment.id);

      // Already verified: return the existing receipt. Confirmation is
      // idempotent, so a redelivered webhook produces no second receipt and no
      // second commission (PRD §53).
      if (payment.status === 'VERIFIED') {
        const receipt = await queryOne<{
          id: string;
          receipt_number: string;
          document_id: string | null;
        }>(
          client,
          'SELECT id, receipt_number, document_id FROM receipts WHERE payment_id = $1',
          [payment.id],
        );
        return {
          status: 'VERIFIED',
          paymentId: payment.id,
          transactionId: payment.transaction_id,
          transactionReference: payment.transaction_reference,
          receiptNumber: receipt?.receipt_number,
          receiptId: receipt?.id,
          documentId: receipt?.document_id ?? undefined,
          message: 'This payment was already confirmed. The receipt below is the original.',
        };
      }

      if (payment.status === 'FAILED' || payment.status === 'ABANDONED') {
        throw paymentFailed(
          payment.transaction_reference,
          'the payment attempt did not complete',
        );
      }

      if (!payment.gateway_reference) {
        throw paymentUnconfirmed(payment.transaction_reference);
      }

      // ---- The independent confirmation -----------------------------------
      const verification = await gateway.verify(payment.gateway_reference);

      if (verification.status === 'PENDING' || verification.status === 'UNKNOWN') {
        await client.query(
          `UPDATE payments SET verification_response = $2 WHERE id = $1`,
          [payment.id, JSON.stringify(verification.raw)],
        );
        throw paymentUnconfirmed(payment.transaction_reference);
      }

      if (verification.status === 'FAILED' || verification.status === 'ABANDONED') {
        await transitionPayment(client, {
          paymentId: payment.id,
          from: payment.status,
          to: verification.status === 'FAILED' ? 'FAILED' : 'ABANDONED',
          failureReason: verification.failureReason ?? 'Gateway reported the payment did not succeed',
          response: verification.raw,
        });
        await transitionTransaction(client, {
          transactionId: payment.transaction_id,
          to: 'FAILED',
          reason: verification.failureReason ?? 'Payment not successful at gateway',
          actorId: params.actorId ?? null,
          source: params.source === 'WEBHOOK' ? 'GATEWAY_WEBHOOK' : 'SYSTEM',
        });
        await recordAudit(client, {
          actorId: params.actorId ?? null,
          actorRole: params.actorRole ?? 'system',
          action: 'payment.failed',
          entityType: 'payment',
          entityId: payment.id,
          newValue: { status: verification.status, reason: verification.failureReason },
        });

        return {
          status: 'FAILED',
          paymentId: payment.id,
          transactionId: payment.transaction_id,
          transactionReference: payment.transaction_reference,
          message:
            'The payment did not succeed. No money has been received and no receipt has been issued.',
        };
      }

      // ---- Amount check ----------------------------------------------------
      // A gateway reporting success for a different amount is never accepted as
      // payment of this obligation: that would let a ₦100 payment discharge a
      // ₦100,000 assessment.
      const expected = parseKobo(payment.amount_kobo);
      if (verification.amountKobo === null || verification.amountKobo !== expected) {
        await transitionTransaction(client, {
          transactionId: payment.transaction_id,
          to: 'UNDER_REVIEW',
          reason: `Gateway amount ${verification.amountKobo ?? 'unknown'} does not match expected ${expected}`,
          actorId: params.actorId ?? null,
          source: 'SYSTEM',
        });
        await client.query(
          `INSERT INTO fraud_flags (rule, severity, entity_type, entity_id, transaction_id, detail)
           VALUES ('AMOUNT_MISMATCH','CRITICAL','TRANSACTION',$1,$1,$2)`,
          [
            payment.transaction_id,
            JSON.stringify({
              expectedKobo: expected.toString(),
              gatewayKobo: verification.amountKobo?.toString() ?? null,
              gatewayReference: payment.gateway_reference,
            }),
          ],
        );
        await recordAudit(client, {
          actorId: params.actorId ?? null,
          actorRole: params.actorRole ?? 'system',
          action: 'payment.amount_mismatch',
          entityType: 'payment',
          entityId: payment.id,
          result: 'FAILURE',
          newValue: {
            expectedKobo: expected.toString(),
            gatewayKobo: verification.amountKobo?.toString() ?? null,
          },
        });

        throw new AppError({
          statusCode: 409,
          code: 'PAYMENT_AMOUNT_MISMATCH',
          message:
            'The amount confirmed by the payment gateway does not match this invoice. ' +
            'The transaction has been placed under review and no receipt has been issued. ' +
            'Do not collect payment again.',
          moneyStatus: 'UNCONFIRMED',
          reference: payment.transaction_reference,
        });
      }

      // ---- Confirmed: advance the money states ----------------------------
      const paidAt = verification.paidAt ?? new Date();

      await transitionPayment(client, {
        paymentId: payment.id,
        from: payment.status,
        to: 'SUCCESSFUL',
        gatewayReference: verification.gatewayReference,
        paymentMethod: verification.paymentMethod,
        paidAt,
        response: verification.raw,
      });

      await transitionTransaction(client, {
        transactionId: payment.transaction_id,
        to: 'PAYMENT_SUCCESSFUL',
        actorId: params.actorId ?? null,
        source: params.source === 'WEBHOOK' ? 'GATEWAY_WEBHOOK' : 'SYSTEM',
        metadata: { gatewayReference: verification.gatewayReference },
      });

      await transitionPayment(client, {
        paymentId: payment.id,
        from: 'SUCCESSFUL',
        to: 'VERIFIED',
        verifiedBySource: params.source,
        response: verification.raw,
      });

      await transitionTransaction(client, {
        transactionId: payment.transaction_id,
        to: 'PAYMENT_VERIFIED',
        reason: `Verified independently via ${params.source.toLowerCase()}`,
        actorId: params.actorId ?? null,
        source: params.source === 'WEBHOOK' ? 'GATEWAY_WEBHOOK' : 'SYSTEM',
      });

      await client.query(
        `UPDATE invoices
            SET amount_paid_kobo = LEAST(total_amount_kobo, amount_paid_kobo + $2::bigint),
                status = CASE
                  WHEN amount_paid_kobo + $2::bigint >= total_amount_kobo THEN 'PAID'
                  ELSE 'PARTIALLY_PAID' END
          WHERE id = $1`,
        [payment.invoice_id, expected.toString()],
      );

      // ---- Evidence and incentive, in the same transaction -----------------
      const receipt = await issueReceipt(client, {
        transactionId: payment.transaction_id,
        paymentId: payment.id,
        actorId: params.actorId ?? null,
      });

      await transitionTransaction(client, {
        transactionId: payment.transaction_id,
        to: 'RECEIPT_GENERATED',
        actorId: params.actorId ?? null,
        source: 'SYSTEM',
        metadata: { receiptNumber: receipt.receiptNumber },
      });

      await transitionTransaction(client, {
        transactionId: payment.transaction_id,
        to: 'RECONCILIATION_PENDING',
        reason: 'Awaiting settlement confirmation',
        actorId: params.actorId ?? null,
        source: 'SYSTEM',
      });

      const commission = await accrueCommission(client, {
        transactionId: payment.transaction_id,
        actorId: params.actorId ?? null,
      });

      await evaluateTransactionRisk(client, { transactionId: payment.transaction_id });

      await recordAudit(client, {
        actorId: params.actorId ?? null,
        actorRole: params.actorRole ?? 'system',
        action: 'payment.verified',
        entityType: 'payment',
        entityId: payment.id,
        newValue: {
          gatewayReference: verification.gatewayReference,
          amountKobo: expected.toString(),
          verifiedBy: params.source,
          receiptNumber: receipt.receiptNumber,
          commissionKobo: commission?.amountKobo.toString() ?? null,
        },
      });

      await queueNotification(client, {
        event: 'PAYMENT_SUCCESSFUL',
        taxpayerId: await taxpayerIdFor(client, payment.transaction_id),
        entityType: 'transaction',
        entityId: payment.transaction_id,
        variables: {
          amount: expected.toString(),
          receiptNumber: receipt.receiptNumber,
          reference: payment.transaction_reference,
        },
      });

      return {
        status: 'VERIFIED',
        paymentId: payment.id,
        transactionId: payment.transaction_id,
        transactionReference: payment.transaction_reference,
        receiptNumber: receipt.receiptNumber,
        receiptId: receipt.receiptId,
        documentId: receipt.documentId,
        commissionKobo: commission?.amountKobo.toString(),
        message: 'Payment confirmed and government receipt issued.',
      };
    },
    // SERIALIZABLE: verification reads the payment, the invoice and the
    // commission ledger and writes all three. A phantom under READ COMMITTED
    // could allow two concurrent confirmations to both accrue commission.
    { isolationLevel: 'SERIALIZABLE' },
  );
}

async function taxpayerIdFor(client: PoolClient, transactionId: string): Promise<string> {
  const row = await queryOne<{ taxpayer_id: string }>(
    client,
    'SELECT taxpayer_id FROM transactions WHERE id = $1',
    [transactionId],
  );
  return row!.taxpayer_id;
}

export interface WebhookResult {
  acknowledged: boolean;
  duplicate: boolean;
  outcome?: ConfirmationResult;
  note: string;
}

/**
 * Handle a gateway webhook (PRD §53).
 *
 * Order matters:
 *   1. verify the signature over the RAW body (never the re-serialised one);
 *   2. persist the delivery, whose UNIQUE (gateway, event_id) makes a
 *      redelivery detectable;
 *   3. if new, verify the payment independently and act.
 *
 * A duplicate returns a successful acknowledgement without creating anything —
 * exactly the behaviour PRD §53 specifies — so the gateway stops retrying.
 */
export async function handleWebhook(params: {
  rawBody: Buffer;
  signature: string | undefined;
  headers?: Record<string, string | undefined>;
  sourceIp?: string | null;
  parsedBody: unknown;
}): Promise<WebhookResult> {
  // Authentication is gateway-specific. A gateway that signs its callbacks has
  // an unsigned delivery refused outright; one that does not sign them (Remita
  // notifies with a reference and expects a status query) has the delivery
  // accepted as a prompt only. Either way the delivery conveys no authority
  // over payment state — `confirmPayment` re-verifies against the gateway.
  const auth = gateway.authenticateWebhook({
    rawBody: params.rawBody,
    headers: params.headers ?? {
      'x-psirs-signature': params.signature,
    },
    parsedBody: params.parsedBody,
    sourceIp: params.sourceIp ?? null,
  });

  const event = gateway.parseWebhook(params.parsedBody);

  if (!event) {
    await withTransaction((client) =>
      client.query(
        `INSERT INTO payment_webhook_events
           (gateway, event_id, event_type, payload, signature, signature_valid,
            processing_status, processing_note)
         VALUES ($1, $2, 'unparseable', $3, $4, $5, 'REJECTED', $6)
         ON CONFLICT (gateway, event_id) DO NOTHING`,
        [
          gateway.name,
          `unparseable-${Date.now()}`,
          JSON.stringify(params.parsedBody ?? {}),
          params.signature ?? null,
          auth.authenticated,
          'Payload could not be parsed into a known event shape',
        ],
      ),
    );
    return { acknowledged: false, duplicate: false, note: 'Webhook payload could not be parsed.' };
  }

  if (!auth.accepted) {
    // Recorded, then refused. A delivery the active gateway will not vouch for
    // is never allowed to influence payment state (PRD §54).
    await withTransaction((client) =>
      client.query(
        `INSERT INTO payment_webhook_events
           (gateway, event_id, event_type, gateway_reference, payload, signature,
            signature_valid, processing_status, processing_note)
         VALUES ($1,$2,$3,$4,$5,$6,false,'REJECTED',$7)
         ON CONFLICT (gateway, event_id) DO NOTHING`,
        [
          gateway.name,
          event.eventId,
          event.eventType,
          event.gatewayReference,
          JSON.stringify(event.raw),
          params.signature ?? null,
          auth.reason ?? 'Delivery could not be authenticated',
        ],
      ),
    );
    throw new AppError({
      statusCode: 401,
      code: 'INVALID_WEBHOOK_SIGNATURE',
      message: auth.reason ?? 'Webhook delivery could not be authenticated.',
      expose: false,
    });
  }

  const insertion = await withTransaction(async (client) => {
    const row = await queryOne<{ id: string }>(
      client,
      `INSERT INTO payment_webhook_events
         (gateway, event_id, event_type, gateway_reference, payload, signature,
          signature_valid, processing_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'RECEIVED')
       ON CONFLICT (gateway, event_id) DO NOTHING
       RETURNING id`,
      [
        gateway.name,
        event.eventId,
        event.eventType,
        event.gatewayReference,
        JSON.stringify(event.raw),
        params.signature ?? null,
        auth.authenticated,
      ],
    );
    return row;
  });

  if (!insertion) {
    return {
      acknowledged: true,
      duplicate: true,
      note: 'This webhook event was already processed. No duplicate payment has been created.',
    };
  }

  const found = await withTransaction((client) =>
    queryOne<{ id: string }>(client, 'SELECT id FROM payments WHERE gateway_reference = $1', [
      event.gatewayReference,
    ]),
  );

  if (!found) {
    await withTransaction((client) =>
      client.query(
        `UPDATE payment_webhook_events
            SET processing_status = 'IGNORED', processed_at = now(),
                processing_note = 'No platform payment matches this gateway reference'
          WHERE gateway = $1 AND event_id = $2`,
        [gateway.name, event.eventId],
      ),
    );
    return {
      acknowledged: true,
      duplicate: false,
      note: 'No matching platform payment. Recorded for reconciliation review.',
    };
  }

  try {
    const outcome = await confirmPayment({ paymentId: found.id, source: 'WEBHOOK' });
    await withTransaction((client) =>
      client.query(
        `UPDATE payment_webhook_events
            SET processing_status = 'PROCESSED', processed_at = now(), payment_id = $3,
                processing_note = $4
          WHERE gateway = $1 AND event_id = $2`,
        [gateway.name, event.eventId, found.id, outcome.message],
      ),
    );
    return { acknowledged: true, duplicate: false, outcome, note: outcome.message };
  } catch (error) {
    const note = error instanceof Error ? error.message : 'Unknown processing error';
    await withTransaction((client) =>
      client.query(
        `UPDATE payment_webhook_events
            SET processing_status = 'FAILED', processed_at = now(), payment_id = $3,
                processing_note = $4
          WHERE gateway = $1 AND event_id = $2`,
        [gateway.name, event.eventId, found.id, note],
      ),
    );
    // Acknowledged so the gateway does not retry forever; the failed delivery
    // sits in the reconciliation exception queue instead.
    return { acknowledged: true, duplicate: false, note };
  }
}

/**
 * Recover a transaction's true state from the server (Addendum §44).
 *
 * "If the browser closes after payment, the agent should be able to reopen the
 * PWA and retrieve the transaction status. This is critical."
 */
export async function getTransactionStatus(db: Db, transactionReference: string) {
  const transaction = await queryOne<Record<string, unknown>>(
    db,
    `SELECT t.id, t.transaction_reference, t.status, t.amount_kobo, t.service_charge_kobo,
            t.total_amount_kobo, t.created_at, t.verified_at, t.settled_at, t.agent_id,
            i.id AS invoice_id, i.invoice_number, i.status AS invoice_status, i.expires_at,
            ri.name AS revenue_item, rc.name AS revenue_category,
            tp.first_name, tp.last_name, tp.business_name, tp.tin,
            p.id AS payment_id, p.payment_reference, p.gateway_reference, p.status AS payment_status,
            p.paid_at, p.verified_at AS payment_verified_at, p.failure_reason,
            r.id AS receipt_id, r.receipt_number, r.verification_code AS receipt_code,
            r.document_id
       FROM transactions t
       JOIN invoices i ON i.id = t.invoice_id
       JOIN revenue_items ri ON ri.id = t.revenue_item_id
       JOIN revenue_categories rc ON rc.id = ri.category_id
       JOIN taxpayers tp ON tp.id = t.taxpayer_id
       LEFT JOIN payments p ON p.transaction_id = t.id
            AND p.status IN ('INITIATED','PENDING','SUCCESSFUL','VERIFIED')
       LEFT JOIN receipts r ON r.transaction_id = t.id
      WHERE t.transaction_reference = $1`,
    [transactionReference],
  );

  if (!transaction) throw notFound('That transaction');

  const events = await query(
    db,
    `SELECT from_status, to_status, reason, source, created_at
       FROM transaction_events WHERE transaction_id = $1 ORDER BY created_at`,
    [transaction.id],
  );

  return { transaction, events };
}
