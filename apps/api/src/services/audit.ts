/**
 * Audit trail (PRD §45, §67).
 *
 * Entries form a hash chain: each row's hash covers its own content plus the
 * hash of the row before it. Deleting or editing any historical entry breaks
 * every hash after it, so tampering is detectable by replay even by someone
 * with database access. Combined with the append-only triggers in migration
 * 001, "silently altering historical financial records" (PRD §7.6) requires
 * defeating both the triggers and the chain.
 */

import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { Db } from '../db/pool';
import { advisoryLock, LOCK_NAMESPACE, query, queryOne, withTransaction } from '../db/pool';

export interface AuditEntry {
  actorId?: string | null;
  actorRole?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
  result?: 'SUCCESS' | 'FAILURE' | 'DENIED';
  ipAddress?: string | null;
  deviceId?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  requestId?: string | null;
}

/**
 * Serialise a value so that the same data always produces the same bytes.
 *
 * Object keys are sorted recursively. This matters because `old_value` and
 * `new_value` are stored as JSONB, and PostgreSQL does not preserve key order
 * in that type — it normalises it. Hashing `JSON.stringify(value)` at insert
 * time and again after a round trip through JSONB would therefore produce two
 * different digests for identical data, and every verification would report
 * tampering that had not happened.
 */
function canonicalJson(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalJson);
  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((accumulator, key) => {
      accumulator[key] = canonicalJson((value as Record<string, unknown>)[key]);
      return accumulator;
    }, {});
}

export function computeHash(entry: {
  sequenceNo: number;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  oldValue: unknown;
  newValue: unknown;
  result: string;
  createdAt: string;
  prevHash: string | null;
  actorRole?: string | null;
  reason?: string | null;
  ipAddress?: string | null;
  deviceId?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  requestId?: string | null;
}, version: HashVersion = CURRENT_HASH_VERSION): string {
  // Field order is fixed and values are canonically encoded so the digest is
  // reproducible by any independent verifier reading the same rows.
  const base = [
    entry.sequenceNo,
    entry.actorId,
    entry.action,
    entry.entityType,
    entry.entityId,
    canonicalJson(entry.oldValue ?? null),
    canonicalJson(entry.newValue ?? null),
    entry.result,
    entry.createdAt,
    entry.prevHash,
  ];

  /*
   * Version 2 covers the rest of the row: the authority somebody claimed, the
   * reason they gave, and where and on what they were when they gave it.
   *
   * Numbers are normalised through Number() on both sides because postgres
   * returns NUMERIC(9,6) as the string "9.896500" while the value written was
   * 9.8965. Hashing either form directly would make every entry carrying a
   * coordinate fail its own verification.
   */
  const canonical =
    version === 1
      ? JSON.stringify(base)
      : JSON.stringify([
          ...base,
          canonicalField(entry.actorRole),
          canonicalField(entry.reason),
          canonicalField(entry.ipAddress),
          canonicalField(entry.deviceId),
          canonicalField(entry.latitude),
          canonicalField(entry.longitude),
          canonicalField(entry.requestId),
        ]);

  return createHash('sha256').update(canonical).digest('hex');
}

export type HashVersion = 1 | 2;

/** The digest new entries are written with. */
export const CURRENT_HASH_VERSION: HashVersion = 2;

/** One field, in a form both the writer and a later reader agree on. */
function canonicalField(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  const text = String(value);
  // A postgres NUMERIC arrives as a string; compare it as the number it is.
  const asNumber = Number(text);
  return text.trim() !== '' && Number.isFinite(asNumber) && /^-?\d*\.?\d+$/.test(text.trim())
    ? asNumber
    : text;
}

/**
 * Append one audit entry.
 *
 * Must run inside the same transaction as the action it records, so an action
 * and its audit trail commit or roll back together — an unaudited state change
 * is never possible.
 */
export async function recordAudit(client: PoolClient, entry: AuditEntry): Promise<string> {
  // Serialise chain appends: two concurrent writers reading the same tail hash
  // would produce a fork that no verifier could replay.
  await advisoryLock(client, LOCK_NAMESPACE.AUDIT_CHAIN, 'audit');

  const previous = await queryOne<{ hash: string }>(
    client,
    'SELECT hash FROM audit_logs ORDER BY sequence_no DESC LIMIT 1',
  );

  const seqRow = await queryOne<{ value: string }>(
    client,
    "SELECT nextval('audit_logs_sequence_no_seq') AS value",
  );
  const sequenceNo = Number.parseInt(seqRow!.value, 10);
  const createdAt = new Date().toISOString();
  const prevHash = previous?.hash ?? null;

  const hash = computeHash({
    sequenceNo,
    actorId: entry.actorId ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    oldValue: entry.oldValue ?? null,
    newValue: entry.newValue ?? null,
    result: entry.result ?? 'SUCCESS',
    createdAt,
    prevHash,
    actorRole: entry.actorRole ?? null,
    reason: entry.reason ?? null,
    ipAddress: entry.ipAddress ?? null,
    deviceId: entry.deviceId ?? null,
    latitude: entry.latitude ?? null,
    longitude: entry.longitude ?? null,
    requestId: entry.requestId ?? null,
  });

  const row = await queryOne<{ id: string }>(
    client,
    `INSERT INTO audit_logs (
       sequence_no, actor_id, actor_role, action, entity_type, entity_id,
       old_value, new_value, reason, result, ip_address, device_id,
       latitude, longitude, request_id, prev_hash, hash, created_at, hash_version
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     RETURNING id`,
    [
      sequenceNo,
      entry.actorId ?? null,
      entry.actorRole ?? null,
      entry.action,
      entry.entityType,
      entry.entityId ?? null,
      entry.oldValue === undefined ? null : JSON.stringify(entry.oldValue),
      entry.newValue === undefined ? null : JSON.stringify(entry.newValue),
      entry.reason ?? null,
      entry.result ?? 'SUCCESS',
      entry.ipAddress ?? null,
      entry.deviceId ?? null,
      entry.latitude ?? null,
      entry.longitude ?? null,
      entry.requestId ?? null,
      prevHash,
      hash,
      createdAt,
      CURRENT_HASH_VERSION,
    ],
  );

  return row!.id;
}

