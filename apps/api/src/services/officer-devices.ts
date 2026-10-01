/**
 * The machines an officer signs in from, and the sessions those machines hold.
 *
 * WHY OFFICERS DO NOT GET WHAT AGENTS GET
 *
 * An agent's handset is registered, approved by a person, bound to that agent,
 * and revocable -- and a revoked handset cannot collect a naira. That is right
 * for a device carrying money in a market and wrong for an officer's browser:
 * pre-approving one before an officer can work puts a queue between an
 * emergency and the person handling it, and a revenue office that cannot sign
 * in on the machine at the counter is a revenue office that stops.
 *
 * So a device here is *discovered*. The first sign-in from one creates the
 * row; every later one touches it. What officers gain is the half that matters
 * when something goes wrong: they can see where they are signed in and end any
 * of it, an administrator can see the same for anybody and block a machine
 * outright, and migration 063 makes a blocked device unable to hold a session
 * at the database -- because the case a block is for is a laptop somebody else
 * already has.
 *
 * WHAT A FINGERPRINT IS NOT
 *
 * It is not an identity, and nothing here treats it as one. It exists so a
 * person reading a list of their own sessions can tell which is the one at the
 * counter downstairs. Two officers on identical machines produce the same
 * fingerprint and it does not matter: the rows are per user, and a device is
 * never a credential.
 */

import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { Db } from '../db/pool';
import { query, queryOne, withTransaction } from '../db/pool';
import { conflict, forbidden, notFound } from '../lib/errors';
import { recordAudit } from './audit';

export interface Actor {
  userId: string;
  role: string;
}

/**
 * A handle for "the same browser on the same machine".
 *
 * Deliberately not the address. An officer on the state network shares one
 * with the whole building, and an officer on a phone changes theirs every few
 * minutes -- so an address-based handle would merge every colleague into one
 * device and split one officer's morning into six.
 *
 * AND DELIBERATELY NOT THE USER AGENT, WHICH IS WHAT IT USED TO BE
 *
 * This hashed `${clientDeviceId}|${userAgent}`, and the officer portal never
 * sent a client identifier -- only the agent app did, and agents do not get
 * officer device rows at all (see `auth.ts`, which passes null for them). So
 * for every officer the first half was empty and the handle was a function of
 * the user agent and nothing else. Two consequences, and the second is the
 * one that matters:
 *
 *   - Two machines running the same browser build were one device. An
 *     officer's desktop and laptop appeared as a single row, and blocking
 *     either blocked both.
 *   - A browser update changed the user agent, which changed the handle, so
 *     the next sign-in matched no row and inserted a fresh ACTIVE one. The
 *     remedy `auth.ts` offers for "a laptop in somebody else's hands"
 *     therefore expired at the next Chrome update, every few weeks, silently.
 *
 * `blockDevice` was never the weak part: it revokes the sessions and
 * migration 063's trigger refuses any future session on that row at the
 * database. Both are correct about the row they name. The row simply stopped
 * being the one the laptop came back as.
 *
 * So when the client sends an identifier, that is the whole handle and the
 * user agent is excluded -- otherwise a browser update would move the
 * fingerprint again and nothing would be fixed. The user agent is still
 * stored on the row and still produces the label a person reads.
 *
 * WHAT THIS DOES NOT CLAIM. The identifier lives in the browser's own
 * storage, so whoever holds the machine can clear it and come back as a new
 * device. Blocking is not tamper-proof against someone with the laptop and
 * must not be relied on as though it were; the durable controls are ending
 * the sessions and disabling the account. What this fixes is the routine
 * silent failure and the two-machines-one-row conflation.
 *
 * The comment on `officer_devices.fingerprint` in migration 063 still
 * describes the old intent. It cannot be corrected: `migrate.ts` records a
 * checksum of every applied file and refuses to start when one changes, so
 * editing an applied migration would stop every existing deployment booting.
 */
