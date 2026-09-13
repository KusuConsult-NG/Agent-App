/**
 * What the chain actually protects.
 *
 * `verifyAuditChain` says it "replays the chain and confirms it has not been
 * tampered with", and is exposed to auditors so integrity is something
 * government can check for itself rather than take on trust. It recomputes a
 * digest over ten fields. The row has seventeen.
 *
 * Seven are outside it: actor_role, reason, ip_address, device_id, latitude,
 * longitude, request_id. Those are not incidental columns. `reason` is the why
 * of every discretionary act on the platform — the words an officer typed when
 * reversing a payment, correcting a taxpayer record, or overriding an agent's
 * clearance. Latitude and longitude are what the platform attributes revenue
 * by and what the fraud rules read for impossible movement. actor_role is the
 * authority somebody claimed to be acting under.
 *
 * THE THREAT MODEL IS THE POINT. `audit_logs` carries triggers refusing UPDATE
 * and DELETE, so nothing reachable through the application can do this. A hash
 * chain exists for the case those triggers cannot cover: somebody with rights
 * over the database itself. In that case they can rewrite who was where, on
 * what device, under what authority and why — and the verifier the auditor
 * runs answers `valid: true`.
 *
 * These tests disable the trigger to stand in that attacker's shoes, which is
 * the only honest way to test a control whose whole purpose is to survive the
 * loss of the layer above it.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  loginAs,
  pool,
  post,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './helpers';
import { queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { computeHash, recordAuditStandalone, verifyAuditChain } from '../services/audit';
import { chainSentence } from '@psirs/shared';

let officerId = '';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({ fullName: 'Audit Admin', phone: '+2348000000120', role: 'admin' });
  const officer = await queryOne<{ id: string }>(
    pool,
    `SELECT id FROM users WHERE phone = '+2348000000120'`,
  );
  officerId = officer!.id;

  // A real entry, carrying every field a tamperer would want to change.
  await recordAuditStandalone({
    actorId: officerId,
    actorRole: 'admin',
    action: 'payment.reversed',
    entityType: 'transaction',
    entityId: 'TXN-2026-000001',
    oldValue: { status: 'SETTLED' },
    newValue: { status: 'REVERSED' },
    reason: 'Taxpayer was charged twice for the same market stall.',
    ipAddress: '10.1.2.3',
    latitude: 9.8965,
    longitude: 8.8583,
    requestId: 'req-original-0001',
  });
});

/**
 * Rewrite a column the way somebody with rights over the database would.
 *
 * The append-only trigger is exactly what such a person disables first, so the
 * test disables it too. Anything less would be testing the trigger rather than
 * the chain.
 */
async function tamper(column: string, value: unknown): Promise<void> {
  await pool.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_no_update');
  try {
    await pool.query(`UPDATE audit_logs SET ${column} = $1 WHERE sequence_no = 1`, [value]);
  } finally {
    await pool.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_no_update');
  }
}

