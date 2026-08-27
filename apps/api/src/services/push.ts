/**
 * Web Push Notification Dispatcher.
 *
 * Provides VAPID-based Web Push message dispatching to agent PWA devices for
 * real-time clearance approvals, referee invitations, and payment settlement notifications.
 */

import { generateKeyPairSync } from 'node:crypto';
import { pool, query } from '../db/pool';

// In-memory / ephemeral VAPID keys for development; in production read from env
let vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
let vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;

if (!vapidPublicKey || !vapidPrivateKey) {
  // Generate a standard EC keypair if none supplied
  try {
    const { publicKey, privateKey } = generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
      publicKeyEncoding: { type: 'spki', format: 'der' },
      privateKeyEncoding: { type: 'pkcs8', format: 'der' },
    });
    vapidPublicKey = Buffer.from(publicKey).toString('base64url');
    vapidPrivateKey = Buffer.from(privateKey).toString('base64url');
  } catch {
    vapidPublicKey = 'BN-mock-public-vapid-key-for-development-purposes-only-32bytes';
    vapidPrivateKey = 'mock-private-vapid-key-32bytes-long';
  }
}

export interface PushSubscriptionData {
  endpoint: string;
  keys?: {
    p256dh?: string;
    auth?: string;
  };
}

interface StoredSubscription {
  userId?: string;
  agentId?: string;
  subscription: PushSubscriptionData;
  createdAt: Date;
}

/*
 * Kept in PostgreSQL, not in a Map.
 *
 * A push subscription identifies a device with a person, which makes it the
 * same class of record as a session or a registered handset — and those do not
 * live in a process. In the Map, every subscription was lost on restart, a
 * handset that subscribed through one replica was unknown to the others, and
 * nothing could be audited, revoked centrally or counted.
 */
export function getVapidPublicKey(): string {
  return vapidPublicKey!;
}

export async function saveSubscription(
  subscription: PushSubscriptionData,
  actor?: { userId?: string; agentId?: string },
): Promise<void> {
  if (!subscription.endpoint) return;
  await pool.query(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth_secret, user_id, agent_id)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (endpoint) DO UPDATE
        SET p256dh = EXCLUDED.p256dh,
            auth_secret = EXCLUDED.auth_secret,
            user_id = EXCLUDED.user_id,
            agent_id = EXCLUDED.agent_id,
            -- Resubscribing revives a row that had been expired, rather than
            -- leaving a dead one shadowing the live endpoint.
            expired_at = NULL`,
    [
      subscription.endpoint,
      subscription.keys?.p256dh ?? null,
      subscription.keys?.auth ?? null,
      actor?.userId ?? null,
      actor?.agentId ?? null,
    ],
  );
}

/**
 * Forget a device.
 *
 * `owner` is optional so an internal caller can drop a subscription the push
 * service itself found dead, but a request coming from a person must pass it:
 * an endpoint is long and random, and that is not the same as checked.
 */
export async function removeSubscription(
  endpoint: string,
  owner?: { userId?: string },
): Promise<void> {
  if (owner?.userId) {
    await pool.query(
      `UPDATE push_subscriptions SET expired_at = now()
        WHERE endpoint = $1 AND user_id = $2 AND expired_at IS NULL`,
      [endpoint, owner.userId],
    );
    return;
  }
  await pool.query(
    `UPDATE push_subscriptions SET expired_at = now()
      WHERE endpoint = $1 AND expired_at IS NULL`,
    [endpoint],
  );
}

/** Live subscriptions for a person or an agent, for whoever writes the adapter. */
export async function subscriptionsFor(target: {
  userId?: string;
  agentId?: string;
}): Promise<{ endpoint: string; p256dh: string | null; auth_secret: string | null }[]> {
  if (!target.userId && !target.agentId) return [];
  return query(
    pool,
    `SELECT endpoint, p256dh, auth_secret FROM push_subscriptions
      WHERE expired_at IS NULL
        AND (($1::uuid IS NOT NULL AND user_id = $1)
          OR ($2::uuid IS NOT NULL AND agent_id = $2))`,
    [target.userId ?? null, target.agentId ?? null],
  );
}

/**
 * Web push delivery, which does not exist yet — and now says so.
 *
 * This counted a `console.log` as a delivery and returned it as `sent`. The
 * messaging layer's own `providerFor('PUSH')` throws and explains that no
 * adapter exists; this function sat beside it reporting success for the same
 * channel. Reporting a notification as sent when nothing left the building is
 * the failure this whole platform is organised against, and it is worse here
 * than most because the caller has no other way to find out.
 *
 * It refuses rather than returning zero, because a caller that queued a push
 * and got `{ sent: 0 }` would reasonably read it as "nobody is subscribed".
 */
export async function sendPushNotification(
  _target: { userId?: string; agentId?: string },
  _payload: { title: string; body: string; data?: Record<string, unknown> },
): Promise<{ sent: number; failed: number }> {
  throw new Error(
    'Web push delivery is not implemented. Subscriptions are recorded in ' +
      'push_subscriptions and are waiting for a VAPID adapter; nothing has been sent.',
  );
}
