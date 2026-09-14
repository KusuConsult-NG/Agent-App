/**
 * The comparison a presented credential gets.
 *
 * `safeEqual` describes itself as being "for OTPs, signatures and verification
 * codes". It was called from one place — `verifyWebhookSignature` — and of the
 * three things it names, signatures were the only one it was put to.
 *
 * The two that were not:
 *
 *   `remita.ts` compared its notification secret with `presented !==
 *   expectedSecret`. That endpoint is a public callback with no attempt
 *   limiting, so a caller may present guesses in a loop and time them, and a
 *   short-circuiting compare returns sooner the earlier it meets a wrong byte.
 *   This is the one that mattered.
 *
 *   `auth.ts` compared `sha256(params.code) !== otp.code_hash`. Both sides are
 *   hex digests, so a timing difference exposes bytes of the stored hash
 *   rather than of the code, and `max_attempts` bounds guessing anyway. Close
 *   to worthless as a leak; changed because the helper's own comment names
 *   OTPs, and a control that names a use it is not put to is the shape this
 *   repository keeps finding.
 *
 * WHY THIS FILE EXISTS AT ALL. Swapping `!==` for `!safeEqual(...)` is
 * observationally identical when the helper is correct, so no test of those
 * two call sites could tell the versions apart — reverting either changes no
 * result, only a timing profile, and a test that asserted on timing would be
 * flaky by construction. What the substitution does depend on is `safeEqual`
 * itself, which nothing exercised. A helper that returned true on a length
 * mismatch would have turned two comparisons into open doors, quietly. So the
 * guard goes where the risk actually is.
 */

import './env';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { safeEqual, sha256 } from '../lib/crypto';

describe('the constant-time comparison three credentials now rest on', () => {
  it('accepts a credential that matches', () => {
    assert.equal(safeEqual('a-shared-secret', 'a-shared-secret'), true);
  });

  it('refuses one that differs in the last byte', () => {
    assert.equal(safeEqual('a-shared-secret', 'a-shared-secrat'), false);
  });

  it('refuses one that differs in the first byte', () => {
    assert.equal(safeEqual('a-shared-secret', 'b-shared-secret'), false);
  });

  /**
   * The failure that would have mattered.
   *
   * `timingSafeEqual` throws on buffers of different lengths, so `safeEqual`
   * returns false before reaching it. A version that returned true instead —
   * or that let the throw escape — would have made a wrong-length secret
   * either accepted or a 500 on a public endpoint.
   */
  it('refuses a shorter credential rather than throwing', () => {
    assert.equal(safeEqual('a-shared-secret', 'a-shared'), false);
  });

  it('refuses a longer credential rather than throwing', () => {
    assert.equal(safeEqual('a-shared', 'a-shared-secret-and-more'), false);
  });

  it('refuses an empty credential against a real one', () => {
    assert.equal(safeEqual('', 'a-shared-secret'), false);
  });

  it('compares hex digests the way the OTP door now does', () => {
    assert.equal(safeEqual(sha256('123456'), sha256('123456')), true);
    assert.equal(safeEqual(sha256('123456'), sha256('123457')), false);
  });
});