export function fingerprintOf(userAgent: string | null, clientDeviceId: string | null): string {
  const material = clientDeviceId ? `device:${clientDeviceId}` : `|${userAgent ?? ''}`;
  return createHash('sha256').update(material).digest('hex').slice(0, 32);
}

/**
 * The handle an officer's row carries if it was created before the portal sent
 * an identifier.
 *
 * Kept so `deviceForSignIn` can find such a row and carry it forward instead
 * of leaving it behind. Leaving it behind is not a cosmetic loss: a BLOCKED
 * row left behind is a block that stopped applying, which would have made
 * this change unblock every blocked device in the estate on the day it
 * deployed.
 */
export function legacyFingerprintOf(userAgent: string | null): string {
  return createHash('sha256').update(`|${userAgent ?? ''}`).digest('hex').slice(0, 32);
}

/**
 * A short, human label from a user agent string.
 *
 * "Chrome on Windows" is what a person needs to recognise a row; the full user
 * agent is kept beside it for whoever is investigating rather than choosing.
 * Nothing here parses versions: an officer deciding which session to end does
 * not care, and a version-aware parser is a thing that goes out of date.
 */
export function labelFor(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device';
  const browser =
    /\bEdg\//.test(userAgent) ? 'Edge'
    : /\bOPR\/|\bOpera\b/.test(userAgent) ? 'Opera'
    : /\bChrome\//.test(userAgent) ? 'Chrome'
    : /\bFirefox\//.test(userAgent) ? 'Firefox'
    : /\bSafari\//.test(userAgent) ? 'Safari'
    : 'Browser';
  const platform =
    /\bAndroid\b/.test(userAgent) ? 'Android'
    : /\biPhone\b|\biPad\b/.test(userAgent) ? 'iOS'
    : /\bWindows\b/.test(userAgent) ? 'Windows'
    : /\bMac OS X\b/.test(userAgent) ? 'macOS'
    : /\bLinux\b/.test(userAgent) ? 'Linux'
    : 'an unrecognised system';
  return `${browser} on ${platform}`;
}

/**
 * Find or create the device this sign-in came from.
 *
 * Refuses a blocked one here as well as at the database, so the officer gets a
 * sentence explaining what happened rather than a constraint violation. The
 * database check is what makes it true; this one is what makes it usable.
 */
export async function deviceForSignIn(
  client: PoolClient,
  params: { userId: string; userAgent: string | null; clientDeviceId: string | null },
): Promise<string> {
  const fingerprint = fingerprintOf(params.userAgent, params.clientDeviceId);

  const find = (handle: string) =>
    queryOne<{ id: string; status: string }>(
      client,
      'SELECT id, status FROM officer_devices WHERE user_id = $1 AND fingerprint = $2',
      [params.userId, handle],
    );

  let existing = await find(fingerprint);

  /*
   * The row this machine used to be, before it sent an identifier.
   *
   * Only worth looking for when an identifier arrived and the new handle
   * matched nothing: that is exactly the first sign-in after this change
   * reached the browser. Adopting the row rather than inserting beside it
   * keeps the device's history, its label and -- the point -- its status. A
   * BLOCKED row found here refuses below, which is what stops this change
   * from unblocking every blocked device on the day it ships.
   *
   * Two machines that shared one legacy row split apart over time: the first
   * to sign in adopts it, the second finds neither handle and gets its own.
   * That is the conflation unwinding, in the only direction it can.
   *
   * Two things keep a BLOCKED row's handle intact, and they are redundant:
   * the `status` test below, and the fact that `auth.ts` calls this inside
   * `withTransaction`, so the refusal thrown further down rolls the UPDATE
   * back anyway.
   *
   * Measured, because the obvious guess was wrong twice. Removing the status
   * test alone changes no observable behaviour and kills no test — the
   * rollback covers it. Removing the transaction alone also kills no test —
   * the status test covers it. Removing BOTH fails two: a second machine that
   * shared the blocked row stops matching it and walks past the block, and a
   * refused attempt leaves the row carrying a different handle.
   *
   * So neither is "the" protection and neither is ornamental. Both stay, and
   * the pair is what the tests pin.
   */
  if (!existing && params.clientDeviceId) {
    const legacy = await find(legacyFingerprintOf(params.userAgent));
    if (legacy) {
      if (legacy.status !== 'BLOCKED') {
        await client.query('UPDATE officer_devices SET fingerprint = $2 WHERE id = $1', [
          legacy.id,
          fingerprint,
        ]);
      }
      existing = legacy;
    }
  }

  if (existing) {
    if (existing.status === 'BLOCKED') {
      throw forbidden(
        'This device has been blocked. Sign in from another one.',
        'An administrator can unblock it.',
      );
    }
    await client.query(
      'UPDATE officer_devices SET last_seen_at = now(), user_agent = $2 WHERE id = $1',
      [existing.id, params.userAgent],
    );
    return existing.id;
  }

  const created = await queryOne<{ id: string }>(
    client,
    `INSERT INTO officer_devices (user_id, fingerprint, label, user_agent)
     VALUES ($1,$2,$3,$4)
     RETURNING id`,
    [params.userId, fingerprint, labelFor(params.userAgent), params.userAgent],
  );
  return created!.id;
}

