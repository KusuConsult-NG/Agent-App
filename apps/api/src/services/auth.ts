/**
 * Authentication (PRD §35, §54; Addendum §22).
 *
 * Phone/password plus OTP, device binding for agents, and step-up grants for
 * high-risk actions. Refresh tokens and OTPs are stored only as hashes, and a
 * refresh rotates its token so a stolen one is usable at most once.
 */

import type { PoolClient } from 'pg';
import type { Role } from '@psirs/shared';
import { permissionsForRole } from '@psirs/shared';
import { pool, queryOne, withTransaction } from '../db/pool';
import { config } from '../config';
import {
  generateOtp,
  generateToken,
  hashPassword,
  sha256,
  verifyPassword,
} from '../lib/crypto';
import { AppError, forbidden, unauthorised, conflict, badRequest } from '../lib/errors';
import { issueAccessToken } from '../middleware/auth';
import { recordAudit } from './audit';
import { queueNotification } from './notifications';

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: {
    id: string;
    fullName: string;
    phone: string;
    email: string | null;
    role: Role;
    permissions: readonly string[];
    agentId?: string;
  };
}

async function createSession(params: {
  userId: string;
  role: Role;
  fullName: string;
  phone: string;
  email: string | null;
  agentId?: string | null;
  deviceId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  /**
   * Carried through from the session being rotated. Absent means this is a
   * fresh password sign-in, which is the only thing that may start a new
   * absolute clock — otherwise refreshing would reset the bound it exists to
   * impose.
   */
  absoluteExpiresAt?: Date | null;
  /**
   * Run inside the caller's transaction instead of opening one.
   *
   * Rotation has to revoke the old session and insert the new one atomically:
   * with two transactions, two refreshes presenting the same token could both
   * read it as live and both mint a session.
   */
  client?: PoolClient;
  // The session id is returned alongside the tokens rather than added to them:
  // `SessionTokens` is the response body, and rotation is the only caller that
  // needs the id.
}): Promise<{ sessionId: string; tokens: SessionTokens }> {
  const refreshToken = generateToken(48);
  const expiresAt = new Date(Date.now() + config.auth.refreshTokenTtlSeconds * 1000);
  const absoluteExpiresAt =
    params.absoluteExpiresAt ??
    new Date(Date.now() + config.auth.sessionAbsoluteTtlSeconds * 1000);

  const insert = async (client: PoolClient) => {
    const row = await queryOne<{ id: string }>(
      client,
      `INSERT INTO sessions
         (user_id, refresh_token_hash, device_id, ip_address, user_agent, expires_at,
          absolute_expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [
        params.userId,
        sha256(refreshToken),
        params.deviceId ?? null,
        params.ipAddress ?? null,
        params.userAgent ?? null,
        // The rolling expiry can never outlast the absolute one.
        expiresAt < absoluteExpiresAt ? expiresAt : absoluteExpiresAt,
        absoluteExpiresAt,
      ],
    );
    await client.query(
      'UPDATE users SET last_login_at = now(), failed_login_count = 0, locked_until = NULL WHERE id = $1',
      [params.userId],
    );
    return row!;
  };

  const session = params.client
    ? await insert(params.client)
    : await withTransaction(insert);

  const accessToken = issueAccessToken({
    sub: params.userId,
    role: params.role,
    sid: session.id,
    agentId: params.agentId ?? undefined,
    deviceId: params.deviceId ?? undefined,
  });

  return {
    sessionId: session.id,
    tokens: {
      accessToken,
      refreshToken,
      expiresIn: config.auth.accessTokenTtlSeconds,
      user: {
        id: params.userId,
        fullName: params.fullName,
        phone: params.phone,
        email: params.email,
        role: params.role,
        permissions: permissionsForRole(params.role),
        agentId: params.agentId ?? undefined,
      },
    },
  };
}

export async function login(params: {
  phone: string;
  password: string;
  deviceIdentifier?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<SessionTokens> {
  const user = await queryOne<{
    id: string;
    full_name: string;
    phone: string;
    email: string | null;
    password_hash: string | null;
    role: Role;
    status: string;
    failed_login_count: number;
    locked_until: Date | null;
  }>(
    pool,
    `SELECT id, full_name, phone, email, password_hash, role, status,
            failed_login_count, locked_until
       FROM users WHERE phone = $1`,
    [params.phone],
  );

  // A uniform failure message for "no such user" and "wrong password" so the
  // endpoint cannot be used to enumerate who holds an account.
  const genericFailure = unauthorised('Phone number or password is incorrect.');

  if (!user || !user.password_hash) throw genericFailure;

  if (user.locked_until && user.locked_until.getTime() > Date.now()) {
    const minutes = Math.ceil((user.locked_until.getTime() - Date.now()) / 60_000);
    throw new AppError({
      statusCode: 423,
      code: 'ACCOUNT_LOCKED',
      message: `Too many failed sign-in attempts. Try again in ${minutes} minute(s).`,
    });
  }

  const valid = await verifyPassword(params.password, user.password_hash);

  if (!valid) {
    await withTransaction(async (client) => {
      const attempts = user.failed_login_count + 1;
      const locked = attempts >= config.auth.maxFailedLogins;
      await client.query(
        `UPDATE users SET failed_login_count = $2,
                locked_until = CASE WHEN $3 THEN now() + make_interval(mins => $4) ELSE locked_until END
          WHERE id = $1`,
        [user.id, locked ? 0 : attempts, locked, config.auth.lockoutMinutes],
      );
      await recordAudit(client, {
        actorId: user.id,
        actorRole: user.role,
        action: 'auth.login_failed',
        entityType: 'user',
        entityId: user.id,
        result: 'FAILURE',
        ipAddress: params.ipAddress ?? null,
        newValue: { attempts, locked },
      });
    });
    throw genericFailure;
  }

  if (user.status !== 'ACTIVE') {
    throw forbidden(
      user.status === 'SUSPENDED'
        ? 'Your account has been suspended. Contact PSIRS support.'
        : 'Your account is not active.',
    );
  }

  const agent =
    user.role === 'agent'
      ? await queryOne<{ id: string }>(
          pool,
          'SELECT id FROM agents WHERE user_id = $1',
          [user.id],
        )
      : null;

  let deviceId: string | null = null;
  if (agent && params.deviceIdentifier) {
    const device = await queryOne<{ id: string; status: string }>(
      pool,
      'SELECT id, status FROM agent_devices WHERE agent_id = $1 AND device_identifier = $2',
      [agent.id, params.deviceIdentifier],
    );
    if (device?.status === 'REVOKED') {
      throw forbidden('This device has been revoked. Sign in from an approved device.');
    }
    deviceId = device?.id ?? null;
  }

  const { tokens } = await createSession({
    userId: user.id,
    role: user.role,
    fullName: user.full_name,
    phone: user.phone,
    email: user.email,
    agentId: agent?.id ?? null,
    deviceId,
    ipAddress: params.ipAddress ?? null,
    userAgent: params.userAgent ?? null,
  });

  await withTransaction((client) =>
    recordAudit(client, {
      actorId: user.id,
      actorRole: user.role,
      action: 'auth.login',
      entityType: 'user',
      entityId: user.id,
      ipAddress: params.ipAddress ?? null,
      deviceId,
    }),
  );

  return tokens;
}

/**
 * Rotate a refresh token; reuse of an old one is refused.
 *
 * Three things must hold before a new token is issued, and two of them exist
 * because the agent PWA now keeps its refresh token in `localStorage` so field
 * agents stay signed in across app restarts with no connectivity. That is the
 * right trade for the field — an agent whose phone restarts in a village must
 * be able to keep collecting — but it means a lost handset carries a real
 * credential, so the credential is bounded in the two ways that matter.
 *
 *   1. The token is unused and unexpired.       (as before)
 *   2. It is presented by the device it was     — a token lifted off a phone is
 *      issued to.                                 useless anywhere else.
 *   3. The session chain has not outlived its   — no amount of refreshing makes
 *      absolute expiry.                            possession permanent.
 *
 * A device mismatch revokes the session rather than merely refusing it. A
 * refresh token appearing on a different device is not a mistake a legitimate
 * agent makes — their device identifier is stable in the same storage as the
 * token — so it is treated as evidence that the token has been copied.
 *
 * "Unused" is enforced by locking the session row for the whole rotation. It
 * was previously read, checked and revoked in three separate statements, so
 * refreshes arriving together all read the token as live and all minted a
 * session: three concurrent requests reliably produced three usable sessions
 * from one token. Rotation is the control that makes a stolen refresh token
 * usable at most once, and without the lock it enforced nothing — every
 * concurrent copy of a token worked, and revoking one session left its siblings
 * collecting revenue.
 */
export async function refresh(params: {
  refreshToken: string;
  ipAddress?: string | null;
  /** From `x-device-id`; the identifier the caller is presenting. */
  deviceIdentifier?: string | null;
}): Promise<SessionTokens> {
  const tokenHash = sha256(params.refreshToken);

  // Refusing is not a no-op: a device mismatch revokes the session, a reused
  // token revokes what descended from it, and both leave an audit record. None
  // of that can happen inside the rotation transaction, because refusing means
  // throwing and throwing rolls the transaction back — the revocation and the
  // record would vanish with it. So the transaction decides, and the caller
  // acts on the decision once it has committed.
  const outcome = await withTransaction(async (client): Promise<RefreshOutcome> => {
    // FOR UPDATE OF s: a second refresh presenting the same token blocks here
    // until this one commits, and then sees the revoked row rather than the
    // live one it would have seen a moment earlier. The lock is taken on the
    // session alone — locking the joined users row would serialise every
    // refresh by the same person against unrelated writes.
    const session = await queryOne<{
      id: string;
      user_id: string;
      device_id: string | null;
      device_identifier: string | null;
      expires_at: Date;
      absolute_expires_at: Date | null;
      revoked_at: Date | null;
      revoked_reason: string | null;
      rotated_to_session_id: string | null;
      full_name: string;
      phone: string;
      email: string | null;
      role: Role;
      status: string;
    }>(
      client,
      `SELECT s.id, s.user_id, s.device_id, s.expires_at, s.absolute_expires_at, s.revoked_at,
              s.revoked_reason, s.rotated_to_session_id,
              d.device_identifier,
              u.full_name, u.phone, u.email, u.role, u.status
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         LEFT JOIN agent_devices d ON d.id = s.device_id
        WHERE s.refresh_token_hash = $1
          FOR UPDATE OF s`,
      [tokenHash],
    );

    if (!session) return { kind: 'EXPIRED' };

    // An already-rotated token is not an expired one. Either a client retried a
    // refresh whose response it never received, or a copy of the token is in
    // someone else's hands — and the second case has to end the session that
    // was minted from it, because the legitimate holder never saw it.
    if (session.revoked_at && session.revoked_reason === REASON_ROTATED) {
      return {
        kind: 'REUSED',
        session: {
          id: session.id,
          user_id: session.user_id,
          role: session.role,
          revoked_at: session.revoked_at,
          rotated_to_session_id: session.rotated_to_session_id,
        },
      };
    }

    if (session.revoked_at || session.expires_at.getTime() < Date.now()) {
      return { kind: 'EXPIRED' };
    }

    if (
      session.absolute_expires_at &&
      session.absolute_expires_at.getTime() < Date.now()
    ) {
      return { kind: 'ABSOLUTE_EXPIRY', sessionId: session.id };
    }

    // Only sessions that were bound to a device are checked against one. A
    // government user signing in from a browser has no device to bind to, and
    // requiring one would lock them out rather than protect anything.
    if (session.device_identifier && session.device_identifier !== params.deviceIdentifier) {
      return {
        kind: 'DEVICE_MISMATCH',
        session: { id: session.id, user_id: session.user_id, role: session.role },
      };
    }

    if (session.status !== 'ACTIVE') return { kind: 'INACTIVE' };

    await client.query(
      `UPDATE sessions SET revoked_at = now(), revoked_reason = $2 WHERE id = $1`,
      [session.id, REASON_ROTATED],
    );

    const agent =
      session.role === 'agent'
        ? await queryOne<{ id: string }>(client, 'SELECT id FROM agents WHERE user_id = $1', [
            session.user_id,
          ])
        : null;

    const { sessionId, tokens } = await createSession({
      userId: session.user_id,
      role: session.role,
      fullName: session.full_name,
      phone: session.phone,
      email: session.email,
      agentId: agent?.id ?? null,
      deviceId: session.device_id,
      ipAddress: params.ipAddress ?? null,
      // Carried, never recomputed: this is what stops rotation from resetting it.
      absoluteExpiresAt: session.absolute_expires_at,
      client,
    });

    // Recorded so a later presentation of this token can find what it became.
    await client.query('UPDATE sessions SET rotated_to_session_id = $2 WHERE id = $1', [
      session.id,
      sessionId,
    ]);

    return { kind: 'ROTATED', tokens };
  });

  switch (outcome.kind) {
    case 'ROTATED':
      return outcome.tokens;

    case 'EXPIRED':
      throw unauthorised('Your session has expired. Sign in again.');

    case 'INACTIVE':
      throw forbidden('Your account is not active.');

    case 'ABSOLUTE_EXPIRY':
      await pool.query(
        `UPDATE sessions SET revoked_at = now(), revoked_reason = 'Absolute session lifetime reached'
          WHERE id = $1 AND revoked_at IS NULL`,
        [outcome.sessionId],
      );
      throw unauthorised('For security, please sign in with your password again.');

    case 'DEVICE_MISMATCH':
      await withTransaction(async (client) => {
        await client.query(
          `UPDATE sessions SET revoked_at = now(),
                  revoked_reason = 'Refresh token presented from a different device'
            WHERE id = $1 AND revoked_at IS NULL`,
          [outcome.session.id],
        );
        await recordAudit(client, {
          actorId: outcome.session.user_id,
          actorRole: outcome.session.role,
          action: 'auth.refresh_device_mismatch',
          entityType: 'session',
          entityId: outcome.session.id,
          result: 'FAILURE',
          ipAddress: params.ipAddress ?? null,
          // The presented identifier is recorded; the token itself never is.
          newValue: { presentedDevice: params.deviceIdentifier ?? null },
        });
      });
      throw unauthorised('Your session has ended. Sign in again on this device.');

    case 'REUSED':
      await withTransaction((client) => handleReuse(client, outcome.session, params));
      throw unauthorised('Your session has ended. Sign in again.');
  }
}

/** What the locked rotation decided, acted on once the transaction has committed. */
type RefreshOutcome =
  | { kind: 'ROTATED'; tokens: SessionTokens }
  | { kind: 'EXPIRED' }
  | { kind: 'INACTIVE' }
  | { kind: 'ABSOLUTE_EXPIRY'; sessionId: string }
  | { kind: 'DEVICE_MISMATCH'; session: { id: string; user_id: string; role: Role } }
  | { kind: 'REUSED'; session: ReusedSession };

interface ReusedSession {
  id: string;
  user_id: string;
  role: Role;
  revoked_at: Date | null;
  rotated_to_session_id: string | null;
}

/** Exactly the string rotation writes, and the one reuse detection matches on. */
const REASON_ROTATED = 'Rotated on refresh';

/**
 * How long after a rotation a repeat presentation is treated as a client retry
 * rather than as a copied token.
 *
 * A field agent on a failing connection sends a refresh, the server rotates,
 * and the reply is lost. The app retries the only token it has. That is the
 * same request twice, seconds apart — not theft — and ending every session on
 * the account for it would strand an agent mid-collection. Beyond the window
 * there is no benign story: the token was exchanged long ago and the holder
 * kept a copy.
 */
const REUSE_GRACE_MS = 60_000;

async function handleReuse(
  client: PoolClient,
  session: ReusedSession,
  params: { ipAddress?: string | null; deviceIdentifier?: string | null },
): Promise<void> {
  const rotatedAgoMs = Date.now() - (session.revoked_at?.getTime() ?? 0);
  const withinGrace = rotatedAgoMs <= REUSE_GRACE_MS;

  // Walk the chain forward. Each rotation links to its successor, so the live
  // session is at the end however many refreshes happened in between.
  const descendants: string[] = [];
  if (!withinGrace) {
    let next = session.rotated_to_session_id;
    while (next && !descendants.includes(next)) {
      descendants.push(next);
      const row = await queryOne<{ rotated_to_session_id: string | null }>(
        client,
        'SELECT rotated_to_session_id FROM sessions WHERE id = $1',
        [next],
      );
      next = row?.rotated_to_session_id ?? null;
    }
    if (descendants.length > 0) {
      await client.query(
        `UPDATE sessions SET revoked_at = now(), revoked_reason = 'Refresh token reuse detected'
          WHERE id = ANY($1::uuid[]) AND revoked_at IS NULL`,
        [descendants],
      );
    }
  }

  await recordAudit(client, {
    actorId: session.user_id,
    actorRole: session.role,
    action: 'auth.refresh_token_reuse',
    entityType: 'session',
    entityId: session.id,
    result: 'FAILURE',
    ipAddress: params.ipAddress ?? null,
    newValue: {
      presentedDevice: params.deviceIdentifier ?? null,
      rotatedSecondsAgo: Math.round(rotatedAgoMs / 1000),
      // Within the grace window nothing is revoked, so the record has to say
      // so — an audit trail that reports a revocation that did not happen is
      // worse than none.
      treatedAs: withinGrace ? 'CLIENT_RETRY' : 'TOKEN_COMPROMISE',
      sessionsRevoked: descendants.length,
    },
  });
}

export async function logout(params: { sessionId: string; userId: string }): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE sessions SET revoked_at = now(), revoked_reason = 'User signed out'
        WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [params.sessionId, params.userId],
    );
    await recordAudit(client, {
      actorId: params.userId,
      action: 'auth.logout',
      entityType: 'session',
      entityId: params.sessionId,
    });
  });
}

/** Revoke every session for a user — used on suspension and by "sign out everywhere". */
export async function revokeAllSessions(userId: string, reason: string): Promise<number> {
  const result = await pool.query(
    `UPDATE sessions SET revoked_at = now(), revoked_reason = $2
      WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId, reason],
  );
  return result.rowCount ?? 0;
}

