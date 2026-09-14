/**
 * The audit chain claims that editing a recorded row is detectable by replay,
 * "even by someone with database access". That claim rested on every field
 * having exactly one digest, and for two of them it did not.
 *
 * Until hash version 3, every covered field went through one encoder that
 * coerced anything matching /^-?\d*\.?\d+$/ to a JavaScript number. That was
 * written for latitude and longitude, which postgres returns as the string
 * "9.896500" for a value written as 9.8965 — but it was applied to the five
 * TEXT columns too, and those come back byte-for-byte as they went in. The
 * coercion therefore threw away real differences: "0007" and "7" hash the
 * same, "1500" and "1500.00" hash the same, and two identifiers longer than a
 * double can hold collapse onto one value. Somebody with database access could
 * rewrite those fields and the auditor's own verifier would report the log
 * intact.
 *
 * request_id is the sharp end: it is taken from the caller's X-Request-Id
 * header, so the value that later needs to collide is chosen by whoever made
 * the request.
 *
 * The sibling defect is the one the coercion was written for and did not
 * finish: the writer hashed the number it was handed while the column stored
 * that number rounded to NUMERIC(9,6), so an entry carrying a coordinate from
 * a handset's GPS failed its own verification the first time anybody checked.
 *
 * The existing chain tests did not catch either. They tamper with request_id
 * by rewriting "req-original-0001" to "req-rewritten-9999" — two values that
 * sit outside the broken class, so the assertion held while the property did
 * not.
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import {
  createGovernmentUser,
  pool,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './helpers';
import { queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { computeHash, recordAuditStandalone, verifyAuditChain } from '../services/audit';

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
  await createGovernmentUser({ fullName: 'Audit Admin', phone: '+2348000000121', role: 'admin' });
  const officer = await queryOne<{ id: string }>(
    pool,
    `SELECT id FROM users WHERE phone = '+2348000000121'`,
  );
  officerId = officer!.id;
});

/** Rewrite a column the way somebody with rights over the database would. */
async function tamper(column: string, value: unknown): Promise<void> {
  await pool.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_no_update');
  try {
    await pool.query(`UPDATE audit_logs SET ${column} = $1 WHERE sequence_no = 1`, [value]);
  } finally {
    await pool.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_no_update');
  }
}

describe('A digest that two different records could share', () => {
  /*
   * Each pair is [column, as recorded, as rewritten]. The two spellings denote
   * the same number and different text, which is the whole point: the column
   * stores text, so the chain must tell them apart.
   */
  for (const [column, recorded, rewritten, what] of [
    ['request_id', '0007', '7', 'a leading zero dropped from the request id'],
    ['request_id', '12.00', '0012', 'the request id respelled around its decimal point'],
    [
      'request_id',
      '9007199254740993',
      '9007199254740992',
      'a request id changed past where a double can count',
    ],
    ['reason', '1500', '1500.00', 'the reason respelled as a decimal'],
    ['reason', '0042', '42', 'a leading zero dropped from the reason'],
  ] as const) {
    it(`refuses to call the chain valid after ${what}`, async () => {
      await recordAuditStandalone({
        actorId: officerId,
        actorRole: 'admin',
        action: 'payment.reversed',
        entityType: 'transaction',
        entityId: 'TXN-2026-000001',
        reason: column === 'reason' ? recorded : 'Taxpayer was charged twice.',
        requestId: column === 'request_id' ? recorded : 'req-original-0001',
      });

      const before = await verifyAuditChain(pool);
      assert.equal(before.valid, true, `the chain was not intact before tampering: ${JSON.stringify(before)}`);

      await tamper(column, rewritten);

      const after = await verifyAuditChain(pool);
      assert.equal(
        after.valid,
        false,
        `${column} was rewritten from ${recorded} to ${rewritten} and the auditor's own verifier reported the chain intact`,
      );
      assert.equal(after.verdict, 'CONTENT_MODIFIED');
      assert.equal(after.brokenAtSequence, 1);
    });
  }

  it('still calls an untouched chain valid, with those same values recorded', async () => {
    await recordAuditStandalone({
      actorId: officerId,
      actorRole: 'admin',
      action: 'payment.reversed',
      entityType: 'transaction',
      entityId: 'TXN-2026-000001',
      reason: '1500',
      requestId: '0007',
    });

    const result = await verifyAuditChain(pool);
    assert.equal(result.valid, true, JSON.stringify(result));
    assert.equal(result.verdict, 'INTACT');
  });
});

