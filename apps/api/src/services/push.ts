/**
 * Web push, from the application server's side (PRD §44).
 *
 * WHY THIS USES A LIBRARY WHEN EVERY OTHER INTEGRATION HERE IS HAND-WRITTEN.
 * The Remita, SMS and KYC adapters are hand-written because they are HTTP
 * shapes, and an HTTP shape that is wrong fails loudly. This is RFC 8291
 * content encryption and RFC 8292 request signing, and cryptography that is
 * subtly wrong does not fail loudly — it produces something that looks
 * delivered. `web-push` is the reference implementation of both. Getting this
 * independently right is not a saving worth making on a platform whose whole
 * purpose is not to tell a citizen something happened when it did not.
 *
 * THE KEYS ARE CONFIGURATION, AND THAT IS THE WHOLE POINT.
 *
 * This module called `generateKeyPairSync` at import time whenever
 * `VAPID_PUBLIC_KEY` was unset, and served the result. A browser binds its
 * subscription to the application server key it was handed, permanently. So a
 * generated key worked until the next restart and then stopped: every handset
 * in the fleet held a subscription signed by a key the server no longer had,
 * every push came back 403, and nothing anywhere said so. Across replicas it
 * never worked at all, because each one had a different identity.
 *
 * A missing key is a visible failure. A generated one is an invisible one, and
 * it is the worse of the two. So when none is configured this serves none,
 * says so, and refuses to send.
 */

import { createPrivateKey, createPublicKey } from 'node:crypto';
import webpush from 'web-push';
import { pool, query } from '../db/pool';
import { log } from '../lib/logger';

interface VapidKeys {
  /** Raw uncompressed P-256 point, base64url. What a browser subscribes with. */
  publicKey: string;
  /** The 32-byte private scalar, base64url. */
  privateKey: string;
  /** `mailto:` or `https:` contact, which the push services require. */
  subject: string;
}

/**
 * The public key in the one encoding a browser accepts.
 *
 * `applicationServerKey` takes the raw uncompressed point — 65 bytes beginning
 * 0x04. What this endpoint served was an SPKI DER wrapper around that point,
 * because that is what `export({ type: 'spki' })` produces.
 * `pushManager.subscribe()` rejects it, so the endpoint could not have produced
 * a single working subscription.
 *
 * Accepting either encoding and answering with the raw one means a deployment
 * that pastes in whichever form its key tool emitted still works.
 */
export function publicKeyFor(configured: string): string {
  const bytes = Buffer.from(configured.trim(), 'base64url');
  if (bytes.length === 65 && bytes[0] === 0x04) return bytes.toString('base64url');

  const key = createPublicKey({ key: bytes, format: 'der', type: 'spki' });
  const raw = Buffer.from(key.export({ type: 'spki', format: 'der' })).subarray(-65);
  if (raw.length !== 65 || raw[0] !== 0x04) {
    throw new Error('VAPID_PUBLIC_KEY is not a P-256 public key.');
  }
  return raw.toString('base64url');
}

/**
 * The private key as the 32-byte scalar, whichever encoding was configured.
 *
 * `web-push generate-vapid-keys` emits the raw scalar; `openssl ecparam` and
 * Node's own `export({ type: 'pkcs8' })` emit DER, and a PEM block is what most
 * people have to hand. All three are a P-256 private key and only one of them
 * is accepted downstream — a mismatch is otherwise rejected at *send* time, one
 * notification at a time, which is the class of failure this module exists to
 * stop producing.
 */
export function privateKeyFor(configured: string): string {
  const trimmed = configured.trim();
  const bytes = Buffer.from(trimmed, 'base64url');
  if (bytes.length === 32) return bytes.toString('base64url');

  const key = trimmed.includes('-----BEGIN')
    ? createPrivateKey(trimmed)
    : createPrivateKey({ key: bytes, format: 'der', type: 'pkcs8' });
  const { d } = key.export({ format: 'jwk' }) as { d?: string };
  if (!d) throw new Error('VAPID_PRIVATE_KEY is not a P-256 private key.');
  return d;
}

function fromEnvironment(): VapidKeys | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;

  return {
    publicKey: publicKeyFor(publicKey),
    privateKey: privateKeyFor(privateKey),
    /*
     * The push services require a contact so they can reach whoever is sending
     * at their users. Defaulted rather than required: a deployment that has set
     * two keys and forgotten the address should send with a generic PSIRS
     * address rather than not send.
     */
    subject: process.env.VAPID_SUBJECT?.trim() || 'mailto:revenue@psirs.pl.gov.ng',
  };
}

