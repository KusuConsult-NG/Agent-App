/**
 * Transaction, payment and commission state machines (PRD §17, §26).
 *
 * Transitions are data, not scattered `if` statements, so that every state
 * change in the platform passes through one guard (`assertTransition`) and
 * every illegal transition is a loud, auditable failure rather than a silent
 * field assignment.
 */

export const TRANSACTION_STATES = [
  'INITIATED',
  'ASSESSMENT_CREATED',
  'INVOICE_GENERATED',
  'PAYMENT_INITIATED',
  'PAYMENT_PENDING',
  'PAYMENT_SUCCESSFUL',
  'PAYMENT_VERIFIED',
  'RECEIPT_GENERATED',
  'SETTLED',
  'FAILED',
  'CANCELLED',
  'EXPIRED',
  'REVERSED',
  'REFUNDED',
  'UNDER_REVIEW',
  'RECONCILIATION_PENDING',
] as const;

export type TransactionState = (typeof TRANSACTION_STATES)[number];

/**
 * The happy path is a straight line; every branch off it is terminal or
 * requires an approved workflow to leave.
 *
 * Two properties are load-bearing and enforced here rather than in prose:
 *   1. Nothing reaches PAYMENT_SUCCESSFUL except from a payment-in-flight
 *      state, and only the gateway verification path may drive it (PRD §95).
 *   2. RECEIPT_GENERATED is reachable only from PAYMENT_VERIFIED, so a
 *      failed or unverified payment can never produce a valid receipt
 *      (PRD §84, §88.26).
 */
export const TRANSACTION_TRANSITIONS: Record<TransactionState, readonly TransactionState[]> = {
  INITIATED: ['ASSESSMENT_CREATED', 'CANCELLED', 'EXPIRED'],
  ASSESSMENT_CREATED: ['INVOICE_GENERATED', 'CANCELLED', 'EXPIRED'],
  INVOICE_GENERATED: ['PAYMENT_INITIATED', 'CANCELLED', 'EXPIRED'],
  PAYMENT_INITIATED: ['PAYMENT_PENDING', 'PAYMENT_SUCCESSFUL', 'FAILED', 'CANCELLED', 'EXPIRED'],
  PAYMENT_PENDING: ['PAYMENT_SUCCESSFUL', 'FAILED', 'EXPIRED', 'UNDER_REVIEW'],
  PAYMENT_SUCCESSFUL: ['PAYMENT_VERIFIED', 'UNDER_REVIEW', 'FAILED'],
  PAYMENT_VERIFIED: ['RECEIPT_GENERATED', 'UNDER_REVIEW'],
  RECEIPT_GENERATED: ['RECONCILIATION_PENDING', 'SETTLED', 'UNDER_REVIEW', 'REVERSED', 'REFUNDED'],
  RECONCILIATION_PENDING: ['SETTLED', 'UNDER_REVIEW', 'REVERSED', 'REFUNDED'],
  SETTLED: ['REVERSED', 'REFUNDED', 'UNDER_REVIEW'],
  UNDER_REVIEW: ['SETTLED', 'RECONCILIATION_PENDING', 'REVERSED', 'REFUNDED', 'RECEIPT_GENERATED'],
  FAILED: ['CANCELLED'],
  CANCELLED: [],
  EXPIRED: [],
  REVERSED: [],
  REFUNDED: [],
};

/** States in which government money is considered actually received. */
export const REVENUE_RECOGNISED_STATES: readonly TransactionState[] = [
  'PAYMENT_VERIFIED',
  'RECEIPT_GENERATED',
  'RECONCILIATION_PENDING',
  'SETTLED',
];

/** States from which no further financial movement is expected. */
export const TERMINAL_STATES: readonly TransactionState[] = [
  'CANCELLED',
  'EXPIRED',
  'REVERSED',
  'REFUNDED',
];

export const PAYMENT_STATES = [
  'INITIATED',
  'PENDING',
  'SUCCESSFUL',
  'VERIFIED',
  'FAILED',
  'ABANDONED',
  'REVERSED',
  'REFUNDED',
] as const;

export type PaymentState = (typeof PAYMENT_STATES)[number];

export const PAYMENT_TRANSITIONS: Record<PaymentState, readonly PaymentState[]> = {
  INITIATED: ['PENDING', 'SUCCESSFUL', 'FAILED', 'ABANDONED'],
  PENDING: ['SUCCESSFUL', 'FAILED', 'ABANDONED'],
  SUCCESSFUL: ['VERIFIED', 'FAILED'],
  VERIFIED: ['REVERSED', 'REFUNDED'],
  FAILED: [],
  ABANDONED: [],
  REVERSED: [],
  REFUNDED: [],
};

