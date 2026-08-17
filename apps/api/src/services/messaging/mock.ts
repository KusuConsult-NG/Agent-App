/**
 * Development message provider.
 *
 * Logs rather than sends, and — unlike what it replaced — says so. Its
 * responses carry `provider: 'mock'`, so a notification delivered in
 * development is distinguishable in the record from one a real gateway
 * accepted.
 *
 * Outcomes are deterministic from the recipient so every branch is reachable:
 *
 *   ends 8   UNAVAILABLE  the gateway could not be reached
 *   ends 9   REJECTED     the gateway refused the number
 *   else     SENT
 *
 * `config.ts` refuses to boot in production while this provider is selected.
 */

import { randomUUID } from 'node:crypto';
import {
  deliveryUnavailable,
  type DeliveryRequest,
  type DeliveryResult,
  type MessageProvider,
} from './types';

export class MockMessageProvider implements MessageProvider {
  readonly name = 'mock';

  async send(request: DeliveryRequest): Promise<DeliveryResult> {
    const recipient = request.recipient.trim();

    if (recipient.endsWith('8')) {
      return deliveryUnavailable('mock', 'Message provider could not be reached (development stub).');
    }

    if (recipient.endsWith('9')) {
      return {
        outcome: 'REJECTED',
        reason: 'The gateway refused this number (development stub).',
        provider: 'mock',
      };
    }

    console.log(`[notify:${request.channel}] -> ${recipient}: ${request.message}`);

    return {
      outcome: 'SENT',
      reference: `mock-${randomUUID().slice(0, 8)}`,
      provider: 'mock',
    };
  }
}
