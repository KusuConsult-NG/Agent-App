/**
 * Refresh token rotation.
 *
 * Rotation is the reason a stolen refresh token is described as "usable at most
 * once". It was not: the session was read, checked and revoked in three
 * separate statements, so refreshes arriving together each read the token as
 * live and each minted a session. Three concurrent requests reliably produced
 * three usable sessions from one token, and revoking one left the others
 * collecting revenue on an agent's behalf.
 *
 * These tests hold the guarantee the name claims — one exchange per token, and
 * a second presentation treated as the signal it is.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  loginAs,
  pool,
  post,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './helpers';
import { queryOne } from '../db/pool';

const PHONE = '+2348009000001';

before(async () => {
  await startTestServer();
});

after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await createGovernmentUser({
    fullName: 'Rotation Test Officer',
    phone: PHONE,
    role: 'revenue_officer',
  });
});

/** Present the same refresh token from `count` requests fired together. */
async function refreshConcurrently(refreshToken: string, count: number) {
  return Promise.all(
    Array.from({ length: count }, () => post('/auth/refresh', { refreshToken })),
  );
}

describe('A refresh token is exchanged exactly once', () => {
  it('lets one of several simultaneous refreshes through, not all of them', async () => {
    const session = await loginAs(PHONE);

    const responses = await refreshConcurrently(session.refreshToken, 4);
    const accepted = responses.filter((r) => r.status === 200);

    assert.equal(
      accepted.length,
      1,
      `expected one exchange, got ${accepted.length} — one token minted ${accepted.length} sessions`,
    );
    for (const refused of responses.filter((r) => r.status !== 200)) {
      assert.equal(refused.status, 401);
    }
  });

  it('leaves exactly one usable session behind', async () => {
    const session = await loginAs(PHONE);
    const responses = await refreshConcurrently(session.refreshToken, 4);

    const live = await queryOne<{ count: string }>(
      pool,
      `SELECT count(*)::text AS count FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE u.phone = $1 AND s.revoked_at IS NULL`,
      [PHONE],
    );
    assert.equal(live?.count, '1');

    // And the session that survived is the one whose tokens were handed back.
    const accepted = responses.find((r) => r.status === 200)!;
    const probe = await post('/auth/logout', undefined, {
      token: accepted.body.accessToken,
    });
    assert.equal(probe.status, 200, 'the accepted session should be the live one');
  });

  it('still refreshes normally when requests are not concurrent', async () => {
    const session = await loginAs(PHONE);

    let refreshToken = session.refreshToken;
    for (let round = 0; round < 3; round += 1) {
      const response = await post('/auth/refresh', { refreshToken });
      assert.equal(response.status, 200, `round ${round} should succeed`);
      assert.notEqual(response.body.refreshToken, refreshToken, 'the token must rotate');
      refreshToken = response.body.refreshToken;
    }
  });
});

describe('Presenting a token that was already exchanged', () => {
  it('is refused', async () => {
    const session = await loginAs(PHONE);
    const first = await post('/auth/refresh', { refreshToken: session.refreshToken });
    assert.equal(first.status, 200);

    const reuse = await post('/auth/refresh', { refreshToken: session.refreshToken });
    assert.equal(reuse.status, 401);
  });

  it('is recorded as reuse rather than as an expiry', async () => {
    const session = await loginAs(PHONE);
    await post('/auth/refresh', { refreshToken: session.refreshToken });
    await post('/auth/refresh', { refreshToken: session.refreshToken });

    const audit = await queryOne<{ new_value: { treatedAs: string } }>(
      pool,
      `SELECT new_value FROM audit_logs WHERE action = 'auth.refresh_token_reuse'
        ORDER BY created_at DESC LIMIT 1`,
    );
    assert.ok(audit, 'reuse must leave an audit record — it is the only theft signal there is');
    assert.equal(audit!.new_value.treatedAs, 'CLIENT_RETRY');
  });

  it('does not end the session when the exchange was moments ago', async () => {
    // A refresh whose reply is lost is retried with the only token the client
    // has. That is one request twice, not a compromised token, and an agent
    // mid-collection must not be signed out for it.
    const session = await loginAs(PHONE);
    const rotated = await post('/auth/refresh', { refreshToken: session.refreshToken });
    await post('/auth/refresh', { refreshToken: session.refreshToken });

    const stillWorks = await post('/auth/refresh', {
      refreshToken: rotated.body.refreshToken,
    });
    assert.equal(stillWorks.status, 200, 'the live session must survive a client retry');
  });

  it('ends the whole chain when the token resurfaces long after it was spent', async () => {
    const session = await loginAs(PHONE);

    // Two rotations, so there is a chain to walk rather than a single successor.
    const second = await post('/auth/refresh', { refreshToken: session.refreshToken });
    const third = await post('/auth/refresh', { refreshToken: second.body.refreshToken });
    assert.equal(third.status, 200);

    // Age the first exchange past the grace window. The alternative is a test
    // that sleeps for a minute.
    await pool.query(
      `UPDATE sessions SET revoked_at = now() - interval '10 minutes'
        WHERE revoked_reason = 'Rotated on refresh'`,
    );

    const reuse = await post('/auth/refresh', { refreshToken: session.refreshToken });
    assert.equal(reuse.status, 401);

    // The session the thief never saw is gone too — that is the point.
    const stillLive = await post('/auth/refresh', { refreshToken: third.body.refreshToken });
    assert.equal(
      stillLive.status,
      401,
      'a reused token must end the session that descended from it',
    );

    const audit = await queryOne<{ new_value: { treatedAs: string; sessionsRevoked: number } }>(
      pool,
      `SELECT new_value FROM audit_logs WHERE action = 'auth.refresh_token_reuse'
        ORDER BY created_at DESC LIMIT 1`,
    );
    assert.equal(audit?.new_value.treatedAs, 'TOKEN_COMPROMISE');
    assert.ok(
      (audit?.new_value.sessionsRevoked ?? 0) >= 1,
      'the audit record must say how much was revoked',
    );
  });
});