// ===========================================================================

export interface SessionRow {
  id: string;
  device_label: string | null;
  device_status: string | null;
  user_agent: string | null;
  ip_address: string | null;
  issued_at: string;
  last_used_at: string | null;
  expires_at: string;
  revoked_at: string | null;
  revoked_reason: string | null;
  full_name?: string;
}

/**
 * Every session an officer holds, current one first.
 *
 * Revoked sessions are included and marked rather than filtered out, because
 * "I ended that one on Tuesday" is exactly what somebody checking their own
 * account needs to see, and an administrator investigating needs it more.
 */
export async function sessionsFor(
  db: Db,
  userId: string,
  currentSessionId: string | null,
): Promise<(SessionRow & { is_current: boolean })[]> {
  const rows = await query<SessionRow>(
    db,
    `SELECT s.id, s.ip_address::text AS ip_address, s.user_agent,
            s.issued_at, s.last_used_at, s.expires_at, s.revoked_at, s.revoked_reason,
            d.label AS device_label, d.status AS device_status
       FROM sessions s
       LEFT JOIN officer_devices d ON d.id = s.officer_device_id
      WHERE s.user_id = $1
      ORDER BY (s.revoked_at IS NULL) DESC, s.last_used_at DESC NULLS LAST, s.issued_at DESC
      LIMIT 100`,
    [userId],
  );
  return rows.map((row) => ({ ...row, is_current: row.id === currentSessionId }));
}

/**
 * End one session.
 *
 * `mayEndAnyone` is the administrator's authority and is checked by the
 * caller; what this enforces is that without it an officer can only end their
 * own -- stated on the row being ended rather than on the request, because
 * "mine" is a fact about the session and not about the URL.
 */
export async function endSession(
  actor: Actor,
  sessionId: string,
  options: { mayEndAnyone: boolean; reason: string },
): Promise<void> {
  await withTransaction(async (client) => {
    const session = await queryOne<{ id: string; user_id: string; revoked_at: string | null }>(
      client,
      'SELECT id, user_id, revoked_at FROM sessions WHERE id = $1',
      [sessionId],
    );
    if (!session) throw notFound('That session');
    if (session.user_id !== actor.userId && !options.mayEndAnyone) {
      /*
       * Not found rather than forbidden. A 403 here would confirm that a
       * session id belongs to somebody, which is more than a caller who may
       * not touch it should learn from asking.
       */
      throw notFound('That session');
    }
    if (session.revoked_at) {
      throw conflict('SESSION_ALREADY_ENDED', 'That session has already ended.');
    }

    await client.query(
      'UPDATE sessions SET revoked_at = now(), revoked_reason = $2 WHERE id = $1',
      [sessionId, options.reason],
    );

    await recordAudit(client, {
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'session.end',
      entityType: 'session',
      entityId: sessionId,
      newValue: { ownSession: session.user_id === actor.userId, userId: session.user_id },
      reason: options.reason,
    });
  });
}

