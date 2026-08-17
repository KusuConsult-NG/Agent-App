/**
 * Authentication (PRD §35, §54; Addendum §22).
 *
 * Phone/password plus OTP, device binding for agents, and step-up grants for
 * high-risk actions. Refresh tokens and OTPs are stored only as hashes, and a
 * refresh rotates its token so a stolen one is usable at most once.
 */

import type { Role } from '@psirs/shared';
import { permissionsForRole } from '@psirs/shared';
import { queryOne, withTransaction } from '../db/pool';
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
}): Promise<SessionTokens> {
  const refreshToken = generateToken(48);
  const expiresAt = new Date(Date.now() + config.auth.refreshTokenTtlSeconds * 1000);

  const session = await withTransaction(async (client) => {
    const row = await queryOne<{ id: string }>(
      client,
      `INSERT INTO sessions
         (user_id, refresh_token_hash, device_id, ip_address, user_agent, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [
        params.userId,
        sha256(refreshToken),
        params.deviceId ?? null,
        params.ipAddress ?? null,
        params.userAgent ?? null,
        expiresAt,
      ],
    );
    await client.query(
      'UPDATE users SET last_login_at = now(), failed_login_count = 0, locked_until = NULL WHERE id = $1',
      [params.userId],
    );
    return row!;
  });

  const accessToken = issueAccessToken({
    sub: params.userId,
    role: params.role,
    sid: session.id,
    agentId: params.agentId ?? undefined,
    deviceId: params.deviceId ?? undefined,
  });

  return {
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
    (await import('../db/pool')).pool,
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
          (await import('../db/pool')).pool,
          'SELECT id FROM agents WHERE user_id = $1',
          [user.id],
        )
      : null;

  let deviceId: string | null = null;
  if (agent && params.deviceIdentifier) {
    const device = await queryOne<{ id: string; status: string }>(
      (await import('../db/pool')).pool,
      'SELECT id, status FROM agent_devices WHERE agent_id = $1 AND device_identifier = $2',
      [agent.id, params.deviceIdentifier],
    );
    if (device?.status === 'REVOKED') {
      throw forbidden('This device has been revoked. Sign in from an approved device.');
    }
    deviceId = device?.id ?? null;
  }

  const tokens = await createSession({
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

/** Rotate a refresh token; reuse of an old one is refused. */
export async function refresh(params: {
  refreshToken: string;
  ipAddress?: string | null;
}): Promise<SessionTokens> {
  const { pool } = await import('../db/pool');

  const session = await queryOne<{
    id: string;
    user_id: string;
    device_id: string | null;
    expires_at: Date;
    revoked_at: Date | null;
    full_name: string;
    phone: string;
    email: string | null;
    role: Role;
    status: string;
  }>(
    pool,
    `SELECT s.id, s.user_id, s.device_id, s.expires_at, s.revoked_at,
            u.full_name, u.phone, u.email, u.role, u.status
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.refresh_token_hash = $1`,
    [sha256(params.refreshToken)],
  );

  if (!session || session.revoked_at || session.expires_at.getTime() < Date.now()) {
    throw unauthorised('Your session has expired. Sign in again.');
  }
  if (session.status !== 'ACTIVE') {
    throw forbidden('Your account is not active.');
  }

  await pool.query(
    `UPDATE sessions SET revoked_at = now(), revoked_reason = 'Rotated on refresh' WHERE id = $1`,
    [session.id],
  );

  const agent =
    session.role === 'agent'
      ? await queryOne<{ id: string }>(pool, 'SELECT id FROM agents WHERE user_id = $1', [
          session.user_id,
        ])
      : null;

  return createSession({
    userId: session.user_id,
    role: session.role,
    fullName: session.full_name,
    phone: session.phone,
    email: session.email,
    agentId: agent?.id ?? null,
    deviceId: session.device_id,
    ipAddress: params.ipAddress ?? null,
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
  const { pool } = await import('../db/pool');
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
}): Promise<{ sent: boolean; expiresInSeconds: number; developmentCode?: string }> {
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