export async function requestOtp(params: {
  destination: string;
  purpose: 'LOGIN' | 'REGISTRATION' | 'STEP_UP' | 'PASSWORD_RESET' | 'REFEREE_VERIFY';
  userId?: string | null;
}): Promise<{
  sent: boolean;
  expiresInSeconds: number;
  /**
   * How many digits the code has.
   *
   * `OTP_LENGTH` is configuration, so a client that hardcodes six is wrong the
   * moment it is set to anything else — and wrong in the worst direction,
   * enabling Confirm on a code the caller has not finished typing. Saying it
   * here lets the applications enforce the real rule rather than a guess at it.
   */
  codeLength: number;
  developmentCode?: string;
}> {
  const code = generateOtp();
  const expiresAt = new Date(Date.now() + config.auth.otpTtlSeconds * 1000);

  await withTransaction(async (client) => {
    // Supersede outstanding codes so only the newest is usable.
    await client.query(
      `UPDATE otp_codes SET consumed_at = now()
        WHERE destination = $1 AND purpose = $2 AND consumed_at IS NULL`,
      [params.destination, params.purpose],
    );

    await client.query(
      `INSERT INTO otp_codes (user_id, destination, purpose, code_hash, expires_at)
       VALUES ($1,$2,$3,$4,$5)`,
      [params.userId ?? null, params.destination, params.purpose, sha256(code), expiresAt],
    );

    await queueNotification(client, {
      event: 'SECURITY_ALERT',
      recipientOverride: params.destination,
      channels: ['SMS'],
      variables: { code, purpose: params.purpose, minutes: String(config.auth.otpTtlSeconds / 60) },
    });
  });

  return {
    sent: true,
    expiresInSeconds: config.auth.otpTtlSeconds,
    codeLength: config.auth.otpLength,
    // Development convenience only; never returned when a real SMS provider is
    // configured, and config.ts refuses to start in production with 'mock'.
    ...(config.notifications.smsProvider === 'mock' ? { developmentCode: code } : {}),
  };
}

