/**
 * The rate limiter must meter a signed-in user by who they are, not by where
 * they connect from.
 *
 * The limiter already carried this comment:
 *
 *   "Keyed by user where known, so one shared NAT address in a rural LGA does
 *    not throttle every agent behind it."
 *
 * It read `req.auth?.userId`, but the global limiter is mounted on the API
 * router *before* any route reaches `authenticate`, so `req.auth` was never
 * populated by the time it ran. The user branch was dead code and every
 * request fell through to the client IP. The effect is exactly the one the
 * comment set out to prevent: agents sharing a mast or an office connection
 * share a single 120-per-minute budget, and the one who happens to be the
 * 121st is told to slow down because of traffic that is not theirs. In a
 * market on a collection day that is a taxpayer standing at a desk that will
 * not take their money.
 *
 * The fix cannot be "authenticate first" — `authenticate` queries the sessions
 * table, and making an unauthenticated flood cost a database round trip each
 * would hand an attacker the very thing the limiter exists to deny. So the
 * limiter verifies the token's signature only: no I/O, and a forged or absent
 * token still falls back to the IP bucket, which is what keeps the limit from
 * being sidestepped by inventing a subject.
 */

import './env';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

import { rateLimit } from '../middleware/security';
import { issueAccessToken } from '../middleware/auth';
import { config } from '../config';

/** A request as the limiter sees it: before any router, so no `req.auth`. */
function requestFrom(ip: string, token?: string): Request {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  return {
    header: (name: string) => headers[name.toLowerCase()],
    clientIp: ip,
    baseUrl: '/api/v1',
  } as unknown as Request;
}

const noopRes = { setHeader() {} } as unknown as Response;

/**
 * Drives the middleware once; resolves true if the request was let through.
 *
 * Asynchronous because the limiter's counts moved to a store that may be the
 * database — see `middleware/rate-limit-store.ts`. The verdict still arrives
 * before the request proceeds; only the waiting is now explicit.
 */
function allows(limiter: ReturnType<typeof rateLimit>, req: Request): Promise<boolean> {
  return new Promise((resolve) => {
    const next: NextFunction = (err?: unknown) => resolve((err ?? null) === null);
    limiter(req, noopRes, next);
  });
}

/** Spends a whole budget, then returns whether the next request is refused. */
async function exhaust(
  limiter: ReturnType<typeof rateLimit>,
  req: Request,
  max: number,
): Promise<boolean> {
  for (let i = 0; i < max; i++) await allows(limiter, req);
  return !(await allows(limiter, req));
}

describe('rate limiting identifies the caller, not the connection', () => {
  const MAX = 5;
  // Distinct prefixes keep each case in its own bucket namespace.
  let tokenA = '';
  let tokenB = '';

  before(() => {
    tokenA = issueAccessToken({ sub: 'user-a', role: 'AGENT', sid: 'session-a' } as never);
    tokenB = issueAccessToken({ sub: 'user-b', role: 'AGENT', sid: 'session-b' } as never);
  });

  it('does not let one agent spend the budget of another behind the same address', async () => {
    const limiter = rateLimit({ max: MAX, keyPrefix: 'shared-nat' });
    const ip = '10.0.0.7';

    assert.equal(
      await exhaust(limiter, requestFrom(ip, tokenA), MAX),
      true,
      'the first agent should be limited once they have spent their own budget',
    );

    assert.equal(
      await allows(limiter, requestFrom(ip, tokenB)),
      true,
      'a second agent on the same address has spent nothing and must be served',
    );
  });

  it('still falls back to the address when there is no token', async () => {
    const limiter = rateLimit({ max: MAX, keyPrefix: 'anonymous' });
    const ip = '10.0.0.8';

    assert.equal(await exhaust(limiter, requestFrom(ip), MAX), true);
    assert.equal(
      await allows(limiter, requestFrom(ip)),
      false,
      'unauthenticated traffic from one address shares one budget',
    );
  });

  it('cannot be sidestepped by inventing a subject', async () => {
    const limiter = rateLimit({ max: MAX, keyPrefix: 'forged' });
    const ip = '10.0.0.9';

    // Correctly shaped, signed with the wrong key.
    const forged = jwt.sign({ sub: 'anyone-i-like', role: 'AGENT', sid: 's' }, 'not-the-secret', {
      issuer: 'psirs-revenue-platform',
      audience: 'psirs-clients',
    });

    assert.equal(await exhaust(limiter, requestFrom(ip), MAX), true);
    assert.equal(
      await allows(limiter, requestFrom(ip, forged)),
      false,
      'an unverifiable token must not buy a fresh budget',
    );
    assert.equal(
      await allows(limiter, requestFrom(ip, 'not-a-jwt-at-all')),
      false,
      'nor must a malformed one',
    );
  });

  it('does not accept a token issued for somewhere else', async () => {
    const limiter = rateLimit({ max: MAX, keyPrefix: 'foreign' });
    const ip = '10.0.0.10';

    // Right secret, wrong audience — a token from another service entirely.
    const foreign = jwt.sign({ sub: 'user-c', role: 'AGENT', sid: 's' }, config.auth.jwtSecret, {
      issuer: 'somewhere-else',
      audience: 'someone-else',
    });

    assert.equal(await exhaust(limiter, requestFrom(ip), MAX), true);
    assert.equal(
      await allows(limiter, requestFrom(ip, foreign)),
      false,
      'a token this API did not issue must not buy a fresh budget',
    );
  });

  it('honours an already-resolved identity without re-verifying', async () => {
    // Route-level limiters mounted after `authenticate` already have `req.auth`.
    // Those must keep working off it rather than parsing the header again.
    const limiter = rateLimit({ max: MAX, keyPrefix: 'resolved' });
    const ip = '10.0.0.11';
    const withAuth = (userId: string): Request => {
      const req = requestFrom(ip);
      (req as { auth?: unknown }).auth = { userId };
      return req;
    };

    assert.equal(await exhaust(limiter, withAuth('user-d'), MAX), true);
    assert.equal(
      await allows(limiter, withAuth('user-e')),
      true,
      'a different resolved user has their own budget',
    );
  });
});
