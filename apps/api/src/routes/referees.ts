/**
 * Referee verification portal (Addendum §10-§13).
 *
 * Every route here is unauthenticated on purpose: "The referee should not need
 * an agent account to respond." Authorisation is the invitation token, which
 * is single-purpose, expiring, and stored only as a hash.
 */

import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { pool } from '../db/pool';
import { rateLimit } from '../middleware/security';
import { validateBody } from '../middleware/validate';
import * as referees from '../services/referees';

export const refereeRouter = Router();

// A token is a bearer credential, so guessing attempts are rate limited hard.
refereeRouter.use(
  rateLimit({
    max: config.security.refereeRateLimitMax,
    windowMs: 60_000,
    keyPrefix: 'referee',
    keyBy: 'ip',
  }),
);

refereeRouter.get('/:token', async (req, res, next) => {
  try {
    const invitation = await referees.openInvitation(pool, req.params.token);
    res.json({
      ...invitation,
      declarations: [
        'I know this person.',
        'The information presented is reasonably accurate.',
        'I am willing to act as referee.',
        'I understand that providing false information may have consequences.',
      ],
    });
  } catch (error) {
    next(error);
  }
});

refereeRouter.post(
  '/:token/respond',
  validateBody(
    z.object({
      confirmsKnowsApplicant: z.boolean(),
      confirmsInformationAccurate: z.boolean(),
      willingToActAsReferee: z.boolean(),
      understandsConsequences: z.boolean(),
      identityType: z
        .enum(['NIN', 'BVN', 'PASSPORT', 'DRIVERS_LICENCE', 'VOTERS_CARD', 'OTHER'])
        .optional(),
      identityNumber: z.string().min(5).max(30).optional(),
      occupation: z.string().max(120).optional(),
      address: z.string().max(300).optional(),
      comments: z.string().max(1000).optional(),
    }),
    async (req, res, data) => {
      const result = await referees.submitRefereeResponse({
        token: req.params.token,
        input: data,
        ipAddress: req.clientIp,
      });
      res.json(result);
    },
  ),
);

refereeRouter.post(
  '/:token/decline',
  validateBody(z.object({ reason: z.string().max(500).optional() }), async (req, res, data) => {
    const result = await referees.declineInvitation({
      token: req.params.token,
      reason: data.reason,
    });
    res.json(result);
  }),
);
