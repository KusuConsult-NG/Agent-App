/**
 * Development identity verification provider.
 *
 * Outcomes are deterministic from the last digit of the identity number, so a
 * demo or test can reach every branch — including the ones that are awkward to
 * provoke with a real provider:
 *
 *   ...9  FAILED       the record did not match
 *   ...8  UNAVAILABLE  the provider could not be reached
 *   ...0  UNDER_REVIEW the provider is unsure
 *   else  CLEARED
 *
 * `config.ts` refuses to boot in production while this provider is selected.
 */

import { randomUUID } from 'node:crypto';
import {
  kycUnavailable,
  type KycProvider,
  type KycVerificationRequest,
  type KycVerificationResult,
} from './types';

export class MockKycProvider implements KycProvider {
  readonly name = 'mock';

  async verify(request: KycVerificationRequest): Promise<KycVerificationResult> {
    const last = request.identityNumber.trim().slice(-1);
    const reference = `MOCK-KYC-${randomUUID().slice(0, 8).toUpperCase()}`;

    if (last === '9') {
      return {
        status: 'FAILED',
        reference,
        livenessResult: 'FAILED',
        failureReason: 'Identity number could not be matched to the national record.',
        provider: 'mock',
      };
    }

    if (last === '8') {
      return kycUnavailable('mock', 'Identity provider could not be reached (development stub).');
    }

    /*
     * "We need more from you" — the outcome the mock could not produce.
     *
     * `KycVerificationStatus` has declared VERIFICATION_REQUIRED from the
     * start and the HTTP adapter maps vendor words onto it, but every
     * development and test run goes through this provider, so the branch that
     * handles it was never once exercised locally. It was wrong: it journalled
     * the applicant as having merely submitted, while the notification told
     * them action was required.
     */
    if (last === '7') {
      return {
        status: 'VERIFICATION_REQUIRED',
        reference,
        livenessResult: 'MANUAL_REVIEW',
        failureReason: 'The photograph of the identity document was too dark to read.',
        provider: 'mock',
      };
    }

    if (last === '0') {
      return {
        status: 'UNDER_REVIEW',
        reference,
        livenessResult: 'MANUAL_REVIEW',
        livenessScore: 62,
        provider: 'mock',
      };
    }

    return {
      status: 'CLEARED',
      reference,
      livenessResult: request.selfieChecksum ? 'PASSED' : 'NOT_PERFORMED',
      livenessScore: request.selfieChecksum ? 94 : undefined,
      provider: 'mock',
    };
  }
}
