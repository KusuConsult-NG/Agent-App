/**
 * Transport and request-level security (PRD §54, Addendum §22).
 *
 * Rate limiting is in-process here for clarity; in production the store is
 * Redis so limits hold across instances. That is a deployment concern, not a
 * behavioural one — the policy and the error contract stay identical.
 */

import type { NextFunction, Request, Response } from 'express';
import { config } from '../config';
import { tooManyRequests, badRequest } from '../lib/errors';

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Bounded sweep so the map cannot grow without limit under a spray of IPs.
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, 60_000).unref();

export function rateLimit(options: { max?: number; windowMs?: number; keyPrefix?: string } = {}) {
  const max = options.max ?? config.security.rateLimitMax;
  const windowMs = options.windowMs ?? config.security.rateLimitWindowMs;

  return (req: Request, res: Response, next: NextFunction): void => {
    // Keyed by user where known, so one shared NAT address in a rural LGA does
    // not throttle every agent behind it.
    const identity = req.auth?.userId ?? req.clientIp ?? 'unknown';
    const key = `${options.keyPrefix ?? req.baseUrl}:${identity}`;
    const now = Date.now();

    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;
    res.setHeader('x-ratelimit-limit', max);
    res.setHeader('x-ratelimit-remaining', Math.max(0, max - bucket.count));

    if (bucket.count > max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader('retry-after', retryAfter);
      return next(tooManyRequests(retryAfter));
    }

    next();
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
export function payloadGuard(maxBytes = 1_000_000) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const length = Number.parseInt(req.header('content-length') ?? '0', 10);
    if (length > maxBytes) {
      return next(
        badRequest(
          `The request is too large (${Math.round(length / 1024)}KB). ` +
            `The maximum is ${Math.round(maxBytes / 1024)}KB. Upload large documents separately.`,
        ),
      );
    }
    next();
  };
}
