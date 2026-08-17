/**
 * End-to-end verification of the PRD §84 acceptance criteria and §88
 * definition of done, against a real database and the real HTTP surface.
 *
 * The suite walks the full lifecycle in order — agent clearance, taxpayer
 * onboarding, assessment, payment, receipt, commission, reconciliation,
 * settlement, payout, reversal — because the guarantees are about how those
 * steps constrain each other, not about any one of them alone.
 */

import { after, before, describe, it } from 'node:test';
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
  territoryForLga,
} from './helpers';
import { seedDemoUsers, seedReferenceData } from '../db/seed';
import { queryOne, query } from '../db/pool';

/** Shared state, built up across the ordered lifecycle suites. */
const ctx = {
  lgaId: '',
  territoryId: '',
  adminToken: '',
  adminPhone: '+2348000000001',
  financeToken: '',
  financePhone: '+2348000000003',
  officerToken: '',
  auditorToken: '',
  agentPhone: '+2347011000001',
  agentToken: '',
  agentId: '',
  deviceId: 'test-device-0000000000001',
  refereeToken: '',
  taxpayerId: '',
  transactionId: '',
  transactionReference: '',
  paymentId: '',
  gatewayReference: '',
  receiptNumber: '',
  receiptCode: '',
  commissionId: '',
};

before(async () => {
  await startTestServer();
  await resetDatabase();
  await seedReferenceData();
  await seedDemoUsers();

  ctx.lgaId = await firstLgaId();
  ctx.territoryId = await territoryForLga(ctx.lgaId);

  ctx.adminToken = (await loginAs(ctx.adminPhone)).accessToken;
  ctx.financeToken = (await loginAs(ctx.financePhone)).accessToken;
  ctx.officerToken = (await loginAs('+2348000000002')).accessToken;
  ctx.auditorToken = (await loginAs('+2348000000005')).accessToken;

  // The default 72-hour hold would make the commission lifecycle untestable in
  // a single run; government configures this per policy (PRD §25).
  await pool.query(`UPDATE commission_policies SET hold_period_hours = 0 WHERE code = 'STANDARD'`);
});

after(async () => {
  await stopTestServer();
});

// ===========================================================================
// Layer 2 — Authority: an agent is not an agent until government says so
// ===========================================================================

