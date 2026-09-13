/**
 * Fraud Detection Rules Deep Tests (PRD §32, §72; Addendum §30).
 *
 * Every heuristic rule in services/fraud.ts is exercised against a live DB.
 * Tests confirm:
 * 1. RAPID_SUCCESSION — ≥5 transactions in 20 seconds raises MEDIUM flag on AGENT
 * 2. SHARED_PHONE_NUMBER — ≥4 taxpayers sharing one phone raises MEDIUM flag on TAXPAYER
 * 3. REFEREE_SHARES_APPLICANT_CONTACT — same phone as agent raises CRITICAL
 * 4. Flag de-duplication — re-raising an existing open flag does nothing
 * 5. HIGH/CRITICAL fraud flag blocks commission promotion (PRD §28)
 * 6. Commission promotes once flag is RESOLVED
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  loginAs,
  post,
  pool,
  resetDatabase,
  settleTransaction,
  startTestServer,
  stopTestServer,
} from './helpers';
import { queryOne, withTransaction } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';
import {
  evaluateTransactionRisk,
  evaluateRegistrationRisk,
  evaluateRefereeRisk,
} from '../services/fraud';
import { promoteEligibleCommissions } from '../services/commission';

let agentToken = '';
let agentDeviceId = '';
let agentDeviceUuid = '';
let agentId = '';
let agentUserId = '';

before(async () => {
  await startTestServer();
});

after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({ fullName: 'Admin', phone: '+2348000000001', role: 'admin' });
  await createGovernmentUser({ fullName: 'Finance', phone: '+2348000000002', role: 'finance_officer' });

  const demo = await seedDemoAgent();
  assert.ok(demo);
  agentDeviceId = demo!.deviceIdentifier;
  agentId = demo!.agentId;

  const deviceRow = await queryOne<{ id: string }>(
    pool,
    `SELECT id FROM agent_devices WHERE agent_id = $1 AND device_identifier = $2 LIMIT 1`,
    [agentId, agentDeviceId],
  );
  agentDeviceUuid = deviceRow!.id;

  const userRow = await queryOne<{ user_id: string }>(
    pool,
    `SELECT user_id FROM agents WHERE id = $1`,
    [agentId],
  );
  agentUserId = userRow!.user_id;

  const session = await loginAs(demo!.phone, demo!.password, agentDeviceId);
  agentToken = session.accessToken;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedTaxpayerViaApi(phone: string, firstName = 'FraudUser'): Promise<string> {
  const lga = await queryOne<{ id: string }>(pool, 'SELECT id FROM lgas LIMIT 1');
  const res = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName,
      lastName: 'FraudTest',
      phone,
      address: '1 Test Road, Jos',
      lgaId: lga!.id,
      consentGiven: true,
      declarationAccepted: true,
      acknowledgeDuplicates: true,
    },
    { token: agentToken, deviceId: agentDeviceId },
  );
  assert.equal(res.status, 201, `Taxpayer registration failed: ${JSON.stringify(res.body)}`);
  return res.body.taxpayerId;
}

/** Create a real verified+settled transaction through the full API payment flow. */
async function createSettledTransaction(taxpayerId: string): Promise<{ transactionId: string; commissionId: string | null }> {
  const item = await queryOne<{ id: string }>(
    pool,
    `SELECT id FROM revenue_items WHERE code = 'DEV-LEVY' AND status = 'ACTIVE' LIMIT 1`,
  );

  // Create assessment + invoice
  const assessRes = await post(
    '/revenue/assessments',
    { taxpayerId, revenueItemId: item!.id, inputs: {} },
    { token: agentToken, deviceId: agentDeviceId, idempotencyKey: `fraud-assess-${Date.now()}-${Math.random()}` },
  );
  assert.equal(assessRes.status, 201, JSON.stringify(assessRes.body));
  const { transactionId } = assessRes.body;

  // Initiate payment
  const payRes = await post(
    '/payments/initiate',
    { transactionId, paymentMethod: 'POS' },
    { token: agentToken, deviceId: agentDeviceId, idempotencyKey: `fraud-pay-${Date.now()}-${Math.random()}` },
  );
  assert.equal(payRes.status, 201, JSON.stringify(payRes.body));
  const { paymentId, gatewayReference } = payRes.body;

  // Simulate gateway payment
  await post(
    '/payments/simulate',
    { gatewayReference, outcome: 'SUCCESS', deliverWebhook: true },
    { token: agentToken, deviceId: agentDeviceId },
  );

  // Confirm payment
  const confirmRes = await post(`/payments/${paymentId}/confirm`, {}, { token: agentToken, deviceId: agentDeviceId });
  assert.equal(confirmRes.status, 200, JSON.stringify(confirmRes.body));

  // Settle it the way production does — the bank credit recorded against the
  // gateway's own statement — rather than by writing the status. Migration 053
  // refuses a transaction that reaches SETTLED with nothing having settled it,
  // and a fixture that can only exist by breaking that rule is describing a
  // state the platform cannot reach. Only the clock is then moved by hand, to
  // put the 72-hour hold period behind it.
  await settleTransaction(transactionId);
  await pool.query(
    `UPDATE transactions SET settled_at = now() - interval '100 hours' WHERE id = $1`,
    [transactionId],
  );

  const commission = await queryOne<{ id: string }>(
    pool, `SELECT id FROM commissions WHERE transaction_id = $1`, [transactionId],
  );

  return { transactionId, commissionId: commission?.id ?? null };
}

