/**
 * Message delivery contract (PRD §44, §66, §79).
 *
 * This is the citizen's only channel. They hold no account on this platform —
 * an authorised agent approaches them — so an SMS is how a taxpayer receives
 * the receipt for money they have just handed over, and the verification code
 * that lets them check it against government records. There is no inbox to fall
 * back to and no portal to log into.
 *
 * That makes the outcome distinction here the same one that runs through every
 * other integration, and for the same reason:
 *
 *   SENT         the provider accepted it for delivery
 *   REJECTED     the provider refused it — a bad number, a blocked sender.
 *                Retrying will not help; a human has to fix the record.
 *   UNAVAILABLE  the provider could not be reached. Not a verdict about this
 *                message, and it must be retried rather than burned against the
 *                attempt budget as though the recipient were unreachable.
 *
 * Before this contract existed, `dispatchQueued` marked every notification SENT
 * with a made-up provider reference whether or not anything had been sent. The
 * `notifications` table then said a citizen had been given proof of payment
 * that had never left the building.
 */

export type DeliveryOutcome = 'SENT' | 'REJECTED' | 'UNAVAILABLE';

export interface DeliveryRequest {
  channel: 'SMS' | 'EMAIL' | 'PUSH';
  recipient: string;
  subject?: string | null;
  message: string;
}

export interface DeliveryResult {
  outcome: DeliveryOutcome;
  /** The provider's own reference. Recorded for audit; never fabricated. */
  reference?: string;
  /** Why it was refused, or why the provider could not be reached. */
  reason?: string;
  provider: string;
}

export interface MessageProvider {
  readonly name: string;
  /**
   * Hand a message to the provider.
   *
   * Implementations must never throw for an upstream failure: return
   * UNAVAILABLE, so the caller can tell "this number is wrong" from "we could
   * not reach the network".
   */
  send(request: DeliveryRequest): Promise<DeliveryResult>;
}

export function deliveryUnavailable(provider: string, reason: string): DeliveryResult {
  return { outcome: 'UNAVAILABLE', reason, provider };
}
