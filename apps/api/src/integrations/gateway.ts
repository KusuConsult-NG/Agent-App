/**
 * Payment gateway adapter (PRD §16, §18, §53).
 *
 * The platform never decides that money arrived. It asks the gateway, and the
 * gateway's answer — delivered by signed webhook or confirmed by a server-side
 * verification call — is the only thing that can move a payment to SUCCESSFUL
 * or VERIFIED (PRD §95).
 *
 * `MockGateway` implements the same interface against the development gateway
 * ledger in migration 006. Swapping in Paystack, Flutterwave, Remita or a
 * state-approved processor means implementing `PaymentGateway`; the payment
 * service does not change.
 */

import { randomUUID } from 'node:crypto';
import type { Kobo, PaymentMethod } from '@psirs/shared';
import { pool, queryOne, query } from '../db/pool';
import { config } from '../config';

export interface InitiatePaymentRequest {
  paymentReference: string;
  amountKobo: Kobo;
  email?: string | null;
  phone: string;
  paymentMethod?: PaymentMethod | null;
  callbackUrl: string;
  metadata: Record<string, unknown>;
}

export interface InitiatePaymentResult {
  gatewayReference: string;
  authorisationUrl: string;
  status: 'PENDING';
  raw: Record<string, unknown>;
}

export interface GatewayVerificationResult {
  /** What the gateway says right now. */
  status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'ABANDONED' | 'REVERSED' | 'UNKNOWN';
  gatewayReference: string;
  /** Amount as the gateway recorded it; compared against our own figure. */
  amountKobo: Kobo | null;
  paidAt: Date | null;
  paymentMethod: PaymentMethod | null;
  failureReason?: string;
  settlementReference?: string | null;
  raw: Record<string, unknown>;
}

export interface GatewayWebhookEvent {
  eventId: string;
  eventType: string;
  gatewayReference: string;
  status: 'SUCCESS' | 'FAILED' | 'REVERSED' | 'PENDING' | 'UNKNOWN';
  amountKobo: Kobo | null;
  paidAt: Date | null;
  paymentMethod: PaymentMethod | null;
  settlementReference?: string | null;
  raw: Record<string, unknown>;
}

export interface SettlementLine {
  gatewayReference: string;
  amountKobo: Kobo;
  status: string;
  paidAt: Date | null;
  settlementReference: string | null;
}

export interface PaymentGateway {
  readonly name: string;
  initiate(request: InitiatePaymentRequest): Promise<InitiatePaymentResult>;
  verify(gatewayReference: string): Promise<GatewayVerificationResult>;
  parseWebhook(payload: unknown): GatewayWebhookEvent | null;
  /** Gateway statement used for three-way reconciliation (PRD §46). */
  fetchStatement(params: { from: Date; to: Date }): Promise<SettlementLine[]>;
}

interface MockGatewayRow {
  gateway_reference: string;
  payment_reference: string;
  amount_kobo: string;
  status: string;
  paid_at: Date | null;
  payment_method: string | null;
  failure_reason: string | null;
  settlement_reference: string | null;
  metadata: Record<string, unknown>;
}

class MockGateway implements PaymentGateway {
  readonly name = 'mock';

  async initiate(request: InitiatePaymentRequest): Promise<InitiatePaymentResult> {
    const gatewayReference = `MOCKGW-${randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase()}`;

    await pool.query(
      `INSERT INTO mock_gateway_transactions
         (gateway_reference, payment_reference, amount_kobo, customer_email,
          customer_phone, payment_method, status, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', $7)`,
      [
        gatewayReference,
        request.paymentReference,
        request.amountKobo.toString(),
        request.email ?? null,
        request.phone,
        request.paymentMethod ?? null,
        JSON.stringify(request.metadata),
      ],
    );

    return {
      gatewayReference,
      authorisationUrl: `${config.payments.callbackUrl}?ref=${gatewayReference}`,
      status: 'PENDING',
      raw: { provider: 'mock', gatewayReference },
    };
  }

