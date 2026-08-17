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

function computeHash(entry: {
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
}): string {
  // Field order is fixed and values are canonically encoded so the digest is
  // reproducible by any independent verifier reading the same rows.
  const canonical = JSON.stringify([
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
  ]);
  return createHash('sha256').update(canonical).digest('hex');
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
  });

  const row = await queryOne<{ id: string }>(
    client,
    `INSERT INTO audit_logs (
       sequence_no, actor_id, actor_role, action, entity_type, entity_id,
       old_value, new_value, reason, result, ip_address, device_id,
       latitude, longitude, request_id, prev_hash, hash, created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
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
  }>(
    db,
    `SELECT sequence_no, actor_id, action, entity_type, entity_id, old_value,
            new_value, result, created_at, prev_hash, hash
       FROM audit_logs
      WHERE sequence_no >= $1
      ORDER BY sequence_no ASC
      LIMIT $2`,
    [options.fromSequence ?? 0, options.limit ?? 10_000],
  );

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

    const recomputed = computeHash({
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
    });

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
