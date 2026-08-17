/**
 * Authentication and authorisation.
 *
 * Three separate gates, deliberately not collapsed into one:
 *   authenticate()        — is this a valid, unrevoked session?
 *   requirePermission()   — does the role carry this permission? (PRD §36)
 *   requireActiveAgent()  — is this agent cleared to touch revenue?
 *                           (Addendum §14, §26, §50)
 *
 * The third exists because a signed-in agent is not the same thing as a cleared
 * agent. An applicant who has an account but no referee clearance authenticates
 * fine and is still refused every revenue endpoint — the check is here in the
 * backend, not in whether the PWA renders a button (Addendum §14).
 */

import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import {
  activationBlockers,
  permissionsForRole,
  roleHasPermission,
  type AgentClearanceFlags,
  type Permission,
  type Role,
  type StepUpAction,
} from '@psirs/shared';
import { config } from '../config';
import { pool, queryOne } from '../db/pool';
import { forbidden, notCleared, unauthorised, AppError } from '../lib/errors';

interface AccessTokenPayload {
  sub: string;
  role: Role;
  sid: string;
  agentId?: string;
  taxpayerId?: string;
  deviceId?: string;
}

export function issueAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, config.auth.jwtSecret, {
    expiresIn: config.auth.accessTokenTtlSeconds,
    issuer: 'psirs-revenue-platform',
    audience: 'psirs-clients',
  });
}

export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.header('authorization');
    if (!header?.startsWith('Bearer ')) {
      throw unauthorised();
    }

    let payload: AccessTokenPayload;
    try {
      payload = jwt.verify(header.slice(7), config.auth.jwtSecret, {
        issuer: 'psirs-revenue-platform',
        audience: 'psirs-clients',
      }) as AccessTokenPayload;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new AppError({
          statusCode: 401,
          code: 'TOKEN_EXPIRED',
          message: 'Your session has expired. Sign in again to continue.',
        });
      }
      throw unauthorised('Your session is not valid. Sign in again.');
    }

    // A valid signature is not enough: the session must still exist and not
    // have been revoked. This is what makes "force logout" and device
    // revocation take effect immediately (PRD §34, Addendum §21).
    const session = await queryOne<{
      id: string;
      revoked_at: Date | null;
      expires_at: Date;
      user_status: string;
      user_role: Role;
    }>(
      pool,
      `SELECT s.id, s.revoked_at, s.expires_at, u.status AS user_status, u.role AS user_role
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.id = $1 AND s.user_id = $2`,
      [payload.sid, payload.sub],
    );

    if (!session || session.revoked_at !== null) {
      throw unauthorised('Your session has been ended. Sign in again.');
    }
    if (session.expires_at.getTime() < Date.now()) {
      throw unauthorised('Your session has expired. Sign in again.');
    }
    if (session.user_status !== 'ACTIVE') {
      throw forbidden(
        session.user_status === 'SUSPENDED'
          ? 'Your account has been suspended. Contact PSIRS support.'
          : 'Your account is not active.',
      );
    }

    // The role is taken from the database, not the token, so a role change or
    // suspension applies to sessions issued before it.
    const role = session.user_role;

    req.auth = {
      userId: payload.sub,
      role,
      sessionId: payload.sid,
      permissions: permissionsForRole(role),
      agentId: payload.agentId,
      taxpayerId: payload.taxpayerId,
      deviceId: payload.deviceId,
    };

    void pool
      .query('UPDATE sessions SET last_used_at = now() WHERE id = $1', [payload.sid])
      .catch(() => undefined);

    next();
  } catch (error) {
    next(error);
  }
}

export function requirePermission(...permissions: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) return next(unauthorised());
    const granted = permissions.some((permission) => roleHasPermission(req.auth!.role, permission));
    if (!granted) {
      return next(
        forbidden(
          `Your role (${req.auth.role}) is not permitted to perform this action.`,
          'If you believe this is wrong, ask your supervisor to review your role assignment.',
        ),
      );
    }
    next();
  };
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) return next(unauthorised());
    if (!roles.includes(req.auth.role)) {
      return next(forbidden(`This action is restricted to: ${roles.join(', ')}.`));
    }
    next();
  };
}