describe('Agent clearance pipeline (Addendum §2, §14, §26, §50)', () => {
  it('accepts an application and starts the applicant at stage 1', async () => {
    const response = await post('/agents/apply', {
      fullName: 'Danladi Musa',
      phone: ctx.agentPhone,
      email: 'danladi.musa@example.test',
      password: 'FieldAgent2026',
      dateOfBirth: '1992-04-11',
      gender: 'MALE',
      address: '14 Rwang Pam Street, Jos',
      lgaId: ctx.lgaId,
      occupation: 'Trader',
      bankName: 'Access Bank',
      bankCode: '044',
      accountName: 'Danladi Musa',
      accountNumber: '0123456781',
    });

    assert.equal(response.status, 201);
    assert.equal(response.body.applicationState, 'APPLICATION_SUBMITTED');
    ctx.agentId = response.body.agentId;

    ctx.agentToken = (await loginAs(ctx.agentPhone, 'FieldAgent2026')).accessToken;
  });

  it('refuses revenue collection to an uncleared applicant', async () => {
    // Addendum §14: enforced in the backend, not by hiding a button.
    const response = await post(
      '/taxpayers',
      {
        taxpayerType: 'INDIVIDUAL',
        firstName: 'Too',
        lastName: 'Early',
        phone: '+2347011999999',
        address: 'Nowhere',
        lgaId: ctx.lgaId,
        consentGiven: true,
        declarationAccepted: true,
      },
      { token: ctx.agentToken, deviceId: ctx.deviceId },
    );

    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, 'AGENT_NOT_CLEARED');
    assert.ok(response.body.error.details.length >= 7, 'every outstanding requirement is listed');
  });

  it('clears identity KYC through the verification provider', async () => {
    const response = await post(
      '/agents/me/kyc',
      { identityType: 'NIN', identityNumber: '12345678901' },
      { token: ctx.agentToken },
    );

    assert.equal(response.status, 200);
    assert.equal(response.body.status, 'CLEARED');
    assert.equal(response.body.applicationState, 'REFEREE_PENDING');
  });

  it('never stores the identity number in plaintext', async () => {
    // Addendum §33 — the platform can match on an identity without holding it.
    const kyc = await queryOne<{ identity_number_hash: string; identity_number_masked: string }>(
      pool,
      'SELECT identity_number_hash, identity_number_masked FROM agent_kyc WHERE agent_id = $1',
      [ctx.agentId],
    );
    assert.ok(kyc);
    assert.notEqual(kyc.identity_number_hash, '12345678901');
    assert.equal(kyc.identity_number_hash.length, 64);
    assert.equal(kyc.identity_number_masked, '*******8901');

    const leaked = await queryOne<{ count: string }>(
      pool,
      `SELECT count(*)::text AS count FROM audit_logs WHERE new_value::text LIKE '%12345678901%'`,
    );
    assert.equal(leaked!.count, '0', 'the raw identity number must not appear in the audit log');
  });

  it('rejects an applicant who nominates themselves as referee', async () => {
    const response = await post(
      '/agents/me/referees',
      {
        fullName: 'Danladi Musa',
        phone: ctx.agentPhone,
        category: 'COMMUNITY_LEADER',
        relationship: 'Self',
      },
      { token: ctx.agentToken },
    );

    assert.equal(response.status, 400);
    assert.match(response.body.error.message, /cannot nominate yourself/i);
  });

  it('sends a tokenised referee invitation needing no account', async () => {
    const response = await post(
      '/agents/me/referees',
      {
        fullName: 'Hon. Bitrus Gyang',
        phone: '+2347022000002',
        email: 'bitrus.gyang@example.test',
        category: 'COMMUNITY_LEADER',
        relationship: 'District head of applicant community',
        occupation: 'Community leader',
      },
      { token: ctx.agentToken },
    );

    assert.equal(response.status, 201);
    ctx.refereeToken = response.body.invitationUrl.split('/referee/')[1];
    assert.ok(ctx.refereeToken, 'an invitation token is issued');

    // Addendum §37: only the hash is persisted.
    const stored = await queryOne<{ invitation_token_hash: string }>(
      pool,
      `SELECT invitation_token_hash FROM referee_invitations
        WHERE referee_id = (SELECT id FROM referees WHERE agent_id = $1 ORDER BY invited_at DESC LIMIT 1)`,
      [ctx.agentId],
    );
    assert.notEqual(stored!.invitation_token_hash, ctx.refereeToken);
  });

  it('lets the referee open and complete verification without signing in', async () => {
    const opened = await get(`/referee/${ctx.refereeToken}`);
    assert.equal(opened.status, 200);
    assert.equal(opened.body.applicantName, 'Danladi Musa');
    assert.equal(opened.body.declarations.length, 4);
    // Only the minimum needed to decide is exposed.
    assert.equal(opened.body.applicantIdentityNumber, undefined);

    const partial = await post(`/referee/${ctx.refereeToken}/respond`, {
      confirmsKnowsApplicant: true,
      confirmsInformationAccurate: true,
      willingToActAsReferee: false,
      understandsConsequences: true,
    });
    assert.equal(partial.status, 400, 'all four declarations are required');

    const response = await post(`/referee/${ctx.refereeToken}/respond`, {
      confirmsKnowsApplicant: true,
      confirmsInformationAccurate: true,
      willingToActAsReferee: true,
      understandsConsequences: true,
      identityType: 'NIN',
      identityNumber: '22233344455',
      occupation: 'District head',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.status, 'CLEARED');
  });

  it('refuses a second response on a used invitation', async () => {
    const replay = await post(`/referee/${ctx.refereeToken}/respond`, {
      confirmsKnowsApplicant: true,
      confirmsInformationAccurate: true,
      willingToActAsReferee: true,
      understandsConsequences: true,
    });
    assert.equal(replay.status, 409);
  });

  it('moves to READY_FOR_REVIEW once identity and referee are both cleared', async () => {
    const status = await get('/agents/me/application', { token: ctx.agentToken });
    assert.equal(status.status, 200);
    assert.equal(status.body.applicationState, 'READY_FOR_REVIEW');
    assert.equal(status.body.checklist.kycCleared, true);
    assert.equal(status.body.checklist.refereeCleared, true);
    assert.equal(status.body.canCollectRevenue, false);
  });

  it('refuses activation while clearance items remain outstanding', async () => {
    const response = await post(
      `/agents/${ctx.agentId}/activate`,
      { territoryId: ctx.territoryId },
      { token: ctx.adminToken },
    );

    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, 'ACTIVATION_BLOCKED');
    assert.match(response.body.error.message, /training|bank|agreement|device|Government review/i);
  });

  it('requires a reason on every government decision', async () => {
    const response = await post(
      `/agents/${ctx.agentId}/review`,
      { decision: 'APPROVE', reason: 'ok' },
      { token: ctx.adminToken },
    );
    assert.equal(response.status, 422);
  });

  it('approves the application and completes the remaining requirements', async () => {
    const review = await post(
      `/agents/${ctx.agentId}/review`,
      {
        decision: 'APPROVE',
        reason: 'Identity verified against NIN, referee confirmed by district head, records in order.',
      },
      { token: ctx.adminToken },
    );
    assert.equal(review.status, 200);
    assert.equal(review.body.applicationState, 'GOVERNMENT_APPROVED');

    const modules = await get('/agents/me/training', { token: ctx.agentToken });
    for (const module of modules.body as { code: string; assessed: boolean }[]) {
      const done = await post(
        `/agents/me/training/${module.code}`,
        { score: module.assessed ? 90 : undefined },
        { token: ctx.agentToken },
      );
      assert.equal(done.status, 200, `module ${module.code} completes`);
    }

    const bank = await post('/agents/me/bank/verify', {}, { token: ctx.agentToken });
    assert.equal(bank.body.verified, true);

    const agreement = await get('/agents/agreement', { token: ctx.agentToken });
    const accepted = await post(
      '/agents/me/agreement',
      { version: agreement.body.version },
      { token: ctx.agentToken },
    );
    assert.equal(accepted.status, 200);

    const device = await post(
      '/agents/me/devices',
      {
        deviceIdentifier: ctx.deviceId,
        deviceName: 'Field phone',
        browser: 'Chrome Mobile',
        operatingSystem: 'Android 14',
        pwaVersion: '1.0.0',
      },
      { token: ctx.agentToken },
    );
    assert.equal(device.status, 201);
    assert.equal(device.body.status, 'ACTIVE');
  });

  it('fails a training module below the pass mark', async () => {
    const response = await post(
      '/agents/me/training/TRN-04',
      { score: 40 },
      { token: ctx.agentToken },
    );
    assert.equal(response.status, 400);
    assert.match(response.body.error.message, /You need at least 80%/);

    // Restore the pass so the lifecycle continues.
    await post('/agents/me/training/TRN-04', { score: 95 }, { token: ctx.agentToken });
  });

  it('activates the agent only once every requirement is met', async () => {
    const response = await post(
      `/agents/${ctx.agentId}/activate`,
      { territoryId: ctx.territoryId },
      { token: ctx.adminToken },
    );

    assert.equal(response.status, 200);
    assert.equal(response.body.applicationState, 'ACTIVE');
    assert.match(response.body.agentCode, /^AGT-\d{5}$/);

    // Re-authenticate so the session carries the device binding.
    ctx.agentToken = (await loginAs(ctx.agentPhone, 'FieldAgent2026', ctx.deviceId)).accessToken;
  });

  it('will not let the database hold an active agent without clearance', async () => {
    // The CHECK constraint is the last line of defence if service code is
    // bypassed entirely (Addendum §14).
    await assert.rejects(
      pool.query(
        `INSERT INTO agents (user_id, application_number, operational_status, kyc_status,
                             referee_status, clearance_status, training_status, territory_id)
         SELECT id, 'APP-FORCED-1', 'ACTIVE', 'NOT_STARTED', 'PENDING', 'PENDING', 'PENDING', $1
           FROM users WHERE phone = $2`,
        [ctx.territoryId, '+2348000000002'],
      ),
      /agent_activation_requires_clearance/,
    );
  });
});

// ===========================================================================
// Layer 1/3 — Identity and transaction
// ===========================================================================

