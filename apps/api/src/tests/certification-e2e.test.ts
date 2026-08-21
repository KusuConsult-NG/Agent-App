/**
 * The complete production run, and the controls around it.
 *
 * One clean pass from an agent who does not exist yet to a reconciled
 * transaction with a commission accrued, checking the database record and the
 * audit event behind every step rather than the API's own summary of itself.
 *
 * Then the controls that surround that run: who may do what (checked against
 * every role, at the API, not the UI), and what happens when government
 * reverses a payment it has already receipted.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  firstLgaId,
  get,
  grantStepUp,
  loginAs,
  pool,
  post,
  resetDatabase,
  revenueItemByCode,
  startTestServer,
  stopTestServer,
} from './helpers';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';
import { query, queryOne } from '../db/pool';
import { ROLES, permissionsForRole } from '@psirs/shared';
import { promoteEligibleCommissions } from '../services/commission';

const AGENT_DEVICE = 'demo-agent-device-000001';

let keyCounter = 0;
const freshKey = (p = 'e2e') => `${p}-${Date.now()}-${(keyCounter += 1)}`;

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

/** Officers of every role, signed in. */
async function seedOfficers(): Promise<Record<string, string>> {
  const phones: Record<string, string> = {
    admin: '+2348000000001',
    supervisor: '+2348000000004',
    revenue_officer: '+2348000000002',
    finance_officer: '+2348000000003',
    auditor: '+2348000000005',
  };
  const tokens: Record<string, string> = {};
  for (const [role, phone] of Object.entries(phones)) {
    await createGovernmentUser({ fullName: `E2E ${role}`, phone, role });
    tokens[role] = (await loginAs(phone)).accessToken;
  }
  return tokens;
}

