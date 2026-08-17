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

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (res.headersSent) return;

  if (error instanceof AppError) {
    if (!error.expose) {
      console.error(`[error] ${req.requestId} ${error.code}`, error);
    }
    res.status(error.statusCode).json(error.toJSON());
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

    // 23514 check_violation / 23503 foreign_key_violation
    if (error.code === '23514' || error.code === '23503') {
      console.error(`[error] ${req.requestId} constraint violation`, error.constraint, error.detail);
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

  console.error(`[error] ${req.requestId} unhandled`, error);
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
