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

/**
 * Route a message to the provider that owns its channel.
 *
 * PUSH is refused rather than defaulted. No push template is seeded, so nothing
 * queues one today — but falling back to the SMS gateway would mean that the
 * day someone adds a push template, a browser push subscription gets posted to
 * an SMS provider as though it were a phone number. It would fail obscurely at
 * the vendor, or worse, be accepted and billed.
 *
 * Web push needs its own adapter (VAPID keys, per-device subscriptions, an
 * entirely different payload). Until that exists, this says so.
 */
export function providerFor(channel: DeliveryRequest['channel']): MessageProvider {
  switch (channel) {
    case 'EMAIL':
      return emailProvider;
    case 'SMS':
      return smsProvider;
    case 'PUSH':
      throw new Error(
        'Web push delivery is not implemented. A PUSH notification was queued, which no ' +
          'template should currently produce — add a push adapter before seeding one.',
      );
  }
}

export type { DeliveryRequest, DeliveryResult };