describe('Taxpayer onboarding and duplicate control (PRD §10, §11)', () => {
  const taxpayer = {
    taxpayerType: 'BUSINESS' as const,
    businessName: 'Rahila Provisions Store',
    businessType: 'Retail',
    natureOfBusiness: 'General provisions',
    phone: '+2347033000003',
    address: '22 Bauchi Road, Jos',
    lgaId: '',
    community: 'Farin Gada',
    identityType: 'NIN' as const,
    identityNumber: '33344455566',
    consentGiven: true,
    declarationAccepted: true,
  };

  it('registers a taxpayer and obtains a TIN from the TIN service', async () => {
    taxpayer.lgaId = ctx.lgaId;

    const response = await post('/taxpayers', taxpayer, {
      token: ctx.agentToken,
      deviceId: ctx.deviceId,
      idempotencyKey: 'taxpayer-create-1',
    });

    assert.equal(response.status, 201);
    assert.equal(response.body.tinStatus, 'ASSIGNED');
    assert.ok(response.body.tin, 'a TIN is assigned by the authoritative service');
    ctx.taxpayerId = response.body.taxpayerId;
  });

  it('replays the same response for a repeated idempotency key', async () => {
    // PRD §61: a retried request must not create a second record.
    const replay = await post('/taxpayers', taxpayer, {
      token: ctx.agentToken,
      deviceId: ctx.deviceId,
      idempotencyKey: 'taxpayer-create-1',
    });

    assert.equal(replay.status, 201);
    assert.equal(replay.body.taxpayerId, ctx.taxpayerId);
    assert.equal(replay.headers.get('idempotent-replay'), 'true');

    const count = await queryOne<{ count: string }>(
      pool,
      `SELECT count(*)::text AS count FROM taxpayers WHERE phone = $1`,
      [taxpayer.phone],
    );
    assert.equal(count!.count, '1');
  });

  it('blocks a decisive duplicate outright', async () => {
    const response = await post(
      '/taxpayers',
      { ...taxpayer, businessName: 'Rahila Stores Two' },
      { token: ctx.agentToken, deviceId: ctx.deviceId, idempotencyKey: 'taxpayer-create-2' },
    );

    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, 'TAXPAYER_ALREADY_EXISTS');
  });

  it('warns on a weaker match and records the agent’s decision', async () => {
    const warned = await post(
      '/taxpayers',
      {
        ...taxpayer,
        businessName: 'Different Business Entirely',
        identityNumber: undefined,
        identityType: undefined,
      },
      { token: ctx.agentToken, deviceId: ctx.deviceId, idempotencyKey: 'taxpayer-create-3' },
    );

    assert.equal(warned.status, 409);
    assert.equal(warned.body.error.code, 'POSSIBLE_DUPLICATE_TAXPAYER');
    assert.match(warned.body.error.message, /Possible existing taxpayer found/);

    const proceeded = await post(
      '/taxpayers',
      {
        ...taxpayer,
        businessName: 'Different Business Entirely',
        identityNumber: undefined,
        identityType: undefined,
        acknowledgeDuplicates: true,
      },
      { token: ctx.agentToken, deviceId: ctx.deviceId, idempotencyKey: 'taxpayer-create-4' },
    );
    assert.equal(proceeded.status, 201);

    const decisions = await query<{ decision: string }>(
      pool,
      `SELECT decision FROM taxpayer_duplicate_checks ORDER BY created_at`,
    );
    assert.ok(decisions.some((d) => d.decision === 'BLOCKED'));
    assert.ok(decisions.some((d) => d.decision === 'PROCEEDED'));
  });
});

describe('Assessment and invoicing (PRD §14, §15)', () => {
  it('prices a revenue item from the catalogue, not from the agent', async () => {
    const itemId = await revenueItemByCode('BP-RENEW-URBAN');

    const quote = await post(
      '/revenue/quote',
      { revenueItemId: itemId, inputs: {} },
      { token: ctx.agentToken, deviceId: ctx.deviceId },
    );

    assert.equal(quote.status, 200);
    assert.equal(quote.body.amountKobo, '500000'); // ₦5,000
    assert.ok(quote.body.trace.length > 0, 'the calculation is explained to the taxpayer');
  });

  it('creates assessment, invoice and transaction as one obligation', async () => {
    const itemId = await revenueItemByCode('BP-RENEW-URBAN');

    const response = await post(
      '/revenue/assessments',
      {
        taxpayerId: ctx.taxpayerId,
        revenueItemId: itemId,
        inputs: {},
        periodLabel: '2026 renewal',
        latitude: 9.8965,
        longitude: 8.8583,
      },
      { token: ctx.agentToken, deviceId: ctx.deviceId, idempotencyKey: 'assessment-1' },
    );

    assert.equal(response.status, 201);
    assert.equal(response.body.amountKobo, '500000');
    assert.match(response.body.invoiceNumber, /^INV\/\d{4}\/\d{6}$/);
    assert.match(response.body.transactionReference, /^TXN-\d{4}-\d{6}$/);

    ctx.transactionId = response.body.transactionId;
    ctx.transactionReference = response.body.transactionReference;
  });

  it('freezes the assessed amount against later edits', async () => {
    // PRD §7.2 — an agent cannot change an amount after authorisation.
    await assert.rejects(
      pool.query(`UPDATE transactions SET amount_kobo = 1 WHERE id = $1`, [ctx.transactionId]),
      /immutable once written/,
    );
    await assert.rejects(
      pool.query(`UPDATE assessments SET amount_kobo = 1 WHERE id = (
        SELECT assessment_id FROM transactions WHERE id = $1)`, [ctx.transactionId]),
      /immutable once written/,
    );
  });

  it('keeps historical assessments at their original rate after a rate change', async () => {
    const itemId = await revenueItemByCode('BP-RENEW-URBAN');
    await grantStepUp(ctx.officerToken, '+2348000000002', 'catalogue.rate.change');

    const change = await post(
      `/revenue/items/${itemId}/rates`,
      {
        rateType: 'FIXED',
        fixedAmountKobo: '1500000', // ₦5,000 -> ₦15,000
        effectiveFrom: new Date(Date.now() + 1000).toISOString(),
        reason: 'Approved 2026 review of business premises renewal fees',
      },
      { token: ctx.officerToken },
    );
    assert.equal(change.status, 201);
    assert.equal(change.body.version, 2);

    // PRD §9: the old transaction remains associated with ₦5,000.
    const existing = await queryOne<{ amount_kobo: string }>(
      pool,
      'SELECT amount_kobo FROM transactions WHERE id = $1',
      [ctx.transactionId],
    );
    assert.equal(existing!.amount_kobo, '500000');

    const history = await get(`/government/audit/queries/rate-changes?revenueItemId=${itemId}`, {
      token: ctx.auditorToken,
    });
    assert.equal(history.body.length, 2, 'both rate versions remain visible');
  });
});

// ===========================================================================
// Layer 4/5 — Money and evidence
// ===========================================================================

