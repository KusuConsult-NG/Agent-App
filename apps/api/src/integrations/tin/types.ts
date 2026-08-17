/**
 * TIN service contract (PRD §11, §82).
 *
 * PRD §82 names the PSIRS TIN service as the source of truth for a Tax
 * Identification Number. This platform records TINs; it does not issue them,
 * and it must never invent one.
 *
 * Both operations carry the outcome that says the service could not be asked,
 * and in each case conflating it with an answer causes a specific, permanent
 * harm:
 *
 *   lookup    NOT_FOUND means "this taxpayer has no TIN" — which leads the
 *             agent to register them as a new applicant. Say that during an
 *             outage and you mint a duplicate TIN for someone who already has
 *             one, for every existing taxpayer an agent touches, permanently.
 *
 *   register  REJECTED means "the service considered this applicant and
 *             declined" — a dead end needing correction. Say that during an
 *             outage and the taxpayer is stranded in a failed state that
 *             nothing retries.
 *
 * So UNAVAILABLE is its own outcome in both, and the callers treat it as work
 * still to do rather than as a verdict.
 */

export type TaxpayerKind = 'INDIVIDUAL' | 'BUSINESS';

export type TinLookupOutcome = 'FOUND' | 'NOT_FOUND' | 'UNAVAILABLE';

export interface TinLookupResult {
  outcome: TinLookupOutcome;
  tin?: string;
  fullName?: string;
  taxpayerType?: TaxpayerKind;
  /** Why the service could not be asked, when UNAVAILABLE. */
  reason?: string;
  provider: string;
}

export interface TinRegistrationRequest {
  taxpayerType: TaxpayerKind;
  firstName?: string;
  lastName?: string;
  businessName?: string;
  phone: string;
  email?: string | null;
  dateOfBirth?: string | null;
  address: string;
  lgaName: string;
  identityType?: string | null;
  identityNumber?: string | null;
}

export type TinRegistrationOutcome =
  /** A TIN was issued and is present in `tin`. */
  | 'ASSIGNED'
  /** Accepted for processing; the number follows. Chase it with `reference`. */
  | 'PENDING'
  /** The service considered this applicant and declined. */
  | 'REJECTED'
  /** The service could not be asked. Not a decision about the applicant. */
  | 'UNAVAILABLE';

export interface TinRegistrationResult {
  outcome: TinRegistrationOutcome;
  /** Present only when ASSIGNED, and never blank — see `assignedTin` below. */
  tin?: string;
  /** The service's own reference, for chasing a PENDING registration. */
  reference: string;
  message: string;
  provider: string;
}

export interface TinService {
  readonly name: string;
  /**
   * Look up an existing TIN.
   *
   * Implementations must never throw for an upstream failure: return
   * UNAVAILABLE, so the caller can tell "no such TIN" from "we could not ask".
   */
  lookup(tin: string): Promise<TinLookupResult>;
  /**
   * Register a taxpayer for a TIN.
   *
   * Same rule: an upstream failure is UNAVAILABLE, not REJECTED.
   */
  register(request: TinRegistrationRequest): Promise<TinRegistrationResult>;
}

export function tinUnavailable(provider: string, reason: string): TinLookupResult {
  return { outcome: 'UNAVAILABLE', reason, provider };
}

export function tinRegistrationUnavailable(
  provider: string,
  message: string,
): TinRegistrationResult {
  return { outcome: 'UNAVAILABLE', reference: '', message, provider };
}

/**
 * The one place a TIN becomes real.
 *
 * `taxpayers.tin` is UNIQUE and the row cannot be deleted, so a blank or
 * malformed value written here is permanent and blocks the real number from
 * ever being recorded. An "assigned" response carrying nothing usable is
 * therefore not an assignment: this returns null and the caller downgrades to
 * PENDING, which is chaseable, rather than writing a TIN that is not one.
 *
 * `pattern` is optional because the PSIRS TIN format is theirs to state. Left
 * unset, only emptiness is rejected.
 */
export function assignedTin(value: unknown, pattern?: RegExp): string | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    value = String(value);
  }
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (pattern && !pattern.test(trimmed)) return null;

  return trimmed;
}
