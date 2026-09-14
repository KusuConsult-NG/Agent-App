/**
 * An idempotency key belongs to the caller who minted it.
 *
 * `hashRequest` covered path, method and body. The lookup is `WHERE scope = $1
 * AND idempotency_key = $2`, the uniqueness is `(scope, idempotency_key)`, and
 * `user_id` is written on insert and compared against nothing. So two callers
 * presenting the same key with a byte-identical body met a matching hash, and
 * the second was handed the first's stored response without executing
 * anything.
 *
 * NOBODY COULD REACH THAT, AND THAT IS THE POINT. Three gates stand in front
 * of the middleware on all four protected routes — `authenticate`,
 * `requirePermission` (every one of `payment.initiate`, `assessment.create`,
 * `taxpayer.create` and `vehicle.renew` is held by the `agent` role alone) and
 * `requireActiveAgent()` — so it takes two separately cleared, active agents.
 * One must then guess the other's key, which the agent application mints as
 * `<scope>-<crypto.randomUUID()>`, and reproduce their request body byte for
 * byte.
 *
 * The isolation was therefore a property of one client's key generator and of
 * three unrelated gates, rather than of this middleware. A future caller
 * deriving a key from something natural — an invoice id, a device counter, a
 * draft sequence — would have lost it silently, with nothing here to notice.
 * Including the caller makes it hold by construction.
 *
 * WHAT THIS TESTS, AND WHAT IT DOES NOT. It exercises the fingerprint
 * directly, because reaching the middleware over HTTP as a second caller means
 * standing up a second cleared agent, which is a large fixture for a path
 * three gates already close. So this proves the property that changed — the
 * caller is part of the request's identity — and the existing suite proves the
 * half that must NOT change: a caller retrying their own key still replays.
 */

import './env';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Request } from 'express';
import { hashRequest } from '../middleware/idempotency';

/** Just enough of a request for the fingerprint, which reads four fields. */
function asRequest(path: string, method: string, body: unknown, userId: string | null): Request {
  return {
    path,
    method,
    body,
    ...(userId === null ? {} : { auth: { userId } }),
  } as unknown as Request;
}

const BODY = { taxpayerType: 'INDIVIDUAL', firstName: 'Key', lastName: 'Subject' };

describe('the fingerprint an idempotency key is matched against', () => {
  it('separates two callers sending byte-identical requests', () => {
    const mine = asRequest('/taxpayers', 'POST', BODY, 'agent-one');
    const theirs = asRequest('/taxpayers', 'POST', BODY, 'agent-two');

    assert.notEqual(
      hashRequest(mine),
      hashRequest(theirs),
      'two callers sending the same body must not share a stored response',
    );
  });

  it('still replays the same caller retrying the same request', () => {
    const first = asRequest('/taxpayers', 'POST', BODY, 'agent-one');
    const retry = asRequest('/taxpayers', 'POST', { ...BODY }, 'agent-one');

    assert.equal(
      hashRequest(first),
      hashRequest(retry),
      'a retry is the same request and must still match, or every retry becomes a refusal',
    );
  });

  it('still refuses the same caller reusing a key for a different body', () => {
    const first = asRequest('/taxpayers', 'POST', BODY, 'agent-one');
    const different = asRequest('/taxpayers', 'POST', { ...BODY, lastName: 'Other' }, 'agent-one');

    assert.notEqual(hashRequest(first), hashRequest(different));
  });

  it('treats an unauthenticated caller as its own identity rather than throwing', () => {
    const anonymous = asRequest('/taxpayers', 'POST', BODY, null);
    assert.equal(typeof hashRequest(anonymous), 'string');
    assert.notEqual(hashRequest(anonymous), hashRequest(asRequest('/taxpayers', 'POST', BODY, 'agent-one')));
  });
});
