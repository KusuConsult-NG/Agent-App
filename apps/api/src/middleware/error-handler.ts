/**
 * Central error handling (PRD §60).
 *
 * Two jobs: never leak internals to a caller, and never leave a field agent
 * guessing about money. Database constraint violations — which on this platform
 * *are* the financial controls — are translated into the specific, actionable
 * message that explains which control fired.
 */

import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { IllegalTransitionError, MoneyError } from '@psirs/shared';
import { AppError, internal, validationFailed } from '../lib/errors';
import { log } from '../lib/logger';
import { reportError } from '../services/error-reporting';

interface PostgresError extends Error {
  code?: string;
  constraint?: string;
  detail?: string;
  hint?: string;
  table?: string;
}

function isPostgresError(error: unknown): error is PostgresError {
  return error instanceof Error && typeof (error as PostgresError).code === 'string';
}

/** Map unique-constraint names to language the caller can act on. */
const UNIQUE_CONSTRAINT_MESSAGES: Record<string, string> = {
  taxpayers_tin_key: 'A taxpayer with this TIN already exists.',
  users_phone_key: 'This phone number is already registered.',
  users_email_key: 'This email address is already registered.',
  receipts_receipt_number_key: 'That receipt number has already been issued.',
  receipts_transaction_id_key: 'A receipt has already been issued for this transaction.',
  invoices_invoice_number_key: 'That invoice number has already been issued.',
  payments_gateway_reference_key:
    'This gateway payment has already been recorded. No duplicate has been created.',
  transactions_transaction_reference_key: 'That transaction reference already exists.',
  commissions_transaction_id_key: 'Commission has already been recorded for this transaction.',
  idx_payments_one_active:
    'A payment is already in progress for this invoice. Check its status before starting another.',
  payment_webhook_events_gateway_event_id_key:
    'This webhook event has already been processed.',
  vehicles_registration_number_key: 'A vehicle with this registration number already exists.',
  agents_user_id_key: 'This user already has an agent application.',
};

/**
 * Map overlap-constraint names to language the caller can act on.
 *
 * The same idea as the unique map above, for `EXCLUDE USING gist`. Four tables
 * carry one, and each is a rule about a period of time not being covered
 * twice: two financial months, two classes for one LGA, two constructions of
 * the nano exemption, two presumptive assessments of one taxpayer for one year.
 *
 * These are reference data with dated windows, so the ordinary mistake is not
 * exotic. Reclassifying an LGA or adopting a replacement policy without first
 * giving the current one an end date is exactly what somebody does the first
 * time they use the screen, and the answer they need is "close the current one
 * first", not a reference number.
 */
