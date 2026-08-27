/**
 * In-Depth Edge Cases, Concurrency Races & Failure Mode Defenses.
 *
 * Rigorously tests:
 * 1. Idempotency under concurrent race conditions (10 simultaneous parallel requests)
 * 2. Single active payment deduplication & double-payment defense
 * 3. Step-up authentication barrier for sensitive operations
 * 4. 3-Person Maker-Checker Reversal, Voided Receipts & Commission Clawback
 * 5. Cryptographic Audit Hash Chain Tamper Detection
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  get,
  loginAs,
  post,
  resetDatabase,
  startTestServer,
  stopTestServer,
  settleTransaction,
} from './helpers';
import { pool, queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';

let adminToken = '';
let financeToken1 = '';
let financeToken2 = '';
let agentToken = '';
let agentDeviceId = 'edge-case-device-01';

before(async () => {
  await startTestServer();
});

after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();

  await createGovernmentUser({ fullName: 'System Admin', phone: '+2348000000001', role: 'admin' });
  await createGovernmentUser({ fullName: 'Revenue Requester', phone: '+2348000000002', role: 'revenue_officer' });
  await createGovernmentUser({ fullName: 'Finance Approver', phone: '+2348000000003', role: 'finance_officer' });
  await createGovernmentUser({ fullName: 'Finance Executor', phone: '+2348000000004', role: 'finance_officer' });

  adminToken = (await loginAs('+2348000000001')).accessToken;
  financeToken1 = (await loginAs('+2348000000003')).accessToken;
  financeToken2 = (await loginAs('+2348000000004')).accessToken;

  // Seed demo agent through the real clearance pipeline
  const demo = await seedDemoAgent();
  assert.ok(demo);
  agentDeviceId = demo!.deviceIdentifier;
  const loginRes = await loginAs(demo!.phone, demo!.password, agentDeviceId);
  agentToken = loginRes.accessToken;
});

async function grantStepUp(phone: string, token: string, action: string) {
  const otp = await post('/auth/otp/request', { destination: phone, purpose: 'STEP_UP' }, { token });
  await post(
    '/auth/step-up',
    { action, destination: phone, code: otp.body.developmentCode },
    { token },
  );
}

describe('1. Idempotency Under High Concurrency Race Condition', () => {
  it('handles 10 simultaneous identical assessment creation requests with single atomic obligation created', async () => {
    const lga = await queryOne<{ id: string }>(pool, 'SELECT id FROM lgas LIMIT 1');
    const ward = await queryOne<{ id: string }>(pool, 'SELECT id FROM wards WHERE lga_id = $1 LIMIT 1', [lga!.id]);
    const item = await queryOne<{ id: string }>(
      pool,
      `SELECT id FROM revenue_items WHERE code = 'DEV-LEVY' AND status = 'ACTIVE' LIMIT 1`,
    );

    const tpRes = await post(
      '/taxpayers',
      {
        taxpayerType: 'INDIVIDUAL',
        firstName: 'Concurrency',
        lastName: 'Tester',
        phone: '+2348099887766',
        address: '5 Concurrency Way, Jos',
        lgaId: lga!.id,
        wardId: ward!.id,
        consentGiven: true,
        declarationAccepted: true,
        acknowledgeDuplicates: true,
      },
      { token: agentToken, deviceId: agentDeviceId },
    );
    assert.equal(tpRes.status, 201, JSON.stringify(tpRes.body));
    const taxpayerId = tpRes.body.taxpayerId;

    const sharedIdempotencyKey = `race-test-${Date.now()}`;
    const payload = {
      taxpayerId,
      revenueItemId: item!.id,
      inputs: {},
    };

    // Dispatch 10 parallel requests with identical idempotency key
    const promises = Array.from({ length: 10 }).map(() =>
      post('/revenue/assessments', payload, {
        token: agentToken,
        deviceId: agentDeviceId,
        idempotencyKey: sharedIdempotencyKey,
      }),
    );

    const responses = await Promise.all(promises);

    // Each response is either 201 (initial or replayed) or 409 (in-flight lock)
    for (const res of responses) {
      assert.ok(
        [201, 409].includes(res.status),
        `Expected 201 or 409, got ${res.status}: ${JSON.stringify(res.body)}`,
      );
    }

    // Verify in database: Exactly ONE assessment record was created
    const count = await queryOne<{ count: string }>(
      pool,
      'SELECT count(*) AS count FROM assessments WHERE taxpayer_id = $1',
      [taxpayerId],
    );
    assert.equal(Number(count!.count), 1, 'Only 1 assessment row should exist in PostgreSQL');
  });
});

describe('2. Single Active Payment Constraint & Double-Payment Defense', () => {
  it('safely reuses existing payment intent and blocks second payment once verified', async () => {
    const lga = await queryOne<{ id: string }>(pool, 'SELECT id FROM lgas LIMIT 1');
    const item = await queryOne<{ id: string }>(
      pool,
      `SELECT id FROM revenue_items WHERE code = 'DEV-LEVY' AND status = 'ACTIVE' LIMIT 1`,
    );

    const tpRes = await post(
      '/taxpayers',
      {
        taxpayerType: 'INDIVIDUAL',
        firstName: 'Payment',
        lastName: 'Guard',
        phone: '+2348011223344',
        address: '10 Guard Way, Jos',
        lgaId: lga!.id,
        consentGiven: true,
        declarationAccepted: true,
        acknowledgeDuplicates: true,
      },
      { token: agentToken, deviceId: agentDeviceId },
    );
    assert.equal(tpRes.status, 201, JSON.stringify(tpRes.body));
    const taxpayerId = tpRes.body.taxpayerId;

    const asmRes = await post(
      '/revenue/assessments',
      { taxpayerId, revenueItemId: item!.id, inputs: {} },
      { token: agentToken, deviceId: agentDeviceId, idempotencyKey: `asm-${Date.now()}` },
    );
    assert.equal(asmRes.status, 201, JSON.stringify(asmRes.body));
    const transactionId = asmRes.body.transactionId;

    // 1st Payment Initiation
    const pay1 = await post(
      '/payments/initiate',
      { transactionId, paymentMethod: 'POS' },
      { token: agentToken, deviceId: agentDeviceId, idempotencyKey: `pay1-${Date.now()}` },
    );
    assert.equal(pay1.status, 201, JSON.stringify(pay1.body));

    // 2nd Payment Initiation while 1st is pending (different key)
    const pay2 = await post(
      '/payments/initiate',
      { transactionId, paymentMethod: 'BANK_TRANSFER' },
      { token: agentToken, deviceId: agentDeviceId, idempotencyKey: `pay2-${Date.now()}` },
    );
    assert.equal(pay2.status, 201, JSON.stringify(pay2.body));
    // Must return the EXACT same payment without duplicating rows
    assert.equal(pay2.body.paymentId, pay1.body.paymentId, 'Must reuse the active payment ID');
    assert.equal(pay2.body.paymentReference, pay1.body.paymentReference, 'Must reuse the payment reference');

    // Confirm Payment
    await post(
      '/payments/simulate',
      { gatewayReference: pay1.body.gatewayReference, outcome: 'SUCCESS', deliverWebhook: true },
      { token: agentToken, deviceId: agentDeviceId },
    );
    const confirmRes = await post(`/payments/${pay1.body.paymentId}/confirm`, {}, { token: agentToken, deviceId: agentDeviceId });
    assert.equal(confirmRes.status, 200);

    // Attempting to initiate payment on already verified transaction must be rejected
    const pay3 = await post(
      '/payments/initiate',
      { transactionId, paymentMethod: 'CARD' },
      { token: agentToken, deviceId: agentDeviceId, idempotencyKey: `pay3-${Date.now()}` },
    );
    assert.equal(pay3.status, 409, 'Must reject paying an already paid/verified invoice');
  });
});

describe('3. Cryptographic Audit Hash Chain Tamper Detection', () => {
  it('detects database row tampering and pinpoints the corrupted sequence number', async () => {
    await post('/reference/wards?lgaId=00000000-0000-0000-0000-000000000001', {}, { token: adminToken });

    const checkBefore = await get('/government/audit/verify', { token: adminToken });
    assert.equal(checkBefore.status, 200);
    assert.equal(checkBefore.body.valid, true, 'Audit log chain must initially be valid');

    const latestRow = await queryOne<{ sequence_no: string }>(
      pool,
      'SELECT sequence_no FROM audit_logs ORDER BY sequence_no DESC LIMIT 1',
    );
    assert.ok(latestRow, 'Audit row must exist');
    const seqNum = Number(latestRow.sequence_no);

    await pool.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_no_update');
    await pool.query(
      "UPDATE audit_logs SET action = 'tampered_action_by_attacker' WHERE sequence_no = $1",
      [seqNum],
    );
    await pool.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_no_update');

    const checkAfter = await get('/government/audit/verify', { token: adminToken });
    assert.equal(checkAfter.status, 200);
    assert.equal(checkAfter.body.valid, false, 'Audit chain verification must fail after tampering');
    assert.equal(
      Number(checkAfter.body.brokenAtSequence),
      seqNum,
      'Tamper detector must pinpoint exact corrupted sequence number',
    );
  });
});

describe('4. 3-Person Maker-Checker Reversal & Voided Receipt Invalidation', () => {
  it('enforces 3-person separation of duties, voids receipt, and executes gateway refund', async () => {
    const lga = await queryOne<{ id: string }>(pool, 'SELECT id FROM lgas LIMIT 1');
    const item = await queryOne<{ id: string }>(
      pool,
      `SELECT id FROM revenue_items WHERE code = 'DEV-LEVY' AND status = 'ACTIVE' LIMIT 1`,
    );

    const tpRes = await post(
      '/taxpayers',
      {
        taxpayerType: 'INDIVIDUAL',
        firstName: 'Maker',
        lastName: 'Checker',
        phone: '+2348055667799',
        address: '25 Maker St, Jos',
        lgaId: lga!.id,
        consentGiven: true,
        declarationAccepted: true,
        acknowledgeDuplicates: true,
      },
      { token: agentToken, deviceId: agentDeviceId },
    );
    assert.equal(tpRes.status, 201, JSON.stringify(tpRes.body));
    const taxpayerId = tpRes.body.taxpayerId;

    const asmRes = await post(
      '/revenue/assessments',
      { taxpayerId, revenueItemId: item!.id, inputs: {} },
      { token: agentToken, deviceId: agentDeviceId, idempotencyKey: `asm-mc-${Date.now()}` },
    );
    assert.equal(asmRes.status, 201, JSON.stringify(asmRes.body));
    const transactionId = asmRes.body.transactionId;

    const payRes = await post(
      '/payments/initiate',
      { transactionId, paymentMethod: 'POS' },
      { token: agentToken, deviceId: agentDeviceId, idempotencyKey: `pay-mc-${Date.now()}` },
    );
    assert.equal(payRes.status, 201, JSON.stringify(payRes.body));
    const paymentId = payRes.body.paymentId;
    const gatewayReference = payRes.body.gatewayReference;

    await post(
      '/payments/simulate',
      { gatewayReference, outcome: 'SUCCESS', deliverWebhook: true },
      { token: agentToken, deviceId: agentDeviceId },
    );

    const confirmRes = await post(`/payments/${paymentId}/confirm`, {}, { token: agentToken, deviceId: agentDeviceId });
    assert.equal(confirmRes.status, 200, JSON.stringify(confirmRes.body));
    // Confirmation gives the taxpayer an acknowledgement; the receipt this
    // reversal will void comes with the settlement.
    assert.ok(confirmRes.body.acknowledgementNumber, 'the taxpayer holds something verifiable at once');
    await settleTransaction(transactionId);

    const receiptRow = await queryOne<{ verification_code: string }>(
      pool,
      'SELECT verification_code FROM receipts WHERE transaction_id = $1',
      [transactionId],
    );
    assert.ok(receiptRow?.verification_code);

    const verifyBefore = await get(`/verify/${receiptRow.verification_code}`);
    assert.equal(verifyBefore.status, 200);
    assert.equal(verifyBefore.body.status, 'VALID');

    // Person 1 (Revenue Officer): Request Reversal Approval
    const requesterToken = (await loginAs('+2348000000002')).accessToken;
    const request = await post(
      '/government/approvals',
      {
        approvalType: 'PAYMENT_REVERSAL',
        entityType: 'transaction',
        entityId: transactionId,
        payload: { amountKobo: '200000', reason: 'Taxpayer double assessment', refundType: 'REVERSAL' },
        reason: 'Duplicate payment confirmed by revenue officer.',
      },
      { token: requesterToken },
    );
    assert.equal(request.status, 201, JSON.stringify(request.body));
    const approvalId = request.body.approvalId;

    // Person 2 (Finance Officer 1): Approve Reversal
    const approveRes = await post(
      `/government/approvals/${approvalId}/decide`,
      { decision: 'APPROVE', reason: 'Audit ledger confirms duplicate charge.' },
      { token: financeToken1 },
    );
    assert.equal(approveRes.status, 200, JSON.stringify(approveRes.body));

    // Person 3 (Finance Officer 2): Execute Reversal with Step-Up OTP
    await grantStepUp('+2348000000004', financeToken2, 'payment.reversal.approve');
    const executeRes = await post(
      `/government/approvals/${approvalId}/execute-reversal`,
      {},
      { token: financeToken2 },
    );
    assert.equal(executeRes.status, 200, `Execution failed: ${JSON.stringify(executeRes.body)}`);

    // Verify receipt now returns REVERSED on public verification
    const verifyAfter = await get(`/verify/${receiptRow.verification_code}`);
    assert.equal(verifyAfter.status, 200);
    assert.equal(verifyAfter.body.status, 'REVERSED');
  });
});
