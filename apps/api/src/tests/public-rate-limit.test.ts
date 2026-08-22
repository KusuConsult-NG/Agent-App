/**
 * On a public surface the limit is about the connection, not the caller.
 *
 * Metering by authenticated subject was the right repair for the platform-wide
 * limiter: agents behind one mast in a rural LGA should not share a budget.
 * Applied indiscriminately it weakens the limits that exist to stop
 * enumeration.
 *
 * `/citizen-status` is the clearest case. It is unauthenticated, it answers
 * questions about whether a given TIN or phone number belongs to a taxpayer,
 * and its 10-per-minute cap is documented as being there "to prevent TIN/phone
 * enumeration". Once the limiter preferred a bearer subject over the address,
 * a caller who presented a valid token got a budget of their own — and
 * `POST /agents/apply` lets anyone create an account. An attacker could farm
 * accounts and multiply their enumeration budget from a single address, which
 * is exactly the arithmetic the cap was written to prevent.
 *
 * So the two kinds of limit are now said apart. Where the limit protects the
 * platform from a caller, key by caller. Where it protects the public from
 * whoever is at the other end of the connection, key by address, and ignore
 * any token offered.
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ??= 'test-jwt-secret-value-that-is-long-enough-32';
process.env.IDENTITY_HASH_SECRET ??= 'test-identity-secret-value-long-enough-32';
process.env.PAYMENT_WEBHOOK_SECRET ??= 'test-webhook-secret-value-long-enough-32';

import './env';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { NextFunction, Request, Response } from 'express';

import { rateLimit } from '../middleware/security';
import { issueAccessToken } from '../lib/access-token';

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

function allows(limiter: ReturnType<typeof rateLimit>, req: Request): boolean {
  let error: unknown = null;
  const next: NextFunction = (err?: unknown) => {
    error = err ?? null;
  };
  limiter(req, noopRes, next);
  return error === null;
}

function exhaust(limiter: ReturnType<typeof rateLimit>, req: Request, max: number): void {
  for (let i = 0; i < max; i++) allows(limiter, req);
}

describe('a public limit meters the connection', () => {
  const MAX = 5;

  it('does not hand a fresh budget to whoever holds an account', () => {
    const limiter = rateLimit({ max: MAX, keyPrefix: 'public-probe', keyBy: 'ip' });
    const ip = '10.1.0.1';
    const token = issueAccessToken({ sub: 'someone', role: 'AGENT', sid: 'sid' } as never);

    exhaust(limiter, requestFrom(ip), MAX);

    assert.equal(
      allows(limiter, requestFrom(ip, token)),
      false,
      'presenting a token must not reset an anti-enumeration budget',
    );
  });

  it('still separates genuinely different addresses', () => {
    const limiter = rateLimit({ max: MAX, keyPrefix: 'public-probe-2', keyBy: 'ip' });

    exhaust(limiter, requestFrom('10.1.0.2'), MAX);

    assert.equal(allows(limiter, requestFrom('10.1.0.2')), false);
    assert.equal(allows(limiter, requestFrom('10.1.0.3')), true, 'another address is another caller');
  });

  it('leaves caller-keyed limits alone', () => {
    // The platform-wide limiter must keep metering by user, which is what
    // stops one shared address throttling every agent behind it.
    const limiter = rateLimit({ max: MAX, keyPrefix: 'caller-keyed' });
    const ip = '10.1.0.4';
    const a = issueAccessToken({ sub: 'user-a', role: 'AGENT', sid: 'sa' } as never);
    const b = issueAccessToken({ sub: 'user-b', role: 'AGENT', sid: 'sb' } as never);

    exhaust(limiter, requestFrom(ip, a), MAX);

    assert.equal(allows(limiter, requestFrom(ip, a)), false);
    assert.equal(allows(limiter, requestFrom(ip, b)), true, 'a different agent has their own budget');
  });
});

describe('the public routers ask for address keying', () => {
  it('is declared on every unauthenticated surface', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const routes = join(__dirname, '..', 'routes');

    // Each of these serves callers with no account, and each cap is about the
    // connection rather than the caller behind it.
    const publicLimiters: [string, string][] = [
      ['citizen.ts', 'citizen-status'],
      ['payments.ts', 'verify'],
      ['payments.ts', 'webhook'],
      ['referees.ts', 'referee'],
      ['reference.ts', 'reference'],
      ['agents.ts', 'agent-apply'],
    ];

    for (const [file, prefix] of publicLimiters) {
      const source = readFileSync(join(routes, file), 'utf8');
      const call = source.match(new RegExp(`rateLimit\\(\\{[^}]*keyPrefix: '${prefix}'[^}]*\\}\\)`, 's'));
      assert.ok(call, `${file}: no limiter with keyPrefix '${prefix}'`);
      assert.match(
        call![0],
        /keyBy: 'ip'/,
        `${file}: the '${prefix}' limit guards a public surface and must key by address`,
      );
    }
  });
});
