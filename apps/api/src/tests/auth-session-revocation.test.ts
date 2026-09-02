/**
 * Signing out of every device, and single-use OTP codes.
 *
 * Both routes were found by enumerating the API surface rather than reading
 * tests: of 141 declared routes, 14 were exercised by nothing. (An early pass
 * put that at 24, but the script behind it mapped each file to its first
 * router, so every route on `supportRouter` — declared alongside
 * `governmentRouter` in one file — was attributed to the wrong mount.) Most of
 * the fourteen are reference or maintenance endpoints. These two are not.
 *
 *   POST /auth/logout-all   what a person uses when they believe their account
 *                           is compromised. If it silently revokes nothing, the
 *                           user has been told they are safe and is not. That
 *                           is worse than having no such button, because they
 *                           stop looking for the attacker.
 *
 *   POST /auth/otp/verify   a separate route from /auth/step-up, which the
 *                           helpers do cover. Nothing exercised this one, and a
 *                           replayable OTP is a bypass of the control that
 *                           protects rate changes, reversals and payouts.
 *
 * `revokeAllSessions` is used elsewhere and works. What was untested is the
 * route: that it is authenticated, that it revokes every session rather than
 * the caller's, and that the revocation actually takes effect on the next
 * request rather than being recorded and ignored.
 */

import './env';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  get,
  loginAs,
  post,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './helpers';

const PHONE = '+2348088000001';
const PASSWORD = 'Password123';

before(async () => {
  await resetDatabase();
  await startTestServer();
  await createGovernmentUser({ fullName: 'Session Fixture', phone: PHONE, role: 'revenue_officer' });
});

after(async () => {
  await stopTestServer();
});

// ===========================================================================
describe('Signing out of every device', () => {
  it('refuses an unauthenticated caller', async () => {
    const response = await post('/auth/logout-all');
    assert.equal(
      response.status,
      401,
      'anyone could otherwise sign a user out of everything by knowing nothing at all',
    );
  });

  /**
   * The property the button exists for.
   *
   * Three devices, one compromise, one press: every other session dies. A
   * revocation that only ends the caller's own session would leave the attacker
   * signed in while telling the victim they had dealt with it.
   */
  it('ends sessions on other devices, not just the caller\'s', async () => {
    const phone = await freshUser();

    const first = await loginAs(phone, PASSWORD, 'device-one');
    const second = await loginAs(phone, PASSWORD, 'device-two');
    const third = await loginAs(phone, PASSWORD, 'device-three');

    // All three work before the revocation, or the test proves nothing.
    for (const [name, session] of [
      ['first', first],
      ['second', second],
      ['third', third],
    ] as const) {
      const check = await get('/auth/me', { token: session.accessToken });
      assert.equal(check.status, 200, `${name} session should be usable before revocation`);
    }

    const revoked = await post('/auth/logout-all', undefined, { token: third.accessToken });
    assert.equal(revoked.status, 200);
    assert.ok(
      (revoked.body as { sessionsRevoked: number }).sessionsRevoked >= 3,
      `expected at least the three sessions to be revoked, got ${JSON.stringify(revoked.body)}`,
    );

    for (const [name, session] of [
      ['first', first],
      ['second', second],
      ['third', third],
    ] as const) {
      const after_ = await get('/auth/me', { token: session.accessToken });
      assert.equal(
        after_.status,
        401,
        `${name} session still worked after logout-all — the user was told they were safe and is not`,
      );
    }
  });

  /**
   * Revocation must be effective, not merely recorded.
   *
   * A revoked session that still passes because the access token has not
   * expired yet is the difference between a security control and a log entry.
   */
  it('takes effect on the very next request', async () => {
    const phone = await freshUser();
    const session = await loginAs(phone, PASSWORD, 'device-solo');

    await post('/auth/logout-all', undefined, { token: session.accessToken });

    const immediately = await get('/auth/me', { token: session.accessToken });
    assert.equal(immediately.status, 401, 'the revoked token was still accepted');
  });

  it('cannot be replayed to revoke someone else', async () => {
    const victimPhone = await freshUser();
    const attackerPhone = await freshUser();

    const victim = await loginAs(victimPhone, PASSWORD, 'victim-device');
    const attacker = await loginAs(attackerPhone, PASSWORD, 'attacker-device');

    await post('/auth/logout-all', undefined, { token: attacker.accessToken });

    const stillFine = await get('/auth/me', { token: victim.accessToken });
    assert.equal(
      stillFine.status,
      200,
      'one user signing out of all devices ended another user\'s session',
    );
  });
});

// ===========================================================================
describe('One-time codes are one-time', () => {
  it('accepts a code once and refuses the replay', async () => {
    const phone = await freshUser();
    const session = await loginAs(phone, PASSWORD, 'otp-device');

    const requested = await post(
      '/auth/otp/request',
      { destination: phone, purpose: 'STEP_UP' },
      { token: session.accessToken },
    );
    assert.equal(requested.status, 200);
    const code = (requested.body as { developmentCode?: string }).developmentCode;
    assert.ok(code, 'the development build should return the code so tests can use it');

    const first = await post('/auth/otp/verify', {
      destination: phone,
      purpose: 'STEP_UP',
      code,
    });
    assert.equal(first.status, 200, `first verification should succeed: ${JSON.stringify(first.body)}`);

    const replay = await post('/auth/otp/verify', {
      destination: phone,
      purpose: 'STEP_UP',
      code,
    });
    assert.notEqual(
      replay.status,
      200,
      'the same code verified twice — a captured code could be reused against a step-up action',
    );
  });

  it('refuses a code that was never issued', async () => {
    const phone = await freshUser();
    const response = await post('/auth/otp/verify', {
      destination: phone,
      purpose: 'STEP_UP',
      code: '000000',
    });
    assert.notEqual(response.status, 200, 'a guessed code was accepted');
  });

  /**
   * A code issued for one purpose must not satisfy another.
   *
   * Otherwise a login code — the easiest to obtain, since anyone can ask for
   * one — would satisfy the step-up that guards a payment reversal.
   */
  it('refuses a code issued for a different purpose', async () => {
    const phone = await freshUser();
    const session = await loginAs(phone, PASSWORD, 'purpose-device');

    const requested = await post(
      '/auth/otp/request',
      { destination: phone, purpose: 'LOGIN' },
      { token: session.accessToken },
    );
    const code = (requested.body as { developmentCode?: string }).developmentCode;
    assert.ok(code);

    const crossed = await post('/auth/otp/verify', {
      destination: phone,
      purpose: 'STEP_UP',
      code,
    });
    assert.notEqual(
      crossed.status,
      200,
      'a LOGIN code satisfied a STEP_UP check — the control guarding reversals and payouts',
    );
  });
});

// ---------------------------------------------------------------------------
let userCount = 0;

/** A user this file owns, so revoking its sessions cannot disturb another test. */
async function freshUser(): Promise<string> {
  userCount += 1;
  const phone = `+23480880${String(10_000 + userCount).slice(0, 5)}`;
  // createGovernmentUser fixes the password at PASSWORD; it takes no password
  // argument, so this file uses the same constant when signing in.
  await createGovernmentUser({ fullName: `Session Fixture ${userCount}`, phone, role: 'revenue_officer' });
  return phone;
}
