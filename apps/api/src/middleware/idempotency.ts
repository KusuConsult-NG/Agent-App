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

/**
 * How long a request may plausibly still be running.
 *
 * Longer than anything on these four routes takes, including a payment
 * initiation waiting on the gateway, and short enough that an agent standing
 * in a market is not told to keep waiting for an attempt that died. Erring
 * long is the safe direction: calling a live request interrupted would tell
 * somebody to go and check a record that is about to be written.
 */
const STALL_AFTER_MS = 5 * 60_000;

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
        created_at: Date;
      }>(
        pool,
        `SELECT status, response_code, response_body, request_hash, created_at
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
          /*
           * Still running, or interrupted and never coming back.
           *
           * Both used to answer "wait a moment and check the transaction
           * status", which is true for the first few seconds and a lie for
           * ever after. A key goes IN_PROGRESS before the handler runs and is
           * settled when the response is written; if the process dies in
           * between — a pod evicted, a container killed — or if the settling
           * UPDATE itself fails, the row stays IN_PROGRESS with nothing left
           * to move it. Every retry of that action then gets a 409 telling the
           * agent to wait, permanently, on the one route where the key is
           * required and the subject is money.
           *
           * So age decides which of the two it is. Under the window it is
           * genuinely in flight and waiting is the right advice. Past it, the
           * attempt was interrupted: the outcome is unknown — it may have
           * committed and lost only its response — and the honest instruction
           * is to look at the record rather than to keep waiting. The status
           * is deliberately NOT reset to allow re-execution: an interrupted
           * request may well have moved money, and a retry that quietly ran it
           * again is exactly what this middleware exists to prevent.
           */
          const startedAt = existing.created_at.getTime();
          if (Date.now() - startedAt < STALL_AFTER_MS) {
            throw new AppError({
              statusCode: 409,
              code: 'REQUEST_IN_PROGRESS',
              message:
                'The original request is still being processed. Nothing has been duplicated. ' +
                'Wait a moment and check the transaction status.',
              moneyStatus: 'UNCONFIRMED',
            });
          }

          throw new AppError({
            statusCode: 409,
            code: 'REQUEST_INTERRUPTED',
            message:
              'The original request was interrupted and never finished, so whether it took ' +
              'effect is not known. Nothing has been duplicated by this retry. Check the ' +
              'record before trying again, and use a new key if nothing was created.',
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
        const insertResult = await pool.query(
          `INSERT INTO idempotency_keys (scope, idempotency_key, user_id, request_hash, status)
           VALUES ($1, $2, $3, $4, 'IN_PROGRESS')
           ON CONFLICT (scope, idempotency_key)
           DO UPDATE SET status = 'IN_PROGRESS', request_hash = EXCLUDED.request_hash
           WHERE idempotency_keys.status = 'FAILED'
           RETURNING id`,
          [scope, key, userId, requestHash],
        );

        if ((insertResult.rowCount ?? 0) === 0) {
          throw new AppError({
            statusCode: 409,
            code: 'REQUEST_IN_PROGRESS',
            message: 'A request with this idempotency key is already being processed.',
            moneyStatus: 'UNCONFIRMED',
          });
        }
      } catch (err) {
        if (err instanceof AppError) throw err;
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

/**
 * Delete keys that have finished being useful.
 *
 * Nothing has ever deleted from this table. Every taxpayer registration, every
 * assessment, every payment initiation and every vehicle renewal leaves a row
 * carrying the full response body as JSONB, kept for the life of the platform —
 * on the busiest write path in the system, in a database whose running out of
 * space stops collection statewide. `idx_idempotency_created` has been sitting
 * on `created_at` since the first migration serving nothing, which is what a
 * retention sweep that was intended and never written looks like.
 *
 * Only settled rows are deleted. An IN_PROGRESS row is the record of a request
 * that was interrupted while it may have been moving money, and deleting it
 * would let the same key re-execute — turning the one control against a double
 * charge into the thing that caused one. Those rows stay, and the middleware
 * reads their age instead.
 */
export async function expireSettledKeys(
  retentionDays = 30,
): Promise<{ deleted: number; interrupted: number }> {
  const deleted = await pool.query(
    `DELETE FROM idempotency_keys
      WHERE status IN ('COMPLETED', 'FAILED')
        AND created_at < now() - ($1 || ' days')::interval`,
    [String(retentionDays)],
  );
  const interrupted = await pool.query(
    `SELECT 1 FROM idempotency_keys
      WHERE status = 'IN_PROGRESS' AND created_at < now() - interval '1 hour'`,
  );
  return { deleted: deleted.rowCount ?? 0, interrupted: interrupted.rowCount ?? 0 };
}