describe('Payment, verification and receipt (PRD §17, §19, §95)', () => {
  it('initiates a payment without asserting any success', async () => {
    const response = await post(
      '/payments/initiate',
      { transactionId: ctx.transactionId, paymentMethod: 'CARD' },
      { token: ctx.agentToken, deviceId: ctx.deviceId, idempotencyKey: 'payment-1' },
    );

    assert.equal(response.status, 201);
    assert.equal(response.body.status, 'PENDING');
    ctx.paymentId = response.body.paymentId;
    ctx.gatewayReference = response.body.gatewayReference;

    const receipts = await queryOne<{ count: string }>(
      pool,
      'SELECT count(*)::text AS count FROM receipts WHERE transaction_id = $1',
      [ctx.transactionId],
    );
    assert.equal(receipts!.count, '0', 'no receipt exists before verification');
  });

  it('reports UNCONFIRMED, in plain language, while the gateway is pending', async () => {
    // PRD §60's worked example. The agent must know not to collect again.
    const response = await post(
      `/payments/${ctx.paymentId}/confirm`,
      {},
      { token: ctx.agentToken, deviceId: ctx.deviceId },
    );

    assert.equal(response.status, 202);
    assert.equal(response.body.error.code, 'PAYMENT_UNCONFIRMED');
    assert.equal(response.body.error.moneyStatus, 'UNCONFIRMED');
    assert.match(response.body.error.message, /has NOT been marked as received/);
    assert.match(response.body.error.message, /Do not ask the taxpayer to pay again/);
  });

  it('refuses at database level to issue a receipt for an unverified payment', async () => {
    // The control that makes PRD §95 structural rather than procedural.
    await assert.rejects(
      pool.query(
        `INSERT INTO receipts (receipt_number, transaction_id, payment_id, taxpayer_id,
                               amount_kobo, verification_code)
         VALUES ('PSIRS/FORGED/000001', $1, $2, $3, 500000, 'FORGE-CODE1')`,
        [ctx.transactionId, ctx.paymentId, ctx.taxpayerId],
      ),
      /not VERIFIED/,
    );
  });

  it('refuses to accrue commission before revenue is verified', async () => {
    await assert.rejects(
      pool.query(
        `INSERT INTO commissions (agent_id, transaction_id, policy_id, rate_basis_points,
                                  basis_amount_kobo, amount_kobo)
         SELECT $1, $2, id, 150, 500000, 7500 FROM commission_policies WHERE code = 'STANDARD'`,
        [ctx.agentId, ctx.transactionId],
      ),
      /Commission cannot be created/,
    );
  });

  it('verifies through a signed webhook and issues the receipt automatically', async () => {
    const response = await post(
      '/payments/simulate',
      { gatewayReference: ctx.gatewayReference, outcome: 'SUCCESS', deliverWebhook: true },
      { token: ctx.agentToken, deviceId: ctx.deviceId },
    );

    assert.equal(response.status, 200);
    assert.equal(response.body.gatewayStatus, 'SUCCESS');
    assert.equal(response.body.webhook.outcome.status, 'VERIFIED');

    ctx.receiptNumber = response.body.webhook.outcome.receiptNumber;
    assert.match(ctx.receiptNumber, /^PSIRS\/\d{4}\/\d{6}$/);

    const transaction = await queryOne<{ status: string; verified_at: Date | null }>(
      pool,
      'SELECT status, verified_at FROM transactions WHERE id = $1',
      [ctx.transactionId],
    );
    assert.equal(transaction!.status, 'RECONCILIATION_PENDING');
    assert.ok(transaction!.verified_at);

    const payment = await queryOne<{ status: string; verified_by_source: string }>(
      pool,
      'SELECT status, verified_by_source FROM payments WHERE id = $1',
      [ctx.paymentId],
    );
    assert.equal(payment!.status, 'VERIFIED');
    assert.equal(payment!.verified_by_source, 'WEBHOOK');
  });

  it('rejects an unsigned webhook without touching payment state', async () => {
    const response = await fetch(
      `${(await startTestServer())}/webhooks/payments`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'evt_forged_1',
          event: 'charge.success',
          data: { reference: ctx.gatewayReference, amount: '500000' },
        }),
      },
    );
    assert.equal(response.status, 401);

    const rejected = await queryOne<{ processing_status: string }>(
      pool,
      `SELECT processing_status FROM payment_webhook_events WHERE event_id = 'evt_forged_1'`,
    );
    assert.equal(rejected!.processing_status, 'REJECTED');
  });

  it('treats a redelivered webhook as a duplicate and creates nothing new', async () => {
    // PRD §53: the same webhook must never create two successful transactions.
    const replay = await post(
      '/payments/simulate',
      { gatewayReference: ctx.gatewayReference, outcome: 'SUCCESS', deliverWebhook: true },
      { token: ctx.agentToken, deviceId: ctx.deviceId },
    );

    assert.equal(replay.status, 200);
    assert.equal(replay.body.webhook.duplicate, true);

    const receipts = await queryOne<{ count: string }>(
      pool,
      'SELECT count(*)::text AS count FROM receipts WHERE transaction_id = $1',
      [ctx.transactionId],
    );
    assert.equal(receipts!.count, '1', 'exactly one receipt exists');

    const commissions = await queryOne<{ count: string }>(
      pool,
      'SELECT count(*)::text AS count FROM commissions WHERE transaction_id = $1',
      [ctx.transactionId],
    );
    assert.equal(commissions!.count, '1', 'exactly one commission exists');
  });

  it('produces a downloadable PDF receipt with a QR verification code', async () => {
    const receipt = await get(
      `/receipts/lookup?number=${encodeURIComponent(ctx.receiptNumber)}`,
      { token: ctx.agentToken },
    );
    assert.equal(receipt.status, 200);
    assert.ok(receipt.body.downloadUrl);
    ctx.receiptCode = receipt.body.verification_code;

    const download = await fetch(
      `${(await startTestServer()).replace('/api/v1', '')}${receipt.body.downloadUrl}`,
    );
    assert.equal(download.status, 200);
    assert.equal(download.headers.get('content-type'), 'application/pdf');

    const bytes = Buffer.from(await download.arrayBuffer());
    assert.ok(bytes.length > 1000, 'the PDF has real content');
    assert.equal(bytes.subarray(0, 4).toString(), '%PDF');
  });

  it('verifies the receipt publicly without exposing taxpayer data', async () => {
    const response = await get(`/verify/${ctx.receiptCode}`);

    assert.equal(response.status, 200);
    assert.equal(response.body.status, 'VALID');
    assert.equal(response.body.receiptNumber, ctx.receiptNumber);
    assert.equal(response.body.integrityConfirmed, true);

    // PRD §20 — nothing sensitive on a public endpoint.
    const serialised = JSON.stringify(response.body);
    assert.equal(serialised.includes('Rahila'), false, 'no taxpayer name');
    assert.equal(serialised.includes('+234'), false, 'no phone number');
    assert.equal(/\btin\b/i.test(serialised), false, 'no TIN');
  });

  it('reports an unknown receipt number as not found', async () => {
    const response = await get('/verify/PSIRS-2026-FAKE01');
    assert.equal(response.status, 404);
    assert.equal(response.body.status, 'NOT_FOUND');
    assert.match(response.body.message, /was not issued by PSIRS/);
  });

  it('recovers the transaction status after the browser is closed', async () => {
    // Addendum §44 — the backend is authoritative and can always be re-read.
    const response = await get(`/payments/transactions/${ctx.transactionReference}/status`, {
      token: ctx.agentToken,
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.transaction.receipt_number, ctx.receiptNumber);
    assert.equal(response.body.transaction.payment_status, 'VERIFIED');
    assert.ok(response.body.events.length >= 6, 'the full state history is available');
  });

  it('makes a receipt immutable once issued', async () => {
    await assert.rejects(
      pool.query(`UPDATE receipts SET amount_kobo = 1 WHERE receipt_number = $1`, [ctx.receiptNumber]),
      /immutable once written/,
    );
    await assert.rejects(
      pool.query(`DELETE FROM receipts WHERE receipt_number = $1`, [ctx.receiptNumber]),
      /cannot be deleted/,
    );
  });
});

