/**
 * The redactor has two ways to be wrong, and only one of them is loud.
 *
 * Logging a secret is the failure everybody designs for, and `logger.ts` does:
 * any field whose key contains `token`, `otp`, `nin`, `code` and a dozen more
 * is replaced before it reaches the transport, whatever the call site passed.
 *
 * The other way is silent. `code` matched the key spelled exactly `code`,
 * which is what the error handler passes for an `AppError` code and what the
 * pool passes for a SQLSTATE — so every failed request arrived at the
 * aggregator with the one field that says *why* replaced by `[redacted]`, and
 * nothing distinguished that from a credential being properly protected.
 *
 * Both directions are pinned here, because fixing the second by loosening the
 * rule would quietly undo the first.
 */

import './env';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { log } from '../lib/logger';

/** Run a log call and give back the one line it wrote. */
function capture(run: () => void): string {
  const lines: string[] = [];
  const original = { log: console.log, warn: console.warn, error: console.error };
  const collect = (line: unknown) => void lines.push(String(line));
  console.log = collect;
  console.warn = collect;
  console.error = collect;
  try {
    run();
  } finally {
    Object.assign(console, original);
  }
  assert.equal(lines.length, 1, 'expected exactly one line');
  return lines[0]!;
}

describe('what a log line keeps', () => {
  it('keeps the code that says why a request failed', () => {
    const line = capture(() =>
      log.error('request failed', {
        requestId: 'req-1',
        component: 'http',
        errorCode: 'PAYMENT_UNCONFIRMED',
        path: '/payments/x',
      }),
    );
    assert.match(line, /PAYMENT_UNCONFIRMED/, 'an operator cannot diagnose what they cannot see');
    assert.doesNotMatch(line, /redacted/);
  });

  it('keeps the SQLSTATE a retried transaction collided on', () => {
    const line = capture(() =>
      log.warn('transaction conflict, retrying', { component: 'db', attempt: 1, sqlState: '40001' }),
    );
    assert.match(line, /40001/);
    assert.doesNotMatch(line, /redacted/);
  });
});

describe('what a log line drops', () => {
  /*
   * The reason `code` is on the list at all, and why the fix above is an
   * exception for one named key rather than a narrower rule. A collection code
   * is what lets somebody collect goods in a beneficiary's name.
   */
  it('still drops a secret whose key merely contains a listed word', () => {
    for (const [key, value] of [
      ['code', 'PLATEAU-7731'],
      ['collectionCode', 'PLATEAU-7731'],
      ['otpCode', '481920'],
      ['identityNumber', '11122233344'],
      ['newPassword', 'hunter2'],
      ['accessToken', 'ey.J.hb'],
      ['nin', '11122233344'],
    ] as const) {
      const line = capture(() => log.info('probe', { [key]: value }));
      assert.doesNotMatch(line, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${key} reached the log`);
      assert.match(line, /redacted/, `${key} should have been redacted`);
    }
  });

  it('drops the fields of an error rather than serialising the whole thing', () => {
    // A pg error carries `detail` — "Key (phone)=(+2348012345678) already
    // exists" — and that is a citizen's phone number. Only name, message and
    // stack survive, which is what keeps it out.
    const error = Object.assign(new Error('duplicate key value violates unique constraint'), {
      detail: 'Key (phone)=(+2348012345678) already exists.',
      code: '23505',
    });
    const line = capture(() => log.error('insert failed', { component: 'db', error }));
    assert.doesNotMatch(line, /2348012345678/, "a citizen's phone number reached the log");
    assert.match(line, /duplicate key value/, 'and the message itself is still useful');
  });
});
