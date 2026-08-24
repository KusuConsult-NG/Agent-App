/**
 * Independent production-readiness audit.
 *
 * These tests were written to *break* the platform, not to demonstrate it. They
 * do not reuse the assertions of the feature suites; each one states a rule the
 * platform claims and then attacks it from the outside — through the HTTP API a
 * real attacker reaches, or through a direct `psql`-equivalent connection, which
 * is what a compromised service account or a careless DBA would have.
 *
 * Where a guarantee is claimed to be enforced in the database rather than in
 * application code, the test bypasses the application entirely and writes to the
 * table directly. A rule that only holds when you go through the service layer
 * is not an invariant.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  apiBaseUrl,
  get,
  loginAs,
  pool,
  post,
  resetDatabase,
  startTestServer,
  stopTestServer,
  createGovernmentUser,
  firstLgaId,
  revenueItemByCode,
} from './helpers';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';
import { queryOne, query } from '../db/pool';
import { hashPassword } from '../lib/crypto';

const AGENT_DEVICE = 'demo-agent-device-000001';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

/** A fully cleared agent plus the officers needed to act on them. */
async function seedActiveAgent() {
  await seedReferenceData();
  await createGovernmentUser({
    fullName: 'Audit Admin',
    phone: '+2348000000001',
    role: 'admin',
  });
  const agent = await seedDemoAgent();
  assert.ok(agent, 'demo agent should seed');
  return agent!;
}

/** Register a taxpayer through the real API, with the consent the law requires. */
async function registerTaxpayer(
  token: string,
  deviceId: string,
  name: string,
  phone: string,
  extra: Record<string, unknown> = {},
) {
  const lgaId = await firstLgaId();
  const ward = await queryOne<{ id: string }>(
    pool,
    'SELECT id FROM wards WHERE lga_id = $1 LIMIT 1',
    [lgaId],
  );
  const [firstName, ...rest] = name.split(' ');
  const response = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName,
      lastName: rest.join(' ') || 'Subject',
      phone,
      gender: 'UNSPECIFIED',
      lgaId,
      wardId: ward?.id,
      address: '1 Audit Way, Jos',
      consentGiven: true,
      declarationAccepted: true,
      ...extra,
    },
    { token, deviceId },
  );
  return { response, lgaId };
}

/** Drive a taxpayer + assessment + invoice to the point money is expected. */
async function raiseInvoice(
  token: string,
  deviceId: string,
  options: { itemCode?: string; inputs?: Record<string, unknown>; phone?: string; name?: string } = {},
) {
  const { response: taxpayer, lgaId } = await registerTaxpayer(
    token,
    deviceId,
    options.name ?? 'Audit Subject',
    options.phone ?? '+2349011100001',
  );
  assert.equal(taxpayer.status, 201, JSON.stringify(taxpayer.body));

  const revenueItemId = await revenueItemByCode(options.itemCode ?? 'MARKET-LEVY');
  const assessment = await post(
    '/revenue/assessments',
    { taxpayerId: taxpayer.body.taxpayerId, revenueItemId, inputs: options.inputs ?? {} },
    { token, deviceId },
  );
  assert.equal(assessment.status, 201, JSON.stringify(assessment.body));

  return {
    taxpayerId: taxpayer.body.taxpayerId as string,
    assessmentId: assessment.body.assessmentId as string,
    invoiceId: assessment.body.invoiceId as string,
    transactionId: assessment.body.transactionId as string,
    amountKobo: assessment.body.amountKobo as string,
    revenueItemId,
    lgaId,
  };
}

/** Take a transaction all the way to a verified payment and issued receipt. */
let idempotencyCounter = 0;
/** A fresh Idempotency-Key; payment initiation requires one, by design. */
function freshKey(prefix = 'audit'): string {
  idempotencyCounter += 1;
  return `${prefix}-${Date.now()}-${idempotencyCounter}`;
}

async function initiatePayment(token: string, deviceId: string, transactionId: string) {
  return post(
    '/payments/initiate',
    { transactionId, paymentMethod: 'CARD' },
    { token, deviceId, idempotencyKey: freshKey('init') },
  );
}

async function payAndVerify(token: string, deviceId: string, transactionId: string) {
  const initiation = await initiatePayment(token, deviceId, transactionId);
  assert.equal(initiation.status, 201, JSON.stringify(initiation.body));

  const simulated = await post(
    '/payments/simulate',
    { gatewayReference: initiation.body.gatewayReference, outcome: 'SUCCESS' },
    { token, deviceId },
  );
  assert.equal(simulated.status, 200, JSON.stringify(simulated.body));

  return { payment: initiation.body, simulated: simulated.body };
}

// ===========================================================================
describe('AUDIT 1 — "No verified payment = no receipt" survives a direct database attack', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('refuses a receipt for a PENDING payment, inserted directly into the table', async () => {
    const agent = await seedActiveAgent();
    const session = await loginAs(agent.phone, agent.password, AGENT_DEVICE);
    const { transactionId } = await raiseInvoice(session.accessToken, AGENT_DEVICE);

    const initiation = await initiatePayment(session.accessToken, AGENT_DEVICE, transactionId);
    assert.equal(initiation.status, 201);

    const payment = await queryOne<{ id: string; status: string; amount_kobo: string }>(
      pool,
      'SELECT id, status, amount_kobo FROM payments WHERE transaction_id = $1',
      [transactionId],
    );
    assert.equal(payment!.status, 'PENDING', 'payment should not be verified yet');

    // Bypass every line of application code. This is the DBA / compromised
    // service-account attack.
    await assert.rejects(
      pool.query(
        `INSERT INTO receipts
           (receipt_number, transaction_id, payment_id, taxpayer_id, amount_kobo, verification_code)
         SELECT 'FAKE-0001', t.id, $2, t.taxpayer_id, $3, 'FAKEVERIFY0001'
           FROM transactions t WHERE t.id = $1`,
        [transactionId, payment!.id, payment!.amount_kobo],
      ),
      /not VERIFIED/,
      'the database itself must refuse a receipt for an unverified payment',
    );

    const count = await queryOne<{ n: string }>(pool, 'SELECT count(*)::text AS n FROM receipts');
    assert.equal(count!.n, '0');
  });

  it('refuses a receipt whose amount does not match the verified payment', async () => {
    const agent = await seedActiveAgent();
    const session = await loginAs(agent.phone, agent.password, AGENT_DEVICE);
    const { transactionId } = await raiseInvoice(session.accessToken, AGENT_DEVICE);
    await payAndVerify(session.accessToken, AGENT_DEVICE, transactionId);

    const payment = await queryOne<{ id: string; status: string }>(
      pool,
      'SELECT id, status FROM payments WHERE transaction_id = $1',
      [transactionId],
    );
    assert.equal(payment!.status, 'VERIFIED');

    // A second receipt, for a hugely inflated amount, against a genuinely
    // verified payment.
    await assert.rejects(
      pool.query(
        `INSERT INTO receipts
           (receipt_number, transaction_id, payment_id, taxpayer_id, amount_kobo, verification_code)
         SELECT 'FAKE-0002', t.id, $2, t.taxpayer_id, 999999999, 'FAKEVERIFY0002'
           FROM transactions t WHERE t.id = $1`,
        [transactionId, payment!.id],
      ),
      /does not match|duplicate key/,
    );
  });

  it('cannot forge a receipt through any HTTP route', async () => {
    const agent = await seedActiveAgent();
    const session = await loginAs(agent.phone, agent.password, AGENT_DEVICE);
    const { transactionId } = await raiseInvoice(session.accessToken, AGENT_DEVICE);

    // Every plausible receipt-creating verb an attacker would try.
    for (const path of ['/receipts', '/receipts/create', '/receipts/issue']) {
      const attempt = await post(
        path,
        { transactionId, amountKobo: 100, receiptNumber: 'FORGED-1' },
        { token: session.accessToken, deviceId: AGENT_DEVICE },
      );
      assert.ok(
        attempt.status === 404 || attempt.status === 403 || attempt.status === 405,
        `POST ${path} should not create a receipt, got ${attempt.status}`,
      );
    }

    const count = await queryOne<{ n: string }>(pool, 'SELECT count(*)::text AS n FROM receipts');
    assert.equal(count!.n, '0');
  });
});