/**
 * Consume a step-up authentication grant (PRD §35).
 *
 * The grant is consumed, not merely checked, so one OTP authorises exactly one
 * high-risk action — a captured token cannot be replayed to approve a second
 * payout or change a second bank account.
 */
export function requireStepUp(action: StepUpAction) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.auth) throw unauthorised();

      const grant = await queryOne<{ id: string }>(
        pool,
        `SELECT id FROM step_up_grants
          WHERE user_id = $1 AND action = $2 AND consumed_at IS NULL AND expires_at > now()
          ORDER BY granted_at DESC LIMIT 1`,
        [req.auth.userId, action],
      );

      if (!grant) {
        throw new AppError({
          statusCode: 403,
          code: 'STEP_UP_REQUIRED',
          message:
            'This action needs extra verification. Request a one-time code and confirm it, then try again.',
          nextStep: `POST /api/v1/auth/step-up with action "${action}".`,
        });
      }

      await pool.query('UPDATE step_up_grants SET consumed_at = now() WHERE id = $1', [grant.id]);
      next();
    } catch (error) {
      next(error);
    }
  };
}

export interface AgentContext {
  agentId: string;
  agentCode: string | null;
  territoryId: string | null;
  lgaId: string | null;
  operationalStatus: string;
  flags: AgentClearanceFlags;
  deviceId: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      agent?: AgentContext;
    }
  }
}

/**
 * The revenue-collection gate (Addendum §26 stage 4, §50).
 *
 * Four independent conditions, each of which fails closed:
 *   1. the agent record is operationally ACTIVE;
 *   2. every clearance item is satisfied;
 *   3. the calling device is registered and not revoked (Addendum §21);
 *   4. the PWA build is at or above the enforced minimum (Addendum §43).
 */
