/**
 * Agent scope containment.
 *
 * The agent application is a field tool, not a window into government. An agent
 * must see their own work — their taxpayers, their transactions, their
 * commission — and nothing that belongs to the administration: no LGA or
 * state-wide revenue, no other agent's figures, no reconciliation, no audit
 * trail, no rate configuration, no taxpayer incentive administration.
 *
 * This suite asserts that containment endpoint by endpoint, against a genuinely
 * cleared and active agent, so a future permission change that widens the
 * agent's view fails here rather than in production.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { permissionsForRole, ROLES } from '@psirs/shared';
import {
  firstLgaId,
  get,
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
import { queryOne } from '../db/pool';

const ctx = {
  lgaId: '',
  territoryId: '',
  adminToken: '',
  agentToken: '',
  agentId: '',
  otherAgentId: '',
  deviceId: 'scope-device-000000000001',
  taxpayerId: '',
  otherTaxpayerId: '',
  otherTransactionRef: '',
};

/** Drive an applicant all the way to ACTIVE so the test exercises a real agent. */
async function createActiveAgent(params: {
  phone: string;
  fullName: string;
  device: string;
  lgaId: string;
  territoryId: string;
  adminToken: string;
  identityNumber: string;
  refereePhone: string;
}): Promise<{ agentId: string; token: string }> {
  const application = await post('/agents/apply', {
    fullName: params.fullName,
    phone: params.phone,
    password: 'FieldAgent2026',
    address: '1 Test Street, Jos',
    lgaId: params.lgaId,
    bankName: 'Access Bank',
    bankCode: '044',
    accountName: params.fullName,
    accountNumber: '0123456781',
  });
  assert.equal(application.status, 201, JSON.stringify(application.body));
  const agentId = application.body.agentId as string;

  let token = (await loginAs(params.phone, 'FieldAgent2026')).accessToken;

  await post(
    '/agents/me/kyc',
    { identityType: 'NIN', identityNumber: params.identityNumber },
    { token },
  );

  const referee = await post(
    '/agents/me/referees',
    {
      fullName: 'Referee For Scope Test',
      phone: params.refereePhone,
      category: 'COMMUNITY_LEADER',
      relationship: 'Community leader who knows the applicant',
    },
    { token },
  );
  const refereeToken = (referee.body.invitationUrl as string).split('/referee/')[1];
  await get(`/referee/${refereeToken}`);
  await post(`/referee/${refereeToken}/respond`, {
    confirmsKnowsApplicant: true,
    confirmsInformationAccurate: true,
    willingToActAsReferee: true,
    understandsConsequences: true,
    identityType: 'NIN',
    identityNumber: '22233344455',
  });

  await post(
    `/agents/${agentId}/review`,
    { decision: 'APPROVE', reason: 'Scope test fixture: identity and referee both cleared.' },
    { token: params.adminToken },
  );

  const modules = await get('/agents/me/training', { token });
  for (const module of modules.body as { code: string; assessed: boolean }[]) {
    await post(
      `/agents/me/training/${module.code}`,
      { score: module.assessed ? 95 : undefined },
      { token },
    );
  }

  await post('/agents/me/bank/verify', {}, { token });
  const agreement = await get('/agents/agreement', { token });
  await post('/agents/me/agreement', { version: agreement.body.version }, { token });
  await post(
    '/agents/me/devices',
    { deviceIdentifier: params.device, deviceName: 'Scope test device', pwaVersion: '1.0.0' },
    { token },
  );

  const activation = await post(
    `/agents/${agentId}/activate`,
    { territoryId: params.territoryId },
    { token: params.adminToken },
  );
  assert.equal(activation.status, 200, JSON.stringify(activation.body));

  token = (await loginAs(params.phone, 'FieldAgent2026', params.device)).accessToken;
  return { agentId, token };
}

