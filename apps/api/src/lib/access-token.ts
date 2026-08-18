/**
 * Access token minting and inspection.
 *
 * The secret, issuer and audience live here so that everything which touches a
 * token agrees on them. Two callers need tokens for quite different reasons:
 * `authenticate`, which must know exactly why a bad token is bad so it can
 * tell the holder whether to refresh or sign in again, and the rate limiter,
 * which only needs to know whose budget to spend and must not do any I/O to
 * find out.
 */

import jwt from 'jsonwebtoken';
import { config } from '../config';

export interface AccessTokenPayload {
  sub: string;
  role: string;
  sid: string;
  agentId?: string;
  deviceId?: string;
}

const CLAIMS = {
  issuer: 'psirs-revenue-platform',
  audience: 'psirs-clients',
} as const;

export function issueAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, config.auth.jwtSecret, {
    expiresIn: config.auth.accessTokenTtlSeconds,
    ...CLAIMS,
  });
}

/** Verifies signature and claims. Throws `jsonwebtoken` errors for the caller to classify. */
export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, config.auth.jwtSecret, CLAIMS) as AccessTokenPayload;
}

/**
 * The subject of a valid bearer token, or null for anything else.
 *
 * Signature-only: no session lookup, no database. That is deliberate. The rate
 * limiter runs before authentication precisely so that a flood of junk costs
 * nothing but a signature check, and giving it a query to make would turn the
 * limiter into the amplifier it exists to prevent. Because the signature is
 * still checked, a caller cannot claim someone else's budget or mint an
 * endless supply of fresh ones — anything unverifiable returns null and falls
 * back to the address it came from.
 *
 * An expired token also returns null. Its holder is about to be turned away by
 * `authenticate` anyway, and metering those attempts by address is the right
 * behaviour for a stale client retrying in a loop.
 */
export function subjectFromBearer(header: string | undefined): string | null {
  if (!header?.startsWith('Bearer ')) return null;
  try {
    const subject = verifyAccessToken(header.slice(7)).sub;
    return typeof subject === 'string' && subject.length > 0 ? subject : null;
  } catch {
    return null;
  }
}
