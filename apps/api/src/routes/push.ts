/**
 * Web Push Notification Routes.
 */

import { Router } from 'express';
import { z } from 'zod';
import { getVapidPublicKey, removeSubscription, saveSubscription } from '../services/push';
import { asyncHandler, validateBody } from '../middleware/validate';

export const pushRouter = Router();

const subscriptionSchema = z.object({
  subscription: z.object({
    endpoint: z.string().url(),
    keys: z
      .object({
        p256dh: z.string().optional(),
        auth: z.string().optional(),
      })
      .optional(),
  }),
});

const unsubscribeSchema = z.object({
  endpoint: z.string().url(),
});

pushRouter.get('/vapid-key', (_req, res) => {
  res.json({ publicKey: getVapidPublicKey() });
});

pushRouter.post(
  '/subscribe',
  validateBody(subscriptionSchema, async (req, res, data) => {
    const actor = (req as any).actor;
    saveSubscription(data.subscription, {
      userId: actor?.actorId,
      agentId: actor?.agentId,
    });
    res.json({ status: 'subscribed' });
  }),
);

pushRouter.post(
  '/unsubscribe',
  validateBody(unsubscribeSchema, async (_req, res, data) => {
    removeSubscription(data.endpoint);
    res.json({ status: 'unsubscribed' });
  }),
);
