/**
 * Message provider selection (PRD §44, §79).
 *
 * SMS and email are chosen separately, because PSIRS may well contract an SMS
 * gateway and a transactional email service from different vendors. Both are
 * `mock` in development and `config.ts` refuses to boot in production with
 * either still selected — an SMS is the citizen's only copy of their receipt.
 *
 * WhatsApp is a third channel used for tax due-date reminders. It uses its own
 * provider (configured via WHATSAPP_PROVIDER_URL / WHATSAPP_API_KEY /
 * WHATSAPP_SENDER_NUMBER) and falls back to mock in development.
 */

import { config } from '../../config';
import { HttpMessageProvider } from './http';
import { MockMessageProvider } from './mock';
import { WebPushProvider } from './push';
import { WhatsAppHttpProvider, WhatsAppMockProvider } from './whatsapp';
import type { DeliveryRequest, DeliveryResult, MessageProvider } from './types';

export * from './types';
export { HttpMessageProvider } from './http';
export { MockMessageProvider } from './mock';
export { WebPushProvider } from './push';
export { WhatsAppHttpProvider, WhatsAppMockProvider } from './whatsapp';

const mock = new MockMessageProvider();

function select(provider: string, url: string): MessageProvider {
  if (provider === 'mock') return mock;
  return new HttpMessageProvider({ name: provider, url });
}

export const smsProvider: MessageProvider = select(
  config.notifications.smsProvider,
  config.notifications.http.url,
);

export const emailProvider: MessageProvider = select(
  config.notifications.emailProvider,
  config.notifications.http.emailUrl || config.notifications.http.url,
);

const waUrl = process.env.WHATSAPP_PROVIDER_URL ?? '';
const waKey = process.env.WHATSAPP_API_KEY ?? '';
const waSender = process.env.WHATSAPP_SENDER_NUMBER ?? '';

export const whatsappProvider: MessageProvider =
  waUrl && waKey
    ? new WhatsAppHttpProvider({ url: waUrl, apiKey: waKey, senderNumber: waSender })
    : new WhatsAppMockProvider();

export const pushProvider: MessageProvider = new WebPushProvider();

/**
 * Route a message to the provider that owns its channel.
 *
 * PUSH used to throw, and that was right while there was no adapter: falling
 * back to the SMS gateway would have posted a browser subscription to a
 * telephone vendor as though it were a number, to fail obscurely at the vendor
 * or, worse, be accepted and billed.
 *
 * It has its own adapter now — VAPID identity, per-device subscriptions, an
 * encrypted payload — reporting the same three outcomes as every other channel.
 * A deployment with no VAPID keys answers UNAVAILABLE rather than a refusal, so
 * a missing setting is retried once somebody fixes it instead of marking every
 * citizen permanently unreachable.
 */
export function providerFor(channel: DeliveryRequest['channel']): MessageProvider {
  switch (channel) {
    case 'EMAIL':
      return emailProvider;
    case 'SMS':
      return smsProvider;
    case 'WHATSAPP':
      return whatsappProvider;
    case 'PUSH':
      return pushProvider;
  }
}

export type { DeliveryRequest, DeliveryResult };