// ===========================================================================
// Commission, reconciliation, settlement
// ===========================================================================

describe('Commission engine (PRD §6, §25, §26, §28)', () => {
  it('computes 1.5% of government revenue without touching the taxpayer amount', async () => {
    const commission = await queryOne<{
      id: string;
      amount_kobo: string;
      basis_amount_kobo: string;
      rate_basis_points: number;
      status: string;
    }>(
      pool,
      'SELECT id, amount_kobo, basis_amount_kobo, rate_basis_points, status FROM commissions WHERE transaction_id = $1',
      [ctx.transactionId],
    );

    assert.ok(commission);
    ctx.commissionId = commission.id;
    assert.equal(commission.basis_amount_kobo, '500000');
    assert.equal(commission.rate_basis_points, 150);
    assert.equal(commission.amount_kobo, '7500'); // 1.5% of ₦5,000 = ₦75.00
    assert.equal(commission.status, 'PENDING');

    // PRD §6: the government transaction is untouched by commission.
    const transaction = await queryOne<{ amount_kobo: string; total_amount_kobo: string }>(
      pool,
      'SELECT amount_kobo, total_amount_kobo FROM transactions WHERE id = $1',
      [ctx.transactionId],
    );
    assert.equal(transaction!.amount_kobo, '500000');
    assert.equal(transaction!.total_amount_kobo, '500000');
  });

  it('keeps commission out of reach until the transaction settles', async () => {
    const wallet = await get('/agents/me/commission', { token: ctx.agentToken });
    assert.equal(wallet.body.wallet.pendingKobo, '7500');
    assert.equal(wallet.body.wallet.eligibleKobo, '0');

    await grantStepUp(ctx.agentToken, ctx.agentPhone, 'commission.payout.request');
    const payout = await post('/agents/me/commission/payout', {}, { token: ctx.agentToken });
    assert.equal(payout.status, 409);
    assert.equal(payout.body.error.code, 'NO_ELIGIBLE_COMMISSION');
  });

  it('requires step-up authentication for a payout request', async () => {
    // The previous test consumed the grant; one OTP authorises one action.
    const payout = await post('/agents/me/commission/payout', {}, { token: ctx.agentToken });
    assert.equal(payout.status, 403);
    assert.equal(payout.body.error.code, 'STEP_UP_REQUIRED');
  });
});

