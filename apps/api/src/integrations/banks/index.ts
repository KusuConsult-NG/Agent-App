/**
 * Bank verification selection (Addendum §16).
 *
 * `BANK_VERIFICATION` chooses the adapter; `mock` is development only and
 * `config.ts` refuses to boot in production with it selected.
 */

import { config } from '../../config';
import { HttpBankVerification } from './http';
import { MockBankVerification } from './mock';
import type { BankVerificationService } from './types';

export * from './types';
export { HttpBankVerification } from './http';
export { MockBankVerification } from './mock';

function selectBankVerification(): BankVerificationService {
  if (config.integrations.bankVerification === 'mock') return new MockBankVerification();
  return new HttpBankVerification();
}

export const bankVerification: BankVerificationService = selectBankVerification();