  async verify(gatewayReference: string): Promise<GatewayVerificationResult> {
    const row = await queryOne<MockGatewayRow>(
      pool,
      `SELECT gateway_reference, payment_reference, amount_kobo, status, paid_at,
              payment_method, failure_reason, settlement_reference, metadata
         FROM mock_gateway_transactions WHERE gateway_reference = $1`,
      [gatewayReference],
    );

    if (!row) {
      // A reference the gateway does not recognise is never treated as success.
      return {
        status: 'UNKNOWN',
        gatewayReference,
        amountKobo: null,
        paidAt: null,
        paymentMethod: null,
        failureReason: 'The gateway has no record of this payment reference.',
        raw: { provider: 'mock', found: false },
      };
    }

    return {
      status: row.status as GatewayVerificationResult['status'],
      gatewayReference: row.gateway_reference,
      amountKobo: BigInt(row.amount_kobo),
      paidAt: row.paid_at,
      paymentMethod: (row.payment_method as PaymentMethod | null) ?? null,
      failureReason: row.failure_reason ?? undefined,
      settlementReference: row.settlement_reference,
      raw: { provider: 'mock', ...row, amount_kobo: row.amount_kobo },
    };
  }

  parseWebhook(payload: unknown): GatewayWebhookEvent | null {
    if (typeof payload !== 'object' || payload === null) return null;
    const body = payload as Record<string, unknown>;
    const data = (body.data as Record<string, unknown> | undefined) ?? {};

    const gatewayReference = typeof data.reference === 'string' ? data.reference : null;
    const eventId = typeof body.id === 'string' ? body.id : null;
    const eventType = typeof body.event === 'string' ? body.event : 'unknown';
    if (!gatewayReference || !eventId) return null;

    const statusMap: Record<string, GatewayWebhookEvent['status']> = {
      'charge.success': 'SUCCESS',
      'charge.failed': 'FAILED',
      'charge.pending': 'PENDING',
      'charge.reversed': 'REVERSED',
    };

    const amountRaw = data.amount;
    const amountKobo =
      typeof amountRaw === 'string' && /^\d+$/.test(amountRaw) ? BigInt(amountRaw) : null;

    return {
      eventId,
      eventType,
      gatewayReference,
      status: statusMap[eventType] ?? 'UNKNOWN',
      amountKobo,
      paidAt: typeof data.paid_at === 'string' ? new Date(data.paid_at) : null,
      paymentMethod: (data.channel as PaymentMethod | undefined) ?? null,
      settlementReference:
        typeof data.settlement_reference === 'string' ? data.settlement_reference : null,
      raw: body,
    };
  }

  async fetchStatement(params: { from: Date; to: Date }): Promise<SettlementLine[]> {
    const rows = await query<MockGatewayRow>(
      pool,
      `SELECT gateway_reference, payment_reference, amount_kobo, status, paid_at,
              payment_method, failure_reason, settlement_reference, metadata
         FROM mock_gateway_transactions
        WHERE created_at >= $1 AND created_at <= $2
        ORDER BY created_at`,
      [params.from, params.to],
    );

    return rows.map((row) => ({
      gatewayReference: row.gateway_reference,
      amountKobo: BigInt(row.amount_kobo),
      status: row.status,
      paidAt: row.paid_at,
      settlementReference: row.settlement_reference,
    }));
  }

  // ---- Development-only controls, used by the simulation endpoint and tests --

  async simulateOutcome(params: {
    gatewayReference: string;
    outcome: 'SUCCESS' | 'FAILED' | 'ABANDONED' | 'REVERSED';
    failureReason?: string;
    paymentMethod?: PaymentMethod;
  }): Promise<MockGatewayRow | null> {
    const paidAt = params.outcome === 'SUCCESS' ? new Date() : null;
    return queryOne<MockGatewayRow>(
      pool,
      `UPDATE mock_gateway_transactions
          SET status = $2,
              paid_at = $3,
              failure_reason = $4,
              payment_method = COALESCE($5, payment_method)
        WHERE gateway_reference = $1
        RETURNING gateway_reference, payment_reference, amount_kobo, status, paid_at,
                  payment_method, failure_reason, settlement_reference, metadata`,
      [
        params.gatewayReference,
        params.outcome,
        paidAt,
        params.failureReason ?? null,
        params.paymentMethod ?? null,
      ],
    );
  }

  async markSettled(gatewayReferences: string[], settlementReference: string): Promise<number> {
    const result = await pool.query(
      `UPDATE mock_gateway_transactions
          SET settlement_reference = $2, settled_at = now()
        WHERE gateway_reference = ANY($1::text[]) AND status = 'SUCCESS'`,
      [gatewayReferences, settlementReference],
    );
    return result.rowCount ?? 0;
  }
}

const mockGateway = new MockGateway();

export const gateway: PaymentGateway = mockGateway;

/** Exposed only for the development simulation routes and integration tests. */
export const developmentGatewayControls = mockGateway;

export function isMockGateway(): boolean {
  return gateway.name === 'mock';
}