// ===========================================================================
describe('AUDIT 2 — an agent cannot make money appear', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('has no route that accepts a payment status from the caller', async () => {
    const agent = await seedActiveAgent();
    const session = await loginAs(agent.phone, agent.password, AGENT_DEVICE);
    const { transactionId } = await raiseInvoice(session.accessToken, AGENT_DEVICE);

    const initiation = await initiatePayment(session.accessToken, AGENT_DEVICE, transactionId);
    const paymentId = initiation.body.paymentId;

    // Attempt to assert success directly. The confirm route takes no status.
    const confirm = await post(
      `/payments/${paymentId}/confirm`,
      { status: 'VERIFIED', verified: true, amountKobo: 1 },
      { token: session.accessToken, deviceId: AGENT_DEVICE },
    );

    // It must consult the gateway, which still says pending — not accept the body.
    assert.notEqual(confirm.status, 200, JSON.stringify(confirm.body));

    const payment = await queryOne<{ status: string }>(
      pool,
      'SELECT status FROM payments WHERE id = $1',
      [paymentId],
    );
    assert.equal(payment!.status, 'PENDING', 'caller-supplied status must be ignored');
  });

  it('refuses to let an agent update a transaction amount in the database', async () => {
    const agent = await seedActiveAgent();
    const session = await loginAs(agent.phone, agent.password, AGENT_DEVICE);
    const { transactionId } = await raiseInvoice(session.accessToken, AGENT_DEVICE);

    await assert.rejects(
      pool.query('UPDATE transactions SET amount_kobo = 1 WHERE id = $1', [transactionId]),
      /immutable|cannot be (changed|modified|updated)/i,
    );
  });

  it('refuses to let anyone delete a transaction, payment or receipt', async () => {
    const agent = await seedActiveAgent();
    const session = await loginAs(agent.phone, agent.password, AGENT_DEVICE);
    const { transactionId } = await raiseInvoice(session.accessToken, AGENT_DEVICE);
    await payAndVerify(session.accessToken, AGENT_DEVICE, transactionId);

    await assert.rejects(
      pool.query('DELETE FROM receipts WHERE transaction_id = $1', [transactionId]),
      /cannot be deleted|append-only/i,
    );
    await assert.rejects(
      pool.query('DELETE FROM payments WHERE transaction_id = $1', [transactionId]),
      /cannot be deleted|append-only/i,
    );
    await assert.rejects(
      pool.query('DELETE FROM transactions WHERE id = $1', [transactionId]),
      /cannot be deleted|append-only/i,
    );
    await assert.rejects(
      pool.query('DELETE FROM audit_logs WHERE id IS NOT NULL'),
      /cannot be deleted|append-only/i,
    );
  });
});

// ===========================================================================
describe('AUDIT 3 — webhook replay cannot duplicate money', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('processes ten identical deliveries exactly once', async () => {
    const agent = await seedActiveAgent();
    const session = await loginAs(agent.phone, agent.password, AGENT_DEVICE);
    const { transactionId } = await raiseInvoice(session.accessToken, AGENT_DEVICE);

    const initiation = await initiatePayment(session.accessToken, AGENT_DEVICE, transactionId);

    // The simulate route builds and signs a webhook and feeds it to the real
    // handler. Fire it repeatedly — same gateway reference, same event id.
    const results = [];
    for (let i = 0; i < 10; i += 1) {
      results.push(
        await post(
          '/payments/simulate',
          { gatewayReference: initiation.body.gatewayReference, outcome: 'SUCCESS' },
          { token: session.accessToken, deviceId: AGENT_DEVICE },
        ),
      );
    }
    for (const r of results) {
      assert.equal(r.status, 200, JSON.stringify(r.body));
    }

    const counts = await queryOne<{
      receipts: string;
      commissions: string;
      verified_payments: string;
    }>(
      pool,
      `SELECT (SELECT count(*)::text FROM receipts WHERE transaction_id = $1)     AS receipts,
              (SELECT count(*)::text FROM commissions WHERE transaction_id = $1)  AS commissions,
              (SELECT count(*)::text FROM payments
                WHERE transaction_id = $1 AND status = 'VERIFIED')                AS verified_payments`,
      [transactionId],
    );

    assert.equal(counts!.receipts, '1', 'exactly one receipt after 10 deliveries');
    assert.equal(counts!.commissions, '1', 'exactly one commission after 10 deliveries');
    assert.equal(counts!.verified_payments, '1');

    // Exactly one delivery may be stored; the rest are refused at the unique
    // constraint and reported back as duplicates rather than acted on.
    const stored = await queryOne<{ n: string }>(
      pool,
      `SELECT count(*)::text AS n FROM payment_webhook_events WHERE signature_valid`,
    );
    assert.equal(stored!.n, '1', 'one webhook event row for ten identical deliveries');

    const laterDeliveries = results.slice(1);
    assert.ok(
      laterDeliveries.every((r) => r.body.webhook?.duplicate === true),
      'every redelivery must be reported as a duplicate',
    );
  });

  it('rejects a webhook with a bad signature', async () => {
    await seedReferenceData();
    const forged = await post(
      '/webhooks/payments',
      { id: 'evt_forged', event: 'charge.success', data: { reference: 'anything', amount: 500000 } },
      { headers: { 'x-webhook-signature': 'deadbeef' } },
    );
    assert.ok(
      forged.status >= 400,
      `an unsigned/forged webhook must be rejected, got ${forged.status}`,
    );
  });
});

