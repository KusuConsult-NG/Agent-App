/**
 * The payment gateway contract (PRD §16, §18, §53, §95).
 *
 * A gateway adapter is a translator, not an authority. The platform never
 * accepts a gateway's word about a payment from an inbound message; it asks,
 * through `verify()`, and acts only on the answer. Everything in this interface
 * follows from that:
 *
 *   * `parseWebhook` extracts an identifier and *nothing the caller trusts*.
 *     Its `status` field exists for logging and triage — `confirmPayment`
 *     re-verifies regardless of what it says.
 *   * `verify` is the only method whose result moves money states.
 *   * `authenticateWebhook` decides whether a delivery may be acted on at all,
 *     which is gateway-specific: some sign their callbacks, some do not.
 */

import type { Kobo, PaymentMethod } from '@psirs/shared';

export interface InitiatePaymentRequest {
  paymentReference: string;
  amountKobo: Kobo;
  email?: string | null;
  phone: string;
  payerName?: string | null;
  description?: string | null;
  paymentMethod?: PaymentMethod | null;
  callbackUrl: string;
  metadata: Record<string, unknown>;
}

export interface InitiatePaymentResult {
  /** The gateway's own handle for this payment — a Remita RRR, for example. */
  gatewayReference: string;
  authorisationUrl: string;
  status: 'PENDING';
  raw: Record<string, unknown>;
}

export interface GatewayVerificationResult {
  /**
   * What the gateway says right now.
   *
   * `UNKNOWN` means the gateway did not give an answer this platform is
   * willing to act on — an unrecognised reference, an unmapped status code, a
   * transport failure. It is never treated as success or as failure: the
   * payment stays in flight and reconciliation picks it up. Failing closed in
   * both directions is deliberate, because wrongly marking a payment failed
   * closes a transaction the taxpayer may have genuinely paid.
   */
  status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'ABANDONED' | 'REVERSED' | 'UNKNOWN';
  gatewayReference: string;
  /** Amount as the gateway recorded it, normalised to kobo. */
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
  /** Advisory only. Never drives a state change — `verify()` does. */
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

export interface WebhookAuthInput {
  rawBody: Buffer;
  headers: Record<string, string | undefined>;
  parsedBody: unknown;
  sourceIp: string | null;
}

export interface WebhookAuthResult {
  /** May this delivery be acted on at all? */
  accepted: boolean;
  /**
   * Is the delivery cryptographically attributable to the gateway?
   *
   * Separate from `accepted` on purpose. A gateway that does not sign its
   * callbacks can still be accepted, because in this architecture a webhook
   * only ever prompts the platform to go and ask the gateway what happened.
   * The distinction is recorded on the stored delivery so an auditor can tell
   * which deliveries were provably genuine.
   */
  authenticated: boolean;
  reason?: string;
}

/**
 * What a gateway says when asked to return money to a taxpayer.
 *
 * `ACCEPTED` means the gateway has taken responsibility for the refund, not
 * that the money has landed. `UNAVAILABLE` is deliberately distinct from
 * `REJECTED`: a gateway that could not be reached has not refused, and a
 * refund the platform failed to ask for must be asked for again rather than
 * written off. This is the same distinction the KYC, TIN, bank and vehicle
 * integrations already make — "we could not ask" is never "the answer is no".
 */
export interface GatewayRefundResult {
  outcome: 'ACCEPTED' | 'REJECTED' | 'UNAVAILABLE';
  /** The gateway's own reference for the refund, when it gave one. */
  reference?: string;
  reason?: string;
  provider: string;
}

export interface RefundRequest {
  /** The gateway's reference for the original payment. */
  gatewayReference: string;
  amountKobo: bigint;
  /** The platform's own reference, so the gateway can be reconciled later. */
  refundReference: string;
  reason: string;
}

export interface PaymentGateway {
  readonly name: string;
  /** False when the gateway does not sign callbacks — see WebhookAuthResult. */
  readonly signsWebhooks: boolean;
  initiate(request: InitiatePaymentRequest): Promise<InitiatePaymentResult>;
  verify(gatewayReference: string): Promise<GatewayVerificationResult>;
  authenticateWebhook(input: WebhookAuthInput): WebhookAuthResult;
  parseWebhook(payload: unknown): GatewayWebhookEvent | null;
  /** Gateway statement used for three-way reconciliation (PRD §46). */
  fetchStatement(params: { from: Date; to: Date }): Promise<SettlementLine[]>;
  /**
   * Ask the gateway to return money to the taxpayer (PRD §71).
   *
   * Must not report ACCEPTED unless the gateway actually took the request. A
   * refund recorded as made when it was not tells a citizen who paid twice
   * that they have their money back.
   */
  refund(request: RefundRequest): Promise<GatewayRefundResult>;
}
