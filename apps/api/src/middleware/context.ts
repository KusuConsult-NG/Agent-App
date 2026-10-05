/**
 * Per-request context: a correlation id, the caller's IP, device and app
 * version. The request id is echoed on every response and written into audit
 * entries, so a support ticket quoting one reference can be traced end to end.
 */

import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Role, Permission } from '@psirs/shared';
import { config } from '../config';
import { log } from '../lib/logger';

export interface AuthContext {
  userId: string;
  role: Role;
  sessionId: string;
  permissions: readonly Permission[];
  agentId?: string;
  deviceId?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      clientIp: string | null;
      deviceIdentifier: string | null;
      appVersion: string | null;
      auth?: AuthContext;
      rawBody?: Buffer;
    }
  }
}

/*
 * Said once, the first time a request arrives with a forwarded address that
 * this deployment is not configured to read.
 *
 * `TRUST_PROXY` defaults to false, and when it is false Express takes
 * `req.ip` from the socket -- which, behind the front-end nginx that serves
 * `/api/`, is nginx. Measured against the rendered config: the caller's
 * address arrives in `X-Forwarded-For` and nowhere else, so with trust off it
 * is present in the request and ignored.
 *
 * Two things then go quietly wrong. Every `keyBy: 'ip'` rate limit collapses
 * into one bucket for the whole internet, and the sharpest of them are on the
 * public citizen lookup -- ten requests a minute, five for a statement -- so
 * the lookup starts refusing ordinary citizens almost at once. And the audit
 * log, which records the address a lookup came from as evidence, records the
 * proxy's address on every row.
 *
 * A boot check cannot see this: whether anything forwards an address depends
 * on what is in front of the API, which the API learns only when a request
 * arrives. So it is a runtime warning, once per process, naming both costs.
 * It does not change `req.clientIp` -- guessing the hop count is how a
 * spoofed `X-Forwarded-For` becomes a trusted address, and the number of hops
 * is a property of the deployment that only the operator knows.
 */
let warnedAboutForwardedAddress = false;

export function requestContext(req: Request, res: Response, next: NextFunction): void {
  req.requestId = (req.header('x-request-id') ?? randomUUID()).slice(0, 64);
  req.clientIp = req.ip ?? req.socket.remoteAddress ?? null;

  if (!warnedAboutForwardedAddress && !config.security.trustProxy && req.header('x-forwarded-for')) {
    warnedAboutForwardedAddress = true;
    log.warn('requests carry X-Forwarded-For but TRUST_PROXY is not set', {
      component: 'http',
      forwardedFor: req.header('x-forwarded-for')?.slice(0, 120) ?? null,
      usingInstead: req.clientIp,
      consequence:
        'every keyBy:ip rate limit shares one bucket for all callers, and the ' +
        "audit log records this address rather than the caller's",
      remedy: 'set TRUST_PROXY to the number of proxies in front of the API',
    });
  }
  req.deviceIdentifier = req.header('x-device-id')?.slice(0, 128) ?? null;
  req.appVersion = req.header('x-app-version')?.slice(0, 32) ?? null;
  res.setHeader('x-request-id', req.requestId);
  next();
}
