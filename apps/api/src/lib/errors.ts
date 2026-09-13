/**
 * Error contract.
 *
 * PRD §60 forbids vague failures: "The system must never display vague errors
 * such as 'Something went wrong.'" On a payment platform an ambiguous error is
 * a financial hazard — a taxpayer who cannot tell whether their money left
 * their account will pay twice.
 *
 * Every error therefore carries:
 *   code        — a stable machine-readable identifier
 *   message     — plain language a field agent or taxpayer can act on
 *   moneyStatus — for payment-path errors, an explicit statement of whether
 *                 the taxpayer's money has been taken
 *   reference   — the transaction/payment reference to quote to support
 */

import { blockerSentence, type AgentBlocker } from '@psirs/shared';

export type MoneyStatus =
  /** No payment was attempted; nothing has been debited. */
  | 'NOT_DEBITED'
  /** A payment is in flight and its outcome is not yet known. Do not retry. */
  | 'UNCONFIRMED'
  /** Money was received; the failure is downstream of the payment itself. */
  | 'RECEIVED'
  /** Not a payment-path error. */
  | 'NOT_APPLICABLE';

export interface ErrorDetail {
  field?: string;
  issue: string;
  /**
   * A stable name for what this detail is, where one exists.
   *
   * `issue` is prose, and prose composed here is prose in English. A client
   * that knows the code can say the same thing in the reader's language;
   * one that does not still has `issue` to fall back on, which is why both
   * travel rather than the code replacing the sentence.
   */
  code?: string;
}

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly moneyStatus: MoneyStatus;
  readonly reference?: string;
  readonly details?: ErrorDetail[];
  readonly nextStep?: string;
  readonly expose: boolean;

  constructor(params: {
    statusCode: number;
    code: string;
    message: string;
    moneyStatus?: MoneyStatus;
    reference?: string;
    details?: ErrorDetail[];
    nextStep?: string;
    expose?: boolean;
  }) {
    super(params.message);
    this.name = 'AppError';
    this.statusCode = params.statusCode;
    this.code = params.code;
    this.moneyStatus = params.moneyStatus ?? 'NOT_APPLICABLE';
    this.reference = params.reference;
    this.details = params.details;
    this.nextStep = params.nextStep;
    this.expose = params.expose ?? true;
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        moneyStatus: this.moneyStatus,
        ...(this.reference ? { reference: this.reference } : {}),
        ...(this.nextStep ? { nextStep: this.nextStep } : {}),
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}

export function badRequest(message: string, details?: ErrorDetail[]): AppError {
  return new AppError({ statusCode: 400, code: 'INVALID_REQUEST', message, details });
}

/**
 * The message promised something the applications do not do.
 *
 * It said "correct the highlighted fields", and nothing was highlighted:
 * neither client marks a field, sets `aria-invalid`, or renders anything at
 * the input. The list of problems appears in the banner and nowhere else. On
 * the twenty-seven-field agent application that is the difference between
 * being told where to look and being told to look for something that is not
 * there — and a message that describes an interface the user cannot see is
 * worse than a plainer one, because they will keep hunting for the highlight.
 */
export function validationFailed(details: ErrorDetail[]): AppError {
  return new AppError({
    statusCode: 422,
    code: 'VALIDATION_FAILED',
    message:
      'Some of the information supplied is not valid. Check the fields listed below and try again.',
    details,
  });
}

export function unauthorised(message = 'You need to sign in to continue.'): AppError {
  return new AppError({ statusCode: 401, code: 'UNAUTHENTICATED', message });
}

export function forbidden(message: string, nextStep?: string): AppError {
  return new AppError({ statusCode: 403, code: 'FORBIDDEN', message, nextStep });
}

export function notFound(what: string): AppError {
  return new AppError({
    statusCode: 404,
    code: 'NOT_FOUND',
    message: `${what} could not be found.`,
  });
}

export function conflict(code: string, message: string, nextStep?: string): AppError {
  return new AppError({ statusCode: 409, code, message, nextStep });
}

/**
 * The most important error in the system.
 *
 * PRD §60's own example: "Payment could not be confirmed. Your money has not
 * been marked as received. Reference: TXN-XXXX." An agent seeing this must
 * know, without interpretation, whether to collect again.
 */
export function paymentUnconfirmed(reference: string): AppError {
  return new AppError({
    statusCode: 202,
    code: 'PAYMENT_UNCONFIRMED',
    message:
      'Payment could not be confirmed yet. The money has NOT been marked as received. ' +
      'Do not ask the taxpayer to pay again — check this transaction again in a few minutes.',
    moneyStatus: 'UNCONFIRMED',
    reference,
    nextStep: 'Open the transaction from your history to see its current status.',
  });
}