describe('Reconciliation and settlement (PRD §46, §47)', () => {
  const reconcile = () =>
    post(
      '/government/reconciliation/run',
      {
        from: new Date(Date.now() - 86_400_000).toISOString(),
        to: new Date(Date.now() + 60_000).toISOString(),
      },
      { token: ctx.financeToken },
    );

  it('reports verified-but-unsettled money as pending settlement, not as collected', async () => {
    // Platform and gateway agree, but government has not yet seen the money in
    // its own account — the third leg of PRD §46's three-way match.
    const response = await reconcile();

    assert.equal(response.status, 200);
    assert.equal(response.body.totalPlatformKobo, response.body.totalGatewayKobo);
    assert.ok((response.body.byStatus.PENDING_SETTLEMENT ?? 0) >= 1);
    assert.equal(response.body.exceptions, 0, 'a pending settlement is not an exception');
  });

  it('records a settlement and moves the transaction to SETTLED', async () => {
    const response = await post(
      '/government/settlements',
      {
        settlementDate: new Date().toISOString().slice(0, 10),
        gatewayReferences: [ctx.gatewayReference],
        receivedAmountKobo: '500000',
        bankReference: 'CBN-SETTLE-0001',
      },
      { token: ctx.financeToken },
    );

    assert.equal(response.status, 201);
    assert.equal(response.body.transactionsSettled, 1);

    const transaction = await queryOne<{ status: string }>(
      pool,
      'SELECT status FROM transactions WHERE id = $1',
      [ctx.transactionId],
    );
    assert.equal(transaction!.status, 'SETTLED');
  });

  it('marks the payment fully matched once government settlement is recorded', async () => {
    const response = await reconcile();
    assert.ok((response.body.byStatus.MATCHED ?? 0) >= 1, 'all three legs now agree');
    assert.ok(response.body.matched >= 1);
  });

  it('flags a settlement whose amount does not match what was expected', async () => {
    // ECON-DEV-LEVY (₦5,000) applies to business taxpayers, which this one is.
    const itemId = await revenueItemByCode('ECON-DEV-LEVY');
    const assessment = await post(
      '/revenue/assessments',
      { taxpayerId: ctx.taxpayerId, revenueItemId: itemId, inputs: {} },
      { token: ctx.agentToken, deviceId: ctx.deviceId, idempotencyKey: 'assessment-variance' },
    );
    assert.equal(assessment.status, 201, JSON.stringify(assessment.body));

    const payment = await post(
      '/payments/initiate',
      { transactionId: assessment.body.transactionId },
      { token: ctx.agentToken, deviceId: ctx.deviceId, idempotencyKey: 'payment-variance' },
    );
    assert.equal(payment.status, 201, JSON.stringify(payment.body));

    await post(
      '/payments/simulate',
      { gatewayReference: payment.body.gatewayReference, outcome: 'SUCCESS' },
      { token: ctx.agentToken, deviceId: ctx.deviceId },
    );

    const settlement = await post(
      '/government/settlements',
      {
        settlementDate: new Date().toISOString().slice(0, 10),
        gatewayReferences: [payment.body.gatewayReference],
        receivedAmountKobo: '100000', // ₦1,000 received against a ₦5,000 levy
        bankReference: 'CBN-SETTLE-SHORT',
      },
      { token: ctx.financeToken },
    );
    assert.equal(settlement.status, 201);

    const flag = await queryOne<{ rule: string; severity: string }>(
      pool,
      `SELECT rule, severity FROM fraud_flags WHERE rule = 'SETTLEMENT_VARIANCE'`,
    );
    assert.ok(flag, 'a settlement shortfall raises a flag rather than being absorbed');
    assert.equal(flag!.severity, 'HIGH');
  });

  it('promotes commission to eligible once settled, then pays it out', async () => {
    const promoted = await post('/government/commissions/promote', {}, { token: ctx.financeToken });
    assert.equal(promoted.status, 200);
    assert.ok(promoted.body.promoted >= 1);

    await grantStepUp(ctx.agentToken, ctx.agentPhone, 'commission.payout.request');
    const payout = await post('/agents/me/commission/payout', {}, { token: ctx.agentToken });
    assert.equal(payout.status, 201);
    assert.match(payout.body.payoutReference, /^PAY-\d{4}-\d{6}$/);

    // The requesting agent cannot approve their own payout; finance does.
    const approved = await post(
      `/government/commissions/payouts/${payout.body.payoutId}/approve`,
      { reason: 'Eligible commission verified against settled transactions' },
      { token: ctx.financeToken },
    );
    assert.equal(approved.status, 200);

    const completed = await post(
      `/government/commissions/payouts/${payout.body.payoutId}/complete`,
      { bankReference: 'BANK-TRF-99001' },
      { token: ctx.financeToken },
    );
    assert.equal(completed.status, 200);

    const commission = await queryOne<{ status: string; payout_id: string | null }>(
      pool,
      'SELECT status, payout_id FROM commissions WHERE id = $1',
      [ctx.commissionId],
    );
    assert.equal(commission!.status, 'PAID');
    assert.ok(commission!.payout_id, 'a paid commission always carries its payout reference');
  });

  it('will not mark commission paid without a payout reference', async () => {
    await assert.rejects(
      pool.query(
        `UPDATE commissions SET status = 'PAID', payout_id = NULL, paid_at = NULL WHERE id = $1`,
        [ctx.commissionId],
      ),
      /cannot be marked PAID without a payout reference/,
    );
  });
});

describe('Reversal cascade (PRD §71, §88.27)', () => {
  it('reverses transaction, receipt and commission together under approval', async () => {
    const requesterId = await createGovernmentUser({
      fullName: 'Reversal Requester',
      phone: '+2348000000010',
      role: 'revenue_officer',
    });
    void requesterId;
    const requesterToken = (await loginAs('+2348000000010')).accessToken;

    const request = await post(
      '/government/approvals',
      {
        approvalType: 'PAYMENT_REVERSAL',
        entityType: 'transaction',
        entityId: ctx.transactionId,
        payload: { amountKobo: '500000', reason: 'Taxpayer charged in error', refundType: 'REVERSAL' },
        reason: 'Taxpayer was assessed for premises they had already renewed in this period.',
      },
      { token: requesterToken },
    );
    assert.equal(request.status, 201);

    // Segregation of duties: the requester cannot approve their own request.
    const selfApproval = await post(
      `/government/approvals/${request.body.approvalId}/decide`,
      { decision: 'APPROVE', reason: 'Approving my own request should not be possible' },
      { token: requesterToken },
    );
    assert.equal(selfApproval.status, 403);

    const approved = await post(
      `/government/approvals/${request.body.approvalId}/decide`,
      { decision: 'APPROVE', reason: 'Duplicate assessment confirmed against 2026 renewal record.' },
      { token: ctx.financeToken },
    );
    assert.equal(approved.status, 200);

    // The approver may not also execute it.
    const selfExecute = await post(
      `/government/approvals/${request.body.approvalId}/execute-reversal`,
      {},
      { token: ctx.financeToken },
    );
    assert.equal(selfExecute.status, 403);

    const executorId = await createGovernmentUser({
      fullName: 'Reversal Executor',
      phone: '+2348000000011',
      role: 'finance_officer',
    });
    void executorId;
    const executorToken = (await loginAs('+2348000000011')).accessToken;
    await grantStepUp(executorToken, '+2348000000011', 'payment.reversal.approve');

    const executed = await post(
      `/government/approvals/${request.body.approvalId}/execute-reversal`,
      {},
      { token: executorToken },
    );

    assert.equal(executed.status, 200);
    assert.equal(executed.body.commissionReversed, 1);
    assert.equal(executed.body.clawbackKobo, '7500', 'the paid commission is recorded for clawback');

    const transaction = await queryOne<{ status: string }>(
      pool,
      'SELECT status FROM transactions WHERE id = $1',
      [ctx.transactionId],
    );
    assert.equal(transaction!.status, 'REVERSED');

    const commission = await queryOne<{ status: string }>(
      pool,
      'SELECT status FROM commissions WHERE id = $1',
      [ctx.commissionId],
    );
    assert.equal(commission!.status, 'REVERSED');
  });

  it('reports the reversed receipt as no longer valid evidence', async () => {
    const response = await get(`/verify/${ctx.receiptCode}`);
    assert.equal(response.body.status, 'REVERSED');
    assert.match(response.body.message, /reversed or refunded/);

    // The receipt row itself survives — history is never erased.
    const receipt = await queryOne<{ status: string }>(
      pool,
      'SELECT status FROM receipts WHERE receipt_number = $1',
      [ctx.receiptNumber],
    );
    assert.equal(receipt!.status, 'REVERSED');
  });

  it('surfaces the reversal in the PRD §67 audit query', async () => {
    const response = await get('/government/audit/queries/reversed-after-success', {
      token: ctx.auditorToken,
    });
    assert.equal(response.status, 200);
    assert.ok(response.body.length >= 1);
    assert.ok(response.body[0].refund_reference);
  });
});

// ===========================================================================
// Access control, audit integrity, device trust
// ===========================================================================