// ===========================================================================
describe('AUDIT 4 — clearance gates hold at the API, not just in the UI', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('refuses revenue collection to an agent who has applied but cleared nothing', async () => {
    await seedReferenceData();
    const lgaId = await firstLgaId();

    const application = await post('/agents/apply', {
      fullName: 'Uncleared Applicant',
      phone: '+2347099999901',
      email: 'uncleared@psirs.test',
      password: 'Password123',
      dateOfBirth: '1990-01-01',
      gender: 'UNSPECIFIED',
      address: '1 Nowhere Road',
      lgaId,
      occupation: 'Trader',
      bankName: 'Access Bank',
      bankCode: '044',
      accountName: 'Uncleared Applicant',
      accountNumber: '0123456789',
    });
    assert.equal(application.status, 201, JSON.stringify(application.body));

    const session = await loginAs('+2347099999901', 'Password123', 'uncleared-device');

    // Straight at the protected revenue APIs, no UI involved.
    const { response: taxpayer } = await registerTaxpayer(
      session.accessToken,
      'uncleared-device',
      'Should Not Exist',
      '+2349011199999',
    );
    assert.equal(taxpayer.status, 403, JSON.stringify(taxpayer.body));

    const assessment = await post(
      '/revenue/assessments',
      { taxpayerId: '00000000-0000-0000-0000-000000000000', revenueItemId: '00000000-0000-0000-0000-000000000000', quantity: 1 },
      { token: session.accessToken, deviceId: 'uncleared-device' },
    );
    assert.equal(assessment.status, 403, JSON.stringify(assessment.body));

    const created = await queryOne<{ n: string }>(
      pool,
      `SELECT count(*)::text AS n FROM taxpayers`,
    );
    assert.equal(created!.n, '0', 'no taxpayer may be created by an uncleared agent');
  });

  it('stops a suspended agent mid-career, on the very next request', async () => {
    const agent = await seedActiveAgent();
    const session = await loginAs(agent.phone, agent.password, AGENT_DEVICE);

    // Works before suspension.
    const before = await raiseInvoice(session.accessToken, AGENT_DEVICE);
    assert.ok(before.transactionId);

    await pool.query(
      `UPDATE agents SET operational_status = 'SUSPENDED' WHERE id = $1`,
      [agent.agentId],
    );

    // Same token, same device — must now be refused.
    const lgaId = await firstLgaId();
    const { response: after } = await registerTaxpayer(
      session.accessToken,
      AGENT_DEVICE,
      'Post Suspension',
      '+2349011100002',
    );
    assert.equal(after.status, 403, JSON.stringify(after.body));
    assert.equal(after.body.error.code, 'AGENT_SUSPENDED');
  });

  it('refuses activation while any clearance item is outstanding', async () => {
    await seedReferenceData();
    const adminId = await createGovernmentUser({
      fullName: 'Audit Admin',
      phone: '+2348000000001',
      role: 'admin',
    });
    const lgaId = await firstLgaId();

    const application = await post('/agents/apply', {
      fullName: 'Half Cleared',
      phone: '+2347099999902',
      email: 'half@psirs.test',
      password: 'Password123',
      dateOfBirth: '1990-01-01',
      gender: 'UNSPECIFIED',
      address: '1 Half Road',
      lgaId,
      occupation: 'Trader',
      bankName: 'Access Bank',
      bankCode: '044',
      accountName: 'Half Cleared',
      accountNumber: '0123456781',
    });
    assert.equal(application.status, 201);
    const agentId = application.body.agentId;

    const admin = await loginAs('+2348000000001', 'Password123');
    const activation = await post(
      `/agents/${agentId}/activate`,
      { territoryId: null },
      { token: admin.accessToken },
    );
    assert.ok(
      activation.status >= 400,
      `activation must fail for an uncleared agent, got ${activation.status}`,
    );

    const state = await queryOne<{ operational_status: string }>(
      pool,
      'SELECT operational_status FROM agents WHERE id = $1',
      [agentId],
    );
    assert.notEqual(state!.operational_status, 'ACTIVE');
    void adminId;
  });
});