describe('The chain notices the row being rewritten', () => {
  for (const [column, value, what] of [
    ['reason', 'Routine adjustment, nothing to see.', 'the reason an officer gave'],
    ['actor_role', 'system', 'the authority the actor claimed'],
    ['ip_address', '198.51.100.9', 'where the request came from'],
    ['latitude', 4.815, 'where the officer was standing'],
    ['request_id', 'req-rewritten-9999', 'the request it belonged to'],
  ] as const) {
    it(`refuses to call the chain valid after ${what} is changed`, async () => {
      await tamper(column, value);

      const result = await verifyAuditChain(pool);
      assert.equal(
        result.valid,
        false,
        `${column} was rewritten and the auditor's own verifier reported the chain intact`,
      );
      assert.equal(result.brokenAtSequence, 1);
    });
  }

  // --- controls ---

  it('still calls an untouched chain valid', async () => {
    const result = await verifyAuditChain(pool);
    assert.equal(result.valid, true, JSON.stringify(result));
    assert.ok(result.entriesChecked > 0);
    assert.equal(result.verdict, 'INTACT');
  });

  it('still catches the fields it always covered', async () => {
    await tamper('action', 'payment.approved');
    const result = await verifyAuditChain(pool);
    assert.equal(result.valid, false);
    assert.equal(result.verdict, 'CONTENT_MODIFIED');
  });

  it('still catches a row removed from the middle', async () => {
    await recordAuditStandalone({
      actorId: officerId,
      actorRole: 'admin',
      action: 'taxpayer.corrected',
      entityType: 'taxpayer',
      entityId: 'second',
      reason: 'Name spelling',
    });
    await pool.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_no_delete');
    try {
      await pool.query('DELETE FROM audit_logs WHERE sequence_no = 1');
    } finally {
      await pool.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_no_delete');
    }

    const result = await verifyAuditChain(pool);
    assert.equal(result.valid, false, 'a removed entry must break the chain');
    /*
     * And which check caught it, not merely that something did.
     *
     * Entry 1 is the genesis row, so what is left is a chain whose oldest
     * entry names a predecessor that is not there — the one break the replay
     * cannot see on its own, because the remainder links to itself perfectly.
     * Pinning the verdict is what distinguishes the separate genesis check
     * doing its job from the loop coincidentally tripping over the same row.
     */
    assert.equal(result.verdict, 'GENESIS_REMOVED');
  });

  /**
   * The one tampering a replay cannot see, and the number that makes it visible.
   *
   * Rewrite an entry and the recomputed hash disagrees. Remove one from the
   * middle and the next entry names a predecessor that is not there. Remove the
   * *most recent* entries and what is left is a shorter chain that links to
   * itself perfectly — there is nothing inside the log that says how long the
   * log was supposed to be.
   *
   * Measured on a copy of the seeded stack before this was written: deleting
   * the five newest of 198 entries produced "valid: 193 entries replayed end to
   * end", and the screen told the auditor "No tampering detected."
   *
   * That claim is now gone, and the answer carries `highestSequence` instead —
   * the number an auditor records so that a log which has been shortened since
   * is visible the next time they look. This pins both halves: the limitation
   * is real and deliberate, and the signal that exposes it must not regress.
   */
  it('cannot see a truncated tail, and says how far it got so somebody can', async () => {
    await recordAuditStandalone({
      actorId: officerId,
      actorRole: 'admin',
      action: 'taxpayer.corrected',
      entityType: 'taxpayer',
      entityId: 'before-truncation',
      reason: 'An entry somebody might prefer was not there',
    });

    const before = await verifyAuditChain(pool);
    assert.equal(before.verdict, 'INTACT', JSON.stringify(before));
    const head = await queryOne<{ max: string }>(
      pool,
      'SELECT COALESCE(max(sequence_no), 0)::text AS max FROM audit_logs',
    );
    assert.equal(
      before.highestSequence,
      Number.parseInt(head!.max, 10),
      'the answer must name the last entry it actually reached',
    );
    assert.ok(before.highestSequence > 1, 'the control is broken: too short a chain to truncate');

    await pool.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_no_delete');
    try {
      await pool.query('DELETE FROM audit_logs WHERE sequence_no = $1', [before.highestSequence]);
    } finally {
      await pool.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_no_delete');
    }

    const after = await verifyAuditChain(pool);
    assert.equal(
      after.verdict,
      'INTACT',
      'a replay of the log against itself cannot see its own tail cut off — if this ' +
        'ever fails, the limitation has been closed and this test should say so',
    );
    assert.equal(
      after.highestSequence,
      before.highestSequence - 1,
      'and the number that would tell an auditor has to move when the log shortens',
    );
  });

  it('the intact sentence does not claim more than the replay establishes', () => {
    const sentence = chainSentence('INTACT', { count: 198, sequence: 198 });
    assert.ok(
      !/no tampering/i.test(sentence),
      `the replay cannot establish that nothing was tampered with: ${sentence}`,
    );
    assert.match(sentence, /198/, 'and it must name how far it reached');
  });

  it('verifies a chain that spans the change of algorithm', async () => {
    /*
     * The claim 030 rests on: entries written before the digest was widened
     * keep version 1 and are verified under the old rule, so history is never
     * recomputed to match a new one — which in an append-only log is exactly
     * the move that would destroy the thing being protected.
     *
     * The version-1 row here is built the way one written a month ago would
     * be: the old digest, over the old ten fields, with the extra columns
     * populated and outside it.
     */
    const tail = await queryOne<{ hash: string; sequence_no: string }>(
      pool,
      'SELECT hash, sequence_no FROM audit_logs ORDER BY sequence_no DESC LIMIT 1',
    );
    const sequenceNo = Number.parseInt(tail!.sequence_no, 10) + 1;
    const createdAt = new Date().toISOString();
    const legacy = {
      sequenceNo,
      actorId: officerId,
      action: 'agent.suspended',
      entityType: 'agent',
      entityId: 'AGT-00007',
      oldValue: null,
      newValue: { status: 'SUSPENDED' },
      result: 'SUCCESS',
      createdAt,
      prevHash: tail!.hash,
    };

    await pool.query(
      `INSERT INTO audit_logs (sequence_no, actor_id, actor_role, action, entity_type,
                               entity_id, new_value, reason, result, prev_hash, hash,
                               created_at, hash_version)
       VALUES ($1,$2,'admin',$3,$4,$5,$6,'Written before the digest was widened',
               'SUCCESS',$7,$8,$9,1)`,
      [
        sequenceNo,
        officerId,
        legacy.action,
        legacy.entityType,
        legacy.entityId,
        JSON.stringify(legacy.newValue),
        legacy.prevHash,
        computeHash(legacy, 1),
        createdAt,
      ],
    );
    await pool.query("SELECT setval('audit_logs_sequence_no_seq', $1)", [sequenceNo]);

    // And a version-2 entry after it, through the ordinary path.
    await recordAuditStandalone({
      actorId: officerId,
      actorRole: 'admin',
      action: 'agent.reinstated',
      entityType: 'agent',
      entityId: 'AGT-00007',
      reason: 'Suspension lifted after review',
    });

    const result = await verifyAuditChain(pool);
    assert.equal(result.valid, true, JSON.stringify(result));
    assert.ok(result.entriesChecked >= 3, `expected the whole chain: ${result.entriesChecked}`);
  });

  it('still refuses an ordinary UPDATE, with the trigger in place', async () => {
    await assert.rejects(
      pool.query(`UPDATE audit_logs SET reason = 'x' WHERE sequence_no = 1`),
      /append-only/i,
    );
  });
});
