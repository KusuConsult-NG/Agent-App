/**
 * Message provider selection (PRD §44, §79).
 *
 * SMS and email are chosen separately, because PSIRS may well contract an SMS
 * gateway and a transactional email service from different vendors. Both are
 * `mock` in development and `config.ts` refuses to boot in production with
 * either still selected — an SMS is the citizen's only copy of their receipt.
 */

import { config } from '../../config';
import { HttpMessageProvider } from './http';
import { MockMessageProvider } from './mock';
import type { DeliveryRequest, DeliveryResult, MessageProvider } from './types';

export * from './types';
export { HttpMessageProvider } from './http';
export { MockMessageProvider } from './mock';

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

/** Route a message to the provider that owns its channel. */
export function providerFor(channel: DeliveryRequest['channel']): MessageProvider {
  return channel === 'EMAIL' ? emailProvider : smsProvider;
}

export type { DeliveryRequest, DeliveryResult };