// ===========================================================================
describe('AUDIT 5 — commission arithmetic, checked independently', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('pays exactly 1.5% of the government amount, at every magnitude', async () => {
    const agent = await seedActiveAgent();
    const session = await loginAs(agent.phone, agent.password, AGENT_DEVICE);

    /*
     * Produce Sales Tax is 2% of a declared base, so a chosen base produces
     * exactly the government amounts the brief names: base x 2% = 1,000 /
     * 10,000 / 100,000 / 1,000,000 naira. Its ₦500 floor does not bind at any
     * of them.
     *
     * This used PIT-CGT, which is now unpriced: the Capital Gains Tax Act was
     * repealed into the Nigeria Tax Act, 2025 and the platform refuses to
     * assess an item whose rate no law in force sets. The property under test
     * is commission arithmetic and does not care which item raises the
     * invoice, only that the government amount is predictable.
     */
    const cases = [
      { naira: 1_000n, baseKobo: 5_000_000 },
      { naira: 10_000n, baseKobo: 50_000_000 },
      { naira: 100_000n, baseKobo: 500_000_000 },
      { naira: 1_000_000n, baseKobo: 5_000_000_000 },
    ];

    for (const [index, testCase] of cases.entries()) {
      const raised = await raiseInvoice(session.accessToken, AGENT_DEVICE, {
        itemCode: 'PRODUCE-SALES-TAX',
        inputs: { baseAmountKobo: testCase.baseKobo },
        name: `Commission Subject${index}`,
        phone: `+23490112000${index}0`,
      });

      const expectedGovernmentKobo = testCase.naira * 100n;
      assert.equal(
        raised.amountKobo,
        expectedGovernmentKobo.toString(),
        `government amount for case ${index}`,
      );

      await payAndVerify(session.accessToken, AGENT_DEVICE, raised.transactionId);

      const row = await queryOne<{
        amount_kobo: string;
        commission_kobo: string;
        status: string;
        basis_points: string | null;
      }>(
        pool,
        `SELECT t.amount_kobo, c.amount_kobo AS commission_kobo, c.status,
                c.rate_basis_points::text AS basis_points
           FROM transactions t JOIN commissions c ON c.transaction_id = t.id
          WHERE t.id = $1`,
        [raised.transactionId],
      );
      assert.ok(row, `commission should exist for case ${index}`);

      const government = BigInt(row!.amount_kobo);
      const expectedCommission = (government * 150n) / 10000n; // 1.5%
      assert.equal(
        row!.commission_kobo,
        expectedCommission.toString(),
        `commission on N${testCase.naira} should be ${expectedCommission} kobo`,
      );
      // Government revenue is never reduced by the commission.
      assert.equal(government, expectedGovernmentKobo);
      // And it must not be immediately payable.
      assert.notEqual(row!.status, 'PAID');
    }
  });

  it('accrues no commission for a failed payment', async () => {
    const agent = await seedActiveAgent();
    const session = await loginAs(agent.phone, agent.password, AGENT_DEVICE);
    const { transactionId } = await raiseInvoice(session.accessToken, AGENT_DEVICE);

    const initiation = await initiatePayment(session.accessToken, AGENT_DEVICE, transactionId);
    await post(
      '/payments/simulate',
      { gatewayReference: initiation.body.gatewayReference, outcome: 'FAILED' },
      { token: session.accessToken, deviceId: AGENT_DEVICE },
    );

    const counts = await queryOne<{ commissions: string; receipts: string }>(
      pool,
      `SELECT (SELECT count(*)::text FROM commissions WHERE transaction_id = $1) AS commissions,
              (SELECT count(*)::text FROM receipts    WHERE transaction_id = $1) AS receipts`,
      [transactionId],
    );
    assert.equal(counts!.commissions, '0', 'a failed payment must not earn commission');
    assert.equal(counts!.receipts, '0', 'a failed payment must not produce a receipt');
  });

  it('refuses to let an agent rewrite their own commission', async () => {
    const agent = await seedActiveAgent();
    const session = await loginAs(agent.phone, agent.password, AGENT_DEVICE);
    const { transactionId } = await raiseInvoice(session.accessToken, AGENT_DEVICE);
    await payAndVerify(session.accessToken, AGENT_DEVICE, transactionId);

    const commission = await queryOne<{ id: string; amount_kobo: string }>(
      pool,
      'SELECT id, amount_kobo FROM commissions WHERE transaction_id = $1',
      [transactionId],
    );
    assert.ok(commission);

    await assert.rejects(
      pool.query('UPDATE commissions SET amount_kobo = 99999999 WHERE id = $1', [commission!.id]),
      /immutable|cannot be (changed|modified|updated)/i,
      'commission amounts must be immutable',
    );
  });
});

// ===========================================================================
describe('AUDIT 6 — historical transactions survive a rate change', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('leaves a paid transaction untouched when the rate is raised tenfold', async () => {
    const agent = await seedActiveAgent();
    const session = await loginAs(agent.phone, agent.password, AGENT_DEVICE);
    const { transactionId } = await raiseInvoice(session.accessToken, AGENT_DEVICE);
    await payAndVerify(session.accessToken, AGENT_DEVICE, transactionId);

    const before = await queryOne<{ amount_kobo: string; receipt_amount: string }>(
      pool,
      `SELECT t.amount_kobo, r.amount_kobo AS receipt_amount
         FROM transactions t JOIN receipts r ON r.transaction_id = t.id
        WHERE t.id = $1`,
      [transactionId],
    );
    assert.ok(before);

    // Supersede the rate the way an administrator would.
    const revenueItemId = await revenueItemByCode('MARKET-LEVY');
    const adminId = await createGovernmentUser({
      fullName: 'Rate Admin',
      phone: '+2348000000009',
      role: 'admin',
    });
    // Close the current version and open a new one at ten times the amount,
    // exactly as an administrator raising a rate would.
    await pool.query(
      `UPDATE revenue_item_rates SET effective_to = now()
        WHERE revenue_item_id = $1 AND effective_to IS NULL`,
      [revenueItemId],
    );
    await pool.query(
      `INSERT INTO revenue_item_rates
         (revenue_item_id, version, rate_type, fixed_amount_kobo, effective_from, created_by)
       SELECT $1, COALESCE(max(version), 0) + 1, 'FIXED', 200000, now(), $2
         FROM revenue_item_rates WHERE revenue_item_id = $1`,
      [revenueItemId, adminId],
    );

    const after = await queryOne<{ amount_kobo: string; receipt_amount: string }>(
      pool,
      `SELECT t.amount_kobo, r.amount_kobo AS receipt_amount
         FROM transactions t JOIN receipts r ON r.transaction_id = t.id
        WHERE t.id = $1`,
      [transactionId],
    );

    assert.equal(after!.amount_kobo, before!.amount_kobo, 'historical amount must not move');
    assert.equal(after!.receipt_amount, before!.receipt_amount, 'issued receipt must not move');
  });
});

// ===========================================================================
describe('AUDIT 7 — cross-tenant and cross-agent isolation', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('does not let one agent read another agent\'s transaction', async () => {
    const agentA = await seedActiveAgent();
    const sessionA = await loginAs(agentA.phone, agentA.password, AGENT_DEVICE);
    const { transactionId } = await raiseInvoice(sessionA.accessToken, AGENT_DEVICE);
    const reference = await queryOne<{ transaction_reference: string }>(
      pool,
      'SELECT transaction_reference FROM transactions WHERE id = $1',
      [transactionId],
    );

    // A second, independently cleared agent.
    const lgaId = await firstLgaId();
    const second = await post('/agents/apply', {
      fullName: 'Second Agent',
      phone: '+2347099999903',
      email: 'second@psirs.test',
      password: 'Password123',
      dateOfBirth: '1990-01-01',
      gender: 'UNSPECIFIED',
      address: '9 Second Road',
      lgaId,
      occupation: 'Trader',
      bankName: 'Access Bank',
      bankCode: '044',
      accountName: 'Second Agent',
      accountNumber: '0123456781',
    });
    assert.equal(second.status, 201, JSON.stringify(second.body));
    const sessionB = await loginAs('+2347099999903', 'Password123', 'second-device');

    const peek = await get(
      `/payments/transactions/${reference!.transaction_reference}/status`,
      { token: sessionB.accessToken, deviceId: 'second-device' },
    );
    assert.ok(
      peek.status === 403 || peek.status === 404,
      `another agent must not read this transaction, got ${peek.status}: ${JSON.stringify(peek.body)}`,
    );
  });

  it('does not let an agent reach government administration endpoints', async () => {
    const agent = await seedActiveAgent();
    const session = await loginAs(agent.phone, agent.password, AGENT_DEVICE);

    const adminPaths = [
      '/government/agents',
      '/government/reconciliation/runs',
      '/government/audit-logs',
      '/payments',
    ];

    for (const path of adminPaths) {
      const attempt = await get(path, { token: session.accessToken, deviceId: AGENT_DEVICE });
      assert.ok(
        attempt.status === 403 || attempt.status === 404,
        `agent must not reach ${path}, got ${attempt.status}`,
      );
    }
  });
});

