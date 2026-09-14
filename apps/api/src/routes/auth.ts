/** Authentication endpoints (PRD §52). */

import { Router } from 'express';
import { z } from 'zod';
import { STEP_UP_ACTIONS } from '@psirs/shared';
import { authenticate } from '../middleware/auth';
import { rateLimit } from '../middleware/security';
import { asyncHandler, emailSchema, phoneSchema, validateBody } from '../middleware/validate';
import * as auth from '../services/auth';
import { config } from '../config';

export const authRouter = Router();

// Sign-in attempts get a much tighter budget than ordinary reads.
authRouter.use(rateLimit({ max: config.security.authRateLimitMax, keyPrefix: 'auth' }));

authRouter.post(
  '/login',
  validateBody(
    z.object({
      phone: phoneSchema,
      password: z.string().min(1, 'Enter your password'),
    }),
    async (req, res, data) => {
      const tokens = await auth.login({
        phone: data.phone,
        password: data.password,
        deviceIdentifier: req.deviceIdentifier,
        ipAddress: req.clientIp,
        userAgent: req.header('user-agent') ?? null,
      });
      res.json(tokens);
    },
  ),
);

// There is deliberately no public self-registration endpoint.
//
// Citizens do not hold accounts on this platform: an authorised agent
// approaches them to onboard them or to help them remit a tax or levy. Agents
// apply through POST /agents/apply, which starts the clearance pipeline rather
// than creating a usable login; government users are provisioned by an
// administrator. An open registration route would have been unused surface
// through which anyone could mint an account able to raise assessments.

authRouter.post(
  '/refresh',
  validateBody(z.object({ refreshToken: z.string().min(10) }), async (req, res, data) => {
    const tokens = await auth.refresh({
      refreshToken: data.refreshToken,
      ipAddress: req.clientIp,
      // The device the token is being presented from. A session bound to a
      // device only refreshes on that device.
      deviceIdentifier: req.deviceIdentifier,
    });
    res.json(tokens);
  }),
);

authRouter.post(
  '/logout',
  authenticate,
  asyncHandler(async (req, res) => {
    await auth.logout({ sessionId: req.auth!.sessionId, userId: req.auth!.userId });
    res.json({ signedOut: true });
  }),
);

authRouter.post(
  '/logout-all',
  authenticate,
  asyncHandler(async (req, res) => {
    const revoked = await auth.revokeAllSessions(req.auth!.userId, 'Signed out of all devices');
    res.json({ sessionsRevoked: revoked });
  }),
);

/**
 * One-time codes, for the one thing the platform does with them.
 *
 * `otp_codes.purpose` names five kinds of code and this route used to accept
 * all five, unauthenticated, for any Nigerian number typed into the body. Only
 * `STEP_UP` was ever consumed by anything: there is no self-registration, no
 * password reset flow and no OTP sign-in, so the other four sent a real SMS,
 * on the State's account, carrying a code that no endpoint could ever redeem —
 * to whichever number the caller named. The purposes stay in the column, ready
 * for the flows that would use them; the route offers only the one that exists.
 *
 * A step-up code belongs to a session that already exists, so unlike signing
 * in, asking for one is an authenticated act — and `requestOtp` then refuses
 * any destination but the number that account is registered under.
 *
 * There is no companion `/otp/verify`. Verifying a code consumes it, so a
 * route that verified without granting anything could only ever destroy a code
 * — and taking the destination from an unauthenticated body, it destroyed
 * other people's: five wrong guesses from anyone who knew an officer's phone
 * number burned that officer's live code, and with it the officer's ability to
 * approve a reversal or a payout for as long as somebody kept it up. The code
 * is presented once, to `/auth/step-up`, by the session it authorises.
 */
authRouter.post(
  '/otp/request',
  authenticate,
  validateBody(
    z.object({
      destination: phoneSchema,
      purpose: z.literal('STEP_UP'),
    }),
    async (req, res, data) => {
      const result = await auth.requestOtp({
        destination: data.destination,
        purpose: data.purpose,
        userId: req.auth!.userId,
      });
      res.json(result);
    },
  ),
);

/** Step-up authentication for high-risk actions (PRD §35). */
authRouter.post(
  '/step-up',
  authenticate,
  validateBody(
    z.object({
      action: z.enum(STEP_UP_ACTIONS),
      destination: phoneSchema,
      code: z.string().length(config.auth.otpLength),
    }),
    async (req, res, data) => {
      const result = await auth.grantStepUp({
        userId: req.auth!.userId,
        action: data.action,
        destination: data.destination,
        code: data.code,
      });
      res.json({ granted: true, expiresAt: result.expiresAt });
    },
  ),
);

authRouter.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    res.json({
      userId: req.auth!.userId,
      role: req.auth!.role,
      permissions: req.auth!.permissions,
      agentId: req.auth!.agentId ?? null,
    });
  }),
);
