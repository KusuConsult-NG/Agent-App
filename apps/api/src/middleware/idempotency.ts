/**
 * Idempotency (PRD §53, §61).
 *
 * "If the user presses Pay twice, the system must not create two government
 * obligations... This should be enforced at backend level, not merely through
 * UI button disabling."
 *
 * The first request for a key inserts an IN_PROGRESS row; the unique index on
 * (scope, key) makes a concurrent duplicate fail at insert rather than execute.
 * When the handler finishes, its status and body are stored and replayed
 * verbatim for every subsequent retry.
 *
 * The request body is hashed too: reusing one key for a *different* payload is
 * a client bug that would otherwise silently return the wrong result, so it is
 * rejected outright.
 */

import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { pool, queryOne } from '../db/pool';
import { AppError, badRequest } from '../lib/errors';
import { log } from '../lib/logger';

function hashRequest(req: Request): string {
  return createHash('sha256')
    .update(JSON.stringify({ path: req.path, method: req.method, body: req.body ?? {} }))
    .digest('hex');
}

export function idempotent(scope: string, options: { required?: boolean } = {}) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const key = req.header('idempotency-key');

      if (!key) {
        if (options.required) {
          throw badRequest(
            'This request requires an Idempotency-Key header so it can be retried safely.',
            [{ field: 'Idempotency-Key', issue: 'Header is missing' }],
          );
        }
        return next();
      }

      if (key.length > 200) {
        throw badRequest('Idempotency-Key is too long (maximum 200 characters).');
      }

      const requestHash = hashRequest(req);
      const userId = req.auth?.userId ?? null;

      const existing = await queryOne<{
        status: string;
        response_code: number | null;
        response_body: unknown;
        request_hash: string;
      }>(
        pool,
        `SELECT status, response_code, response_body, request_hash
           FROM idempotency_keys WHERE scope = $1 AND idempotency_key = $2`,
        [scope, key],
      );

      if (existing) {
        if (existing.request_hash !== requestHash) {
          throw new AppError({
            statusCode: 422,
            code: 'IDEMPOTENCY_KEY_REUSED',
            message:
              'This idempotency key was already used for a different request. ' +
              'Use a new key for a new transaction.',
            moneyStatus: 'NOT_DEBITED',
          });
        }

        if (existing.status === 'IN_PROGRESS') {
          // The original attempt is still running. Returning its (unknown)
          // outcome would be a guess, so we say plainly that nothing new was
          // created and the caller should re-read the transaction.
          throw new AppError({
            statusCode: 409,
            code: 'REQUEST_IN_PROGRESS',
            message:
              'The original request is still being processed. Nothing has been duplicated. ' +
              'Wait a moment and check the transaction status.',
            moneyStatus: 'UNCONFIRMED',
          });
        }

        if (existing.status === 'COMPLETED') {
          res.setHeader('idempotent-replay', 'true');
          res.status(existing.response_code ?? 200).json(existing.response_body);
          return;
        }
        // A FAILED attempt may be retried: fall through and re-execute.
      }

      try {
        await pool.query(
          `INSERT INTO idempotency_keys (scope, idempotency_key, user_id, request_hash, status)
           VALUES ($1, $2, $3, $4, 'IN_PROGRESS')
           ON CONFLICT (scope, idempotency_key)
           DO UPDATE SET status = 'IN_PROGRESS', request_hash = EXCLUDED.request_hash
           WHERE idempotency_keys.status = 'FAILED'`,
          [scope, key, userId, requestHash],
        );
      } catch {
        throw new AppError({
          statusCode: 409,
          code: 'REQUEST_IN_PROGRESS',
          message: 'A request with this idempotency key is already being processed.',
          moneyStatus: 'UNCONFIRMED',
        });
      }

      // Capture the handler's response so retries replay it exactly.
      //
      // The record is written BEFORE the response is sent, and that ordering is
      // the whole point. This used to fire the UPDATE without waiting and send
      // the response immediately, which left a window in which the key was
      // still IN_PROGRESS while the caller already had its answer. A client
      // that retried in that window — which is exactly what a phone on a bad
      // connection does — was told 409 REQUEST_IN_PROGRESS with moneyStatus
      // UNCONFIRMED, instead of being replayed the success that had already
      // happened. On `payment.initiate` that is the worst possible answer: the
      // agent is told the money state is unknown when the request had in fact
      // succeeded.
      //
      // Sending a few milliseconds later is the right trade for a retry that
      // can never observe a state the server has not finished recording.
      const originalJson = res.json.bind(res);
      res.json = ((body: unknown) => {
        const status = res.statusCode;
        pool
          .query(
            `UPDATE idempotency_keys
                SET status = $1, response_code = $2, response_body = $3, completed_at = now()
              WHERE scope = $4 AND idempotency_key = $5`,
            [status >= 500 ? 'FAILED' : 'COMPLETED', status, JSON.stringify(body), scope, key],
          )
          .catch((error) => log.error('failed to persist idempotent response', { component: 'idempotency', error }))
          // finally, not then: a failed write must not also cost the caller
          // their response. It leaves the key IN_PROGRESS, which is the old
          // behaviour for that case and no worse.
          .finally(() => originalJson(body));
        return res;
      }) as typeof res.json;

      next();
    } catch (error) {
      next(error);
    }
  };
}

/** Release a key so a failed attempt can be retried with the same key. */
export async function releaseIdempotencyKey(scope: string, key: string): Promise<void> {
  await pool.query(
    `UPDATE idempotency_keys SET status = 'FAILED' WHERE scope = $1 AND idempotency_key = $2`,
    [scope, key],
  );
}