before(async () => {
  await startTestServer();
  await resetDatabase();
  await seedReferenceData();
  await seedDemoUsers();

  ctx.lgaId = await firstLgaId();
  ctx.territoryId = await territoryForLga(ctx.lgaId);
  ctx.adminToken = (await loginAs('+2348000000001')).accessToken;

  const agent = await createActiveAgent({
    phone: '+2347055000001',
    fullName: 'Scope Test Agent',
    device: ctx.deviceId,
    lgaId: ctx.lgaId,
    territoryId: ctx.territoryId,
    adminToken: ctx.adminToken,
    identityNumber: '55566677788',
    refereePhone: '+2347066000001',
  });
  ctx.agentId = agent.agentId;
  ctx.agentToken = agent.token;

  // A second agent, in the same territory, whose work must stay invisible.
  const other = await createActiveAgent({
    phone: '+2347055000002',
    fullName: 'Other Agent',
    device: 'scope-device-000000000002',
    lgaId: ctx.lgaId,
    territoryId: ctx.territoryId,
    adminToken: ctx.adminToken,
    identityNumber: '55566677711',
    refereePhone: '+2347066000002',
  });
  ctx.otherAgentId = other.agentId;

  // The other agent registers a taxpayer and collects a payment on them.
  const otherTaxpayer = await post(
    '/taxpayers',
    {
      taxpayerType: 'BUSINESS',
      businessName: 'Other Agent Client Ltd',
      phone: '+2347077000002',
      address: '9 Other Street, Jos',
      lgaId: ctx.lgaId,
      consentGiven: true,
      declarationAccepted: true,
    },
    { token: other.token, deviceId: 'scope-device-000000000002' },
  );
  ctx.otherTaxpayerId = otherTaxpayer.body.taxpayerId;

  const itemId = await revenueItemByCode('BP-RENEW-URBAN');
  const assessment = await post(
    '/revenue/assessments',
    { taxpayerId: ctx.otherTaxpayerId, revenueItemId: itemId, inputs: {} },
    { token: other.token, deviceId: 'scope-device-000000000002', idempotencyKey: 'scope-a-1' },
  );
  ctx.otherTransactionRef = assessment.body.transactionReference;

  const payment = await post(
    '/payments/initiate',
    { transactionId: assessment.body.transactionId },
    { token: other.token, deviceId: 'scope-device-000000000002', idempotencyKey: 'scope-p-1' },
  );
  await post(
    '/payments/simulate',
    { gatewayReference: payment.body.gatewayReference, outcome: 'SUCCESS', deliverWebhook: true },
    { token: other.token, deviceId: 'scope-device-000000000002' },
  );

  // Our agent registers their own taxpayer.
  const own = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Own',
      lastName: 'Client',
      phone: '+2347077000001',
      address: '3 Own Street, Jos',
      lgaId: ctx.lgaId,
      consentGiven: true,
      declarationAccepted: true,
    },
    { token: ctx.agentToken, deviceId: ctx.deviceId },
  );
  ctx.taxpayerId = own.body.taxpayerId;
});

after(async () => {
  await stopTestServer();
});

describe('The agent role holds no administrative permission', () => {
  it('grants nothing beyond own-scope work', () => {
    const granted = permissionsForRole('agent');

    // Nothing that reads across agents, areas or the whole platform.
    for (const forbidden of [
      'report:read:all',
      'report:read:territory',
      'report:financial',
      'dashboard:executive',
      'payment:read:all',
      'payment:reconcile',
      'commission:read:all',
      'commission:manage',
      'commission:payout:approve',
      'agent:read:all',
      'agent:read:assigned',
      'agent:manage',
      'agent:approve',
      'agent:suspend',
      'catalogue:configure',
      'audit:read',
      'fraud:read',
      'fraud:manage',
      'incentive:read:all',
      'incentive:configure',
      'taxpayer:read:all',
      'taxpayer:manage',
      'system:configure',
      'user:manage',
      'approval:review',
      'approval:authorise',
    ] as const) {
      assert.equal(
        granted.includes(forbidden),
        false,
        `agent must not hold ${forbidden}`,
      );
    }
  });

  it('holds no incentive permission — incentives belong to the taxpayer', () => {
    const granted = permissionsForRole('agent');
    assert.equal(
      granted.some((permission) => permission.startsWith('incentive:')),
      false,
      'incentives are administered for taxpayers, not agents',
    );
    // Incentives are administered by government on the taxpayer's behalf.
    // Citizens hold no account at all — an agent approaches them — so there is
    // no taxpayer role for the permission to belong to.
    assert.equal(
      (ROLES as readonly string[]).includes('taxpayer'),
      false,
      'citizens are served by agents and never sign in',
    );
    assert.ok(permissionsForRole('revenue_officer').includes('incentive:read:all'));
  });
});

