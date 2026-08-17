/**
 * HTTP message provider.
 *
 * Which SMS gateway PSIRS contracts is a procurement decision — Termii,
 * Africa's Talking, Infobip and Twilio all serve Nigeria and none of them
 * agrees with the others about field names. So this adapter speaks one explicit
 * contract and maps onto the vendor's through configuration, the same way the
 * KYC and TIN adapters do.
 *
 *   POST {SMS_PROVIDER_URL}   with `Authorization: Bearer <SMS_PROVIDER_API_KEY>`
 *
 *   { "to": "+2348030000001", "from": "PSIRS",
 *     "channel": "SMS", "subject": null, "message": "…" }
 *
 * The body keys are configurable because the common vendors differ on exactly
 * these three: `to`/`recipient`/`phone`, `from`/`sender`/`sender_id`,
 * `message`/`body`/`text`.
 *
 * HOW AN ANSWER IS READ
 *
 * A 2xx with a provider reference is SENT. A 4xx is the provider refusing this
 * message — a malformed number, an unregistered sender ID — which no amount of
 * retrying fixes, so it is REJECTED and stops consuming attempts. Everything
 * else, including a 5xx, a timeout and an unreadable body, is UNAVAILABLE: the
 * message is still owed to the citizen and must be tried again.
 *
 * A 2xx carrying no reference is treated as SENT but recorded with an empty
 * reference rather than a fabricated one. Inventing a reference is what the
 * previous implementation did, and it is how the platform came to claim
 * deliveries that never happened.
 */

import { config } from '../../config';
import {
  deliveryUnavailable,
  type DeliveryRequest,
  type DeliveryResult,
  type MessageProvider,
} from './types';

function walk(body: unknown, path: string): unknown {
  if (!path) return body;
  return path
    .split('.')
    .reduce<unknown>(
      (acc, key) =>
        acc !== null && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined,
      body,
    );
}

function text(body: unknown, path: string): string | undefined {
  const value = walk(body, path);
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  if (typeof value === 'number') return String(value);
  return undefined;
}

export interface HttpMessageProviderOptions {
  name?: string;
  url?: string;
  apiKey?: string;
  senderId?: string;
  timeoutMs?: number;
  recipientField?: string;
  senderField?: string;
  messageField?: string;
  referencePath?: string;
  errorPath?: string;
}

export class HttpMessageProvider implements MessageProvider {
  readonly name: string;

  private readonly url: string;
  private readonly apiKey: string;
  private readonly senderId: string;
  private readonly timeoutMs: number;
  private readonly recipientField: string;
  private readonly senderField: string;
  private readonly messageField: string;
  private readonly referencePath: string;
  private readonly errorPath: string;

  constructor(options?: HttpMessageProviderOptions) {
    const settings = config.notifications.http;
    this.name = options?.name ?? config.notifications.smsProvider;
    this.url = options?.url ?? settings.url;
    this.apiKey = options?.apiKey ?? settings.apiKey;
    this.senderId = options?.senderId ?? config.notifications.smsSenderId;
    this.timeoutMs = options?.timeoutMs ?? settings.timeoutMs;
    this.recipientField = options?.recipientField ?? settings.recipientField;
    this.senderField = options?.senderField ?? settings.senderField;
    this.messageField = options?.messageField ?? settings.messageField;
    this.referencePath = options?.referencePath ?? settings.referencePath;
    this.errorPath = options?.errorPath ?? settings.errorPath;
  }

  async send(request: DeliveryRequest): Promise<DeliveryResult> {
    if (!this.url) {
      return deliveryUnavailable(this.name, 'No message provider URL is configured');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    let raw: string;
    try {
      response = await fetch(this.url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({
          [this.recipientField]: request.recipient,
          [this.senderField]:
            request.channel === 'EMAIL' ? config.notifications.fromEmail : this.senderId,
          [this.messageField]: request.message,
          channel: request.channel,
          subject: request.subject ?? null,
        }),
      });
      raw = await response.text();
    } catch (error) {
      return deliveryUnavailable(
        this.name,
        error instanceof Error && error.name === 'AbortError'
          ? 'Message provider did not respond in time'
          : 'Message provider could not be reached',
      );
    } finally {
      clearTimeout(timer);
    }

    let body: unknown = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = null;
    }

    if (response.status >= 400 && response.status < 500) {
      // The provider looked at this message and said no. Retrying an
      // unreachable number five times only delays telling someone about it.
      return {
        outcome: 'REJECTED',
        reason:
          text(body, this.errorPath) ??
          `Message provider rejected the message (${response.status})`,
        provider: this.name,
      };
    }

    if (!response.ok) {
      return deliveryUnavailable(this.name, `Message provider responded ${response.status}`);
    }

    return {
      outcome: 'SENT',
      // Empty rather than invented when the provider gives us nothing.
      reference: text(body, this.referencePath) ?? '',
      provider: this.name,
    };
  }
}
