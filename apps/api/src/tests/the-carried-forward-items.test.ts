/**
 * The things found during the audit passes and left for later.
 *
 * Each was written down at the time rather than fixed, because widening a diff
 * mid-pass is how a fix for one thing breaks another. None blocked deployment.
 * All of them are the same kind of quiet: a guard that reads a state nothing
 * writes, a log that records everything except the one lookup that names a
 * person, a penalty applied to the wrong party.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  firstLgaId,
  get,
  loginAs,
  pool,
  post,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './helpers';
import { query, queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { config } from '../config';
import { computeComplianceScore } from '../services/incentives';
import { storageKey } from '../services/storage';

const ADMIN = '+2348030004400';
// The database refuses an approval whose maker is its approver, so the reversal
// fixture below needs two officers — which is the control working, not a
// nuisance: nobody may approve their own request to move money back.
const APPROVER = '+2348030004401';
let adminToken = '';
let lgaId = '';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  lgaId = await firstLgaId();
  await createGovernmentUser({ role: 'admin', phone: ADMIN, fullName: 'Carried Forward Admin' });
  await createGovernmentUser({ role: 'finance_officer', phone: APPROVER, fullName: 'Second Officer' });
  adminToken = (await loginAs(ADMIN)).accessToken;
});

// ---------------------------------------------------------------------------

describe('a handset state nothing could produce', () => {
  it('is no longer a state the database will accept', async () => {
    const rows = await query<{ definition: string }>(
      pool,
      `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
        WHERE conname = 'agent_devices_status_check'`,
    );
    assert.equal(rows.length, 1);
    assert.ok(
      !rows[0].definition.includes("'APPROVED'"),
      `APPROVED is still accepted: ${rows[0].definition}`,
    );
    // The four that remain are the four the code writes.
    for (const status of ['PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED']) {
      assert.ok(rows[0].definition.includes(`'${status}'`), `${status} should still be allowed`);
    }
  });

  it('is not left behind in the queries that used to look for it', async () => {
    const source = [
      'src/services/agents.ts',
    ].map((file) => require('node:fs').readFileSync(file, 'utf8')).join('\n');

    // The clearance check and the suspension sweep both listed APPROVED
    // alongside ACTIVE. A constraint that no longer allows it and a query that
    // still asks for it is worse than either alone: the query looks deliberate.
    assert.ok(
      !/agent_devices[\s\S]{0,200}'APPROVED'/.test(source),
      'a query still reads agent_devices for APPROVED',
    );
  });
});

// ---------------------------------------------------------------------------

describe('a citizen lookup', () => {
  async function taxpayerWithTin(tin: string, phone: string): Promise<string> {
    const row = await queryOne<{ id: string }>(
      pool,
      `INSERT INTO taxpayers (taxpayer_type, first_name, last_name, phone, address, lga_id,
                              consent_given, declaration_accepted, tin, tin_status)
       VALUES ('INDIVIDUAL','Looked','Up',$1,'Market Road',$2,true,true,$3,'ASSIGNED')
       RETURNING id`,
      [phone, lgaId, tin],
    );
    return row!.id;
  }

  it('is recorded, hit or miss', async () => {
    await taxpayerWithTin('TIN90000001', '+2348100004001');

    const found = await get('/citizen-status?tin=TIN90000001');
    assert.equal(found.status, 200, JSON.stringify(found.body));
    assert.equal(found.body.found, true);

    const missed = await get('/citizen-status?tin=TIN90000099');
    assert.equal(missed.body.found, false);

    const attempts = await query<{ result: string; lookup_value: string; lookup_value_hashed: boolean }>(
      pool,
      `SELECT result, lookup_value, lookup_value_hashed FROM verification_attempts
        WHERE lookup_type = 'TAXPAYER' ORDER BY created_at`,
    );
    assert.equal(attempts.length, 2, `expected both lookups recorded, got ${attempts.length}`);
    assert.deepEqual(
      attempts.map((a) => a.result),
      ['VALID', 'NOT_FOUND'],
      'the miss matters more than the hit — that is the enumeration signal',
    );
  });

  it('does not put the taxpayer’s identifier in the log', async () => {
    await taxpayerWithTin('TIN90000002', '+2348100004002');
    await get('/citizen-status?phone=%2B2348100004002');

    const attempt = await queryOne<{ lookup_value: string; lookup_value_hashed: boolean }>(
      pool,
      `SELECT lookup_value, lookup_value_hashed FROM verification_attempts
        WHERE lookup_type = 'TAXPAYER' ORDER BY created_at DESC LIMIT 1`,
    );
    assert.ok(attempt, 'the lookup should have been recorded');
    assert.equal(attempt!.lookup_value_hashed, true);
    assert.ok(
      !attempt!.lookup_value.includes('2348100004002'),
      'the phone number must not be readable in the log',
    );
  });

  it('records the same identifier the same way, so repetition is visible', async () => {
    await get('/citizen-status?tin=TIN90000003');
    await get('/citizen-status?tin=TIN90000003');
    await get('/citizen-status?tin=TIN90000004');

    const rows = await query<{ lookup_value: string }>(
      pool,
      `SELECT lookup_value FROM verification_attempts WHERE lookup_type = 'TAXPAYER'`,
    );
    const distinct = new Set(rows.map((r) => r.lookup_value));
    assert.equal(rows.length, 3);
    assert.equal(distinct.size, 2, 'the same TIN twice must hash to one value');
  });

  it('still answers the citizen when the log cannot be written', async () => {
    // Evidence, not a control. Refusing to tell somebody what they owe because
    // an audit insert failed would be the wrong way round.
    await taxpayerWithTin('TIN90000005', '+2348100004005');
    await pool.query('ALTER TABLE verification_attempts RENAME TO verification_attempts_hidden');
    try {
      const response = await get('/citizen-status?tin=TIN90000005');
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.equal(response.body.found, true);
    } finally {
      await pool.query('ALTER TABLE verification_attempts_hidden RENAME TO verification_attempts');
    }
  });
});

// ---------------------------------------------------------------------------

describe('who a reversal is blamed on', () => {
  it('defaults to the government rather than the citizen', async () => {
    const rows = await query<{ column_default: string }>(
      pool,
      `SELECT column_default FROM information_schema.columns
        WHERE table_name = 'refunds' AND column_name = 'attributable_to'`,
    );
    assert.equal(rows.length, 1, 'refunds should record who a reversal is attributable to');
    assert.match(
      rows[0].column_default,
      /GOVERNMENT/,
      'saying nothing must never cost a citizen compliance points',
    );
  });

  it('leaves the compliance score alone when the state made the error', async () => {
    const taxpayer = await queryOne<{ id: string }>(
      pool,
      `INSERT INTO taxpayers (taxpayer_type, first_name, last_name, phone, address, lga_id,
                              consent_given, declaration_accepted, tin, tin_status)
       VALUES ('INDIVIDUAL','Wrongly','Charged','+2348100004010','Market Road',$1,true,true,
               'TIN90000010','ASSIGNED') RETURNING id`,
      [lgaId],
    );

    const before = await scoreFor(taxpayer!.id);

    // A reversal nobody classified: PSIRS correcting itself.
    await seedReversal(taxpayer!.id, 'GOVERNMENT');
    const afterGovernment = await scoreFor(taxpayer!.id);
    assert.equal(
      afterGovernment,
      before,
      'a reversal the state caused must not cost the taxpayer points',
    );

    // One they are answerable for — a chargeback — does count.
    await seedReversal(taxpayer!.id, 'TAXPAYER');
    const afterTaxpayer = await scoreFor(taxpayer!.id);
    assert.ok(
      afterTaxpayer < afterGovernment,
      `a chargeback should cost points: ${afterGovernment} -> ${afterTaxpayer}`,
    );
  });

  async function scoreFor(taxpayerId: string): Promise<number> {
    // Takes a client rather than the pool: the score is normally recomputed
    // inside the transaction that changed what it measures.
    const client = await pool.connect();
    try {
      return (await computeComplianceScore(client, taxpayerId)).score;
    } finally {
      client.release();
    }
  }

  let seq = 0;
  async function seedReversal(taxpayerId: string, attributableTo: string): Promise<void> {
    seq += 1;
    const itemId = await queryOne<{ id: string }>(
      pool,
      `SELECT ri.id FROM revenue_items ri
         JOIN revenue_item_rates r ON r.revenue_item_id = ri.id
        WHERE ri.status = 'ACTIVE' LIMIT 1`,
    );
    const assessment = await queryOne<{ id: string }>(
      pool,
      `INSERT INTO assessments (assessment_number, taxpayer_id, revenue_item_id, rate_version_id,
                                base_amount_kobo, amount_kobo, lga_id, created_by,
                                assessment_type, period_label, status)
       SELECT 'ASM-CF-' || $3, $1, $2, r.id, 100000, 100000, $4, u.id, 'OFFICER', '2026', 'ACTIVE'
         FROM revenue_item_rates r
         CROSS JOIN LATERAL (SELECT id FROM users WHERE phone = $5 LIMIT 1) u
        WHERE r.revenue_item_id = $2 LIMIT 1
       RETURNING id`,
      [taxpayerId, itemId!.id, String(seq), lgaId, ADMIN],
    );
    const invoice = await queryOne<{ id: string }>(
      pool,
      `INSERT INTO invoices (invoice_number, assessment_id, taxpayer_id, amount_kobo,
                             total_amount_kobo, verification_code, created_by, status, expires_at)
       SELECT 'INV-CF-' || $3, $1, $2, 100000, 100000, 'CFCODE' || $3, u.id, 'PAID',
              now() + interval '30 days'
         FROM users u WHERE u.phone = $4 LIMIT 1
       RETURNING id`,
      [assessment!.id, taxpayerId, String(seq), ADMIN],
    );
    const transaction = await queryOne<{ id: string }>(
      pool,
      `INSERT INTO transactions (transaction_reference, invoice_id, assessment_id, taxpayer_id,
                                 revenue_item_id, lga_id, amount_kobo, total_amount_kobo,
                                 created_by, channel, status)
       SELECT 'TXN-CF-' || $5, $1, $2, $3, $4, $6, 100000, 100000, u.id, 'OFFICER', 'REVERSED'
         FROM users u WHERE u.phone = $7 LIMIT 1
       RETURNING id`,
      [invoice!.id, assessment!.id, taxpayerId, itemId!.id, String(seq), lgaId, ADMIN],
    );
    const payment = await queryOne<{ id: string }>(
      pool,
      `INSERT INTO payments (payment_reference, transaction_id, amount_kobo, payment_method,
                             gateway, status)
       VALUES ('PAY-CF-' || $2, $1, 100000, 'CARD', 'mock', 'REVERSED') RETURNING id`,
      [transaction!.id, String(seq)],
    );
    const approval = await queryOne<{ id: string }>(
      pool,
      `INSERT INTO approvals (approval_type, entity_type, entity_id, payload, requested_by,
                              requested_reason, status, approved_by, approved_at, decision_reason)
       SELECT 'PAYMENT_REVERSAL', 'transaction', $1::text, '{}'::jsonb, maker.id,
              'Seeded for the score test', 'APPROVED', checker.id, now(),
              'Approved for the score test'
         FROM (SELECT id FROM users WHERE phone = $2) maker,
              (SELECT id FROM users WHERE phone = $3) checker
       RETURNING id`,
      [transaction!.id, ADMIN, APPROVER],
    );
    await pool.query(
      `INSERT INTO refunds (refund_reference, transaction_id, payment_id, amount_kobo, refund_type,
                            reason, approval_id, requested_by, approved_by, approved_at, status,
                            attributable_to)
       SELECT 'REF-CF-' || $6, $1, $2, 100000, 'REVERSAL', 'Seeded', $3, maker.id, checker.id,
              now(), 'COMPLETED', $4
         FROM (SELECT id FROM users WHERE phone = $5) maker,
              (SELECT id FROM users WHERE phone = $7) checker`,
      [transaction!.id, payment!.id, approval!.id, attributableTo, ADMIN, String(seq), APPROVER],
    );
  }
});

// ---------------------------------------------------------------------------

describe('two deployments sharing one bucket', () => {
  it('do not write over each other’s documents', () => {
    const key = storageKey('receipt', '2026', 'PSIRS-RCT-2026-000123.pdf');
    assert.ok(
      key.startsWith(`${config.storage.keyPrefix}/`),
      `a key must name its deployment: ${key}`,
    );
    assert.ok(config.storage.keyPrefix.length > 0, 'a deployment must have a key prefix');

    // Document numbers come from a sequence in this database, so the same
    // number is issued again by any environment restored from a backup. The
    // prefix is the only thing between that and a production receipt being
    // silently overwritten by staging.
    assert.notEqual(key, 'receipt/2026/PSIRS-RCT-2026-000123.pdf');
  });
});

// ---------------------------------------------------------------------------

describe('a transaction held open across somebody else’s network', () => {
  it('is bounded, so a provider that never answers cannot hold its locks', () => {
    assert.ok(
      config.database.idleInTransactionTimeoutMs > 0,
      'an open transaction with nothing running must have a ceiling',
    );
    // Above the longest provider timeout, so no legitimate call is cut short.
    assert.ok(
      config.database.idleInTransactionTimeoutMs > config.storage.s3.timeoutMs,
      'the ceiling must not be lower than the calls it has to survive',
    );
  });
});