describe('A coordinate the column cannot hold at the precision it arrived', () => {
  it('verifies against what the column gives back, not what the handset sent', async () => {
    // More decimals than NUMERIC(9,6) keeps. A phone's GPS supplies this.
    await recordAuditStandalone({
      actorId: officerId,
      actorRole: 'admin',
      action: 'enumeration.recorded',
      entityType: 'taxpayer',
      entityId: 'TP-2026-000001',
      latitude: 9.8965004999,
      longitude: 8.8921117777,
    });

    const result = await verifyAuditChain(pool);
    assert.equal(
      result.valid,
      true,
      `an entry carrying a GPS coordinate failed its own verification: ${JSON.stringify(result)}`,
    );
  });

  it('stores the coordinate already rounded, so the database rounds nothing', async () => {
    await recordAuditStandalone({
      actorId: officerId,
      actorRole: 'admin',
      action: 'enumeration.recorded',
      entityType: 'taxpayer',
      entityId: 'TP-2026-000002',
      latitude: 9.8965004999,
      longitude: 8.8921117777,
    });

    const row = await queryOne<{ latitude: string; longitude: string }>(
      pool,
      'SELECT latitude, longitude FROM audit_logs WHERE sequence_no = 1',
    );
    assert.equal(row!.latitude, '9.896500');
    assert.equal(row!.longitude, '8.892112');
  });

  /*
   * The tie case, and the reason the value is rounded before it is hashed
   * rather than only when it is read back.
   *
   * node-postgres sends a JS number as its decimal text, so postgres parses
   * "9.0010005" as an exact decimal, sees a tie at the sixth place and rounds
   * half away from zero: 9.001001. JS reaches for the nearest double first,
   * which sits just below that midpoint, so toFixed(6) gives 9.001000. Hashing
   * the number the caller passed and storing what postgres made of it would
   * therefore disagree for roughly half of all such coordinates, and the
   * auditor would be told the row had been altered.
   *
   * Measured against this database: of 400 coordinates whose seventh decimal
   * is 5, 198 round differently in postgres than in JS.
   */
  it('verifies a coordinate that postgres and JavaScript round differently', async () => {
    await recordAuditStandalone({
      actorId: officerId,
      actorRole: 'admin',
      action: 'enumeration.recorded',
      entityType: 'taxpayer',
      entityId: 'TP-2026-000004',
      latitude: 9.0010005,
      longitude: 8.0020005,
    });

    const result = await verifyAuditChain(pool);
    assert.equal(
      result.valid,
      true,
      `a coordinate sitting on a rounding tie failed its own verification: ${JSON.stringify(result)}`,
    );

    // And it is stored as the value that was hashed, not as postgres' rounding.
    const row = await queryOne<{ latitude: string; longitude: string }>(
      pool,
      'SELECT latitude, longitude FROM audit_logs WHERE sequence_no = 1',
    );
    assert.equal(row!.latitude, '9.001000');
    assert.equal(row!.longitude, '8.002000');
  });

  it('still notices the coordinate being moved', async () => {
    await recordAuditStandalone({
      actorId: officerId,
      actorRole: 'admin',
      action: 'enumeration.recorded',
      entityType: 'taxpayer',
      entityId: 'TP-2026-000003',
      latitude: 9.8965004999,
      longitude: 8.8921117777,
    });

    await tamper('latitude', 4.815162);

    const result = await verifyAuditChain(pool);
    assert.equal(result.valid, false);
    assert.equal(result.verdict, 'CONTENT_MODIFIED');
  });
});

describe('Entries written under the previous algorithm', () => {
  /*
   * Frozen vectors. These two digests were produced by version 2 as it stood
   * before version 3 existed. Every audit row already on disk was written with
   * that code, so if these move, those rows stop verifying and the chain
   * reports tampering across the whole history.
   */
  const V2_ENTRY = {
    sequenceNo: 1,
    actorId: 'a',
    action: 'x',
    entityType: 'y',
    entityId: 'z',
    oldValue: null,
    newValue: null,
    result: 'SUCCESS',
    createdAt: '2026-09-14T00:00:00.000Z',
    prevHash: null,
    actorRole: 'AGENT',
    reason: null,
    ipAddress: null,
    deviceId: null,
    requestId: null,
  };

  it('still produce the digest version 2 gave them, for a coordinate as a number', () => {
    assert.equal(
      computeHash({ ...V2_ENTRY, latitude: 9.8965004999, longitude: 8.8921117777 }, 2),
      '80ff2c7d941ac8f1c6801ded337dc72da42bcf55cf313e00bc44aa282738fa20',
    );
  });

  it('still produce the digest version 2 gave them, for a coordinate as a string', () => {
    assert.equal(
      computeHash({ ...V2_ENTRY, latitude: '9.896500', longitude: '8.892112' }, 2),
      'a2d73d6fb2cce3f994bb640ee9550e4758db57f75161d82f23f92fb66365928d',
    );
  });

  it('differ from version 3 only where version 2 lost a difference', () => {
    const withProse = { ...V2_ENTRY, latitude: null, longitude: null, reason: 'stolen laptop' };
    assert.equal(
      computeHash(withProse, 2),
      computeHash(withProse, 3),
      'a reason that was never coerced should hash the same under both versions',
    );

    const withDigits = { ...V2_ENTRY, latitude: null, longitude: null, reason: '0007' };
    assert.notEqual(
      computeHash(withDigits, 2),
      computeHash(withDigits, 3),
      'a reason version 2 coerced to a number must hash differently now it is kept as text',
    );
  });
});