export async function verifyOtp(params: {
  destination: string;
  purpose: 'LOGIN' | 'REGISTRATION' | 'STEP_UP' | 'PASSWORD_RESET' | 'REFEREE_VERIFY';
  code: string;
}): Promise<{ userId: string | null }> {
  return withTransaction(async (client) => {
    const otp = await queryOne<{
      id: string;
      user_id: string | null;
      code_hash: string;
      attempts: number;
      max_attempts: number;
      expires_at: Date;
    }>(
      client,
      `SELECT id, user_id, code_hash, attempts, max_attempts, expires_at
         FROM otp_codes
        WHERE destination = $1 AND purpose = $2 AND consumed_at IS NULL
        ORDER BY created_at DESC LIMIT 1
        FOR UPDATE`,
      [params.destination, params.purpose],
    );

    if (!otp) {
      throw badRequest('No verification code was requested for this number, or it has already been used.');
    }
    if (otp.expires_at.getTime() < Date.now()) {
      throw badRequest('That verification code has expired. Request a new one.');
    }
    if (otp.attempts >= otp.max_attempts) {
      await client.query('UPDATE otp_codes SET consumed_at = now() WHERE id = $1', [otp.id]);
      throw badRequest('Too many incorrect attempts. Request a new verification code.');
    }

    if (sha256(params.code) !== otp.code_hash) {
      await client.query('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1', [otp.id]);
      throw badRequest(
        `That code is not correct. You have ${otp.max_attempts - otp.attempts - 1} attempt(s) left.`,
      );
    }

    await client.query('UPDATE otp_codes SET consumed_at = now() WHERE id = $1', [otp.id]);
    return { userId: otp.user_id };
  });
}

/** Grant a step-up window after successful OTP verification (PRD §35). */
export async function grantStepUp(params: {
  userId: string;
  action: string;
  destination: string;
  code: string;
}): Promise<{ expiresAt: Date }> {
  await verifyOtp({ destination: params.destination, purpose: 'STEP_UP', code: params.code });

  const expiresAt = new Date(Date.now() + config.auth.stepUpTtlSeconds * 1000);

  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO step_up_grants (user_id, action, expires_at) VALUES ($1,$2,$3)`,
      [params.userId, params.action, expiresAt],
    );
    await recordAudit(client, {
      actorId: params.userId,
      action: 'auth.step_up_granted',
      entityType: 'user',
      entityId: params.userId,
      newValue: { action: params.action },
    });
  });

  return { expiresAt };
}
