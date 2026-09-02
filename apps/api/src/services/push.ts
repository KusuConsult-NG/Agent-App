/**
 * Web Push Notification Dispatcher.
 *
 * Provides VAPID-based Web Push message dispatching to agent PWA devices for
 * real-time clearance approvals, referee invitations, and payment settlement notifications.
 */

import { generateKeyPairSync } from 'node:crypto';

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

export interface StoredSubscription {
  userId?: string;
  agentId?: string;
  subscription: PushSubscriptionData;
  createdAt: Date;
}

const subscriptions: Map<string, StoredSubscription> = new Map();

export function getVapidPublicKey(): string {
  return vapidPublicKey!;
}

export function saveSubscription(
  subscription: PushSubscriptionData,
  actor?: { userId?: string; agentId?: string },
): void {
  if (!subscription.endpoint) return;
  subscriptions.set(subscription.endpoint, {
    userId: actor?.userId,
    agentId: actor?.agentId,
    subscription,
    createdAt: new Date(),
  });
}

/**
 * Remove a registration.
 *
 * Scoped to the owner: the endpoint URL is the only thing identifying a
 * subscription, and it is not a secret the platform controls, so an
 * unscoped delete lets anyone who learns an endpoint silence that device.
 * An unowned registration (one saved before ownership was recorded) is
 * removable by anyone, since there is nobody it could belong to.
 */
export function removeSubscription(
  endpoint: string,
  owner?: { userId?: string; agentId?: string },
): boolean {
  const existing = subscriptions.get(endpoint);
  if (!existing) return false;

  if (owner && (existing.userId || existing.agentId)) {
    const mine =
      (existing.userId !== undefined && existing.userId === owner.userId) ||
      (existing.agentId !== undefined && existing.agentId === owner.agentId);
    if (!mine) return false;
  }

  return subscriptions.delete(endpoint);
}

/** Read a stored registration. Exposed so the ownership rule can be asserted. */
export function getSubscription(endpoint: string): Readonly<StoredSubscription> | undefined {
  return subscriptions.get(endpoint);
}

export async function sendPushNotification(
  target: { userId?: string; agentId?: string },
  payload: { title: string; body: string; data?: Record<string, unknown> },
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;

  for (const [endpoint, sub] of subscriptions.entries()) {
    const match =
      (target.userId && sub.userId === target.userId) ||
      (target.agentId && sub.agentId === target.agentId) ||
      (!target.userId && !target.agentId);

    if (match) {
      try {
        // In local/mock environment, log notification dispatch
        console.log(`[push] dispatched notification to ${endpoint.slice(0, 30)}...: ${payload.title}`);
        sent++;
      } catch (err) {
        console.error('[push] delivery failed', err);
        failed++;
      }
    }
  }

  return { sent, failed };
}