describe('An agent cannot see revenue beyond their own work', () => {
  const denied = [
    ['executive dashboard', 'GET', '/government/dashboard'],
    ['state and LGA revenue intelligence', 'GET', '/government/intelligence/geography'],
    ['ward revenue for their own LGA', 'GET', '/government/intelligence/geography?lgaId=SUB_LGA'],
    ['platform KPIs', 'GET', '/government/kpis'],
    ['all transactions', 'GET', '/government/transactions'],
    ['transactions filtered to their own LGA', 'GET', '/government/transactions?lgaId=SUB_LGA'],
    ['transaction CSV export', 'GET', '/government/transactions?format=csv'],
    ['settlement dashboard', 'GET', '/government/settlements'],
    ['reconciliation exceptions', 'GET', '/government/reconciliation/exceptions'],
    ['leakage dashboard', 'GET', '/government/leakage'],
    ['fraud flags', 'GET', '/government/fraud/flags'],
    ['audit log', 'GET', '/government/audit'],
    ['audit chain verification', 'GET', '/government/audit/verify'],
    ['rate change history', 'GET', '/government/audit/queries/rate-changes'],
    ['reversed transaction report', 'GET', '/government/audit/queries/reversed-after-success'],
    ['taxpayer access log', 'GET', '/government/audit/queries/taxpayer-access?taxpayerId=SUB_TAXPAYER'],
    ['receipts by revenue item', 'GET', '/government/audit/queries/receipts-by-item?revenueItemCode=BP-RENEW-URBAN'],
    ['incentive programmes', 'GET', '/government/programmes'],
    ['commission payouts across agents', 'GET', '/government/commissions/payouts'],
    ['approval queue', 'GET', '/government/approvals'],
    ['all payments', 'GET', '/payments'],
    ['agent register', 'GET', '/agents'],
    ['KYC dashboard', 'GET', '/agents/kyc-dashboard'],
    ['referee dashboard', 'GET', '/agents/referee-dashboard'],
    ['agent performance league table', 'GET', '/agents/performance'],
    ['territory list', 'GET', '/government/reference/territories'],
    ['integration configuration', 'GET', '/government/platform/integrations'],
  ] as const;

  for (const [label, method, path] of denied) {
    it(`refuses ${label}`, async () => {
      const resolved = path
        .replace('SUB_LGA', ctx.lgaId)
        .replace('SUB_TAXPAYER', ctx.taxpayerId);

      const response =
        method === 'GET'
          ? await get(resolved, { token: ctx.agentToken, deviceId: ctx.deviceId })
          : await post(resolved, {}, { token: ctx.agentToken, deviceId: ctx.deviceId });

      assert.equal(response.status, 403, `${label} should be forbidden, got ${response.status}`);
      assert.equal(response.body.error.code, 'FORBIDDEN');
    });
  }

  it('refuses to configure a revenue rate', async () => {
    const itemId = await revenueItemByCode('DEV-LEVY');
    const response = await post(
      `/revenue/items/${itemId}/rates`,
      {
        rateType: 'FIXED',
        fixedAmountKobo: '1',
        effectiveFrom: new Date(Date.now() + 86_400_000).toISOString(),
        reason: 'An agent should never be able to set a government rate',
      },
      { token: ctx.agentToken, deviceId: ctx.deviceId },
    );
    assert.equal(response.status, 403);
  });

  it('refuses to read another agent’s clearance record', async () => {
    const response = await get(`/agents/${ctx.otherAgentId}`, {
      token: ctx.agentToken,
      deviceId: ctx.deviceId,
    });
    assert.equal(response.status, 403);
  });
});

