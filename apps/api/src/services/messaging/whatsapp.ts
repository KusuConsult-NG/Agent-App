/**
 * WhatsApp messaging provider.
 *
 * Production: calls a WhatsApp Business API endpoint (Termii, Africa's
 * Talking, Twilio, etc.) that accepts JSON POST requests.
 *
 * Development: behaves identically to the SMS mock — logs to console and
 * returns deterministic outcomes from the recipient identifier.
 *
 * Environment variables required in production:
 *   WHATSAPP_PROVIDER_URL     — full URL of the WhatsApp send endpoint
 *   WHATSAPP_API_KEY          — bearer token / API key
 *   WHATSAPP_SENDER_NUMBER    — registered sender number in E.164 format
 */

import { randomUUID } from 'node:crypto';
import { deliveryUnavailable, type DeliveryRequest, type DeliveryResult, type MessageProvider } from './types';

export class WhatsAppMockProvider implements MessageProvider {
  readonly name = 'whatsapp-mock';

  async send(request: DeliveryRequest): Promise<DeliveryResult> {
    const recipient = request.recipient.trim();
    if (recipient.endsWith('8')) {
      return deliveryUnavailable('whatsapp-mock', 'WhatsApp provider could not be reached (development stub).');
    }
    if (recipient.endsWith('9')) {
      return { outcome: 'REJECTED', reason: 'WhatsApp number not registered (development stub).', provider: 'whatsapp-mock' };
    }
    console.log(`[notify:WHATSAPP] -> ${recipient}: ${request.message.slice(0, 80)}…`);
    return { outcome: 'SENT', reference: `wa-mock-${randomUUID().slice(0, 8)}`, provider: 'whatsapp-mock' };
  }
}

export class WhatsAppHttpProvider implements MessageProvider {
  readonly name: string;
  private readonly url: string;
  private readonly apiKey: string;
  private readonly senderNumber: string;

  constructor(options: { url: string; apiKey: string; senderNumber: string }) {
    this.name = 'whatsapp-http';
    this.url = options.url;
    this.apiKey = options.apiKey;
    this.senderNumber = options.senderNumber;
  }

  async send(request: DeliveryRequest): Promise<DeliveryResult> {
    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          from: this.senderNumber,
          to: request.recipient,
          type: 'text',
          body: request.message,
          channel: 'whatsapp',
        }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        return {
          outcome: response.status >= 500 ? 'UNAVAILABLE' : 'REJECTED',
          reason: `WhatsApp provider returned ${response.status}: ${text.slice(0, 200)}`,
          provider: this.name,
        };
      }

      const data = (await response.json()) as { message_id?: string; messageId?: string };
      return {
        outcome: 'SENT',
        reference: data.message_id ?? data.messageId ?? undefined,
        provider: this.name,
      };
    } catch (error) {
      return deliveryUnavailable(
        this.name,
        error instanceof Error ? error.message : 'Unknown WhatsApp provider error',
      );
    }
  }
}