/**
 * The push services a subscription may name.
 *
 * A push endpoint is chosen by the browser, but it arrives in a request body,
 * which makes it caller-supplied text that the server later opens a connection
 * to. Unconstrained, that is a server-side request forgery primitive with a
 * trigger the caller controls: `COMMISSION_EARNED_PUSH` is a seeded active
 * template, so an agent who has subscribed an endpoint of their choosing makes
 * the API dial it by collecting one levy. An audit demonstrated it against
 * `169.254.169.254`, `127.0.0.1`, `10.0.0.5`, `[::1]` and an external host, and
 * confirmed connections landing on a local listener.
 *
 * A suffix allowlist rather than a private-range denylist. A denylist has to be
 * right about every address family, every encoding of a loopback address, and
 * every name that resolves to one after the check has passed; this has to be
 * right about which companies operate push services, which is a list somebody
 * can read. `PUSH_ENDPOINT_HOSTS` extends it without a deployment, for a
 * browser this list has not met yet.
 */
const DEFAULT_PUSH_HOSTS = [
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'web.push.apple.com',
  'notify.windows.com',
  'push.services.mozilla.com',
];

function allowedPushHosts(): string[] {
  const configured = (process.env.PUSH_ENDPOINT_HOSTS ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  return configured.length > 0 ? configured : DEFAULT_PUSH_HOSTS;
}

/**
 * Whether this is an address a push service could actually live at.
 *
 * Checked where the subscription is accepted *and* again before the connection
 * is opened. Twice because they answer different questions: the first stops a
 * bad row being stored, the second stops a bad row already stored — written
 * before this rule existed, or by any path that does not go through the route —
 * from being dialled.
 */
export function isAllowedPushEndpoint(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }

  // A plaintext endpoint would put a citizen's notification on the wire, and
  // `web-push` would send it over TLS regardless — so the scheme in the string
  // is a claim about intent that the transport does not honour. Require it to
  // be honest.
  if (url.protocol !== 'https:') return false;

  // Credentials in the URL are never part of a push endpoint and are a way to
  // make one host look like another to a careless reader.
  if (url.username || url.password) return false;

  // Real push services answer on 443. A port is how an internal service is
  // usually addressed, and refusing one costs nothing a browser needs.
  if (url.port !== '' && url.port !== '443') return false;

  const host = url.hostname.toLowerCase();

  /*
   * No push service is addressed by a bare IP, and every address the audit
   * reached was one. Rejecting the literal form closes those without needing to
   * enumerate private ranges — and the allowlist below closes the rest,
   * including a name that resolves to somewhere internal.
   */
  if (/^\d+(\.\d+){3}$/.test(host)) return false;
  if (host.startsWith('[') || host.includes(':')) return false;

  return allowedPushHosts().some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

/**
 * The one call that leaves the building, behind a name.
 *
 * `web-push` speaks HTTPS unconditionally, which is right — every real push
 * endpoint is HTTPS and a plaintext one would put a citizen's notification on
 * the wire.
 *
 * It was also claimed here that this "means the delivery path cannot be aimed
 * at a local server". That was wrong, and it is the belief the defect above
 * grew in: `web-push` builds its request with `https.request` and takes the
 * hostname, port and path from the endpoint, so speaking HTTPS says nothing
 * about *where*. `https://127.0.0.1:4000/…` dials 127.0.0.1 on port 4000.
 * What keeps the delivery path off the local network is `isAllowedPushEndpoint`,
 * not the protocol.
 *
 * That branch is worth reaching. Retiring a subscription cannot be undone from
 * this side — nothing here can recreate one, only the citizen opening the
 * application again — so getting it wrong on a push service's bad afternoon
 * would quietly unsubscribe the fleet.
 */
type PushTransport = (
  subscription: webpush.PushSubscription,
  payload: string,
  options: webpush.RequestOptions,
) => Promise<{ statusCode: number }>;

const realTransport: PushTransport = (subscription, payload, options) =>
  webpush.sendNotification(subscription, payload, options);

let transport: PushTransport = realTransport;

export function setPushTransportForTesting(fn: PushTransport): void {
  transport = fn;
}

export function resetPushTransport(): void {
  transport = realTransport;
}

/**
 * Outbound proxy, because a government network usually has one.
 *
 * PSIRS egress is unlikely to be direct, and a push that cannot leave the
 * network fails as a connection error — indistinguishable, without this, from
 * the push service being down. `web-push` handles the proxy itself; this only
 * decides whether to hand it one.
 */
function proxyUrl(): string | undefined {
  return process.env.PUSH_PROXY_URL?.trim() || process.env.HTTPS_PROXY?.trim() || undefined;
}

let configured: VapidKeys | null | undefined;

/** The configured identity, or null when there is none. Never invented. */
export function vapidKeys(): VapidKeys | null {
  if (configured === undefined) configured = fromEnvironment();
  return configured;
}

/** Test seam. Production reads the environment and nothing else. */
export function setVapidForTesting(keys: VapidKeys): void {
  configured = {
    ...keys,
    publicKey: publicKeyFor(keys.publicKey),
    privateKey: privateKeyFor(keys.privateKey),
  };
}

export function clearVapidForTesting(): void {
  configured = null;
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
export function getVapidPublicKey(): string | null {
  return vapidKeys()?.publicKey ?? null;
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
 * This server has no identity to sign with.
 *
 * Its own class, because the caller has to tell it from everything else that
 * can go wrong. It is transient — two environment variables away from working
 * — and it is a fact about the deployment rather than about the handset or the
 * person, so it must never be recorded as a failed delivery against either.
 */
export class PushNotConfiguredError extends Error {
  constructor() {
    super(
      'Web push is not configured. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY; nothing has ' +
        'been sent, and no subscription has been counted as failed.',
    );
    this.name = 'PushNotConfiguredError';
  }
}

/**
 * The request that would go out, without sending it.
 *
 * `web-push` builds this the same way for a real send, so asserting on it is
 * asserting on the wire format: the aes128gcm body the push service cannot
 * read, and the VAPID signature it checks before routing anything. It is also
 * the thing to print when a deployment's pushes are being refused and nobody
 * can see why.
 */
export function pushRequestFor(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: { title: string; body: string },
): { endpoint: string; headers: Record<string, string>; body: Buffer } {
  const keys = vapidKeys();
  if (!keys) throw new Error('Web push is not configured.');

  const details = webpush.generateRequestDetails(
    {
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth },
    },
    JSON.stringify(payload),
    {
      vapidDetails: {
        subject: keys.subject,
        publicKey: keys.publicKey,
        privateKey: keys.privateKey,
      },
      TTL: 60 * 60 * 24,
    },
  );

  return {
    endpoint: details.endpoint,
    headers: details.headers as Record<string, string>,
    body: details.body as Buffer,
  };
}

/**
 * Deliver to every live handset a person or an agent has registered.
 *
 * This counted a `console.log` as a delivery and returned it as `sent`, and
 * then — correctly — refused outright rather than lying. It sends now, and the
 * outcomes are the same ones every other integration in this platform reports:
 *
 *   sent      the push service accepted the message for delivery
 *   failed    it refused, and the subscription is retired only if the service
 *             said the handset itself is gone
 *   throws    this server has no identity to sign with, which is not a fact
 *             about any handset and must not be counted against one
 *
 * The last distinction costs something to get wrong. A push service returning
 * 503 on a bad afternoon is not a verdict about a citizen's phone, and retiring
 * the fleet over it is unrecoverable: a subscription cannot be recreated from
 * here, only by every citizen opening the application again.
 */
export async function sendPushNotification(
  target: { userId?: string; agentId?: string },
  payload: { title: string; body: string; data?: Record<string, unknown> },
): Promise<{ sent: number; failed: number }> {
  const keys = vapidKeys();
  if (!keys) {
    throw new PushNotConfiguredError();
  }

  const subscriptions = await subscriptionsFor(target);
  if (subscriptions.length === 0) return { sent: 0, failed: 0 };

  const message = JSON.stringify({
    title: payload.title,
    body: payload.body,
    ...(payload.data ? { data: payload.data } : {}),
  });

  let sent = 0;
  let failed = 0;

  for (const subscription of subscriptions) {
    /*
     * A row saved before the browser handed over its keys cannot be encrypted
     * to. Skipped rather than counted as a failure, and not allowed to stop the
     * handsets that can be reached.
     */
    if (!subscription.p256dh || !subscription.auth_secret) {
      log.warn('push subscription has no encryption keys', {
        component: 'push',
        endpoint: subscription.endpoint,
      });
      continue;
    }

    /*
     * Nothing is dialled that this platform would not have accepted.
     *
     * The route refuses these now, so a row reaching here should be one stored
     * before that rule existed. Checked anyway, because the cost of being wrong
     * is a connection from a government server to an address a caller chose,
     * and because the check at the boundary protects only the callers that go
     * through the boundary.
     */
    if (!isAllowedPushEndpoint(subscription.endpoint)) {
      log.warn('refusing to deliver to an endpoint outside the allowed push services', {
        component: 'push',
        endpoint: subscription.endpoint,
      });
      failed += 1;
      continue;
    }

    try {
      await transport(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth_secret },
        },
        message,
        {
          vapidDetails: {
            subject: keys.subject,
            publicKey: keys.publicKey,
            privateKey: keys.privateKey,
          },
          TTL: 60 * 60 * 24,
          ...(proxyUrl() ? { proxy: proxyUrl() } : {}),
        },
      );
      sent += 1;
    } catch (error) {
      failed += 1;
      const status = (error as { statusCode?: number }).statusCode;

      /*
       * 404 and 410 are how a push service reports that the handset is gone —
       * the browser uninstalled, the site data cleared, the subscription
       * revoked. Left in the table it is retried on every notification for
       * ever, and the failure count grows with nothing actually wrong.
       *
       * Every other status, and every error with none, leaves the row alone.
       */
      if (status === 404 || status === 410) {
        await removeSubscription(subscription.endpoint);
        log.info('push subscription retired by the push service', {
          component: 'push',
          endpoint: subscription.endpoint,
          status,
        });
      } else {
        log.warn('push delivery failed', {
          component: 'push',
          endpoint: subscription.endpoint,
          status: status ?? null,
        });
      }
    }
  }

  return { sent, failed };
}