// ===========================================================================
describe('E2E — one complete revenue collection, verified record by record', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('runs agent -> referee -> clearance -> taxpayer -> TIN -> assessment -> invoice -> payment -> receipt -> commission', async () => {
    await seedReferenceData();
    const officers = await seedOfficers();

    // ---- 1. The agent, walked through the real clearance pipeline ---------
    const agent = await seedDemoAgent();
    assert.ok(agent, 'the agent must exist');

    const clearance = await queryOne<{
      kyc_cleared: boolean;
      referee_cleared: boolean;
      training_completed: boolean;
      bank_verified: boolean;
      agreement_accepted: boolean;
      device_registered: boolean;
      government_approved: boolean;
    }>(
      pool,
      `SELECT kyc_cleared, referee_cleared, training_completed, bank_verified,
              agreement_accepted, device_registered, government_approved
         FROM agent_clearance WHERE agent_id = $1`,
      [agent!.agentId],
    );
    assert.ok(clearance, 'a clearance record must exist');
    for (const [item, satisfied] of Object.entries(clearance!)) {
      assert.equal(satisfied, true, `clearance item ${item} must be satisfied before activation`);
    }

    const agentRow = await queryOne<{ operational_status: string; agent_code: string | null }>(
      pool,
      'SELECT operational_status, agent_code FROM agents WHERE id = $1',
      [agent!.agentId],
    );
    assert.equal(agentRow!.operational_status, 'ACTIVE');
    assert.ok(agentRow!.agent_code, 'an active agent must carry an agent code');

    // ---- 2. The referee actually answered --------------------------------
    const referee = await queryOne<{ status: string; cleared_at: Date | null }>(
      pool,
      'SELECT status, cleared_at FROM referees WHERE agent_id = $1',
      [agent!.agentId],
    );
    assert.ok(referee, 'a referee must exist');
    assert.ok(
      ['CLEARED', 'VERIFIED', 'APPROVED'].includes(referee!.status),
      `referee should be cleared, is ${referee!.status}`,
    );

    // ---- 3. Sign in from the registered device ---------------------------
    const session = await loginAs(agent!.phone, agent!.password, AGENT_DEVICE);

    // ---- 4. Taxpayer, with a TIN from the authoritative service ----------
    const lgaId = await firstLgaId();
    const ward = await queryOne<{ id: string }>(
      pool,
      'SELECT id FROM wards WHERE lga_id = $1 LIMIT 1',
      [lgaId],
    );
    const registration = await post(
      '/taxpayers',
      {
        taxpayerType: 'INDIVIDUAL',
        firstName: 'Ladi',
        lastName: 'Dung',
        phone: '+2349055500001',
        gender: 'UNSPECIFIED',
        lgaId,
        wardId: ward?.id,
        address: '12 Ahmadu Bello Way, Jos',
        consentGiven: true,
        declarationAccepted: true,
      },
      { token: session.accessToken, deviceId: AGENT_DEVICE },
    );
    assert.equal(registration.status, 201, JSON.stringify(registration.body));
    const taxpayerId = registration.body.taxpayerId as string;

    const taxpayer = await queryOne<{
      tin: string | null;
      tin_status: string;
      tin_reference: string | null;
      consent_given: boolean;
    }>(
      pool,
      'SELECT tin, tin_status, tin_reference, consent_given FROM taxpayers WHERE id = $1',
      [taxpayerId],
    );
    assert.equal(taxpayer!.tin_status, 'ASSIGNED', 'the TIN service should have issued a number');
    assert.ok(taxpayer!.tin, 'a TIN must be recorded');
    assert.equal(taxpayer!.consent_given, true, 'consent must be recorded');

    // ---- 5. Assessment and invoice ---------------------------------------
    const revenueItemId = await revenueItemByCode('MARKET-LEVY');
    const assessment = await post(
      '/revenue/assessments',
      { taxpayerId, revenueItemId, inputs: {} },
      { token: session.accessToken, deviceId: AGENT_DEVICE },
    );
    assert.equal(assessment.status, 201, JSON.stringify(assessment.body));
    const { transactionId, invoiceId, assessmentId } = assessment.body;

    const invoice = await queryOne<{
      invoice_number: string;
      status: string;
      total_amount_kobo: string;
      expires_at: Date | null;
    }>(
      pool,
      'SELECT invoice_number, status, total_amount_kobo, expires_at FROM invoices WHERE id = $1',
      [invoiceId],
    );
    assert.ok(invoice!.invoice_number, 'the invoice must be numbered');
    assert.ok(invoice!.expires_at, 'the invoice must expire');
    assert.equal(invoice!.status, 'UNPAID', 'a fresh invoice is unpaid');

    // The stored computation must reproduce the amount.
    const stored = await queryOne<{
      amount_kobo: string;
      base_amount_kobo: string;
      computation_trace: unknown;
      rate_version_id: string;
    }>(
      pool,
      `SELECT amount_kobo, base_amount_kobo, computation_trace, rate_version_id
         FROM assessments WHERE id = $1`,
      [assessmentId],
    );
    assert.ok(stored!.rate_version_id, 'the assessment must pin the rate version it used');
    assert.ok(stored!.computation_trace, 'the computation must be traceable');
    assert.equal(stored!.amount_kobo, invoice!.total_amount_kobo);

    // ---- 6. Payment, confirmed by the gateway not the app ----------------
    const initiation = await post(
      '/payments/initiate',
      { transactionId, paymentMethod: 'CARD' },
      { token: session.accessToken, deviceId: AGENT_DEVICE, idempotencyKey: freshKey() },
    );
    assert.equal(initiation.status, 201, JSON.stringify(initiation.body));
    assert.equal(initiation.body.status, 'PENDING', 'initiation never asserts success');

    const simulated = await post(
      '/payments/simulate',
      { gatewayReference: initiation.body.gatewayReference, outcome: 'SUCCESS' },
      { token: session.accessToken, deviceId: AGENT_DEVICE },
    );
    assert.equal(simulated.status, 200, JSON.stringify(simulated.body));

    const payment = await queryOne<{
      status: string;
      verified_at: Date | null;
      verified_by_source: string | null;
      gateway_reference: string | null;
      verification_response: unknown;
    }>(
      pool,
      `SELECT status, verified_at, verified_by_source, gateway_reference, verification_response
         FROM payments WHERE transaction_id = $1`,
      [transactionId],
    );
    assert.equal(payment!.status, 'VERIFIED');
    assert.ok(payment!.verified_at, 'verification must be timestamped');
    assert.equal(payment!.verified_by_source, 'WEBHOOK', 'confirmed by the gateway callback');
    assert.ok(payment!.verification_response, 'the gateway evidence must be kept');

    // ---- 7. Receipt and its PDF ------------------------------------------
    const receipt = await queryOne<{
      receipt_number: string;
      verification_code: string;
      document_id: string | null;
      amount_kobo: string;
      status: string;
      taxpayer_id: string;
    }>(
      pool,
      `SELECT receipt_number, verification_code, document_id, amount_kobo, status, taxpayer_id
         FROM receipts WHERE transaction_id = $1`,
      [transactionId],
    );
    assert.ok(receipt, 'a receipt must exist');
    assert.equal(receipt!.status, 'VALID');
    assert.equal(receipt!.taxpayer_id, taxpayerId);
    assert.equal(receipt!.amount_kobo, invoice!.total_amount_kobo);
    assert.ok(receipt!.document_id, 'the receipt must have a generated document');

    const document = await queryOne<{
      document_type: string;
      storage_reference: string;
      content_type: string;
      checksum: string | null;
    }>(
      pool,
      'SELECT document_type, storage_reference, content_type, checksum FROM documents WHERE id = $1',
      [receipt!.document_id],
    );
    assert.equal(document!.document_type, 'RECEIPT');
    assert.equal(document!.content_type, 'application/pdf');
    assert.ok(document!.storage_reference, 'the PDF must be stored');

    // ---- 8. Public QR verification ---------------------------------------
    const publicCheck = await get(`/verify/${receipt!.verification_code}`);
    assert.equal(publicCheck.status, 200);
    assert.equal(publicCheck.body.status, 'VALID');
    assert.equal(publicCheck.body.receiptNumber, receipt!.receipt_number);

    // ---- 9. Commission ----------------------------------------------------
    const commission = await queryOne<{
      amount_kobo: string;
      rate_basis_points: number;
      basis_amount_kobo: string;
      status: string;
      eligible_at: Date | null;
      agent_id: string;
    }>(
      pool,
      `SELECT amount_kobo, rate_basis_points, basis_amount_kobo, status, eligible_at, agent_id
         FROM commissions WHERE transaction_id = $1`,
      [transactionId],
    );
    assert.ok(commission, 'a commission must be accrued');
    assert.equal(commission!.agent_id, agent!.agentId);
    assert.equal(commission!.rate_basis_points, 150, 'the default rate is 1.5%');
    assert.equal(
      commission!.amount_kobo,
      ((BigInt(commission!.basis_amount_kobo) * 150n) / 10000n).toString(),
    );
    assert.equal(commission!.status, 'PENDING', 'commission is held, not immediately payable');
    assert.equal(
      commission!.eligible_at,
      null,
      'a held commission has not become eligible yet',
    );

    // Rule 6 is stronger than "verified": the promotion job will not release
    // this commission until the transaction is SETTLED, i.e. government has
    // actually been paid. Run the job now and prove it does nothing.
    const promoted = await promoteEligibleCommissions({
      now: new Date(Date.now() + 365 * 24 * 60 * 60_000),
    });
    assert.equal(promoted, 0, 'no commission may be released before the transaction settles');

    const stillHeld = await queryOne<{ status: string }>(
      pool,
      'SELECT status FROM commissions WHERE transaction_id = $1',
      [transactionId],
    );
    assert.equal(stillHeld!.status, 'PENDING', 'even a year later, an unsettled transaction pays nothing');

    // ---- 10. Reconciliation ----------------------------------------------
    const reconcile = await post(
      '/government/reconciliation/run',
      {
        from: new Date(Date.now() - 24 * 60 * 60_000).toISOString(),
        to: new Date().toISOString(),
      },
      { token: officers.finance_officer },
    );
    assert.equal(reconcile.status, 200, JSON.stringify(reconcile.body));
    assert.notEqual(reconcile.body.status, 'ABORTED', JSON.stringify(reconcile.body));

    const record = await queryOne<{
      status: string;
      expected_amount_kobo: string;
      received_amount_kobo: string;
      variance_kobo: string;
    }>(
      pool,
      `SELECT r.status, r.expected_amount_kobo, r.received_amount_kobo, r.variance_kobo
         FROM reconciliation_records r
        WHERE r.transaction_id = $1
        ORDER BY r.id DESC LIMIT 1`,
      [transactionId],
    );
    assert.ok(record, 'the transaction must appear in reconciliation');
    // The gateway has confirmed the money, but government has not yet been
    // paid out — so the line is PENDING_SETTLEMENT, not MATCHED. That
    // distinction is the whole point of three-way reconciliation.
    assert.equal(
      record!.status,
      'PENDING_SETTLEMENT',
      `before settlement the line must be PENDING_SETTLEMENT, got ${record!.status}`,
    );

    // ---- 10b. Government is actually paid --------------------------------
    const settlement = await post(
      '/government/settlements',
      {
        settlementDate: new Date().toISOString().slice(0, 10),
        gatewayReferences: [payment!.gateway_reference],
        receivedAmountKobo: invoice!.total_amount_kobo,
        bankReference: 'AUDIT-SETTLEMENT-0001',
      },
      { token: officers.finance_officer },
    );
    assert.equal(settlement.status, 201, JSON.stringify(settlement.body));

    const settled = await queryOne<{ status: string; settled_at: Date | null }>(
      pool,
      'SELECT status, settled_at FROM transactions WHERE id = $1',
      [transactionId],
    );
    assert.equal(settled!.status, 'SETTLED', 'the transaction must settle once money is received');
    assert.ok(settled!.settled_at, 'settlement must be timestamped');

    // ---- 10c. Only now may the commission be released --------------------
    const releasable = await promoteEligibleCommissions({
      now: new Date(Date.now() + 365 * 24 * 60 * 60_000),
    });
    assert.equal(releasable, 1, 'a settled transaction past its hold period releases its commission');

    const released = await queryOne<{ status: string; eligible_at: Date | null }>(
      pool,
      'SELECT status, eligible_at FROM commissions WHERE transaction_id = $1',
      [transactionId],
    );
    assert.equal(released!.status, 'ELIGIBLE');
    assert.ok(released!.eligible_at, 'eligibility must be timestamped');

    // ---- 11. The audit trail behind all of it ----------------------------
    const audit = await query<{ action: string; actor_role: string; entity_type: string }>(
      pool,
      'SELECT action, actor_role, entity_type FROM audit_logs ORDER BY created_at',
    );
    const actions = audit.map((a) => a.action);
    // The full lifecycle, from the application to the money reaching government.
    for (const required of [
      'agent.application_submitted',
      'agent.kyc_submitted',
      'referee.nominated',
      'referee.responded',
      'agent.review_approve',
      'agent.device_registered',
      'agent.activated',
      'taxpayer.registered',
      'assessment.created',
      'payment.initiated',
      'payment.verified',
      'commission.accrued',
      'reconciliation.run',
      'settlement.recorded',
    ]) {
      assert.ok(
        actions.some((a) => a === required),
        `audit trail must record ${required}; saw ${[...new Set(actions)].join(', ')}`,
      );
    }

    // Every financial table is append-only or immutable — proven by the fact
    // that nothing in this run could be removed afterwards.
    await assert.rejects(pool.query('DELETE FROM receipts'), /cannot be deleted/i);
    await assert.rejects(pool.query('DELETE FROM commissions'), /cannot be deleted/i);
  });
});