// ===========================================================================
describe('AUDIT 8 — public receipt verification discloses only what it should', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('confirms a real receipt without leaking taxpayer identity data', async () => {
    const agent = await seedActiveAgent();
    const session = await loginAs(agent.phone, agent.password, AGENT_DEVICE);
    const { transactionId } = await raiseInvoice(session.accessToken, AGENT_DEVICE);
    await payAndVerify(session.accessToken, AGENT_DEVICE, transactionId);

    const receipt = await queryOne<{ verification_code: string; receipt_number: string }>(
      pool,
      'SELECT verification_code, receipt_number FROM receipts WHERE transaction_id = $1',
      [transactionId],
    );
    assert.ok(receipt);

    const taxpayer = await queryOne<{
      phone: string;
      first_name: string | null;
      last_name: string | null;
      address: string | null;
      identity_hash: string | null;
    }>(
      pool,
      `SELECT tp.phone, tp.first_name, tp.last_name, tp.address, tp.identity_hash
         FROM taxpayers tp JOIN transactions t ON t.taxpayer_id = tp.id WHERE t.id = $1`,
      [transactionId],
    );

    const verification = await get(`/verify/${receipt!.verification_code}`);
    assert.equal(verification.status, 200, JSON.stringify(verification.body));

    const serialised = JSON.stringify(verification.body);
    assert.ok(!serialised.includes(taxpayer!.phone), 'public verification must not expose the phone number');
    if (taxpayer!.address) {
      assert.ok(!serialised.includes(taxpayer!.address), 'public verification must not expose the address');
    }
    if (taxpayer!.identity_hash) {
      assert.ok(
        !serialised.includes(taxpayer!.identity_hash),
        'public verification must not expose the identity hash',
      );
    }
    assert.ok(!/"address"/i.test(serialised), 'public verification must not expose an address');
  });

  it('reports an unknown code as invalid rather than erroring', async () => {
    await seedReferenceData();
    const verification = await get('/verify/NOTAREALCODE123');
    assert.ok(
      verification.status === 200 || verification.status === 404,
      `unknown code should answer cleanly, got ${verification.status}`,
    );
    const serialised = JSON.stringify(verification.body).toLowerCase();
    assert.ok(
      serialised.includes('invalid') ||
        serialised.includes('not') ||
        verification.status === 404,
      'an unknown receipt must be reported as not valid',
    );
  });
});

// ===========================================================================
describe('AUDIT 9 — authentication hardening', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('does not accept a token signed with a different key', async () => {
    const agent = await seedActiveAgent();
    const jwt = require('jsonwebtoken') as typeof import('jsonwebtoken');
    const forged = jwt.sign(
      { sub: '00000000-0000-0000-0000-000000000000', sid: '00000000-0000-0000-0000-000000000000', role: 'admin' },
      'an-attackers-own-secret-that-is-long-enough',
      { expiresIn: '1h' },
    );
    const attempt = await get('/government/agents', { token: forged });
    assert.equal(attempt.status, 401);
    void agent;
  });

  it('does not accept an unsigned "alg: none" token', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(
      JSON.stringify({ sub: '00000000-0000-0000-0000-000000000000', role: 'admin' }),
    ).toString('base64url');
    const attempt = await get('/government/agents', { token: `${header}.${body}.` });
    assert.equal(attempt.status, 401);
  });

  it('ends a session immediately when it is revoked', async () => {
    const agent = await seedActiveAgent();
    const session = await loginAs(agent.phone, agent.password, AGENT_DEVICE);

    const ok = await get('/agents/me/application', {
      token: session.accessToken,
      deviceId: AGENT_DEVICE,
    });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));

    await pool.query('UPDATE sessions SET revoked_at = now()');

    const revoked = await get('/agents/me/application', {
      token: session.accessToken,
      deviceId: AGENT_DEVICE,
    });
    assert.equal(revoked.status, 401, 'a revoked session must stop working at once');
  });

  it('stores no password in a recoverable form', async () => {
    const agent = await seedActiveAgent();
    const row = await queryOne<{ password_hash: string }>(
      pool,
      'SELECT password_hash FROM users u JOIN agents a ON a.user_id = u.id WHERE a.id = $1',
      [agent.agentId],
    );
    assert.ok(row!.password_hash.startsWith('$2'), 'password must be bcrypt-hashed');
    assert.ok(!row!.password_hash.includes(agent.password));
  });

  it('does not leak whether a phone number exists on a failed sign-in', async () => {
    const agent = await seedActiveAgent();
    const wrongPassword = await post('/auth/login', {
      phone: agent.phone,
      password: 'DefinitelyWrong123',
    });
    const noSuchUser = await post('/auth/login', {
      phone: '+2347000000999',
      password: 'DefinitelyWrong123',
    });
    assert.equal(wrongPassword.status, noSuchUser.status);
    assert.deepEqual(
      (wrongPassword.body as { message?: string }).message,
      (noSuchUser.body as { message?: string }).message,
      'the two answers must be indistinguishable',
    );
  });
});