const OVERLAP_CONSTRAINT_MESSAGES: Record<string, string> = {
  financial_periods_do_not_overlap:
    'A financial period already covers part of those dates. Periods cannot overlap.',
  lga_class_no_overlap:
    'This LGA already has a class covering part of that period. Give the current ' +
    'classification an end date first, then publish the new one.',
  nano_policy_no_overlap:
    'A nano exemption policy already covers part of that period. Give the current ' +
    'policy an end date first, then adopt the new one.',
  presumptive_no_overlap:
    'This taxpayer already has a presumptive assessment covering part of that period.',
};

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (res.headersSent) return;

  if (error instanceof AppError) {
    if (!error.expose) {
      log.error('request failed', {
        requestId: req.requestId,
        component: 'http',
        code: error.code,
        path: req.path,
        error,
      });
    }
    res.status(error.statusCode).json(error.toJSON());
    return;
  }

  /*
   * A body that is not JSON.
   *
   * body-parser raises a SyntaxError before any handler runs, and it arrived
   * here as an unrecognised error — so a client sending malformed bytes was
   * told "a problem on our side. No financial record has been changed", with
   * a 500 behind it.
   *
   * Untrue, and expensively so. Nothing on our side went wrong, and a 500 on
   * a government revenue platform is an alert: one handset with a broken
   * request could page an on-call engineer repeatedly for its own typo, which
   * is how a team learns to ignore its alerts. The money status was right by
   * luck — nothing was debited because nothing was read — and is now stated
   * on purpose.
   */
  if (
    error instanceof SyntaxError &&
    'body' in error &&
    typeof (error as { status?: number }).status === 'number'
  ) {
    res.status(400).json(
      new AppError({
        statusCode: 400,
        code: 'MALFORMED_BODY',
        message: 'The request body could not be read. It is not valid JSON.',
        moneyStatus: 'NOT_DEBITED',
        nextStep: 'Check the request and send it again.',
      }).toJSON(),
    );
    return;
  }

  if (error instanceof ZodError) {
    res.status(422).json(
      validationFailed(
        error.issues.map((issue) => ({
          field: issue.path.join('.') || undefined,
          issue: issue.message,
        })),
      ).toJSON(),
    );
    return;
  }

  if (error instanceof MoneyError) {
    res.status(422).json(
      new AppError({
        statusCode: 422,
        code: 'INVALID_AMOUNT',
        message: error.message,
        moneyStatus: 'NOT_DEBITED',
      }).toJSON(),
    );
    return;
  }

  if (error instanceof IllegalTransitionError) {
    res.status(409).json(
      new AppError({
        statusCode: 409,
        code: 'ILLEGAL_STATE_TRANSITION',
        message: `${error.message}. The record's current state does not allow this action.`,
        moneyStatus: 'NOT_DEBITED',
      }).toJSON(),
    );
    return;
  }

  if (isPostgresError(error)) {
    // 23505 unique_violation
    if (error.code === '23505') {
      const message =
        (error.constraint && UNIQUE_CONSTRAINT_MESSAGES[error.constraint]) ??
        'That record already exists. No duplicate has been created.';
      res.status(409).json(
        new AppError({
          statusCode: 409,
          code: 'DUPLICATE_RECORD',
          message,
          moneyStatus: 'NOT_DEBITED',
        }).toJSON(),
      );
      return;
    }

    /*
     * 23P01 exclusion_violation.
     *
     * Without this the request fell past every branch below to the 500 at the
     * bottom of this function, whose comment reads: "Nothing above recognised
     * this, which means it is a bug rather than a rule firing." An overlap
     * constraint IS a rule firing, and it fired correctly. The officer got an
     * internal error and a reference number for an action the platform had
     * decided, on purpose, to refuse — and `reportError` woke somebody about
     * it, so the same mistake also spent an alert.
     *
     * It survived because nothing had ever called the two routes that reach
     * it: `POST /presumptive/lga-classes` and `POST /presumptive/nano-policy`
     * are both on the never-exercised list. Neither service pre-checks the
     * overlap the way `openPeriod` does for financial periods, so the database
     * is the only thing refusing, and the refusal had nowhere to go.
     */
    if (error.code === '23P01') {
      const message =
        (error.constraint && OVERLAP_CONSTRAINT_MESSAGES[error.constraint]) ??
        'That period overlaps one that already exists. Nothing has been changed.';
      log.warn('an overlap rule blocked the request', {
        requestId: req.requestId,
        component: 'http',
        constraint: error.constraint,
        detail: error.detail,
        path: req.path,
      });
      res.status(409).json(
        new AppError({
          statusCode: 409,
          code: 'OVERLAPPING_PERIOD',
          message,
          moneyStatus: 'NOT_DEBITED',
          nextStep:
            'Close the existing record by giving it an end date, then try again.',
        }).toJSON(),
      );
      return;
    }

    // 23514 check_violation / 23503 foreign_key_violation
    if (error.code === '23514' || error.code === '23503') {
      log.warn('a financial integrity rule blocked the request', {
        requestId: req.requestId,
        component: 'http',
        constraint: error.constraint,
        detail: error.detail,
        path: req.path,
      });
      res.status(409).json(
        new AppError({
          statusCode: 409,
          code: 'INTEGRITY_RULE_VIOLATED',
          message:
            'This action was blocked by a financial integrity rule. ' +
            'Nothing has been changed. Contact support with the reference below if you believe this is wrong.',
          moneyStatus: 'NOT_DEBITED',
          reference: req.requestId,
        }).toJSON(),
      );
      return;
    }

    // 2F003/38003/P0001 — our own RAISE EXCEPTION from the integrity triggers.
    // These messages are written for humans and are safe to surface: they say
    // exactly which control refused the action.
    if (error.code === 'P0001' || error.code === '2BP01') {
      res.status(409).json(
        new AppError({
          statusCode: 409,
          code: 'FINANCIAL_CONTROL_BLOCKED',
          message: error.message,
          moneyStatus: 'NOT_DEBITED',
          reference: req.requestId,
          nextStep: error.hint,
        }).toJSON(),
      );
      return;
    }

    // 40001 serialization_failure — a genuine concurrency retry case.
    if (error.code === '40001' || error.code === '40P01') {
      res.status(409).json(
        new AppError({
          statusCode: 409,
          code: 'CONCURRENT_UPDATE',
          message:
            'Another update to this record happened at the same time. Nothing was changed. Try again.',
          moneyStatus: 'NOT_DEBITED',
        }).toJSON(),
      );
      return;
    }
  }

  // Nothing above recognised this, which means it is a bug rather than a rule
  // firing. Somebody has to find out now: on a revenue platform an unhandled
  // exception is a taxpayer who paid and has no receipt.
  log.error('unhandled error', {
    requestId: req.requestId,
    component: 'http',
    method: req.method,
    path: req.path,
    error,
  });
  reportError({
    message: `Unhandled error on ${req.method} ${req.path}`,
    error,
    requestId: req.requestId,
    component: 'http',
    context: { method: req.method, path: req.path, role: req.auth?.role ?? null },
  });
  res.status(500).json(internal(req.requestId).toJSON());
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json(
    new AppError({
      statusCode: 404,
      code: 'ROUTE_NOT_FOUND',
      message: `No endpoint matches ${req.method} ${req.path}.`,
    }).toJSON(),
  );
}
