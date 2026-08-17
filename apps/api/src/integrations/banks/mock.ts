/**
 * Development bank account verification.
 *
 * Outcomes are deterministic from the account number, so a demo or test can
 * reach every branch:
 *
 *   not 10 digits   NOT_FOUND    Nigerian account numbers are 10 digits
 *   ends 8          UNAVAILABLE  the bank could not be reached
 *   ends 9          MISMATCH     the account belongs to someone else
 *   otherwise       VERIFIED
 *
 * `config.ts` refuses to boot in production while this service is selected.
 */

import { randomUUID } from 'node:crypto';
import {
  bankUnavailable,
  type BankVerificationRequest,
  type BankVerificationResult,
  type BankVerificationService,
} from './types';

export class MockBankVerification implements BankVerificationService {
  readonly name = 'mock';

  async verify(request: BankVerificationRequest): Promise<BankVerificationResult> {
    const accountNumber = request.accountNumber.trim();
    const reference = `MOCK-BNK-${randomUUID().slice(0, 8).toUpperCase()}`;

    if (!/^\d{10}$/.test(accountNumber)) {
      return {
        outcome: 'NOT_FOUND',
        reference,
        failureReason: 'Nigerian account numbers are 10 digits.',
        provider: 'mock',
      };
    }

    if (accountNumber.endsWith('8')) {
      return bankUnavailable(
        'mock',
        'Bank verification service could not be reached (development stub).',
      );
    }

    if (accountNumber.endsWith('9')) {
      return {
        outcome: 'MISMATCH',
        accountName: 'CHINEDU OKAFOR',
        reference,
        failureReason:
          'The account is held by "CHINEDU OKAFOR", which does not match the name on this ' +
          "application. Commission can only be paid to an account in the agent's own name.",
        provider: 'mock',
      };
    }

    return {
      outcome: 'VERIFIED',
      accountName: request.expectedName.toUpperCase(),
      reference,
      provider: 'mock',
    };
  }
}
