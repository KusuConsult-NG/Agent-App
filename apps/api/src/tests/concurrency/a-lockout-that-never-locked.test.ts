/**
 * Five wrong passwords at the same moment, and an account still open.
 *
 * `login` reads `failed_login_count`, adds one to it in JavaScript, and writes
 * the result back: `UPDATE users SET failed_login_count = $2`. The read takes
 * no lock and is not even in the transaction that writes.
 *
 * So N simultaneous wrong guesses all read the same count, all compute the
 * same `count + 1`, and all write it. The counter advances by one however many
 * attempts were made, and the threshold it is compared against is never
 * reached.
 *
 * WHAT THAT COSTS, bounded honestly
 *
 * `/auth` is rate limited at `AUTH_RATE_LIMIT_MAX` (10) requests per minute,
 * so this is not unlimited guessing. It is the difference between two
 * controls: with the counter working, an attacker gets five wrong passwords
 * EVER before the account locks for `lockoutMinutes`; with it not working,
 * they get ten per minute for as long as they care to keep going, because each
 * batch of ten advances the count by one and the lockout is never reached.
 *
 * The lockout is the control that makes a weak password survivable. A rate
 * limit paces an attacker; a lockout stops them.
 *
 * WHAT THESE ASSERT. That the count reflects the attempts made, and that the
 * account is locked once enough of them have been made at once — which is the
 * only thing an attacker's parallelism must not be able to avoid.
 */

import '../env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  pool,
  post,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from '../helpers';
import { queryOne } from '../../db/pool';
import { seedReferenceData } from '../../db/seed';
import { config } from '../../config';

const PHONE = '+2348089800001';
// The password `createGovernmentUser` sets.
const PASSWORD = 'Password123';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({
    fullName: 'Lockout Subject',
    phone: PHONE,
    role: 'revenue_officer',
  });
});

const guess = (attempt: number) =>
  post('/auth/login', { phone: PHONE, password: `WrongPassword${attempt}` });

async function account(): Promise<{ failed_login_count: number; locked_until: Date | null }> {
  const row = await queryOne<{ failed_login_count: number; locked_until: Date | null }>(
    pool,
    'SELECT failed_login_count, locked_until FROM users WHERE phone = $1',
    [PHONE],
  );
  assert.ok(row, 'the account is gone');
  return row!;
}

describe('wrong passwords tried at the same moment', () => {
  it('locks the account once the threshold is reached, however they arrive', async () => {
    const threshold = config.auth.maxFailedLogins;
    const attempts = await Promise.all(
      Array.from({ length: threshold }, (_, i) => guess(i)),
    );
    for (const attempt of attempts) {
      assert.ok(
        attempt.status === 401 || attempt.status === 423,
        `a wrong password answered ${attempt.status}: ${JSON.stringify(attempt.body)}`,
      );
    }

    const after = await account();
    assert.ok(
      after.locked_until !== null && after.locked_until.getTime() > Date.now(),
      `${threshold} wrong passwords were tried together and the account is still open ` +
        `(failed_login_count is ${after.failed_login_count}); an attacker who sends their ` +
        'guesses in parallel never reaches the threshold at all',
    );
  });

  it('counts every attempt below the threshold, not one of them', async () => {
    const below = config.auth.maxFailedLogins - 2;
    await Promise.all(Array.from({ length: below }, (_, i) => guess(i)));

    const after = await account();
    assert.equal(
      after.failed_login_count,
      below,
      'the counter advanced by less than the number of wrong passwords tried',
    );
    assert.equal(after.locked_until, null, 'the account locked before the threshold');
  });

  /*
   * And the state that must not change: the right password still works, and
   * still clears the count.
   */
  it('still signs in with the right password, and forgets the failures', async () => {
    await Promise.all([guess(1), guess(2)]);

    const signedIn = await post('/auth/login', { phone: PHONE, password: PASSWORD });
    assert.equal(signedIn.status, 200, JSON.stringify(signedIn.body));

    const after = await account();
    assert.equal(after.failed_login_count, 0, 'a successful sign-in has to clear the count');
  });
});