describe('Access control and audit integrity (PRD §36, §45, §67)', () => {
  it('keeps the auditor read-only', async () => {
    const write = await post(
      '/taxpayers',
      {
        taxpayerType: 'INDIVIDUAL',
        firstName: 'Audit',
        lastName: 'Attempt',
        phone: '+2347099000099',
        address: 'Nowhere',
        lgaId: ctx.lgaId,
        consentGiven: true,
        declarationAccepted: true,
      },
      { token: ctx.auditorToken },
    );
    assert.equal(write.status, 403);
    assert.equal(write.body.error.code, 'FORBIDDEN');

    const read = await get('/government/audit?limit=5', { token: ctx.auditorToken });
    assert.equal(read.status, 200);
  });

  it('stops an agent reconciling payments or configuring rates', async () => {
    const reconcile = await post(
      '/government/reconciliation/run',
      { from: new Date().toISOString(), to: new Date().toISOString() },
      { token: ctx.agentToken, deviceId: ctx.deviceId },
    );
    assert.equal(reconcile.status, 403);

    const itemId = await revenueItemByCode('DEV-LEVY');
    const rate = await post(
      `/revenue/items/${itemId}/rates`,
      {
        rateType: 'FIXED',
        fixedAmountKobo: '1',
        effectiveFrom: new Date(Date.now() + 1000).toISOString(),
        reason: 'Attempting to set my own rate',
      },
      { token: ctx.agentToken, deviceId: ctx.deviceId },
    );
    assert.equal(rate.status, 403);
  });

  it('verifies the audit hash chain end to end', async () => {
    const response = await get('/government/audit/verify', { token: ctx.auditorToken });

    assert.equal(response.status, 200);
    assert.equal(response.body.valid, true);
    assert.ok(response.body.entriesChecked > 20, 'the chain covers the whole run');
    assert.match(response.body.message, /No tampering detected/);
  });

  it('detects tampering with a historical audit entry', async () => {
    // The audit table forbids UPDATE outright; this proves the trigger holds
    // even for a direct database statement.
    await assert.rejects(
      pool.query(`UPDATE audit_logs SET action = 'tampered' WHERE sequence_no = 1`),
      /append-only/,
    );
    await assert.rejects(
      pool.query(`DELETE FROM audit_logs WHERE sequence_no = 1`),
      /cannot be deleted/,
    );
  });

  it('records who accessed a taxpayer record', async () => {
    const response = await get(
      `/government/audit/queries/taxpayer-access?taxpayerId=${ctx.taxpayerId}`,
      { token: ctx.auditorToken },
    );
    assert.equal(response.status, 200);
    assert.ok(response.body.length >= 1);
  });
});

describe('Device trust and suspension (PRD §34, §88.28; Addendum §21)', () => {
  it('refuses a transaction from an unregistered device', async () => {
    const response = await post(
      '/revenue/assessments',
      {
        taxpayerId: ctx.taxpayerId,
        revenueItemId: await revenueItemByCode('DEV-LEVY'),
        inputs: {},
      },
      { token: ctx.agentToken, deviceId: 'some-other-device-9999' },
    );

    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, 'DEVICE_NOT_REGISTERED');
  });

  it('blocks transactions from an unsupported app version', async () => {
    // Addendum §43 — an outdated build cannot move money.
    const response = await post(
      '/payments/initiate',
      { transactionId: ctx.transactionId },
      {
        token: ctx.agentToken,
        deviceId: ctx.deviceId,
        appVersion: '0.9.0',
        idempotencyKey: 'payment-old-version',
      },
    );

    assert.equal(response.status, 426);
    assert.equal(response.body.error.code, 'UPDATE_REQUIRED');
    assert.equal(response.body.error.moneyStatus, 'NOT_DEBITED');
  });

  it('revokes a device and ends its sessions immediately', async () => {
    const device = await queryOne<{ id: string }>(
      pool,
      'SELECT id FROM agent_devices WHERE agent_id = $1 AND device_identifier = $2',
      [ctx.agentId, ctx.deviceId],
    );

    const response = await post(
      `/agents/devices/${device!.id}/revoke`,
      { reason: 'Device reported lost by the agent' },
      { token: ctx.adminToken },
    );
    assert.equal(response.status, 200);

    const blocked = await get('/agents/me/home', {
      token: ctx.agentToken,
      deviceId: ctx.deviceId,
    });
    assert.equal(blocked.status, 401, 'the session bound to the device is ended immediately');

    // A fresh session that was never bound to the device still cannot transact
    // from it: the check is on the device presented, not on the session.
    const freshToken = (await loginAs(ctx.agentPhone, 'FieldAgent2026')).accessToken;
    const fromRevokedDevice = await post(
      '/revenue/assessments',
      {
        taxpayerId: ctx.taxpayerId,
        revenueItemId: await revenueItemByCode('ECON-DEV-LEVY'),
        inputs: {},
      },
      { token: freshToken, deviceId: ctx.deviceId },
    );
    assert.equal(fromRevokedDevice.status, 403);
    assert.equal(fromRevokedDevice.body.error.code, 'DEVICE_REVOKED');
  });

  it('suspends an agent and stops them collecting immediately', async () => {
    ctx.agentToken = (await loginAs(ctx.agentPhone, 'FieldAgent2026')).accessToken;
    await grantStepUp(ctx.adminToken, ctx.adminPhone, 'agent.suspend');

    const response = await post(
      `/agents/${ctx.agentId}/suspend`,
      { reason: 'Under investigation following a taxpayer complaint about cash collection.' },
      { token: ctx.adminToken },
    );
    assert.equal(response.status, 200);

    // Existing sessions are cut immediately (PRD §88.28).
    const oldSession = await get('/agents/me/application', { token: ctx.agentToken });
    assert.equal(oldSession.status, 401);

    // The agent can still sign in — Addendum §25 expects them to be able to see
    // their own status — but every revenue function is closed to them.
    const reauthenticated = await loginAs(ctx.agentPhone, 'FieldAgent2026');
    const status = await get('/agents/me/application', { token: reauthenticated.accessToken });
    assert.equal(status.status, 200);
    assert.equal(status.body.applicationState, 'SUSPENDED');
    assert.equal(status.body.canCollectRevenue, false);

    const collection = await post(
      '/revenue/assessments',
      {
        taxpayerId: ctx.taxpayerId,
        revenueItemId: await revenueItemByCode('ECON-DEV-LEVY'),
        inputs: {},
      },
      { token: reauthenticated.accessToken, deviceId: ctx.deviceId },
    );
    assert.equal(collection.status, 403);
    assert.equal(collection.body.error.code, 'AGENT_SUSPENDED');
  });
});