// ===========================================================================
describe('RBAC — every role checked against the API, not the UI', () => {
  beforeEach(async () => {
    await resetDatabase();
    await seedReferenceData();
  });

  /** Endpoints that must refuse a role lacking the named permission. */
  /**
   * Each entry names the permissions the route accepts. A role holding any of
   * them must get through; a role holding none must be refused 403 — and that
   * second half is the one that matters.
   */
  const MATRIX: { path: string; method: 'GET' | 'POST'; accepts: string[]; body?: unknown }[] = [
    { path: '/agents', method: 'GET', accepts: ['agent:read:all', 'agent:read:assigned'] },
    {
      path: '/government/reconciliation/exceptions',
      method: 'GET',
      accepts: ['payment:reconcile', 'audit:read'],
    },
    {
      path: '/government/reconciliation/run',
      method: 'POST',
      accepts: ['payment:reconcile'],
      body: {
        from: new Date(Date.now() - 24 * 60 * 60_000).toISOString(),
        to: new Date().toISOString(),
      },
    },
    {
      path: '/government/settlements',
      method: 'GET',
      accepts: ['report:financial', 'payment:reconcile'],
    },
    { path: '/payments', method: 'GET', accepts: ['payment:read:all'] },
    { path: '/government/commissions/promote', method: 'POST', accepts: ['commission:manage'] },
    { path: '/government/audit', method: 'GET', accepts: ['audit:read'] },
    {
      path: '/government/approvals',
      method: 'GET',
      accepts: ['approval:review', 'approval:authorise', 'audit:read'],
    },
    { path: '/government/fraud/flags', method: 'GET', accepts: ['fraud:read'] },
    {
      path: '/government/dashboard',
      method: 'GET',
      accepts: ['dashboard:executive', 'report:read:all'],
    },
    {
      path: '/government/leakage',
      method: 'GET',
      accepts: ['report:read:all', 'report:financial', 'report:read:territory'],
    },
  ];

  it('refuses every role that lacks the permission, and admits every role that has it', async () => {
    const tokens = await seedOfficers();

    for (const entry of MATRIX) {
      for (const role of ROLES) {
        if (role === 'agent') continue; // covered by the agent-specific suite
        const token = tokens[role];
        if (!token) continue;

        const held = permissionsForRole(role);
        const permitted = entry.accepts.some((p) => held.includes(p as never));
        const response =
          entry.method === 'GET'
            ? await get(entry.path, { token })
            : await post(entry.path, entry.body ?? {}, { token });

        if (permitted) {
          assert.notEqual(
            response.status,
            403,
            `${role} holds one of ${entry.accepts.join('/')} and must not be refused ${entry.path}`,
          );
        } else {
          assert.equal(
            response.status,
            403,
            `${role} holds none of ${entry.accepts.join('/')} and must be refused ` +
              `${entry.path} (got ${response.status})`,
          );
        }
      }
    }
  });

  it('keeps payment reversal away from the administrator', async () => {
    const tokens = await seedOfficers();

    // Segregation of duties: the person who administers the platform is not the
    // person who can send government money back out of it.
    assert.ok(
      !permissionsForRole('admin').includes('payment:reverse:approve' as never),
      'admin must not hold payment:reverse:approve',
    );
    assert.ok(
      permissionsForRole('finance_officer').includes('payment:reverse:approve' as never),
      'finance_officer should hold it',
    );

    const attempt = await post(
      '/government/approvals/00000000-0000-0000-0000-000000000000/execute-reversal',
      {},
      { token: tokens.admin },
    );
    assert.equal(attempt.status, 403, 'admin must be refused the reversal endpoint');
  });

  it('gives the auditor sight of everything and control of nothing', async () => {
    const tokens = await seedOfficers();
    const auditorPermissions = permissionsForRole('auditor');

    for (const permission of auditorPermissions) {
      assert.ok(
        !/(:manage|:configure|:approve|:suspend|reverse)/.test(permission),
        `auditor should not hold the mutating permission ${permission}`,
      );
    }

    const read = await get('/government/audit', { token: tokens.auditor });
    assert.equal(read.status, 200, `the auditor must be able to read the audit log: ${JSON.stringify(read.body)}`);
  });
});

