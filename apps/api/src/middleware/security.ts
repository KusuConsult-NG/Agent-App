/**
 * Transport and request-level security (PRD §54, Addendum §22).
 *
 * Where the rate limiter keeps its counts is chosen by `RATE_LIMIT_STORE` and
 * lives in `./rate-limit-store`; production refuses to boot on the per-process
 * one. The policy and the error contract are identical either way — only the
 * storage moves, so a limit means the same thing to a caller whichever store
 * is behind it.
 */

import type { NextFunction, Request, Response } from 'express';
import { config } from '../config';
import { tooManyRequests, badRequest } from '../lib/errors';
import { subjectFromBearer } from '../lib/access-token';
import {
  MemoryBucketStore,
  PostgresBucketStore,
  type RateLimitStore,
} from './rate-limit-store';

const store: RateLimitStore =
  config.security.rateLimitStore === 'postgres'
    ? new PostgresBucketStore()
    : new MemoryBucketStore();

/** Test seam: which store is actually in use, and how to clear it. */
export const __rateLimitStore = store;

/**
 * How a limit decides who is being metered.
 *
 * `caller` is the default and the right choice for the platform's own traffic:
 * a signed-in user gets their own budget, so one shared address in a rural LGA
 * does not throttle every agent behind it.
 *
 * `ip` is for public surfaces, where the cap exists to make some behaviour
 * expensive for whoever is at the other end of the connection — enumerating
 * TINs, guessing receipt codes, farming applications. Preferring an
 * authenticated subject there would let a caller buy extra budget by holding
 * an account, which on this platform anyone can create.
 */
export type RateLimitKey = 'caller' | 'ip';

export function rateLimit(
  options: { max?: number; windowMs?: number; keyPrefix?: string; keyBy?: RateLimitKey } = {},
) {
  const max = options.max ?? config.security.rateLimitMax;
  const windowMs = options.windowMs ?? config.security.rateLimitWindowMs;

  return (req: Request, res: Response, next: NextFunction): void => {
    // Keyed by user where known, so one shared NAT address in a rural LGA does
    // not throttle every agent behind it.
    //
    // The global limiter is mounted before any route reaches `authenticate`,
    // so `req.auth` is usually still empty here and the subject has to come
    // from the token itself. That check is signature-only and deliberately so:
    // a limiter that queried the sessions table would let an unauthenticated
    // flood cost a database round trip each, which is the thing it is here to
    // prevent. Anything unverifiable — forged, malformed, expired, issued
    // elsewhere — yields null and falls back to the address, so a caller
    // cannot mint themselves a fresh budget by inventing a subject.
    //
    // The shared store keeps that property: a caller already over the limit is
    // refused from memory for the rest of their window, so a flood costs one
    // round trip rather than one per request.
    const identity =
      options.keyBy === 'ip'
        ? (req.clientIp ?? 'unknown')
        : (req.auth?.userId ??
           subjectFromBearer(req.header('authorization')) ??
           req.clientIp ??
           'unknown');
    const key = `${options.keyPrefix ?? req.baseUrl}:${identity}`;

    store.hit(key, windowMs, max).then(
      (bucket) => {
        res.setHeader('x-ratelimit-limit', max);
        res.setHeader('x-ratelimit-remaining', Math.max(0, max - bucket.count));

        if (bucket.count > max) {
          const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - Date.now()) / 1000));
          res.setHeader('retry-after', retryAfter);
          return next(tooManyRequests(retryAfter));
        }

        next();
      },
      // `hit` handles its own failures and resolves; this is the belt to that
      // brace. Either way the request proceeds rather than failing on a
      // bookkeeping error.
      () => next(),
    );
  };
}

export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('cross-origin-opener-policy', 'same-origin');
  res.setHeader('permissions-policy', 'geolocation=(self), camera=(self), microphone=()');
  res.setHeader(
    'strict-transport-security',
    'max-age=31536000; includeSubDomains; preload',
  );
  // The API serves JSON and PDFs only; nothing it returns should ever execute.
  res.setHeader(
    'content-security-policy',
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  );
  next();
}

export function cors(req: Request, res: Response, next: NextFunction): void {
  const origin = req.header('origin');
  if (origin && config.security.corsOrigins.includes(origin)) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('access-control-allow-credentials', 'true');
    res.setHeader('vary', 'Origin');
  }
  res.setHeader(
    'access-control-allow-headers',
    'content-type, authorization, idempotency-key, x-device-id, x-app-version, x-request-id',
  );
  res.setHeader('access-control-allow-methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
  res.setHeader('access-control-expose-headers', 'x-request-id, idempotent-replay, retry-after');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
}

/**
 * Reject oversized JSON before parsing. Express's own limit returns an opaque
 * error; PRD §60 requires the caller be told what to do about it.
 */
/**
 * Refuse oversized requests before a body is read.
 *
 * One ceiling for ordinary requests, and a higher one for the routes that
 * exist to receive a file. The message used to end "upload large documents
 * separately", which was written when there was nowhere to upload one; now
 * that identity capture exists, the guard has to let those bytes through
 * rather than send an agent away with advice they cannot follow.
 */
export function payloadGuard(
  maxBytes = 1_000_000,
  options: { uploadMaxBytes?: number; isUpload?: (req: Request) => boolean } = {},
) {
  const uploadMax = options.uploadMaxBytes ?? 8 * 1024 * 1024;
  // Path-based rather than content-type based: a client that lies about its
  // type must still be held to the ordinary limit.
  const isUpload = options.isUpload ?? ((req: Request) => /\/kyc\/documents(\?|$)/.test(req.path));

  return (req: Request, _res: Response, next: NextFunction): void => {
    const length = Number.parseInt(req.header('content-length') ?? '0', 10);
    const ceiling = isUpload(req) ? uploadMax : maxBytes;
    if (length > ceiling) {
      return next(
        badRequest(
          `The request is too large (${Math.round(length / 1024)}KB). ` +
            `The maximum is ${Math.round(ceiling / 1024)}KB.` +
            (isUpload(req) ? ' Photograph the document rather than filming it.' : ''),
        ),
      );
    }
    next();
  };
}
