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

authRouter.post(
  '/register',
  validateBody(
    z.object({
      fullName: z.string().min(2, 'Enter your full name'),
      phone: phoneSchema,
      email: emailSchema.optional(),
      password: z
        .string()
        .min(8, 'Your password must be at least 8 characters')
        .regex(/[0-9]/, 'Include at least one number')
        .regex(/[a-zA-Z]/, 'Include at least one letter'),
      taxpayerId: z.string().uuid().optional(),
    }),
    async (_req, res, data) => {
      const result = await auth.registerTaxpayerUser(data);
      res.status(201).json(result);
    },
  ),
);

authRouter.post(
  '/refresh',
  validateBody(z.object({ refreshToken: z.string().min(10) }), async (req, res, data) => {
    const tokens = await auth.refresh({
      refreshToken: data.refreshToken,
      ipAddress: req.clientIp,
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

authRouter.post(
  '/otp/request',
  validateBody(
    z.object({
      destination: phoneSchema,
      purpose: z.enum(['LOGIN', 'REGISTRATION', 'STEP_UP', 'PASSWORD_RESET', 'REFEREE_VERIFY']),
    }),
    async (req, res, data) => {
      const result = await auth.requestOtp({
        destination: data.destination,
        purpose: data.purpose,
        userId: req.auth?.userId ?? null,
      });
      res.json(result);
    },
  ),
);

authRouter.post(
  '/otp/verify',
  validateBody(
    z.object({
      destination: phoneSchema,
      purpose: z.enum(['LOGIN', 'REGISTRATION', 'STEP_UP', 'PASSWORD_RESET', 'REFEREE_VERIFY']),
      code: z.string().length(config.auth.otpLength, 'Enter the full code'),
    }),
    async (_req, res, data) => {
      const result = await auth.verifyOtp(data);
      res.json({ verified: true, ...result });
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
      taxpayerId: req.auth!.taxpayerId ?? null,
    });
  }),
);