export function requireActiveAgent(options: { requireDevice?: boolean } = {}) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.auth) throw unauthorised();

      if (req.auth.role !== 'agent') {
        // Officers legitimately act on behalf of taxpayers through their own
        // permissions; they simply are not agents and skip this gate.
        return next();
      }

      const agent = await queryOne<{
        id: string;
        agent_code: string | null;
        territory_id: string | null;
        lga_id: string | null;
        operational_status: string;
        account_status: string;
        kyc_cleared: boolean;
        referee_cleared: boolean;
        training_completed: boolean;
        bank_verified: boolean;
        agreement_accepted: boolean;
        device_registered: boolean;
        government_approved: boolean;
      }>(
        pool,
        `SELECT a.id, a.agent_code, a.territory_id, a.lga_id, a.operational_status,
                a.account_status,
                COALESCE(c.kyc_cleared, false)        AS kyc_cleared,
                COALESCE(c.referee_cleared, false)    AS referee_cleared,
                COALESCE(c.training_completed, false) AS training_completed,
                COALESCE(c.bank_verified, false)      AS bank_verified,
                COALESCE(c.agreement_accepted, false) AS agreement_accepted,
                COALESCE(c.device_registered, false)  AS device_registered,
                COALESCE(c.government_approved, false) AS government_approved
           FROM agents a
           LEFT JOIN agent_clearance c ON c.agent_id = a.id
          WHERE a.user_id = $1`,
        [req.auth.userId],
      );

      if (!agent) {
        throw forbidden('No agent profile is linked to this account.');
      }

      const flags: AgentClearanceFlags = {
        kycCleared: agent.kyc_cleared,
        refereeCleared: agent.referee_cleared,
        trainingCompleted: agent.training_completed,
        bankVerified: agent.bank_verified,
        agreementAccepted: agent.agreement_accepted,
        deviceRegistered: agent.device_registered,
        governmentApproved: agent.government_approved,
      };

      if (agent.operational_status === 'SUSPENDED' || agent.account_status === 'SUSPENDED') {
        throw new AppError({
          statusCode: 403,
          code: 'AGENT_SUSPENDED',
          message:
            'Your agent account is suspended. You cannot carry out revenue collection. ' +
            'Contact your supervisor.',
        });
      }

      if (agent.operational_status !== 'ACTIVE') {
        throw notCleared(activationBlockers(flags));
      }

      // Device state is checked before the general clearance list so that a
      // revoked or unknown device produces the specific reason rather than a
      // generic "not cleared" — revoking a device clears the device_registered
      // flag, and an agent told only "you are not cleared" cannot tell that
      // registering a replacement handset is the fix.
      let deviceId: string | null = null;
      if (options.requireDevice !== false) {
        if (!req.deviceIdentifier) {
          throw new AppError({
            statusCode: 403,
            code: 'DEVICE_NOT_IDENTIFIED',
            message:
              'This device is not identified. Sign in again from your registered device to continue.',
          });
        }

        const device = await queryOne<{ id: string; status: string }>(
          pool,
          `SELECT id, status FROM agent_devices
            WHERE agent_id = $1 AND device_identifier = $2`,
          [agent.id, req.deviceIdentifier],
        );

        if (!device) {
          throw new AppError({
            statusCode: 403,
            code: 'DEVICE_NOT_REGISTERED',
            message:
              'This device is not registered to your agent account. Register it before collecting revenue.',
            nextStep: 'Open Profile > Devices to register this device.',
          });
        }

        if (device.status === 'REVOKED' || device.status === 'SUSPENDED') {
          throw new AppError({
            statusCode: 403,
            code: 'DEVICE_REVOKED',
            message:
              'This device has been revoked and can no longer be used for revenue collection. ' +
              'Contact your supervisor.',
          });
        }

        if (device.status === 'PENDING') {
          throw new AppError({
            statusCode: 403,
            code: 'DEVICE_PENDING_APPROVAL',
            message: 'This device is awaiting approval before it can be used for transactions.',
          });
        }

        deviceId = device.id;
        void pool
          .query('UPDATE agent_devices SET last_seen_at = now() WHERE id = $1', [device.id])
          .catch(() => undefined);
      }

      const blockers = activationBlockers(flags);
      if (blockers.length > 0) {
        // Defence in depth: the DB CHECK constraint should make an active agent
        // with unmet requirements unreachable, but such an agent must be
        // stopped rather than trusted.
        throw notCleared(blockers);
      }

      req.agent = {
        agentId: agent.id,
        agentCode: agent.agent_code,
        territoryId: agent.territory_id,
        lgaId: agent.lga_id,
        operationalStatus: agent.operational_status,
        flags,
        deviceId,
      };

      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Enforce a minimum PWA build for financial endpoints (Addendum §43).
 *
 * An outdated client may hold bugs in payment handling, so government can
 * block transactions from it while still allowing the agent to sign in and
 * update.
 */
export async function requireSupportedAppVersion(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (req.auth?.role !== 'agent') return next();

    const row = await queryOne<{ minimum_version: string; recommended_version: string }>(
      pool,
      `SELECT minimum_version, recommended_version
         FROM app_versions
        WHERE app = 'AGENT_PWA' AND effective_from <= now()
        ORDER BY effective_from DESC LIMIT 1`,
    );

    const minimum = row?.minimum_version ?? config.pwa.minimumAgentVersion;
    const current = req.appVersion;

    if (!current || compareVersions(current, minimum) < 0) {
      throw new AppError({
        statusCode: 426,
        code: 'UPDATE_REQUIRED',
        message:
          `This version of the app is no longer supported for transactions. ` +
          `Update to version ${row?.recommended_version ?? minimum} and try again.`,
        moneyStatus: 'NOT_DEBITED',
        nextStep: 'Close and reopen the app to install the latest version.',
      });
    }

    next();
  } catch (error) {
    next(error);
  }
}

/** Semantic version comparison; missing parts are treated as 0. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const left = parse(a);
  const right = parse(b);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}