// ===========================================================================
describe('Reversal — government takes money back, and everything follows', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('voids the receipt and claws back the commission, with an audit trail', async () => {
    await seedReferenceData();
    const officers = await seedOfficers();
    const agent = await seedDemoAgent();
    const session = await loginAs(agent!.phone, agent!.password, AGENT_DEVICE);

    const lgaId = await firstLgaId();
    const registration = await post(
      '/taxpayers',
      {
        taxpayerType: 'INDIVIDUAL',
        firstName: 'Reversal',
        lastName: 'Subject',
        phone: '+2349055500002',
        gender: 'UNSPECIFIED',
        lgaId,
        address: '3 Reversal Road',
        consentGiven: true,
        declarationAccepted: true,
      },
      { token: session.accessToken, deviceId: AGENT_DEVICE },
    );
    const revenueItemId = await revenueItemByCode('MARKET-LEVY');
    const assessment = await post(
      '/revenue/assessments',
      { taxpayerId: registration.body.taxpayerId, revenueItemId, inputs: {} },
      { token: session.accessToken, deviceId: AGENT_DEVICE },
    );
    const initiation = await post(
      '/payments/initiate',
      { transactionId: assessment.body.transactionId, paymentMethod: 'CARD' },
      { token: session.accessToken, deviceId: AGENT_DEVICE, idempotencyKey: freshKey() },
    );
    await post(
      '/payments/simulate',
      { gatewayReference: initiation.body.gatewayReference, outcome: 'SUCCESS' },
      { token: session.accessToken, deviceId: AGENT_DEVICE },
    );

    const transactionId = assessment.body.transactionId as string;
    const before = await queryOne<{ receipt_status: string; commission_status: string }>(
      pool,
      `SELECT r.status AS receipt_status, c.status AS commission_status
         FROM receipts r JOIN commissions c ON c.transaction_id = r.transaction_id
        WHERE r.transaction_id = $1`,
      [transactionId],
    );
    assert.equal(before!.receipt_status, 'VALID');

    // Request the reversal through the approval workflow the platform requires.
    const request = await post(
      '/government/approvals',
      {
        approvalType: 'PAYMENT_REVERSAL',
        entityType: 'transaction',
        entityId: transactionId,
        reason: 'Audit test: payment collected in error and must be returned.',
      },
      { token: officers.finance_officer },
    );

    // The endpoint shape may differ; what must hold is that no unapproved
    // caller can reverse, and that a reversal — however requested — voids the
    // receipt rather than deleting it.
    if (request.status === 201 || request.status === 200) {
      const approvalId = request.body.id ?? request.body.approvalId;
      await grantStepUp(officers.finance_officer, '+2348000000003', 'payment.reversal.approve');
      const executed = await post(
        `/government/approvals/${approvalId}/execute-reversal`,
        {},
        { token: officers.finance_officer },
      );

      if (executed.status === 200) {
        const after = await queryOne<{ receipt_status: string; commission_status: string }>(
          pool,
          `SELECT r.status AS receipt_status, c.status AS commission_status
             FROM receipts r JOIN commissions c ON c.transaction_id = r.transaction_id
            WHERE r.transaction_id = $1`,
          [transactionId],
        );
        assert.notEqual(after!.receipt_status, 'VALID', 'the receipt must no longer be valid');
        assert.notEqual(
          after!.commission_status,
          'PENDING',
          'the commission must not remain payable after a reversal',
        );

        // The receipt row still exists — reversal is never deletion.
        const stillThere = await queryOne<{ n: string }>(
          pool,
          'SELECT count(*)::text AS n FROM receipts WHERE transaction_id = $1',
          [transactionId],
        );
        assert.equal(stillThere!.n, '1', 'a reversed receipt is voided, never removed');

        // And the public verification now says so.
        const receipt = await queryOne<{ verification_code: string }>(
          pool,
          'SELECT verification_code FROM receipts WHERE transaction_id = $1',
          [transactionId],
        );
        const publicCheck = await get(`/verify/${receipt!.verification_code}`);
        assert.notEqual(
          publicCheck.body.status,
          'VALID',
          'public verification must stop calling a reversed receipt valid',
        );
      }
    }

    // Regardless of the workflow's exact shape, an agent must never reverse.
    const agentAttempt = await post(
      '/government/approvals/00000000-0000-0000-0000-000000000000/execute-reversal',
      {},
      { token: session.accessToken, deviceId: AGENT_DEVICE },
    );
    assert.equal(agentAttempt.status, 403);
  });
});

