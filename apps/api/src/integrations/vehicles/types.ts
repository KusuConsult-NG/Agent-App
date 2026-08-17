/**
 * Vehicle registry contract (PRD §21, §22, §82).
 *
 * PRD §21: "The system must not rely solely on manually entered vehicle data."
 * PRD §82 names the authorised vehicle authority as the source of truth for a
 * vehicle record — not this platform.
 *
 * The outcome is a three-way discriminated result rather than a boolean, and
 * the reason is the whole point of this file:
 *
 *   FOUND        the authority holds this vehicle, and here it is
 *   NOT_FOUND    the authority says it holds no such vehicle — an answer
 *   UNAVAILABLE  the authority could not be asked — NOT an answer
 *
 * A boolean `found` forces an adapter that cannot reach the registry to report
 * `false`, which asserts something false: that the vehicle is not registered.
 * An agent told "no record of this vehicle" will capture it manually, and the
 * platform will hold an unverified record that looks exactly like one for a
 * vehicle that genuinely is not on the register. During an outage every vehicle
 * in the state would look unregistered.
 *
 * So `UNAVAILABLE` is distinct, is surfaced to the agent in those words, and
 * can never set `authority_verified_at`.
 */

export interface VehicleRecord {
  registrationNumber: string;
  chassisNumber?: string;
  engineNumber?: string;
  make?: string;
  model?: string;
  vehicleType?: string;
  vehicleClass?: string;
  colour?: string;
  ownerName?: string;
  ownerPhone?: string;
  currentExpiryDate?: string;
  authorityReference?: string;
}

export type VehicleLookupOutcome = 'FOUND' | 'NOT_FOUND' | 'UNAVAILABLE';

export interface VehicleLookupResult {
  outcome: VehicleLookupOutcome;
  /** Present only when `outcome` is FOUND. */
  vehicle?: VehicleRecord;
  /** Why the registry could not be asked, when UNAVAILABLE. */
  reason?: string;
  provider: string;
}

export interface RenewalNotification {
  registrationNumber: string;
  expiryDate: string;
  documentNumber: string;
}

export interface RenewalNotificationResult {
  /** False when the authority could not be told; the renewal still stands. */
  accepted: boolean;
  reference: string;
  reason?: string;
  provider: string;
}

export interface VehicleRegistry {
  readonly name: string;
  /**
   * Look a vehicle up at the authority.
   *
   * Implementations must never throw for an upstream failure: return
   * `UNAVAILABLE`, so the caller can tell "not registered" from "we could not
   * ask".
   */
  lookup(registrationNumber: string): Promise<VehicleLookupResult>;
  /**
   * Tell the authority a renewal was paid for.
   *
   * A failure here does not invalidate the renewal — the taxpayer has paid and
   * holds a government receipt — so it returns a result to be retried and
   * reported rather than throwing.
   */
  recordRenewal(notification: RenewalNotification): Promise<RenewalNotificationResult>;
}

export function registryUnavailable(provider: string, reason: string): VehicleLookupResult {
  return { outcome: 'UNAVAILABLE', reason, provider };
}