// ---------------------------------------------------------------------------

describe('RAPID_SUCCESSION fraud rule', () => {
  it('raises a MEDIUM flag when 5+ transactions are processed within 20 seconds', async () => {
    const lga = await queryOne<{ id: string }>(pool, 'SELECT id FROM lgas LIMIT 1');
    const item = await queryOne<{ id: string }>(pool, `SELECT id FROM revenue_items WHERE code = 'DEV-LEVY' LIMIT 1`);
    const taxpayerId = await seedTaxpayerViaApi('+2348099700001', 'RapidUser');

    const assessRes = await post(
      '/revenue/assessments',
      { taxpayerId, revenueItemId: item!.id, inputs: {} },
      { token: agentToken, deviceId: agentDeviceId, idempotencyKey: `rapid-assess-${Date.now()}` },
    );
    const { invoiceId, assessmentId } = assessRes.body;

    const baseRef = `TXN-RAPID-${Date.now()}`;
    for (let i = 0; i < 5; i++) {
      await pool.query(
        `INSERT INTO transactions
           (transaction_reference, taxpayer_id, invoice_id, assessment_id, revenue_item_id, agent_id, device_id, lga_id, amount_kobo, total_amount_kobo, status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 200000, 200000, 'PAYMENT_VERIFIED', $9)`,
        [`${baseRef}-${i}`, taxpayerId, invoiceId, assessmentId, item!.id, agentId, agentDeviceUuid, lga!.id, agentUserId],
      );
    }

    const lastTx = await queryOne<{ id: string }>(
      pool,
      `SELECT id FROM transactions WHERE agent_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [agentId],
    );

    await withTransaction((client) =>
      evaluateTransactionRisk(client, { transactionId: lastTx!.id }),
    );

    const flag = await queryOne<{ rule: string; severity: string }>(
      pool,
      `SELECT rule, severity FROM fraud_flags WHERE rule = 'RAPID_SUCCESSION' AND entity_type = 'AGENT' AND entity_id = $1`,
      [agentId],
    );

    assert.ok(flag, 'RAPID_SUCCESSION flag must have been raised');
    assert.equal(flag!.severity, 'MEDIUM');
  });
});

describe('SHARED_PHONE_NUMBER fraud rule', () => {
  it('raises MEDIUM flag when 4+ taxpayers share one phone number', async () => {
    const sharedPhone = '+2348099111111';
    const lga = await queryOne<{ id: string }>(pool, 'SELECT id FROM lgas LIMIT 1');

    for (let i = 0; i < 4; i++) {
      await pool.query(
        `INSERT INTO taxpayers
           (registered_by_agent_id, lga_id, taxpayer_type, first_name, last_name, phone, address, consent_given, declaration_accepted, tin_status)
         VALUES ($1, $2, 'INDIVIDUAL', $3, 'FraudTest', $4, 'Test Road', true, true, 'NOT_REQUESTED')`,
        [agentId, lga!.id, `SharedUser${i}`, sharedPhone],
      );
    }

    const lastTp = await queryOne<{ id: string }>(
      pool,
      `SELECT id FROM taxpayers WHERE phone = $1 ORDER BY created_at DESC LIMIT 1`,
      [sharedPhone],
    );

    await withTransaction((client) =>
      evaluateRegistrationRisk(client, { taxpayerId: lastTp!.id, agentId, phone: sharedPhone }),
    );

    const flag = await queryOne<{ rule: string; severity: string }>(
      pool,
      `SELECT rule, severity FROM fraud_flags WHERE rule = 'SHARED_PHONE_NUMBER' AND entity_type = 'TAXPAYER' AND entity_id = $1`,
      [lastTp!.id],
    );

    assert.ok(flag, 'SHARED_PHONE_NUMBER flag must have been raised');
    assert.equal(flag!.severity, 'MEDIUM');
  });
});

describe('REFEREE_SHARES_APPLICANT_CONTACT fraud rule', () => {
  it('raises CRITICAL flag when referee uses the same phone as the applicant agent', async () => {
    const agentPhone = await queryOne<{ phone: string }>(
      pool,
      `SELECT u.phone FROM agents a JOIN users u ON u.id = a.user_id WHERE a.id = $1`,
      [agentId],
    );

    const refCode = `REF-FRAUD-${Date.now()}`;
    const refRow = await queryOne<{ id: string }>(
      pool,
      `INSERT INTO referees (agent_id, reference_code, full_name, phone, email, relationship, category, status)
       VALUES ($1, $2, 'Same Phone Ref', $3, 'ref@test.com', 'Friend', 'COMMUNITY_LEADER', 'INVITED')
       RETURNING id`,
      [agentId, refCode, agentPhone!.phone],
    );

    await withTransaction((client) =>
      evaluateRefereeRisk(client, { refereeId: refRow!.id }),
    );

    const flag = await queryOne<{ rule: string; severity: string }>(
      pool,
      `SELECT rule, severity FROM referee_risk_flags WHERE referee_id = $1 AND rule = 'REFEREE_SHARES_APPLICANT_CONTACT'`,
      [refRow!.id],
    );

    assert.ok(flag, 'REFEREE_SHARES_APPLICANT_CONTACT flag must have been raised');
    assert.equal(flag!.severity, 'CRITICAL');
  });
});

describe('Flag de-duplication', () => {
  it('does not insert a second open flag for the same rule and entity', async () => {
    const sharedPhone = '+2348099222222';
    const lga = await queryOne<{ id: string }>(pool, 'SELECT id FROM lgas LIMIT 1');

    for (let i = 0; i < 4; i++) {
      await pool.query(
        `INSERT INTO taxpayers
           (registered_by_agent_id, lga_id, taxpayer_type, first_name, last_name, phone, address, consent_given, declaration_accepted, tin_status)
         VALUES ($1, $2, 'INDIVIDUAL', $3, 'FraudTest', $4, 'Test Road', true, true, 'NOT_REQUESTED')`,
        [agentId, lga!.id, `DedupUser${i}`, sharedPhone],
      );
    }

    const lastTp = await queryOne<{ id: string }>(
      pool,
      `SELECT id FROM taxpayers WHERE phone = $1 ORDER BY created_at DESC LIMIT 1`,
      [sharedPhone],
    );

    await withTransaction((c) => evaluateRegistrationRisk(c, { taxpayerId: lastTp!.id, agentId, phone: sharedPhone }));
    await withTransaction((c) => evaluateRegistrationRisk(c, { taxpayerId: lastTp!.id, agentId, phone: sharedPhone }));

    const count = await queryOne<{ count: string }>(
      pool,
      `SELECT count(*)::text AS count FROM fraud_flags WHERE rule = 'SHARED_PHONE_NUMBER' AND entity_id = $1`,
      [lastTp!.id],
    );

    assert.equal(Number(count!.count), 1, 'Duplicate open flag must not be inserted');
  });
});

describe('HIGH/CRITICAL fraud flag blocks commission promotion (PRD §28)', () => {
  it('leaves commission PENDING while a HIGH fraud flag is open on the agent', async () => {
    const taxpayerId = await seedTaxpayerViaApi('+2348099800001', 'FraudHoldUser');
    const { commissionId } = await createSettledTransaction(taxpayerId);

    assert.ok(commissionId, 'Commission should be accrued for DEV-LEVY settled payment');

    // Insert an open HIGH fraud flag on the agent
    await pool.query(
      `INSERT INTO fraud_flags (rule, severity, entity_type, entity_id, agent_id, detail, status)
       VALUES ('DEVICE_VELOCITY', 'HIGH', 'AGENT', $1, $1, '{"test": true}', 'OPEN')`,
      [agentId],
    );

    const promoted = await promoteEligibleCommissions({ now: new Date() });
    assert.equal(promoted, 0, 'Promotion must be blocked by open HIGH fraud flag');

    const commission = await queryOne<{ status: string }>(
      pool, `SELECT status FROM commissions WHERE id = $1`, [commissionId],
    );
    assert.equal(commission!.status, 'PENDING', 'Commission must remain PENDING while fraud flag is open');
  });

  it('promotes commission after fraud flag is resolved', async () => {
    const taxpayerId = await seedTaxpayerViaApi('+2348099800002', 'FraudResolvedUser');
    const { commissionId } = await createSettledTransaction(taxpayerId);

    assert.ok(commissionId, 'Commission should be accrued for DEV-LEVY settled payment');

    // Insert a DISMISSED flag — must not block promotion
    await pool.query(
      `INSERT INTO fraud_flags (rule, severity, entity_type, entity_id, agent_id, detail, status)
       VALUES ('DEVICE_VELOCITY', 'HIGH', 'AGENT', $1, $1, '{"test": true}', 'DISMISSED')`,
      [agentId],
    );

    const promoted = await promoteEligibleCommissions({ now: new Date() });
    assert.ok(promoted >= 1, 'Commission must promote when fraud flag is DISMISSED');

    const commission = await queryOne<{ status: string }>(
      pool, `SELECT status FROM commissions WHERE id = $1`, [commissionId],
    );
    assert.equal(commission!.status, 'ELIGIBLE', 'Commission must be ELIGIBLE after flag dismissal');
  });
});