// ===========================================================================
describe('AUDIT 10 — SQL injection and input handling', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('treats a classic injection payload as data, not SQL', async () => {
    const agent = await seedActiveAgent();
    const session = await loginAs(agent.phone, agent.password, AGENT_DEVICE);
    const lgaId = await firstLgaId();

    const payload = "Robert'); DROP TABLE transactions;--";
    const { response: created } = await registerTaxpayer(
      session.accessToken,
      AGENT_DEVICE,
      payload,
      '+2349011100077',
    );

    // Either it is rejected by validation or stored verbatim; what must not
    // happen is the table disappearing.
    const stillThere = await queryOne<{ n: string }>(
      pool,
      `SELECT count(*)::text AS n FROM information_schema.tables WHERE table_name = 'transactions'`,
    );
    assert.equal(stillThere!.n, '1', 'transactions table must still exist');

    if (created.status === 201) {
      const stored = await queryOne<{ first_name: string }>(
        pool,
        'SELECT first_name FROM taxpayers WHERE id = $1',
        [created.body.taxpayerId],
      );
      assert.ok(stored, 'the row should exist and the table should be intact');
    }
  });

  it('rejects a negative or absurd assessable amount', async () => {
    const agent = await seedActiveAgent();
    const session = await loginAs(agent.phone, agent.password, AGENT_DEVICE);
    const revenueItemId = await revenueItemByCode('PRODUCE-SALES-TAX');

    const { response: taxpayer } = await registerTaxpayer(
      session.accessToken,
      AGENT_DEVICE,
      'Boundary Subject',
      '+2349011100088',
    );
    assert.equal(taxpayer.status, 201, JSON.stringify(taxpayer.body));

    /*
     * Absurd on any item, whatever its rate: a negative assessable amount is
     * not a small one, and a word is not a number.
     *
     * The negative cases used to pass only by accident. On an item with a
     * statutory floor, a percentage of a negative base rounds to zero, the
     * floor is applied because zero is below it, and the assessment is raised
     * — so `2.00% of ₦-0.01` produced a ₦500 charge and nothing objected.
     * Whether nonsense was refused depended on whether the item had a
     * minimum. `rate-engine.ts` now refuses it outright.
     */
    for (const baseAmountKobo of [-1, -1_000_000, 'not-a-number']) {
      const assessment = await post(
        '/revenue/assessments',
        { taxpayerId: taxpayer.body.taxpayerId, revenueItemId, inputs: { baseAmountKobo } },
        { token: session.accessToken, deviceId: AGENT_DEVICE },
      );
      assert.ok(
        assessment.status >= 400,
        `base ${baseAmountKobo} must be rejected, got ${assessment.status}: ${JSON.stringify(assessment.body)}`,
      );
    }

    /*
     * Zero is the interesting one, and its right answer depends on the item.
     * Produce Sales Tax carries a ₦500 statutory floor, so a declared zero
     * base is charged the floor rather than refused — a minimum means "at
     * least this much", and that is a policy the law sets rather than a bug.
     * On an item with no floor the same input must be refused outright.
     *
     * What must hold either way, and is the property worth having, is that
     * nothing ever stores an assessment for nothing.
     */
    const zeroBase = await post(
      '/revenue/assessments',
      { taxpayerId: taxpayer.body.taxpayerId, revenueItemId, inputs: { baseAmountKobo: 0 } },
      { token: session.accessToken, deviceId: AGENT_DEVICE },
    );
    if (zeroBase.status < 400) {
      assert.ok(
        BigInt(zeroBase.body.amountKobo) > 0n,
        `a zero base may charge the statutory minimum but never nothing: ${JSON.stringify(zeroBase.body)}`,
      );
    }

    const bad = await queryOne<{ n: string }>(
      pool,
      'SELECT count(*)::text AS n FROM assessments WHERE amount_kobo <= 0',
    );
    assert.equal(bad!.n, '0', 'no non-positive assessment may be stored');
  });
});

// ===========================================================================
describe('AUDIT 11 — audit trail completeness for money movement', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('records who, what, when and which record for a full payment lifecycle', async () => {
    const agent = await seedActiveAgent();
    const session = await loginAs(agent.phone, agent.password, AGENT_DEVICE);
    const { transactionId } = await raiseInvoice(session.accessToken, AGENT_DEVICE);
    await payAndVerify(session.accessToken, AGENT_DEVICE, transactionId);

    const actions = await query<{ action: string }>(
      pool,
      `SELECT DISTINCT action FROM audit_logs ORDER BY action`,
    );
    const names = actions.map((a) => a.action);

    for (const required of ['payment.initiated', 'payment.verified']) {
      assert.ok(names.includes(required), `audit log must contain ${required}; saw ${names.join(', ')}`);
    }

    const verified = await queryOne<{
      actor_role: string;
      entity_type: string;
      entity_id: string;
      created_at: Date;
      new_value: unknown;
    }>(
      pool,
      `SELECT actor_role, entity_type, entity_id, created_at, new_value
         FROM audit_logs WHERE action = 'payment.verified' LIMIT 1`,
    );
    assert.ok(verified!.entity_type, 'entity type recorded');
    assert.ok(verified!.entity_id, 'affected record recorded');
    assert.ok(verified!.created_at, 'timestamp recorded');
    assert.ok(verified!.new_value, 'new value recorded');

    // Transaction state history must be complete and append-only.
    const events = await query<{ to_status: string }>(
      pool,
      'SELECT to_status FROM transaction_events WHERE transaction_id = $1 ORDER BY created_at',
      [transactionId],
    );
    const statuses = events.map((e) => e.to_status);
    for (const expected of ['PAYMENT_PENDING', 'PAYMENT_SUCCESSFUL', 'PAYMENT_VERIFIED', 'RECEIPT_GENERATED']) {
      assert.ok(statuses.includes(expected), `state history must include ${expected}`);
    }
  });
});