export function paymentPendingReconciliation(reference: string): AppError {
  return new AppError({
    statusCode: 202,
    code: 'PAYMENT_PENDING_RECONCILIATION',
    message:
      'Payment received but reconciliation is pending. Do not pay again. ' +
      'The receipt will be issued as soon as settlement is confirmed.',
    moneyStatus: 'RECEIVED',
    reference,
  });
}

export function paymentFailed(reference: string, reason: string): AppError {
  return new AppError({
    statusCode: 402,
    code: 'PAYMENT_FAILED',
    message: `The payment did not go through: ${reason}. No money has been taken from the taxpayer.`,
    moneyStatus: 'NOT_DEBITED',
    reference,
    nextStep: 'Start the payment again, or choose a different payment method.',
  });
}

export function tooManyRequests(retryAfterSeconds: number): AppError {
  return new AppError({
    statusCode: 429,
    code: 'RATE_LIMITED',
    message: `Too many requests. Wait ${retryAfterSeconds} seconds and try again.`,
    moneyStatus: 'NOT_DEBITED',
  });
}

/**
 * A capability this deployment has not been configured with.
 *
 * Distinct from `internal`: nothing has gone wrong, and the caller is not
 * asked to quote a reference to support. Something has not been set up, and
 * saying which setting is what turns a silent outage into a checklist item.
 */
export function serviceUnavailable(message: string, nextStep?: string): AppError {
  return new AppError({
    statusCode: 503,
    code: 'NOT_CONFIGURED',
    message,
    nextStep,
    moneyStatus: 'NOT_APPLICABLE',
  });
}

/**
 * The answer to an unhandled exception — the one error nobody anticipated.
 *
 * IT USED TO SAY "No financial record has been changed", with `moneyStatus:
 * NOT_DEBITED`. That is an assertion this path cannot make. `MoneyStatus`
 * defines NOT_DEBITED as "No payment was attempted", and an exception nobody
 * anticipated can be thrown after a transaction committed, after a gateway
 * accepted a payment, after a receipt was issued. The error handler that calls
 * this says so four lines above the call: "on a revenue platform an unhandled
 * exception is a taxpayer who paid and has no receipt."
 *
 * The agent application renders NOT_DEBITED as "No money has been taken from
 * the taxpayer" — in Hausa too — in plain error styling, not the warning
 * styling it reserves for "Do not collect again". So the one moment the
 * platform knows least was the moment it spoke with most confidence, to the
 * person standing in front of somebody who has just handed over cash.
 *
 * THE RULE BELOW IS THE CLIENT'S OWN, mirrored. `apps/agent/src/lib/api.ts`
 * already decides this correctly for a request that never got an answer at
 * all: "A read that never arrived moves no money whether it arrived or not. A
 * write under `/payments` that never got an answer is a write whose effect is
 * unknown — which is exactly what UNCONFIRMED means... Every other write says
 * NOT_APPLICABLE, because telling an agent their taxpayer may have been
 * debited by a failed support ticket is its own kind of wrong."
 *
 * A 500 is the same situation with a status line attached, so it gets the same
 * answer. What no branch does any more is claim nothing happened.
 */
export function internal(
  reference?: string,
  request?: { method: string; path: string },
): AppError {
  const write = (request?.method ?? 'GET').toUpperCase() !== 'GET';
  const money = write && (request?.path ?? '').startsWith('/payments');

  return new AppError({
    statusCode: 500,
    code: 'INTERNAL_ERROR',
    message: money
      ? 'The request could not be completed because of a problem on our side, and whether ' +
        'the payment went through is not known. Quote the reference below to support.'
      : 'The request could not be completed because of a problem on our side. ' +
        'Quote the reference below to support.',
    moneyStatus: money ? 'UNCONFIRMED' : 'NOT_APPLICABLE',
    reference,
    nextStep: money
      ? 'Check the transaction before collecting anything again.'
      : undefined,
    expose: false,
  });
}

/** Raised when the agent is not cleared to perform revenue work (Addendum §26). */
export function notCleared(blockers: readonly AgentBlocker[]): AppError {
  return new AppError({
    statusCode: 403,
    code: 'AGENT_NOT_CLEARED',
    message:
      'You are not yet cleared to carry out revenue collection. ' +
      'Your application must be completed and approved first.',
    // Both, deliberately: the agent PWA reads the code and says it in Hausa,
    // and anything else reading this response still gets a sentence.
    details: blockers.map((code) => ({ code, issue: blockerSentence(code) })),
    nextStep: 'Open "My Application" to see what is still outstanding.',
  });
}
