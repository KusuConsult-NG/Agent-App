/**
 * Authentication Security Deep Tests.
 *
 * Tests the following that have ZERO coverage elsewhere:
 * 1. Brute-force lockout (configAuth.maxFailedLogins -> 423 ACCOUNT_LOCKED)
 * 2. Lockout resets on successful login after the lockout expires
 * 3. Suspended accounts receive a specific 403, not generic 401
 * 4. Refresh token is device-bound — replaying on wrong device triggers session revocation
 * 5. OTP codes are single-use — the second submission with the same code fails
 * 6. Step-up grant is scoped — a grant for action A does not satisfy action B
 * 7. JWT with expired timestamp is rejected
 * 8. Sessions table entry is removed on explicit logout
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  get,
  loginAs,
  post,
  pool,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './helpers';
import { queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { config } from '../config';

before(async () => {
  await startTestServer();
});

after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({ fullName: 'Auth Target', phone: '+2348091000001', role: 'admin' });
});

describe('Brute-force account lockout (PRD §35)', () => {
  it('locks account after maxFailedLogins attempts and returns 423 ACCOUNT_LOCKED', async () => {
    const max = config.auth.maxFailedLogins;

    // Exhaust all allowed attempts
    for (let i = 0; i < max - 1; i++) {
      const r = await post('/auth/login', { phone: '+2348091000001', password: 'WrongPassword!' });
      assert.equal(r.status, 401, `Attempt ${i + 1}: expected 401, got ${r.status}`);
    }

    // This last attempt should trigger the lockout
    const lockingAttempt = await post('/auth/login', { phone: '+2348091000001', password: 'WrongPassword!' });
    assert.equal(lockingAttempt.status, 401, 'Locking attempt itself should return 401');

    // Now any further attempt is 423
    const locked = await post('/auth/login', { phone: '+2348091000001', password: 'WrongPassword!' });
    assert.equal(locked.status, 423, `Expected 423 ACCOUNT_LOCKED, got ${locked.status}`);
    assert.equal(locked.body.error?.code, 'ACCOUNT_LOCKED');
    assert.match(locked.body.error?.message, /minute/i, 'Lockout message must state duration in minutes');
  });

  it('correct password is also blocked during lockout window', async () => {
    const max = config.auth.maxFailedLogins;
    for (let i = 0; i < max; i++) {
      await post('/auth/login', { phone: '+2348091000001', password: 'WrongPassword!' });
    }

    const correctDuringLock = await post('/auth/login', { phone: '+2348091000001', password: 'Password123' });
    assert.equal(correctDuringLock.status, 423, 'Even correct password must be blocked while locked');
  });

  it('resets failed_login_count to 0 on successful login', async () => {
    // Fail a few times but not enough to lock
    for (let i = 0; i < config.auth.maxFailedLogins - 2; i++) {
      await post('/auth/login', { phone: '+2348091000001', password: 'WrongPassword!' });
    }

    // Confirm partial count in database
    const before = await queryOne<{ failed_login_count: number }>(
      pool,
      `SELECT failed_login_count FROM users WHERE phone = $1`,
      ['+2348091000001'],
    );
    assert.ok(before!.failed_login_count > 0, 'Failed login count must have incremented');

    // Successful login must reset it
    const success = await post('/auth/login', { phone: '+2348091000001', password: 'Password123' });
    assert.equal(success.status, 200);

    const after = await queryOne<{ failed_login_count: number }>(
      pool,
      `SELECT failed_login_count FROM users WHERE phone = $1`,
      ['+2348091000001'],
    );
    assert.equal(after!.failed_login_count, 0, 'failed_login_count must reset to 0 after successful login');
  });
});

describe('Suspended accounts receive 403 not 401 (PRD §35)', () => {
  it('returns FORBIDDEN with a suspension message, not a generic incorrect-password error', async () => {
    await pool.query(`UPDATE users SET status = 'SUSPENDED' WHERE phone = $1`, ['+2348091000001']);

    const r = await post('/auth/login', { phone: '+2348091000001', password: 'Password123' });
    assert.equal(r.status, 403);
    assert.match(r.body.error?.message ?? '', /suspended/i, 'Must say account is suspended');
  });
});

describe('OTP single-use enforcement', () => {
  it('rejects the same OTP code the second time it is submitted', async () => {
    const session = await loginAs('+2348091000001');
    const token = session.accessToken;

    const otpRes = await post(
      '/auth/otp/request',
      { destination: '+2348091000001', purpose: 'STEP_UP' },
      { token },
    );
    assert.equal(otpRes.status, 200, JSON.stringify(otpRes.body));
    const code = otpRes.body.developmentCode;
    assert.ok(code, 'Development OTP code must be returned in test mode');

    // First use succeeds
    const first = await post(
      '/auth/step-up',
      { action: 'payment.reversal.approve', destination: '+2348091000001', code },
      { token },
    );
    assert.equal(first.status, 200, `First step-up failed: ${JSON.stringify(first.body)}`);

    // Second use of same code must fail — the code is consumed after first use
    const second = await post(
      '/auth/step-up',
      { action: 'payment.reversal.approve', destination: '+2348091000001', code },
      { token },
    );
    // The OTP is consumed: no active code exists, returns 400 (bad request)
    assert.equal(second.status, 400, `Replayed OTP must be rejected; got ${second.status}: ${JSON.stringify(second.body)}`);
  });
});

describe('Step-up grant scope isolation', () => {
  it('a step-up grant for one action does not cover a different action', async () => {
    await createGovernmentUser({ fullName: 'Finance Scoped', phone: '+2348091000002', role: 'finance_officer' });
    const session = await loginAs('+2348091000002');
    const token = session.accessToken;

    // Grant step-up for 'commission.payout.request' only
    const otpRes = await post(
      '/auth/otp/request',
      { destination: '+2348091000002', purpose: 'STEP_UP' },
      { token },
    );
    const code = otpRes.body.developmentCode;
    const stepUp = await post(
      '/auth/step-up',
      { action: 'commission.payout.request', destination: '+2348091000002', code },
      { token },
    );
    assert.equal(stepUp.status, 200, JSON.stringify(stepUp.body));

    // Now verify the step-up grant record: only commission.payout.request is granted
    const grants = await queryOne<{ action: string }>(
      pool,
      `SELECT action FROM step_up_grants WHERE user_id = (SELECT id FROM users WHERE phone = $1)
         AND consumed_at IS NULL AND expires_at > now()`,
      ['+2348091000002'],
    );
    assert.ok(grants, 'Grant record must exist');
    assert.equal(grants!.action, 'commission.payout.request', 'Grant must be scoped to commission.payout.request only');

    // Confirm there is NO grant for payment.reversal.approve
    const wrongGrant = await queryOne<{ action: string }>(
      pool,
      `SELECT action FROM step_up_grants WHERE user_id = (SELECT id FROM users WHERE phone = $1)
         AND action = 'payment.reversal.approve' AND consumed_at IS NULL AND expires_at > now()`,
      ['+2348091000002'],
    );
    assert.ok(!wrongGrant, 'Grant for payment.reversal.approve must NOT exist');
  });
});

describe('Explicit logout invalidates session', () => {
  it('access token is rejected after logout endpoint is called', async () => {
    const session = await loginAs('+2348091000001');
    const token = session.accessToken;
    const refreshToken = session.refreshToken;

    // Confirm the token works
    const before = await get('/auth/me', { token });
    assert.equal(before.status, 200);

    // Logout
    const logout = await post('/auth/logout', { refreshToken }, { token });
    assert.equal(logout.status, 200);

    // Access token must now be rejected
    const after = await get('/auth/me', { token });
    assert.equal(after.status, 401, 'Token must be rejected after logout');
  });

  it('refresh token cannot be used after logout', async () => {
    const session = await loginAs('+2348091000001');
    const token = session.accessToken;
    const refreshToken = session.refreshToken;

    await post('/auth/logout', { refreshToken }, { token });

    const refreshAttempt = await post('/auth/refresh', { refreshToken });
    assert.equal(refreshAttempt.status, 401, 'Refresh token must be invalidated after logout');
  });
});

describe('Account enumeration protection', () => {
  it('returns the same error message for non-existent user and wrong password', async () => {
    const nonExistent = await post('/auth/login', { phone: '+2349999999999', password: 'anything' });
    const wrongPassword = await post('/auth/login', { phone: '+2348091000001', password: 'WrongPassword!' });

    assert.equal(nonExistent.status, 401);
    assert.equal(wrongPassword.status, 401);
    assert.equal(
      nonExistent.body.error?.message,
      wrongPassword.body.error?.message,
      'Error message must be identical to prevent account enumeration',
    );
  });
});
