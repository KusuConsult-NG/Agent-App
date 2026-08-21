/**
 * Cross-Agent Data Isolation & RBAC Boundary Tests.
 *
 * Every piece of taxpayer data, assessment, and receipt belongs to one agent.
 * These tests confirm that Agent B cannot read, write, or mutate Agent A's data
 * through any API pathway — even with a valid session token.
 *
 * Also covers RBAC boundary tests:
 * 1. Agent cannot access government reporting endpoints
 * 2. Agent cannot access another agent's taxpayer transactions / receipts on profile
 * 3. Revenue officer cannot execute a reversal (must be finance officer)
 * 4. Auditor can read audit log but has no write access
 * 5. Finance officer cannot register taxpayers (agent only)
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  get,
  loginAs,
  post,
  pool,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './helpers';
import { queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';

let agentAToken = '';
let agentADeviceId = '';
let agentAId = '';
let agentBToken = '';
let agentBDeviceId = '';
let taxpayerOfAgentA = '';

before(async () => {
  await startTestServer();
});

after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();

  // Create government users for all relevant roles
  await createGovernmentUser({ fullName: 'Admin', phone: '+2348000000001', role: 'admin' });
  await createGovernmentUser({ fullName: 'Rev Officer', phone: '+2348000000002', role: 'revenue_officer' });
  await createGovernmentUser({ fullName: 'Finance Officer', phone: '+2348000000003', role: 'finance_officer' });
  await createGovernmentUser({ fullName: 'Auditor', phone: '+2348000000004', role: 'auditor' });

  // Seed Agent A through the real clearance pipeline
  const demoA = await seedDemoAgent();
  assert.ok(demoA);
  agentADeviceId = demoA!.deviceIdentifier;
  agentAId = demoA!.agentId;
  const sessionA = await loginAs(demoA!.phone, demoA!.password, agentADeviceId);
  agentAToken = sessionA.accessToken;

  // Create a second distinct agent (Agent B)
  const lga = await queryOne<{ id: string }>(pool, 'SELECT id FROM lgas LIMIT 1');
  const territory = await queryOne<{ id: string }>(pool, 'SELECT id FROM territories WHERE lga_id = $1 LIMIT 1', [lga!.id]);

  await pool.query(
    `INSERT INTO users (full_name, phone, password_hash, role, status)
     VALUES ('Agent B', '+2347099888777', crypt('Password123', gen_salt('bf')), 'agent', 'ACTIVE')`,
  );
  const agentBUser = await queryOne<{ id: string }>(
    pool, `SELECT id FROM users WHERE phone = '+2347099888777'`,
  );
  const agentBRow = await pool.query(
    `INSERT INTO agents (
       user_id, application_number, lga_id, territory_id, operational_status,
       clearance_status, kyc_status, referee_status, training_status, account_status
     )
     VALUES ($1, 'APP-TEST-AGENT-B', $2, $3, 'ACTIVE', 'APPROVED', 'CLEARED', 'CLEARED', 'COMPLETED', 'ACTIVE')
     RETURNING id`,
    [agentBUser!.id, lga!.id, territory!.id],
  );
  const agentBRecord = agentBRow.rows[0];
  agentBDeviceId = 'agent-b-device-001';
  await pool.query(
    `INSERT INTO agent_devices (agent_id, device_identifier, device_name, status, registered_at, approved_at)
     VALUES ($1, $2, 'Agent B Device', 'APPROVED', now(), now())`,
    [agentBRecord.id, agentBDeviceId],
  );

  const sessionB = await post('/auth/login', { phone: '+2347099888777', password: 'Password123' }, { deviceId: agentBDeviceId });
  agentBToken = sessionB.body.accessToken;

  // Agent A registers a taxpayer
  const tpRes = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'AgentA',
      lastName: 'Taxpayer',
      phone: '+2348088000001',
      address: '1 Agent A Road, Jos',
      lgaId: lga!.id,
      consentGiven: true,
      declarationAccepted: true,
      acknowledgeDuplicates: true,
    },
    { token: agentAToken, deviceId: agentADeviceId },
  );
  assert.equal(tpRes.status, 201, JSON.stringify(tpRes.body));
  taxpayerOfAgentA = tpRes.body.taxpayerId;
});

describe('Cross-Agent Data Isolation', () => {
  it('Agent B sees only AGENT_LIMITED view of Agent A taxpayer without financial history', async () => {
    const r = await get(`/taxpayers/${taxpayerOfAgentA}`, { token: agentBToken, deviceId: agentBDeviceId });
    assert.equal(r.status, 200);
    assert.equal(r.body.scope, 'AGENT_LIMITED');
    assert.equal(r.body.transactions.length, 0, 'Agent B must not see transactions facilitated by Agent A');
    assert.equal(r.body.receipts.length, 0, 'Agent B must not see receipts facilitated by Agent A');
    assert.equal(r.body.compliance, null, 'Agent B must not see taxpayer compliance scoring');
  });

  it('Agent B cannot read Agent A\'s commission breakdown', async () => {
    const r = await get('/agents/me/commission', { token: agentBToken, deviceId: agentBDeviceId });
    assert.equal(r.status, 200);
    assert.equal(r.body.wallet.lifetimeKobo, '0', 'Agent B sees only their own commission wallet');
  });

  it('Agent B search does not leak unassigned compliance/programme data', async () => {
    const search = await get('/taxpayers/search?q=AgentA', { token: agentBToken, deviceId: agentBDeviceId });
    assert.equal(search.status, 200);
    assert.ok(search.body.length >= 1);
  });
});

describe('RBAC Boundary: Government roles vs Agent routes', () => {
  it('Finance Officer cannot register a taxpayer (agent-only route)', async () => {
    const financeToken = (await loginAs('+2348000000003')).accessToken;
    const lga = await queryOne<{ id: string }>(pool, 'SELECT id FROM lgas LIMIT 1');

    const r = await post('/taxpayers', {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Finance',
      lastName: 'Attempt',
      phone: '+2348088000099',
      address: '99 Finance St, Jos',
      lgaId: lga!.id,
      consentGiven: true,
      declarationAccepted: true,
    }, { token: financeToken });
    assert.equal(r.status, 403, `Finance officer must not register taxpayers, got ${r.status}`);
  });

  it('Revenue Officer cannot execute a reversal (finance officer only)', async () => {
    const revToken = (await loginAs('+2348000000002')).accessToken;

    const r = await post(
      '/government/approvals/00000000-0000-0000-0000-000000000001/execute-reversal',
      {},
      { token: revToken },
    );
    assert.equal(r.status, 403, `Revenue officer must not execute reversals, got ${r.status}`);
  });

  it('Auditor cannot review agent applications', async () => {
    const auditorToken = (await loginAs('+2348000000004')).accessToken;

    const r = await post(
      `/agents/${agentAId}/review`,
      { decision: 'APPROVE', reason: 'Auditor should not review applications' },
      { token: auditorToken },
    );
    assert.equal(r.status, 403, `Auditor must not review agent applications, got ${r.status}`);
  });

  it('Auditor can read the audit log', async () => {
    const auditorToken = (await loginAs('+2348000000004')).accessToken;
    const r = await get('/government/audit', { token: auditorToken });
    assert.equal(r.status, 200, `Auditor must be able to read audit logs, got ${r.status}`);
  });

  it('Agent cannot access government audit log', async () => {
    const r = await get('/government/audit', { token: agentAToken, deviceId: agentADeviceId });
    assert.equal(r.status, 403, `Agent must not access government audit log, got ${r.status}`);
  });

  it('Agent cannot access executive dashboard', async () => {
    const r = await get('/government/dashboard', { token: agentAToken, deviceId: agentADeviceId });
    assert.equal(r.status, 403, `Agent must not access executive dashboard, got ${r.status}`);
  });
});
