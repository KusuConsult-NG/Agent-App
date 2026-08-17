/**
 * Remita payment gateway (PRD §16, §18, §53, §95).
 *
 * Remita is the collection channel most Nigerian government revenue runs
 * through, and its model differs from a card-first processor in ways this
 * adapter has to respect:
 *
 *   * **The RRR is the artefact.** Initiating a payment generates a Remita
 *     Retrieval Reference. The taxpayer can then pay it at any bank branch,
 *     ATM, POS, USSD or online channel — possibly days later, possibly with no
 *     browser involved at all. So "initiate" does not mean "the payer is now at
 *     a checkout page"; it means an obligation now has a payable reference.
 *
 *   * **Amounts are Naira decimals, not kobo.** Every crossing of this boundary
 *     converts explicitly. This is the single likeliest place for a silent
 *     hundred-fold error, so it is done in one place each way and tested.
 *
 *   * **Callbacks are not signed.** Remita notifies with an RRR and expects the
 *     merchant to query status. That is exactly this platform's model already:
 *     a webhook is a prompt to go and ask, never an instruction to believe
 *     (PRD §95). An unsigned notification is therefore acceptable here — the
 *     worst a forged one can do is make the platform ask Remita about a
 *     reference, and act on Remita's answer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BEFORE PRODUCTION USE
 *
 * The request shapes and hashing below follow Remita's documented integration.
 * Two things must still be confirmed against PSIRS's own Remita sandbox and
 * credentials, because they vary by merchant configuration:
 *
 *   1. `serviceTypeId` — issued to PSIRS per revenue stream.
 *   2. The full status-code list. Only `00` (successful) is mapped as success
 *      here. Everything else is reported as PENDING rather than FAILED, which
 *      is deliberate: an unmapped code can then never wrongly mark money as
 *      received, and can never wrongly close a transaction the taxpayer did
 *      pay. Unmapped codes surface through reconciliation instead of being
 *      guessed at. Add known failure codes to `failureStatusCodes` once
 *      confirmed, to shorten that loop.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createHash } from 'node:crypto';
import { koboToNaira, nairaToKobo, type Kobo, type PaymentMethod } from '@psirs/shared';
import { config } from '../../config';
import type {
  GatewayVerificationResult,
  GatewayWebhookEvent,
  InitiatePaymentRequest,
  InitiatePaymentResult,
  PaymentGateway,
  SettlementLine,
  WebhookAuthInput,
  WebhookAuthResult,
} from './types';

function sha512(value: string): string {
  return createHash('sha512').update(value).digest('hex');
}

/**
 * Remita wraps some responses in a JSONP envelope (`jsonp {...}`). Strip
 * anything before the first brace rather than assuming a bare JSON body.
 */
function parseRemitaBody(text: string): Record<string, unknown> {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`Remita returned a body that is not JSON: ${text.slice(0, 200)}`);
  }
  return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return null;
}

/**
 * Convert a Remita Naira amount to kobo.
 *
 * Remita may send "5000", "5000.00" or the JSON number 5000. All three mean
 * ₦5,000.00 — never 5,000 kobo. Anything unparseable returns null so the
 * caller treats the amount as unknown rather than as zero.
 */
export function remitaAmountToKobo(value: unknown): Kobo | null {
  if (value === null || value === undefined || value === '') return null;
  try {
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return null;
      return nairaToKobo(value.toFixed(2));
    }
    if (typeof value === 'string') return nairaToKobo(value.trim());
    return null;
  } catch {
    return null;
  }
}

/** Remita's payment channel names, mapped onto the platform's method enum. */
function mapChannel(channel: unknown): PaymentMethod | null {
  const value = asString(channel)?.toUpperCase() ?? '';
  if (value.includes('CARD')) return 'CARD';
  if (value.includes('USSD')) return 'USSD';
  if (value.includes('POS')) return 'POS';
  if (value.includes('BANK') || value.includes('BRANCH') || value.includes('TELLER')) {
    return 'BANK_TRANSFER';
  }
  if (value.includes('TRANSFER') || value.includes('NIP')) return 'ACCOUNT_TRANSFER';
  return null;
}