describe('Offline drafts (PRD §30; Addendum §23)', () => {
  it('accepts a draft registration and assigns server-generated ids on sync', async () => {
    // Reinstate the agent, then register a replacement handset — the earlier
    // device was revoked, and an agent with no approved device cannot transact.
    await pool.query(
      `UPDATE agents SET operational_status = 'ACTIVE', account_status = 'ACTIVE',
              suspended_at = NULL, suspension_reason = NULL WHERE id = $1`,
      [ctx.agentId],
    );
    await pool.query(`UPDATE users SET status = 'ACTIVE' WHERE phone = $1`, [ctx.agentPhone]);

    const token = (await loginAs(ctx.agentPhone, 'FieldAgent2026')).accessToken;

    const replacement = await post(
      '/agents/me/devices',
      {
        deviceIdentifier: 'replacement-device-000002',
        deviceName: 'Replacement phone',
        pwaVersion: '1.0.0',
      },
      { token },
    );
    assert.equal(replacement.status, 201, JSON.stringify(replacement.body));
    ctx.deviceId = 'replacement-device-000002';

    const response = await post(
      '/drafts/sync',
      {
        drafts: [
          {
            clientReference: 'offline-draft-000001',
            draftType: 'TAXPAYER_REGISTRATION',
            capturedAt: new Date(Date.now() - 3_600_000).toISOString(),
            payload: {
              taxpayerType: 'INDIVIDUAL',
              firstName: 'Ladi',
              lastName: 'Dung',
              phone: '+2347044000004',
              address: 'Village square, Kuru',
              lgaId: ctx.lgaId,
              consentGiven: true,
              declarationAccepted: true,
            },
          },
        ],
      },
      { token },
    );

    assert.equal(response.status, 200);
    assert.equal(response.body.results[0].status, 'SYNCED');
    assert.ok(response.body.results[0].entityId, 'the server assigns the id, not the device');

    const replay = await post(
      '/drafts/sync',
      {
        drafts: [
          {
            clientReference: 'offline-draft-000001',
            draftType: 'TAXPAYER_REGISTRATION',
            capturedAt: new Date().toISOString(),
            payload: { taxpayerType: 'INDIVIDUAL' },
          },
        ],
      },
      { token },
    );
    assert.equal(replay.body.results[0].status, 'DUPLICATE');
  });

  it('offers no offline path that can mark a payment as received', async () => {
    // Addendum §23's financial rule, expressed as an API-surface property: the
    // draft type enum simply has no payment member.
    const response = await post(
      '/drafts/sync',
      {
        drafts: [
          {
            clientReference: 'offline-payment-attempt',
            draftType: 'PAYMENT',
            capturedAt: new Date().toISOString(),
            payload: { amountKobo: '500000', status: 'PAID' },
          },
        ],
      },
      { token: (await loginAs(ctx.agentPhone, 'FieldAgent2026')).accessToken, deviceId: ctx.deviceId },
    );

    assert.equal(response.status, 422);
  });
});

describe('Government reporting (PRD §37, §38, §39)', () => {
  it('reports collections by category, LGA, agent and MDA', async () => {
    const response = await get('/government/dashboard', { token: ctx.adminToken });

    assert.equal(response.status, 200);
    assert.ok(response.body.collections);
    assert.ok(Array.isArray(response.body.revenueByCategory));
    assert.equal(response.body.revenueByLga.length, 17, 'every Plateau LGA is reported');
    assert.ok(Array.isArray(response.body.revenueByAgent));
    assert.ok(Array.isArray(response.body.revenueByMda));
    assert.ok(response.body.exceptions);
  });

  it('drills down State -> LGA -> Ward', async () => {
    const lgas = await get('/government/intelligence/geography', { token: ctx.adminToken });
    assert.equal(lgas.body.length, 17);
    assert.equal(lgas.body[0].level_type, 'LGA');

    const wards = await get(`/government/intelligence/geography?lgaId=${ctx.lgaId}`, {
      token: ctx.adminToken,
    });
    assert.ok(wards.body.length > 0);
    assert.equal(wards.body[0].level_type, 'WARD');
  });

  it('exports transactions as CSV', async () => {
    const response = await get('/government/transactions?format=csv&limit=10', {
      token: ctx.adminToken,
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/csv/);
    assert.match(String(response.body), /transaction_reference/);
  });

  it('counts only verified revenue in collections', async () => {
    // A reversed transaction must not still be counted as collected.
    const kpis = await get('/government/kpis', { token: ctx.adminToken });
    assert.equal(kpis.status, 200);
    assert.ok(Number(kpis.body.reversals) >= 1);

    const dashboard = await get('/government/dashboard', { token: ctx.adminToken });
    const byCategory = dashboard.body.revenueByCategory as { category: string; amount_kobo: string }[];
    const premises = byCategory.find((row) => row.category === 'Business Premises and Development');
    // The ₦5,000 premises renewal was reversed; only the ₦5,000 economic
    // development levy in the same category remains recognised.
    assert.equal(premises?.amount_kobo, '500000');
  });
});

describe('Citizens are served by agents, not by a portal', () => {
  it('exposes no self-registration endpoint', async () => {
    // The route is gone, not merely guarded — nothing can mint a citizen
    // account able to raise its own assessment.
    const response = await post('/auth/register', {
      fullName: 'Walk In Citizen',
      phone: '+2347099000001',
      password: 'CitizenPass2026',
    });
    assert.equal(response.status, 404);
    assert.equal(response.body.error.code, 'ROUTE_NOT_FOUND');
  });

  it('will not let the database hold a citizen login', async () => {
    // Migration 007 narrowed users.role, so this holds for any caller —
    // including one at a psql prompt.
    await assert.rejects(
      pool.query(
        `INSERT INTO users (full_name, phone, password_hash, role)
         VALUES ('Citizen', '+2347099000002', 'x', 'taxpayer')`,
      ),
      /users_role_check/,
    );
  });

  it('will not let a transaction claim it came from a citizen portal', async () => {
    await assert.rejects(
      pool.query(`UPDATE transactions SET channel = 'TAXPAYER_PORTAL' WHERE id = $1`, [
        ctx.transactionId,
      ]),
      /transactions_channel_check|immutable/,
    );
  });

  it('still lets the citizen verify their receipt without an account', async () => {
    // Removing the portal removed a way in, not the citizen's right to proof.
    const response = await get(`/verify/${ctx.receiptCode}`);
    assert.equal(response.status, 200);
    assert.ok(['VALID', 'REVERSED'].includes(response.body.status));
  });
});