/** Record an audit entry in its own transaction, for paths outside one. */
export async function recordAuditStandalone(entry: AuditEntry): Promise<string> {
  return withTransaction((client) => recordAudit(client, entry));
}

export interface ChainVerification {
  valid: boolean;
  entriesChecked: number;
  brokenAtSequence?: number;
  detail?: string;
}

/**
 * Replay the chain and confirm it has not been tampered with.
 *
 * Exposed to auditors (PRD §7.7) so integrity is something government can
 * check for itself rather than a property it has to take on trust.
 */
export async function verifyAuditChain(
  db: Db,
  options: { fromSequence?: number; limit?: number } = {},
): Promise<ChainVerification> {
  const rows = await query<{
    sequence_no: string;
    actor_id: string | null;
    action: string;
    entity_type: string;
    entity_id: string | null;
    old_value: unknown;
    new_value: unknown;
    result: string;
    created_at: Date;
    prev_hash: string | null;
    hash: string;
    hash_version: number;
    actor_role: string | null;
    reason: string | null;
    ip_address: string | null;
    device_id: string | null;
    latitude: string | null;
    longitude: string | null;
    request_id: string | null;
  }>(
    db,
    `SELECT sequence_no, actor_id, action, entity_type, entity_id, old_value,
            new_value, result, created_at, prev_hash, hash, hash_version,
            actor_role, reason, ip_address, device_id, latitude, longitude, request_id
       FROM audit_logs
      WHERE sequence_no >= $1
      ORDER BY sequence_no ASC
      LIMIT $2`,
    [options.fromSequence ?? 0, options.limit ?? 10_000],
  );

  /*
   * THE GENESIS ENTRY, BEFORE ANYTHING ELSE.
   *
   * The loop below starts by adopting the first row's own prev_hash as what it
   * expects to see — which it has to, because a caller may verify a window
   * beginning anywhere. The cost is that deleting the head of the chain is
   * invisible: remove entries 1 to N and the remainder links to itself
   * perfectly, and the auditor is told the log is intact.
   *
   * So the oldest surviving entry is checked separately, whatever window was
   * asked for. Only the first entry ever written has no predecessor; if the
   * oldest row now claims one, the entries it pointed at are gone.
   *
   * Sequence numbers are deliberately NOT checked for continuity. They come
   * from a BIGSERIAL read inside the transaction that writes the entry, so a
   * rolled-back action leaves a gap that is entirely legitimate, and treating
   * that as tampering would cry wolf on the one control nobody can afford to
   * start ignoring.
   */
  const genesis = await queryOne<{ sequence_no: string; prev_hash: string | null }>(
    db,
    'SELECT sequence_no, prev_hash FROM audit_logs ORDER BY sequence_no ASC LIMIT 1',
  );

  if (genesis && genesis.prev_hash !== null) {
    return {
      valid: false,
      entriesChecked: 0,
      brokenAtSequence: Number.parseInt(genesis.sequence_no, 10),
      detail:
        'The oldest entry in the log names a predecessor that is not there: ' +
        'the beginning of the chain has been removed.',
    };
  }

  let expectedPrev: string | null = rows.length > 0 ? rows[0]!.prev_hash : null;
  let checked = 0;

  for (const row of rows) {
    if (row.prev_hash !== expectedPrev) {
      return {
        valid: false,
        entriesChecked: checked,
        brokenAtSequence: Number.parseInt(row.sequence_no, 10),
        detail: 'Chain link mismatch: an entry is missing or was inserted out of order.',
      };
    }

    const recomputed = computeHash(
      {
        sequenceNo: Number.parseInt(row.sequence_no, 10),
        actorId: row.actor_id,
        action: row.action,
        entityType: row.entity_type,
        entityId: row.entity_id,
        oldValue: row.old_value,
        newValue: row.new_value,
        result: row.result,
        createdAt: row.created_at.toISOString(),
        prevHash: row.prev_hash,
        actorRole: row.actor_role,
        reason: row.reason,
        ipAddress: row.ip_address,
        deviceId: row.device_id,
        latitude: row.latitude,
        longitude: row.longitude,
        requestId: row.request_id,
      },
      row.hash_version === 2 ? 2 : 1,
    );

    if (recomputed !== row.hash) {
      return {
        valid: false,
        entriesChecked: checked,
        brokenAtSequence: Number.parseInt(row.sequence_no, 10),
        detail: 'Entry content does not match its recorded hash: the row was modified.',
      };
    }

    expectedPrev = row.hash;
    checked += 1;
  }

  return { valid: true, entriesChecked: checked };
}