function parseRemitaDate(value: unknown): Date | null {
  const text = asString(value);
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export class RemitaGateway implements PaymentGateway {
  readonly name = 'remita';
  /** Remita notifies with an RRR; it does not sign the callback. */
  readonly signsWebhooks = false;

  private readonly baseUrl: string;
  private readonly merchantId: string;
  private readonly apiKey: string;
  private readonly serviceTypeId: string;
  private readonly successStatusCodes: Set<string>;
  private readonly failureStatusCodes: Set<string>;
  private readonly notificationSecret: string;
  private readonly notificationIpAllowlist: string[];
  private readonly requestTimeoutMs: number;

  constructor(options?: {
    baseUrl?: string;
    merchantId?: string;
    apiKey?: string;
    serviceTypeId?: string;
    successStatusCodes?: string[];
    failureStatusCodes?: string[];
    notificationSecret?: string;
    notificationIpAllowlist?: string[];
    requestTimeoutMs?: number;
  }) {
    this.baseUrl = (options?.baseUrl ?? config.payments.remita.baseUrl).replace(/\/+$/, '');
    this.merchantId = options?.merchantId ?? config.payments.remita.merchantId;
    this.apiKey = options?.apiKey ?? config.payments.remita.apiKey;
    this.serviceTypeId = options?.serviceTypeId ?? config.payments.remita.serviceTypeId;
    this.successStatusCodes = new Set(
      options?.successStatusCodes ?? config.payments.remita.successStatusCodes,
    );
    this.failureStatusCodes = new Set(
      options?.failureStatusCodes ?? config.payments.remita.failureStatusCodes,
    );
    this.notificationSecret =
      options?.notificationSecret ?? config.payments.remita.notificationSecret;
    this.notificationIpAllowlist =
      options?.notificationIpAllowlist ?? config.payments.remita.notificationIpAllowlist;
    this.requestTimeoutMs = options?.requestTimeoutMs ?? config.payments.remita.requestTimeoutMs;
  }

  private async request(
    url: string,
    init: RequestInit & { timeoutMs?: number } = {},
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? this.requestTimeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`Remita responded ${response.status}: ${text.slice(0, 200)}`);
      }
      return parseRemitaBody(text);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Generate an RRR for an invoice.
   *
   * The hash Remita expects over an init request is
   * SHA512(merchantId + serviceTypeId + orderId + totalAmount + responseUrl),
   * with the amount in Naira.
   */
  async initiate(request: InitiatePaymentRequest): Promise<InitiatePaymentResult> {
    const amountNaira = koboToNaira(request.amountKobo);
    const orderId = request.paymentReference;

    const hash = sha512(
      `${this.merchantId}${this.serviceTypeId}${orderId}${amountNaira}${request.callbackUrl}`,
    );

    const body = {
      serviceTypeId: this.serviceTypeId,
      amount: amountNaira,
      orderId,
      payerName: request.payerName ?? 'Taxpayer',
      payerEmail: request.email ?? '',
      payerPhone: request.phone,
      description: request.description ?? 'Plateau State government revenue',
      responseurl: request.callbackUrl,
    };

    const raw = await this.request(
      `${this.baseUrl}/remita/exapp/api/v1/send/api/echannelsvc/merchant/api/paymentinit`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `remitaConsumerKey=${this.merchantId},remitaConsumerToken=${hash}`,
        },
        body: JSON.stringify(body),
      },
    );

    const rrr = asString(raw.RRR) ?? asString(raw.rrr);
    if (!rrr) {
      throw new Error(
        `Remita did not return an RRR for ${orderId} (statuscode ${asString(raw.statuscode) ?? 'none'}: ${
          asString(raw.status) ?? 'no status'
        })`,
      );
    }

    return {
      gatewayReference: rrr,
      // The RRR is payable at any Remita channel; the hosted page is a
      // convenience for an agent handing a phone to a taxpayer, not the only
      // route to paying it.
      authorisationUrl: `${this.baseUrl}/remita/onepage/${this.merchantId}/${rrr}/${sha512(
        `${rrr}${this.apiKey}${this.merchantId}`,
      )}/biller.spa`,
      status: 'PENDING',
      raw: { ...raw, provider: 'remita' },
    };
  }

  /**
   * Ask Remita what happened to an RRR.
   *
   * This is the independent confirmation PRD §95 requires: it is the only
   * thing in the platform that can move a payment to VERIFIED.
   *
   * The hash for a status query is SHA512(rrr + apiKey + merchantId).
   */
  async verify(gatewayReference: string): Promise<GatewayVerificationResult> {
    const rrr = gatewayReference.trim();
    const hash = sha512(`${rrr}${this.apiKey}${this.merchantId}`);

    let raw: Record<string, unknown>;
    try {
      raw = await this.request(
        `${this.baseUrl}/remita/ecomm/${this.merchantId}/${rrr}/${hash}/status.reg`,
        { method: 'GET' },
      );
    } catch (error) {
      // A transport failure tells us nothing about the money. Reporting UNKNOWN
      // keeps the payment in flight; the caller surfaces PAYMENT_UNCONFIRMED
      // and reconciliation sweeps it up later.
      return {
        status: 'UNKNOWN',
        gatewayReference: rrr,
        amountKobo: null,
        paidAt: null,
        paymentMethod: null,
        failureReason: error instanceof Error ? error.message : 'Remita status query failed',
        raw: { provider: 'remita', error: true },
      };
    }

    const code = asString(raw.status) ?? '';
    const amountKobo = remitaAmountToKobo(raw.amount);
    const paidAt = parseRemitaDate(raw.transactiontime ?? raw.paymentDate);

    let status: GatewayVerificationResult['status'];
    if (this.successStatusCodes.has(code)) {
      status = 'SUCCESS';
    } else if (this.failureStatusCodes.has(code)) {
      status = 'FAILED';
    } else {
      // Unmapped: neither believed paid nor declared failed. See the header note.
      status = 'PENDING';
    }

    // A success with no amount or no payment time is not something to receipt.
    if (status === 'SUCCESS' && (amountKobo === null || amountKobo <= 0n)) {
      return {
        status: 'UNKNOWN',
        gatewayReference: rrr,
        amountKobo: null,
        paidAt,
        paymentMethod: mapChannel(raw.channel),
        failureReason: `Remita reported status ${code} without a usable amount`,
        raw: { ...raw, provider: 'remita' },
      };
    }

    return {
      status,
      gatewayReference: rrr,
      amountKobo,
      paidAt: status === 'SUCCESS' ? (paidAt ?? new Date()) : paidAt,
      paymentMethod: mapChannel(raw.channel),
      failureReason:
        status === 'SUCCESS' ? undefined : (asString(raw.message) ?? `Remita status ${code}`),
      settlementReference: asString(raw.settlementReference ?? raw.settlementDate),
      raw: { ...raw, provider: 'remita' },
    };
  }

  /**
   * Accept a Remita notification.
   *
   * Remita does not sign callbacks, so acceptance rests on the fact that the
   * delivery conveys no authority: it names an RRR, and the platform then asks
   * Remita directly. Two optional controls narrow the surface anyway — a shared
   * secret header and an IP allowlist — and both are off unless configured.
   */
  authenticateWebhook(input: WebhookAuthInput): WebhookAuthResult {
    const expectedSecret = this.notificationSecret;
    if (expectedSecret) {
      const presented =
        input.headers['x-remita-signature'] ?? input.headers['x-psirs-signature'] ?? '';
      if (presented !== expectedSecret) {
        return {
          accepted: false,
          authenticated: false,
          reason: 'Remita notification secret missing or incorrect',
        };
      }
      return { accepted: true, authenticated: true };
    }

    const allowlist = this.notificationIpAllowlist;
    if (allowlist.length > 0) {
      const ip = input.sourceIp ?? '';
      if (!allowlist.some((entry) => ip === entry || ip.endsWith(entry))) {
        return {
          accepted: false,
          authenticated: false,
          reason: `Notification from ${ip || 'unknown address'} is outside the Remita allowlist`,
        };
      }
      return { accepted: true, authenticated: true };
    }

    return {
      accepted: true,
      authenticated: false,
      reason:
        'Remita does not sign callbacks; accepted as a prompt only. The payment status ' +
        'is taken from a direct status query, not from this delivery.',
    };
  }

  /**
   * Extract the RRR from a notification.
   *
   * Nothing here is trusted beyond the reference itself. Remita notifications
   * carry no event id, so one is derived from the RRR and the reported status —
   * which is what makes redelivery of the same outcome collapse to a duplicate
   * against the UNIQUE (gateway, event_id) constraint (PRD §53).
   */
  parseWebhook(payload: unknown): GatewayWebhookEvent | null {
    if (typeof payload !== 'object' || payload === null) return null;
    const body = payload as Record<string, unknown>;

    const rrr =
      asString(body.rrr) ?? asString(body.RRR) ?? asString(body.transactionId) ?? null;
    if (!rrr) return null;

    const code = asString(body.status) ?? asString(body.statuscode) ?? 'unknown';

    return {
      eventId: `remita:${rrr}:${code}`,
      eventType: `remita.notification.${code}`,
      gatewayReference: rrr,
      status: this.successStatusCodes.has(code)
        ? 'SUCCESS'
        : this.failureStatusCodes.has(code)
          ? 'FAILED'
          : 'UNKNOWN',
      amountKobo: remitaAmountToKobo(body.amount),
      paidAt: parseRemitaDate(body.transactiontime ?? body.paymentDate),
      paymentMethod: mapChannel(body.channel),
      settlementReference: asString(body.settlementReference),
      raw: body,
    };
  }

  /**
   * Remita exposes settlement through merchant reporting rather than a
   * transaction-listing API, and the shape depends on how PSIRS's merchant
   * account is configured. Until that is agreed, this returns nothing rather
   * than guessing.
   *
   * The consequence is explicit and safe: `runReconciliation` sees no gateway
   * lines, so verified payments are reported as MISSING_PAYMENT exceptions in
   * the finance queue rather than being silently marked reconciled. Finance is
   * told to look, which is the correct failure mode for money.
   */
  async fetchStatement(_params: { from: Date; to: Date }): Promise<SettlementLine[]> {
    return [];
  }
}