describe('An agent sees only their own figures', () => {
  it('reports own collections on the home screen, not the territory’s', async () => {
    const home = await get('/agents/me/home', { token: ctx.agentToken, deviceId: ctx.deviceId });
    assert.equal(home.status, 200);

    // The other agent collected ₦5,000 in the same LGA today. None of it may
    // appear in this agent's figures.
    assert.equal(home.body.today.collected_kobo, '0');
    assert.equal(home.body.today.successful, '0');
    assert.equal(home.body.taxpayersOnboarded.total, '1');

    const serialised = JSON.stringify(home.body);
    assert.equal(serialised.includes(ctx.otherTransactionRef), false);
    assert.equal(serialised.includes('Other Agent Client'), false);
  });

  it('lists only transactions it facilitated', async () => {
    const response = await get('/agents/me/transactions', {
      token: ctx.agentToken,
      deviceId: ctx.deviceId,
    });
    assert.equal(response.status, 200);
    assert.equal(
      (response.body as { transaction_reference: string }[]).some(
        (row) => row.transaction_reference === ctx.otherTransactionRef,
      ),
      false,
      'another agent’s transaction must not appear',
    );
  });

  it('lists only receipts it facilitated', async () => {
    const response = await get('/receipts', { token: ctx.agentToken, deviceId: ctx.deviceId });
    assert.equal(response.status, 200);
    assert.equal(
      (response.body as { taxpayer_name: string }[]).some((row) =>
        row.taxpayer_name?.includes('Other Agent Client'),
      ),
      false,
    );
  });

  it('reports only its own commission', async () => {
    const response = await get('/agents/me/commission', {
      token: ctx.agentToken,
      deviceId: ctx.deviceId,
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.wallet.lifetimeKobo, '0');
    assert.equal(response.body.entries.length, 0);
  });
});

describe('An agent sees a taxpayer only as far as serving them requires', () => {
  it('can find a taxpayer and see what they owe', async () => {
    // Serving a walk-up taxpayer requires finding them and knowing their
    // obligations — that much is the job.
    const search = await get('/taxpayers/search?q=Other%20Agent%20Client', {
      token: ctx.agentToken,
      deviceId: ctx.deviceId,
    });
    assert.equal(search.status, 200);
    assert.ok(search.body.length >= 1);

    const obligations = await get(`/revenue/taxpayers/${ctx.otherTaxpayerId}/obligations`, {
      token: ctx.agentToken,
      deviceId: ctx.deviceId,
    });
    assert.equal(obligations.status, 200);
  });

  it('does not expose another agent’s collection history on the taxpayer profile', async () => {
    const profile = await get(`/taxpayers/${ctx.otherTaxpayerId}`, {
      token: ctx.agentToken,
      deviceId: ctx.deviceId,
    });
    assert.equal(profile.status, 200);

    // The taxpayer's payment history belongs to the taxpayer and to government,
    // not to whichever agent happens to search for them.
    assert.equal(
      profile.body.transactions.length,
      0,
      'transactions facilitated by another agent must not be listed',
    );
    assert.equal(profile.body.receipts.length, 0);
    assert.equal(
      profile.body.compliance,
      null,
      'compliance scoring is taxpayer incentive data, not agent data',
    );
    assert.deepEqual(profile.body.programmes, []);
    assert.equal(profile.body.scope, 'AGENT_LIMITED');
  });

  it('shows the agent their own facilitated work on a taxpayer profile', async () => {
    const itemId = await revenueItemByCode('DEV-LEVY');
    const assessment = await post(
      '/revenue/assessments',
      { taxpayerId: ctx.taxpayerId, revenueItemId: itemId, inputs: {} },
      { token: ctx.agentToken, deviceId: ctx.deviceId, idempotencyKey: 'scope-own-1' },
    );
    assert.equal(assessment.status, 201, JSON.stringify(assessment.body));

    const profile = await get(`/taxpayers/${ctx.taxpayerId}`, {
      token: ctx.agentToken,
      deviceId: ctx.deviceId,
    });
    assert.equal(profile.body.transactions.length, 1);
    assert.equal(
      profile.body.transactions[0].transaction_reference,
      assessment.body.transactionReference,
    );
  });

  it('refuses the taxpayer incentive record entirely', async () => {
    const response = await get(`/taxpayers/${ctx.taxpayerId}/incentives`, {
      token: ctx.agentToken,
      deviceId: ctx.deviceId,
    });
    assert.equal(response.status, 403, 'incentives are mapped to the taxpayer, not the agent');
  });
});

describe('Government retains the full view', () => {
  it('shows administration every agent’s collections and every LGA', async () => {
    const dashboard = await get('/government/dashboard', { token: ctx.adminToken });
    assert.equal(dashboard.status, 200);
    assert.equal(dashboard.body.revenueByLga.length, 17);
    assert.ok(
      (dashboard.body.revenueByAgent as { full_name: string }[]).some(
        (row) => row.full_name === 'Other Agent',
      ),
      'administration sees the agent the field agent cannot',
    );

    const transactions = await get('/government/transactions', { token: ctx.adminToken });
    assert.ok(
      (transactions.body as { transaction_reference: string }[]).some(
        (row) => row.transaction_reference === ctx.otherTransactionRef,
      ),
    );
  });

  it('shows an officer the full taxpayer record the agent could not see', async () => {
    const officerToken = (await loginAs('+2348000000002')).accessToken;
    const profile = await get(`/taxpayers/${ctx.otherTaxpayerId}`, { token: officerToken });
    assert.equal(profile.status, 200);
    assert.equal(profile.body.scope, 'FULL');
    assert.ok(profile.body.transactions.length >= 1);
    assert.ok(profile.body.receipts.length >= 1);
    assert.notEqual(profile.body.compliance, null);
  });

  it('keeps the taxpayer’s own incentives available to the taxpayer and to officers', async () => {
    const officerToken = (await loginAs('+2348000000002')).accessToken;
    const response = await get(`/taxpayers/${ctx.otherTaxpayerId}/incentives`, {
      token: officerToken,
    });
    assert.equal(response.status, 200);
    assert.ok(Object.prototype.hasOwnProperty.call(response.body, 'compliance'));
  });
});