export const COMMISSION_STATES = [
  'PENDING',
  'ELIGIBLE',
  'ON_HOLD',
  'APPROVED',
  'PAID',
  'REVERSED',
  'CANCELLED',
] as const;

export type CommissionState = (typeof COMMISSION_STATES)[number];

export const COMMISSION_TRANSITIONS: Record<CommissionState, readonly CommissionState[]> = {
  PENDING: ['ELIGIBLE', 'ON_HOLD', 'REVERSED', 'CANCELLED'],
  ELIGIBLE: ['APPROVED', 'ON_HOLD', 'REVERSED', 'CANCELLED'],
  // PENDING is the destination when a hold is lifted rather than settled: the
  // commission goes back to being ordinary accrued money and has to pass the
  // usual eligibility test again. Releasing straight to ELIGIBLE would declare
  // it payable without checking that its transaction ever settled.
  ON_HOLD: ['PENDING', 'ELIGIBLE', 'REVERSED', 'CANCELLED'],
  // ELIGIBLE is the destination when a requested payout is refused, and only
  // then. It is not the same move the ON_HOLD note above warns against: to
  // reach APPROVED this commission was ELIGIBLE moments earlier, so the
  // settlement and hold tests have already been passed and nothing new is
  // being declared payable. Without it a refused payout stranded the money —
  // requestPayout only ever selects ELIGIBLE, so an APPROVED commission
  // belonging to a payout that will never happen could never be requested
  // again, and the agent was told they had no commission.
  APPROVED: ['PAID', 'ON_HOLD', 'REVERSED', 'ELIGIBLE'],
  PAID: ['REVERSED'],
  REVERSED: [],
  CANCELLED: [],
};

export const AGENT_STATUSES = [
  'PENDING',
  'UNDER_REVIEW',
  'ACTIVE',
  'SUSPENDED',
  'DEACTIVATED',
  'TERMINATED',
] as const;

export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const INVOICE_STATES = ['UNPAID', 'PARTIALLY_PAID', 'PAID', 'EXPIRED', 'CANCELLED'] as const;
export type InvoiceState = (typeof INVOICE_STATES)[number];

export const RECONCILIATION_STATES = [
  'PENDING',
  'MATCHED',
  'MISSING_PAYMENT',
  'MISSING_PLATFORM_TRANSACTION',
  'AMOUNT_MISMATCH',
  'DUPLICATE_PAYMENT',
  'REVERSED',
  'PENDING_SETTLEMENT',
  'RESOLVED',
] as const;

export type ReconciliationState = (typeof RECONCILIATION_STATES)[number];

/** Reconciliation outcomes a finance officer must action (PRD §46). */
export const RECONCILIATION_EXCEPTIONS: readonly ReconciliationState[] = [
  'MISSING_PAYMENT',
  'MISSING_PLATFORM_TRANSACTION',
  'AMOUNT_MISMATCH',
  'DUPLICATE_PAYMENT',
];

export class IllegalTransitionError extends Error {
  readonly from: string;
  readonly to: string;

  constructor(entity: string, from: string, to: string) {
    super(`${entity} cannot move from ${from} to ${to}`);
    this.name = 'IllegalTransitionError';
    this.from = from;
    this.to = to;
  }
}

function assert<S extends string>(
  entity: string,
  table: Record<S, readonly S[]>,
  from: S,
  to: S,
): void {
  const allowed = table[from];
  if (!allowed || !allowed.includes(to)) {
    throw new IllegalTransitionError(entity, from, to);
  }
}

export function assertTransactionTransition(from: TransactionState, to: TransactionState): void {
  assert('Transaction', TRANSACTION_TRANSITIONS, from, to);
}

export function assertPaymentTransition(from: PaymentState, to: PaymentState): void {
  assert('Payment', PAYMENT_TRANSITIONS, from, to);
}

export function assertCommissionTransition(from: CommissionState, to: CommissionState): void {
  assert('Commission', COMMISSION_TRANSITIONS, from, to);
}

export function canTransactionTransition(from: TransactionState, to: TransactionState): boolean {
  return (TRANSACTION_TRANSITIONS[from] ?? []).includes(to);
}
