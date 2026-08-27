/**
 * Web Push Notification Routes.
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

// The VAPID public key is public by definition and the browser needs it before
// it can subscribe, so this one stays open.
pushRouter.get('/vapid-key', (_req, res) => {
  res.json({ publicKey: getVapidPublicKey() });
});

/*
 * Everything below identifies a device with a person.
 *
 * Subscribing read `(req as any).actor`, which exists nowhere in this codebase
 * — the cast is what kept the compiler quiet about it. Every subscription was
 * therefore stored with no userId and no agentId, and `sendPushNotification`
 * matches a target against exactly those fields. A targeted push would have
 * matched nobody; its untargeted fallback matches everybody. Since the router
 * was also unauthenticated there was no identity to record even in principle,
 * and unsubscribing took any endpoint at all.
 *
 * None of this has been noticed because web push delivery is deliberately not
 * implemented yet — `providerFor('PUSH')` throws and says so. That is exactly
 * why it is worth repairing now: whoever adds the adapter would otherwise
 * inherit a store full of anonymous subscriptions from an endpoint anyone
 * could post to.
 */
pushRouter.use(authenticate);

pushRouter.post(
  '/subscribe',
  validateBody(subscriptionSchema, async (req, res, data) => {
    await saveSubscription(data.subscription, {
      userId: req.auth!.userId,
      agentId: req.auth!.agentId,
    });
    res.json({ status: 'subscribed' });
  }),
);

pushRouter.post(
  '/unsubscribe',
  validateBody(unsubscribeSchema, async (req, res, data) => {
    // Only your own device. An endpoint is long and random, but "hard to guess"
    // is not the same as "checked".
    await removeSubscription(data.endpoint, { userId: req.auth!.userId });
    res.json({ status: 'unsubscribed' });
  }),
);