// ===========================================================================
describe('AUDIT 12 — production configuration refuses to be unsafe', () => {
  it('refuses to boot in production with mock integrations', async () => {
    // Loading config.ts in a production-like environment must throw. Done in a
    // child process because config is a module singleton.
    const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
    const { join } = require('node:path') as typeof import('node:path');

    let threw = false;
    let output = '';
    try {
      execFileSync(
        'npx',
        ['tsx', '-e', `require(${JSON.stringify(join(__dirname, '..', 'config.ts'))})`],
        {
          encoding: 'utf8',
          stdio: 'pipe',
          env: {
            ...process.env,
            NODE_ENV: 'production',
            DATABASE_URL: 'postgres://user:pass@db.example.gov.ng:5432/psirs',
            JWT_SECRET: 'a'.repeat(40),
            IDENTITY_HASH_SECRET: 'b'.repeat(40),
            PAYMENT_WEBHOOK_SECRET: 'c'.repeat(40),
            // Everything else left at its mock default on purpose.
            PAYMENT_GATEWAY: undefined as unknown as string,
          },
        },
      );
    } catch (error) {
      threw = true;
      output = String((error as { stderr?: string }).stderr ?? '');
    }

    assert.ok(threw, 'production boot with mock integrations must fail');
    assert.match(output, /Refusing to start in production/);
    for (const expected of ['PAYMENT_GATEWAY', 'KYC_PROVIDER', 'STORAGE_DRIVER', 'SMS_PROVIDER']) {
      assert.match(output, new RegExp(expected), `boot guard should name ${expected}`);
    }
  });

  /**
   * Every integration set correctly, so the checks above all pass — and the
   * addresses the public is sent to left at their defaults.
   *
   * This configuration used to boot clean. VERIFICATION_BASE_URL is QR-encoded
   * onto every receipt and forms every referee invitation, so booting meant
   * issuing immutable receipts whose verification link points at localhost, and
   * invitations no referee can answer.
   */
  it('refuses to boot in production with public URLs left on localhost', () => {
    const result = bootProduction({}, PUBLIC_URL_SETTINGS);

    assert.ok(result.threw, 'a fully-configured production boot with default URLs must fail');
    assert.match(result.output, /VERIFICATION_BASE_URL still points at a local address/);
    assert.match(result.output, /PAYMENT_CALLBACK_URL still points at a local address/);
    assert.match(result.output, /CORS_ORIGINS entry .* still points at a local address/);
  });

  it('refuses plain HTTP, loopback addresses and malformed URLs', () => {
    const overHttp = bootProduction({
      VERIFICATION_BASE_URL: 'http://portal.psirs.pl.gov.ng/verify',
      PAYMENT_CALLBACK_URL: 'https://agent.psirs.pl.gov.ng/payment/return',
      CORS_ORIGINS: 'https://portal.psirs.pl.gov.ng',
    });
    assert.ok(overHttp.threw, 'plain HTTP must be refused in production');
    assert.match(overHttp.output, /VERIFICATION_BASE_URL must use HTTPS in production/);

    const loopback = bootProduction({
      VERIFICATION_BASE_URL: 'https://127.0.0.1:5174/verify',
      PAYMENT_CALLBACK_URL: 'not-a-url',
      CORS_ORIGINS: 'https://portal.psirs.pl.gov.ng',
    });
    assert.ok(loopback.threw);
    assert.match(loopback.output, /VERIFICATION_BASE_URL still points at a local address/);
    assert.match(loopback.output, /PAYMENT_CALLBACK_URL is not a valid URL/);
  });

  it('boots when the public URLs are real HTTPS addresses', () => {
    const result = bootProduction({});
    assert.equal(
      result.threw,
      false,
      `a correctly configured production boot must succeed: ${result.output}`,
    );
  });
});

/** The three settings that name addresses the public is sent to. */
const PUBLIC_URL_SETTINGS = [
  'VERIFICATION_BASE_URL',
  'PAYMENT_CALLBACK_URL',
  'CORS_ORIGINS',
] as const;

/** Every production setting the guard checks, correct — the caller overrides. */
const PRODUCTION_ENV: Record<string, string> = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://user:pass@db.example.gov.ng:5432/psirs',
  JWT_SECRET: 'a'.repeat(40),
  IDENTITY_HASH_SECRET: 'b'.repeat(40),
  PAYMENT_WEBHOOK_SECRET: 'c'.repeat(40),
  VERIFICATION_BASE_URL: 'https://portal.psirs.pl.gov.ng/verify',
  PAYMENT_CALLBACK_URL: 'https://agent.psirs.pl.gov.ng/payment/return',
  CORS_ORIGINS: 'https://agent.psirs.pl.gov.ng,https://portal.psirs.pl.gov.ng',
  PAYMENT_GATEWAY: 'remita',
  REMITA_MERCHANT_ID: '123',
  REMITA_API_KEY: 'key',
  REMITA_SERVICE_TYPE_ID: 'svc',
  REMITA_BASE_URL: 'https://login.remita.net',
  TIN_SERVICE: 'http',
  TIN_SERVICE_URL: 'https://tin.psirs.gov.ng',
  VEHICLE_REGISTRY: 'http',
  VEHICLE_REGISTRY_URL: 'https://vreg.gov.ng',
  KYC_PROVIDER: 'http',
  KYC_PROVIDER_URL: 'https://kyc.vendor.ng',
  BANK_VERIFICATION: 'http',
  BANK_VERIFICATION_URL: 'https://bank.vendor.ng',
  SMS_PROVIDER: 'termii',
  SMS_PROVIDER_URL: 'https://sms.termii.com',
  EMAIL_PROVIDER: 'smtp',
  STORAGE_DRIVER: 's3',
  STORAGE_ENDPOINT: 'https://s3.eu-west-1.amazonaws.com',
  STORAGE_BUCKET: 'psirs',
  STORAGE_ACCESS_KEY_ID: 'AK',
  STORAGE_SECRET_ACCESS_KEY: 'SK',
  ERROR_REPORTING: 'webhook',
  ERROR_REPORTING_URL: 'https://alerts.psirs.pl.gov.ng/hook',
  METRICS_TOKEN: 'a-scrape-token',
};

/**
 * A production environment for a child process.
 *
 * `omit` removes a setting entirely so config.ts falls back to its default,
 * which is the only way to test what an operator who never set it would get.
 */
function productionEnv(
  overrides: Record<string, string>,
  omit: readonly string[] = [],
): NodeJS.ProcessEnv {
  const env = { ...process.env, ...PRODUCTION_ENV, ...overrides };
  for (const name of omit) delete env[name];
  return env;
}

/** Load config.ts in a child process, since config is a module singleton. */
function bootProduction(
  overrides: Record<string, string>,
  omit: readonly string[] = [],
): { threw: boolean; output: string } {
  const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
  const { join } = require('node:path') as typeof import('node:path');

  try {
    execFileSync(
      'npx',
      ['tsx', '-e', `require(${JSON.stringify(join(__dirname, '..', 'config.ts'))})`],
      { encoding: 'utf8', stdio: 'pipe', env: productionEnv(overrides, omit) },
    );
    return { threw: false, output: '' };
  } catch (error) {
    return { threw: true, output: String((error as { stderr?: string }).stderr ?? '') };
  }
}

