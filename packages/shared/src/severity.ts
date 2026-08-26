/**
 * What colour a status should be read in.
 *
 * Both front ends render a status chip, and both classified it the same way:
 * ask whether the status *contains* a good-news word. INACTIVE contains
 * ACTIVE. INVALID contains VALID. UNPAID contains PAID, and UNVERIFIED
 * contains VERIFIED — four states that mean the opposite of the word inside
 * them, every one of them rendered green in both apps.
 *
 * The verification one is why this is not decoration. A doctored receipt
 * verifies as INVALID, and INVALID was shown in the colour reserved for a
 * genuine government receipt. PRD §95 says nothing may make a revenue
 * transaction appear successful without confirmation; a green chip on a forged
 * receipt is that, done with CSS.
 *
 * It lives here rather than in either app because it went wrong twice, in two
 * copies of the same fifteen lines. One copy cannot drift from itself.
 *
 * The rule is whole words, split on underscores, and a negation may never
 * reach the success branch — so a word added to `GOOD` later cannot quietly
 * turn its own opposite green somewhere else in the platform.
 */

export type Severity = 'success' | 'danger' | 'pending' | 'neutral';

/** It went well, it is settled, somebody confirmed it. */
const GOOD = [
  'CLEARED',
  'ACTIVE',
  'COMPLETED',
  'PAID',
  'VALID',
  'SETTLED',
  'VERIFIED',
  'APPROVED',
  'MATCHED',
  'RESOLVED',
  'SUCCESS',
  'SUCCESSFUL',
  'SYNCED',
];

/** It went wrong, it was refused, or it is not to be trusted. */
const BAD = [
  'FAILED',
  'REJECTED',
  'REVERSED',
  'SUSPENDED',
  'REVOKED',
  'EXPIRED',
  'CANCELLED',
  'MISSING',
  'MISMATCH',
  'MISMATCHED',
  'DUPLICATE',
  'DISPUTED',
  'CRITICAL',
  'HIGH',
  // The four that used to read as their own opposites, and the outcome a
  // doctored document verifies as.
  'INACTIVE',
  'INVALID',
  'UNVERIFIED',
  'UNMATCHED',
  'TAMPERED',
];

/** Somebody still has to do something. */
const WAITING = [
  'PENDING',
  'REVIEW',
  'REVIEWED',
  'SUBMITTED',
  'INVITED',
  'PROGRESS',
  'REQUESTED',
  'OPEN',
  'OPENED',
  'MEDIUM',
  'AWAITING',
  // An invoice nobody has paid yet is outstanding, not failed.
  'UNPAID',
];

/*
 * Words that turn the sentence around, kept apart from BAD on purpose:
 * NOT_STARTED is not a bad outcome, it is merely not a good one. All this
 * list may do is stop the success branch being reached through a negation.
 */
const NEGATORS = ['NOT', 'NO', 'NON', 'NEVER'];

export function statusSeverity(status: string): Severity {
  const words = status.toUpperCase().split('_');
  const has = (list: string[]) => words.some((word) => list.includes(word));

  if (has(BAD)) return 'danger';
  if (has(GOOD) && !has(NEGATORS)) return 'success';
  if (has(WAITING)) return 'pending';
  return 'neutral';
}

/** Exported for the test that holds the negation property. */
export const GOOD_STATUS_WORDS: readonly string[] = GOOD;