// ===========================================================================

export async function devicesFor(db: Db, userId: string) {
  return query(
    db,
    `SELECT d.id, d.label, d.user_agent, d.first_seen_at, d.last_seen_at, d.status,
            d.blocked_at, d.block_reason,
            b.full_name AS blocked_by_name,
            (SELECT count(*)::int FROM sessions s
              WHERE s.officer_device_id = d.id AND s.revoked_at IS NULL
                AND s.expires_at > now()) AS live_sessions
       FROM officer_devices d
       LEFT JOIN users b ON b.id = d.blocked_by
      WHERE d.user_id = $1
      ORDER BY d.last_seen_at DESC`,
    [userId],
  );
}

/**
 * Block a device, and end what it is holding in the same breath.
 *
 * Blocking without revoking would be theatre: the access token in memory on
 * that machine keeps working until it expires and the refresh token keeps
 * minting more. One transaction, so there is no moment where the device is
 * marked blocked and still signed in.
 */
export async function blockDevice(
  actor: Actor,
  deviceId: string,
  reason: string,
): Promise<{ sessionsEnded: number }> {
  return withTransaction(async (client) => {
    const device = await queryOne<{ id: string; user_id: string; status: string; label: string }>(
      client,
      'SELECT id, user_id, status, label FROM officer_devices WHERE id = $1',
      [deviceId],
    );
    if (!device) throw notFound('That device');
    if (device.status === 'BLOCKED') {
      throw conflict('DEVICE_ALREADY_BLOCKED', `${device.label} is already blocked.`);
    }

    await client.query(
      `UPDATE officer_devices
          SET status = 'BLOCKED', blocked_at = now(), blocked_by = $2, block_reason = $3
        WHERE id = $1`,
      [deviceId, actor.userId, reason],
    );

    const ended = await client.query(
      `UPDATE sessions
          SET revoked_at = now(), revoked_reason = $2
        WHERE officer_device_id = $1 AND revoked_at IS NULL`,
      [deviceId, `Device blocked: ${reason}`],
    );

    await recordAudit(client, {
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'officer.device.block',
      entityType: 'officer_device',
      entityId: deviceId,
      oldValue: { status: 'ACTIVE' },
      newValue: { status: 'BLOCKED', userId: device.user_id, sessionsEnded: ended.rowCount ?? 0 },
      reason,
    });

    return { sessionsEnded: ended.rowCount ?? 0 };
  });
}

/**
 * And back.
 *
 * A block that could not be lifted would make a mistyped device id permanent
 * for the officer it landed on, which is a worse failure than the one blocking
 * guards against. Sessions are not restored: whoever had the machine has been
 * signed out, and the officer signs in again.
 */
export async function unblockDevice(
  actor: Actor,
  deviceId: string,
  reason: string,
): Promise<void> {
  await withTransaction(async (client) => {
    const device = await queryOne<{ id: string; status: string; label: string }>(
      client,
      'SELECT id, status, label FROM officer_devices WHERE id = $1',
      [deviceId],
    );
    if (!device) throw notFound('That device');
    if (device.status !== 'BLOCKED') {
      throw conflict('DEVICE_NOT_BLOCKED', `${device.label} is not blocked.`);
    }

    await client.query(
      `UPDATE officer_devices
          SET status = 'ACTIVE', blocked_at = NULL, blocked_by = NULL, block_reason = NULL
        WHERE id = $1`,
      [deviceId],
    );

    await recordAudit(client, {
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'officer.device.unblock',
      entityType: 'officer_device',
      entityId: deviceId,
      oldValue: { status: 'BLOCKED' },
      newValue: { status: 'ACTIVE' },
      reason,
    });
  });
}