// ===========================================================================
describe('AUDIT 16 — demonstration accounts cannot be created in production', () => {
  const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
  const { join } = require('node:path') as typeof import('node:path');
  const SEED = join(__dirname, '..', 'db', 'seed.ts');

  /**
   * `--demo` creates five ACTIVE government accounts, one of them `admin`, all
   * sharing the password `Password123`. `seedDemoAgent` had refused production
   * since it was written; this path did not, and the seed's closing line used
   * to recommend the flag — in production, to an operator who had just run the
   * seed for the reference data production actually needs.
   */
  function seedInProduction(...flags: string[]): { threw: boolean; output: string } {
    // A real production environment in every respect except the database,
    // which points at the test one so the run has somewhere to go.
    const env = productionEnv({ DATABASE_URL: process.env.DATABASE_URL! });
    try {
      const stdout = execFileSync('npx', ['tsx', SEED, ...flags], {
        encoding: 'utf8',
        stdio: 'pipe',
        env,
      });
      return { threw: false, output: stdout };
    } catch (error) {
      const e = error as { stdout?: string; stderr?: string };
      return { threw: true, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
    }
  }

  it('refuses --demo, before touching the database', () => {
    const result = seedInProduction('--demo');
    assert.ok(result.threw, '--demo must fail in production');
    assert.match(result.output, /Refusing --demo\/--demo-agent in production/);
    assert.ok(
      !result.output.includes('Password123'),
      'no demonstration password may be printed in production',
    );
  });

  it('refuses --demo-agent, which implies --demo', () => {
    const result = seedInProduction('--demo-agent');
    assert.ok(result.threw, '--demo-agent must fail in production');
    assert.match(result.output, /Refusing --demo\/--demo-agent in production/);
  });

  it('never recommends the demonstration flags in production', () => {
    // The legitimate production step: reference data, no flags. It must
    // succeed, and it must not close by pointing at --demo.
    const result = seedInProduction();
    assert.equal(result.threw, false, `the no-flag seed must work in production: ${result.output}`);
    assert.ok(
      !/Re-run with --demo/.test(result.output),
      'production must not be told to re-run with --demo',
    );
    assert.match(result.output, /Demonstration users and agents are refused in production/);
  });
});

// ===========================================================================
describe('AUDIT 13 — concurrency', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('creates one payment intent when Pay is tapped ten times at once', async () => {
    const agent = await seedActiveAgent();
    const session = await loginAs(agent.phone, agent.password, AGENT_DEVICE);
    const { transactionId } = await raiseInvoice(session.accessToken, AGENT_DEVICE);

    const attempts = await Promise.all(
      Array.from({ length: 10 }, () =>
        post(
          '/payments/initiate',
          { transactionId, paymentMethod: 'CARD' },
          { token: session.accessToken, deviceId: AGENT_DEVICE, idempotencyKey: freshKey('race') },
        ),
      ),
    );

    const succeeded = attempts.filter((a) => a.status === 201 || a.status === 200);
    assert.ok(succeeded.length >= 1, 'at least one initiation should succeed');

    const payments = await query<{ id: string }>(
      pool,
      'SELECT id FROM payments WHERE transaction_id = $1',
      [transactionId],
    );
    assert.equal(payments.length, 1, 'exactly one payment row for ten concurrent taps');
  });

  it('issues one receipt when confirmation races itself', async () => {
    const agent = await seedActiveAgent();
    const session = await loginAs(agent.phone, agent.password, AGENT_DEVICE);
    const { transactionId } = await raiseInvoice(session.accessToken, AGENT_DEVICE);

    const initiation = await initiatePayment(session.accessToken, AGENT_DEVICE, transactionId);

    // Put the gateway into SUCCESS without delivering a webhook, then race
    // several confirmations at once.
    await post(
      '/payments/simulate',
      { gatewayReference: initiation.body.gatewayReference, outcome: 'SUCCESS', deliverWebhook: false },
      { token: session.accessToken, deviceId: AGENT_DEVICE },
    );

    await Promise.all(
      Array.from({ length: 8 }, () =>
        post(
          `/payments/${initiation.body.paymentId}/confirm`,
          {},
          { token: session.accessToken, deviceId: AGENT_DEVICE },
        ),
      ),
    );

    const counts = await queryOne<{ receipts: string; commissions: string }>(
      pool,
      `SELECT (SELECT count(*)::text FROM receipts WHERE transaction_id = $1) AS receipts,
              (SELECT count(*)::text FROM commissions WHERE transaction_id = $1) AS commissions`,
      [transactionId],
    );
    assert.equal(counts!.receipts, '1', 'racing confirmations must produce one receipt');
    assert.equal(counts!.commissions, '1', 'racing confirmations must produce one commission');
  });
});

// ===========================================================================
describe('AUDIT 14 — document access control', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('refuses an unauthenticated or unsigned document request', async () => {
    const agent = await seedActiveAgent();
    const session = await loginAs(agent.phone, agent.password, AGENT_DEVICE);
    const { transactionId } = await raiseInvoice(session.accessToken, AGENT_DEVICE);
    await payAndVerify(session.accessToken, AGENT_DEVICE, transactionId);

    const document = await queryOne<{ id: string }>(
      pool,
      `SELECT d.id FROM documents d JOIN receipts r ON r.document_id = d.id
        WHERE r.transaction_id = $1`,
      [transactionId],
    );
    assert.ok(document, 'a receipt document should exist');

    const anonymous = await get(`/documents/${document!.id}`);
    assert.ok(
      anonymous.status === 401 || anonymous.status === 403,
      `an anonymous document fetch must be refused, got ${anonymous.status}`,
    );
  });

  it('does not expose KYC documents to another agent', async () => {
    const agent = await seedActiveAgent();
    const kyc = await queryOne<{ id: string }>(pool, 'SELECT id FROM kyc_documents LIMIT 1');
    if (!kyc) return; // nothing captured in this fixture

    const lgaId = await firstLgaId();
    await post('/agents/apply', {
      fullName: 'Nosy Agent',
      phone: '+2347099999904',
      email: 'nosy@psirs.test',
      password: 'Password123',
      dateOfBirth: '1990-01-01',
      gender: 'UNSPECIFIED',
      address: '4 Nosy Road',
      lgaId,
      occupation: 'Trader',
      bankName: 'Access Bank',
      bankCode: '044',
      accountName: 'Nosy Agent',
      accountNumber: '0123456781',
    });
    const nosy = await loginAs('+2347099999904', 'Password123', 'nosy-device');

    const attempt = await get(`/documents/${kyc!.id}`, {
      token: nosy.accessToken,
      deviceId: 'nosy-device',
    });
    assert.ok(
      attempt.status >= 400,
      `another agent must not read a KYC document, got ${attempt.status}`,
    );
    void agent;
  });
});

// ===========================================================================
describe('AUDIT 15 — TIN cannot be invented by an agent', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('ignores a TIN supplied by the agent at registration', async () => {
    const agent = await seedActiveAgent();
    const session = await loginAs(agent.phone, agent.password, AGENT_DEVICE);
    const lgaId = await firstLgaId();

    const { response: created } = await registerTaxpayer(
      session.accessToken,
      AGENT_DEVICE,
      'TIN Forger',
      '+2349011100099',
      { existingTin: 'PL-FORGED-0001' },
    );

    if (created.status === 201) {
      const stored = await queryOne<{ tin: string | null }>(
        pool,
        'SELECT tin FROM taxpayers WHERE id = $1',
        [created.body.taxpayerId],
      );
      assert.notEqual(
        stored!.tin,
        'PL-FORGED-0001',
        'an agent-supplied TIN must never be written as the authoritative TIN',
      );
    } else {
      assert.ok(created.status >= 400);
    }
  });
});
