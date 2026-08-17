/**
 * Payment gateway selection (PRD §16, §81, §82).
 *
 * One gateway is active per deployment, chosen by `PAYMENT_GATEWAY`. The
 * revenue code imports `gateway` and never names a provider, so swapping
 * processors is a configuration change plus one adapter — not a change to how
 * payments, receipts or reconciliation work.
 *
 * PSIRS collects through **Remita**, the channel most Nigerian government
 * revenue runs on. The mock remains for development and for the test suite,
 * and `config.ts` refuses to boot in production while it is selected.
 */

import { config } from '../config';
import { MockGateway } from './gateways/mock';
import { RemitaGateway } from './gateways/remita';
import type { PaymentGateway } from './gateways/types';

export type {
  GatewayVerificationResult,
  GatewayWebhookEvent,
  InitiatePaymentRequest,
  InitiatePaymentResult,
  PaymentGateway,
  SettlementLine,
  WebhookAuthInput,
  WebhookAuthResult,
} from './gateways/types';

const mockGateway = new MockGateway();

function selectGateway(): PaymentGateway {
  switch (config.payments.gateway) {
    case 'remita':
      return new RemitaGateway();
    case 'mock':
      return mockGateway;
    default:
      // An unrecognised gateway name must stop the process, not silently fall
      // back to something that accepts payments nobody made.
      throw new Error(
        `Unknown PAYMENT_GATEWAY "${config.payments.gateway}". Supported values: remita, mock.`,
      );
  }
}

export const gateway: PaymentGateway = selectGateway();

/** Exposed only for the development simulation routes and integration tests. */
export const developmentGatewayControls = mockGateway;

export function isMockGateway(): boolean {
  return gateway.name === 'mock';
}
