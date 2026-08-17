/**
 * Identity verification contract (PRD Addendum §4-§7).
 *
 * The provider verifies an agent applicant's identity against a government
 * record. Which provider PSIRS contracts is a procurement decision — NIMC
 * through a licensed aggregator, or a vendor offering NIN/BVN verification —
 * so the platform holds the contract and the providers implement it.
 *
 * The important design point is the fifth outcome. Four of these are verdicts
 * about a person; `UNAVAILABLE` is a statement about the provider, and the two
 * must never be confused:
 *
 *   CLEARED               the record matched
 *   FAILED                the record did not match — a verdict
 *   UNDER_REVIEW          the provider is unsure; a human decides
 *   VERIFICATION_REQUIRED more information is needed from the applicant
 *   UNAVAILABLE           we could not ask — NOT a verdict
 *
 * Collapsing `UNAVAILABLE` into `FAILED` would reject legitimate applicants
 * whenever an upstream service had an outage, and those rejections would look
 * indistinguishable from genuine identity mismatches in the clearance record.
 * Collapsing it into `CLEARED` would be worse. So it is its own outcome, and
 * `submitKyc` refuses to record any attempt at all when it occurs.
 */

export interface KycVerificationRequest {
  identityType: string;
  identityNumber: string;
  firstName: string;
  lastName: string;
  dateOfBirth?: string | null;
  phone: string;
  /** Present when a selfie was captured, for providers that do liveness. */
  selfieChecksum?: string | null;
}

export type KycOutcome =
  | 'CLEARED'
  | 'FAILED'
  | 'UNDER_REVIEW'
  | 'VERIFICATION_REQUIRED'
  | 'UNAVAILABLE';

export type LivenessResult = 'PASSED' | 'FAILED' | 'MANUAL_REVIEW' | 'NOT_PERFORMED';

export interface KycVerificationResult {
  status: KycOutcome;
  /** The provider's own reference, recorded for audit (Addendum §33). */
  reference: string;
  livenessResult: LivenessResult;
  livenessScore?: number;
  /** Why it failed, or why the provider could not be reached. */
  failureReason?: string;
  provider: string;
}

export interface KycProvider {
  readonly name: string;
  /**
   * Verify an identity.
   *
   * Implementations must never throw for an upstream failure: return
   * `UNAVAILABLE` instead, so the caller can distinguish "we could not ask"
   * from "the answer was no". Throwing is reserved for programming errors.
   */
  verify(request: KycVerificationRequest): Promise<KycVerificationResult>;
}

/** Convenience for adapters: an outage expressed as a result, not an exception. */
export function kycUnavailable(provider: string, reason: string): KycVerificationResult {
  return {
    status: 'UNAVAILABLE',
    reference: '',
    livenessResult: 'NOT_PERFORMED',
    failureReason: reason,
    provider,
  };
}