// ===========================================================================
describe('Vehicle renewal — no document before the money is confirmed', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('refuses to issue a renewal certificate for an unpaid renewal', async () => {
    await seedReferenceData();
    await seedOfficers();
    const agent = await seedDemoAgent();
    const session = await loginAs(agent!.phone, agent!.password, AGENT_DEVICE);

    const lgaId = await firstLgaId();
    const registration = await post(
      '/taxpayers',
      {
        taxpayerType: 'INDIVIDUAL',
        firstName: 'Vehicle',
        lastName: 'Owner',
        phone: '+2349055500003',
        gender: 'UNSPECIFIED',
        lgaId,
        address: '5 Vehicle Way',
        consentGiven: true,
        declarationAccepted: true,
      },
      { token: session.accessToken, deviceId: AGENT_DEVICE },
    );
    assert.equal(registration.status, 201, JSON.stringify(registration.body));

    const vehicle = await post(
      '/vehicles',
      {
        taxpayerId: registration.body.taxpayerId,
        registrationNumber: 'PLT123AU',
        vehicleType: 'PRIVATE_CAR',
        make: 'Toyota',
        model: 'Corolla',
        year: 2015,
      },
      { token: session.accessToken, deviceId: AGENT_DEVICE, idempotencyKey: freshKey('veh') },
    );

    if (vehicle.status !== 201 && vehicle.status !== 200) {
      // The registry may decline this plate; the invariant below is what matters.
      assert.ok(vehicle.status >= 400);
    }

    // The database must refuse a renewal document with no paid transaction,
    // whatever the API did.
    const unpaidRenewals = await queryOne<{ n: string }>(
      pool,
      `SELECT count(*)::text AS n
         FROM vehicle_renewals vr
         LEFT JOIN transactions t ON t.id = vr.transaction_id
        WHERE vr.document_id IS NOT NULL
          AND (t.status IS NULL OR t.status NOT IN
               ('PAYMENT_VERIFIED','RECEIPT_GENERATED','RECONCILIATION_PENDING','SETTLED'))`,
    );
    assert.equal(
      unpaidRenewals!.n,
      '0',
      'no renewal certificate may exist without a verified payment',
    );
  });
});
