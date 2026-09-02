/**
 * Web Push Notification Routes.
 *
 * `/vapid-key` is deliberately public: a VAPID *public* key identifies the
 * server to the browser's push service and is designed to be handed to anyone.
 *
 * Registering and removing a subscription is not. Both were reachable
 * unauthenticated, which meant anybody on the internet could plant an endpoint
 * in the dispatch table, and anybody who learned an endpoint URL could delete
 * someone else's registration. Neither is reachable from the app before
 * sign-in — the agent PWA only offers the toggle on the More screen — so the
 * guard costs the real client nothing.
 */

import { Router } from 'express';
import { z } from 'zod';
import { getVapidPublicKey, removeSubscription, saveSubscription } from '../services/push';
import { authenticate } from '../middleware/auth';
import { validateBody } from '../middleware/validate';

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

pushRouter.use(authenticate);

pushRouter.post(
  '/subscribe',
  validateBody(subscriptionSchema, async (req, res, data) => {
    // The owner comes from the verified session. This previously read
    // `req.actor`, a field nothing in the codebase sets, so every subscription
    // was stored with no owner at all — and `sendPushNotification`, which
    // matches on owner, could therefore never deliver a targeted message.
    saveSubscription(data.subscription, {
      userId: req.auth!.userId,
      agentId: req.auth!.agentId,
    });
    res.json({ status: 'subscribed' });
  }),
);

pushRouter.post(
  '/unsubscribe',
  validateBody(unsubscribeSchema, async (req, res, data) => {
    removeSubscription(data.endpoint, { userId: req.auth!.userId, agentId: req.auth!.agentId });
    res.json({ status: 'unsubscribed' });
  }),
);
