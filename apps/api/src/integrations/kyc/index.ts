/**
 * Identity verification provider selection (PRD §81, §82).
 *
 * `KYC_PROVIDER` chooses the adapter; `mock` is development only and
 * `config.ts` refuses to boot in production with it selected. Any other value
 * uses the configurable HTTP adapter and becomes the provider's name in the
 * audit record, so the clearance trail says which service cleared an agent.
 */

import { config } from '../../config';
import { HttpKycProvider } from './http';
import { MockKycProvider } from './mock';
import type { KycProvider } from './types';

export * from './types';
export { HttpKycProvider } from './http';
export { MockKycProvider } from './mock';

function selectKycProvider(): KycProvider {
  if (config.integrations.kycProvider === 'mock') return new MockKycProvider();
  return new HttpKycProvider();
}

export const kycProvider: KycProvider = selectKycProvider();
