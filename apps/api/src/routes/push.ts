/**
 * Web Push Notification Routes.
 */

import { Router } from 'express';
import { z } from 'zod';
import {
  getVapidPublicKey,
  isAllowedPushEndpoint,
  removeSubscription,
  saveSubscription,
} from '../services/push';
import { authenticate } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { serviceUnavailable } from '../lib/errors';

export const pushRouter = Router();

/*
 * `z.string().url()` was the whole of it, and a URL is not an address this
 * server should open a connection to.
 *
 * The endpoint is chosen by the browser but arrives in a request body, so it is
 * caller-supplied text that the delivery path later dials. Any authenticated
 * agent could name `169.254.169.254`, `127.0.0.1:4000` or their own collector,
 * then fire the request themselves by collecting a levy — the seeded
 * `COMMISSION_EARNED_PUSH` template sends on a real earning. `isAllowedPushEndpoint`
 * holds it to the push services a browser can actually have been given.
 *
 * The refusal names no internal address back to the caller: a probe of one host
 * and a probe of another get the same sentence, so this cannot be used to map
 * what the server can reach.
 */
const pushEndpoint = z
  .string()
  .url()
  .refine(isAllowedPushEndpoint, {
    message:
      'That is not a push service this platform delivers to. A subscription must name the ' +
      'endpoint your browser was given.',
  });

const subscriptionSchema = z.object({
  subscription: z.object({
    endpoint: pushEndpoint,
    keys: z
      .object({
        p256dh: z.string().optional(),
        auth: z.string().optional(),
      })
      .optional(),
  }),
});

// Unsubscribe takes the same shape. It does not dial anything, but accepting an
// address here that subscribe would refuse invites a row nothing can act on.
const unsubscribeSchema = z.object({
  endpoint: pushEndpoint,
});

/*
 * The VAPID public key is public by definition and the browser needs it before
 * it can subscribe, so this one stays open.
 *
 * When none is configured this answers 503 rather than a key. It used to serve
 * one generated at startup, which a browser binds to permanently and which the
 * next restart throws away — a fleet that stops receiving anything, with
 * nothing anywhere to say why. An honest refusal here is a deployment checklist
 * item; the alternative was a silent outage.
 */
pushRouter.get('/vapid-key', (_req, res) => {
  const publicKey = getVapidPublicKey();
  if (!publicKey) {
    throw serviceUnavailable(
      'Push notifications are not configured on this server, so there is no key to subscribe ' +
        'with.',
      'An administrator must set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY.',
    );
  }
  res.json({ publicKey });
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
