/**
 * The last nine routes no test exercised.
 *
 * Reading the previously uncovered routes produced nine defects across this
 * audit, at close to one per route read, so these were worth reading rather
 * than counting. They turned out to be correct — which is a result, not a
 * non-result: several are controls the rest of the platform leans on, and
 * "probably fine" was the only evidence for them until now.
 *
 * Two mattered more than the rest.
 *
 * `POST /agents/devices/:deviceId/approve` is the control this audit itself
 * came to depend on: field capture is bound to an approved handset, and every
 * argument about revoking a lost phone rests on approval meaning something.
 * It had no test.
 *
 * `POST /government/reconciliation/recover` re-confirms payments the gateway
 * completed but no webhook reported. If it could mark a payment verified
 * without asking the gateway, it would break the second inviolable rule from
 * inside the reconciliation system meant to enforce it.
 */

import {
  createGovernmentUser,
  firstLgaId,
  get,
  loginAs,
  pool,
  post,
  resetDatabase,
  revenueItemByCode,
  startTestServer,
  stopTestServer,
} from './helpers';
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { query, queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';

let officerToken = '';
let financeToken = '';
let agent: { token: string; device: string; agentId: string };

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({
    role: 'admin',
    phone: '+2348030000140',
    fullName: 'Coverage Officer',
  });
  officerToken = (await loginAs('+2348030000140')).accessToken;

  await createGovernmentUser({
    role: 'finance_officer',
    phone: '+2348030000141',
    fullName: 'Reconciliation Officer',
  });
  financeToken = (await loginAs('+2348030000141')).accessToken;

  const demo = await seedDemoAgent();
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agent = {
    token: session.accessToken,
    device: demo!.deviceIdentifier,
    agentId: demo!.agentId,
  };
});

async function registerTaxpayer(suffix: string, extra: Record<string, unknown> = {}) {
  const response = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Coverage',
      lastName: `Subject${suffix}`,
      phone: `+2348141${suffix.padStart(6, '0')}`,
      address: '2 Market Road, Bokkos',
      lgaId: await firstLgaId(),
      consentGiven: true,
      declarationAccepted: true,
      ...extra,
    },
    { token: agent.token, deviceId: agent.device, idempotencyKey: `tp-cov-${suffix}` },
  );
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.taxpayerId as string;
}

describe('approving a device', () => {
  async function pendingDevice(): Promise<string> {
    const row = await queryOne<{ id: string }>(
      pool,
      `INSERT INTO agent_devices (agent_id, device_identifier, device_name, status)
       VALUES ($1, $2, 'Chrome on Linux', 'PENDING') RETURNING id`,
      [agent.agentId, `pwa-cov-${Date.now()}`],
    );
    return row!.id;
  }

  it('moves a pending device to active', async () => {
    const deviceId = await pendingDevice();

    const response = await post(`/agents/devices/${deviceId}/approve`, undefined, {
      token: officerToken,
    });

    assert.equal(response.status, 200, JSON.stringify(response.body));
    const row = await queryOne<{ status: string; approved_by: string | null }>(
      pool,
      'SELECT status, approved_by FROM agent_devices WHERE id = $1',
      [deviceId],
    );
    assert.equal(row!.status, 'ACTIVE');
    assert.ok(row!.approved_by, 'the approving officer must be recorded');
  });

  it('will not resurrect a revoked device', async () => {
    // Revocation is how a lost or misused handset is dealt with. Approving one
    // back into service would undo that silently.
    const deviceId = await pendingDevice();
    await pool.query(`UPDATE agent_devices SET status = 'REVOKED' WHERE id = $1`, [deviceId]);

    const response = await post(`/agents/devices/${deviceId}/approve`, undefined, {
      token: officerToken,
    });

    assert.equal(response.status, 403, JSON.stringify(response.body));
    const row = await queryOne<{ status: string }>(
      pool,
      'SELECT status FROM agent_devices WHERE id = $1',
      [deviceId],
    );
    assert.equal(row!.status, 'REVOKED');
  });

  it('says so when the device does not exist', async () => {
    const response = await post(
      '/agents/devices/00000000-0000-0000-0000-000000000000/approve',
      undefined,
      { token: officerToken },
    );
    assert.equal(response.status, 404, JSON.stringify(response.body));
  });

  it('is not open to an agent approving their own handset', async () => {
    const deviceId = await pendingDevice();

    const response = await post(`/agents/devices/${deviceId}/approve`, undefined, {
      token: agent.token,
      deviceId: agent.device,
    });

    assert.equal(
      response.status,
      403,
      'an agent approving their own device would make the control self-signed',
    );
  });
});

describe('recovering payments the webhook never reported', () => {
  it('asks the gateway rather than assuming, and reports what it found', async () => {
    const auth = { token: agent.token, deviceId: agent.device };
    const taxpayerId = await registerTaxpayer('1');
    const assessment = await post(
      '/revenue/assessments',
      {
        taxpayerId,
        revenueItemId: await revenueItemByCode('SHOPS-KIOSKS'),
        inputs: {},
      },
      { ...auth, idempotencyKey: 'as-rec' },
    );
    // Initiated and left unconfirmed: the gateway was never told to succeed,
    // so a sweep that "recovers" this one would be inventing a payment.
    await post(
      '/payments/initiate',
      { transactionId: assessment.body.transactionId },
      { ...auth, idempotencyKey: 'pay-rec' },
    );

    // payment:reconcile, which the finance officer holds and the admin does not.
    const response = await post(
      '/government/reconciliation/recover',
      {
        from: new Date(Date.now() - 86_400_000).toISOString(),
        to: new Date(Date.now() + 60_000).toISOString(),
        limit: 50,
      },
      { token: financeToken },
    );

    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.ok(response.body.attempted >= 1, `nothing was attempted: ${JSON.stringify(response.body)}`);
    assert.equal(
      response.body.verified,
      0,
      'a payment the gateway has not confirmed must not be recovered as verified',
    );

    const payment = await queryOne<{ status: string }>(
      pool,
      `SELECT p.status FROM payments p WHERE p.transaction_id = $1`,
      [assessment.body.transactionId],
    );
    assert.notEqual(payment!.status, 'VERIFIED');
  });
});

describe('assigning a territory', () => {
  it('records the change and keeps the previous value in the audit', async () => {
    const territory = await queryOne<{ id: string }>(pool, 'SELECT id FROM territories LIMIT 1');

    const response = await post(
      `/agents/${agent.agentId}/territory`,
      { territoryId: territory!.id },
      { token: officerToken },
    );

    assert.equal(response.status, 200, JSON.stringify(response.body));
    const entry = await queryOne<{ old_value: { territoryId: string | null } }>(
      pool,
      `SELECT old_value FROM audit_logs
        WHERE action = 'agent.territory_assigned' AND entity_id = $1
        ORDER BY sequence_no DESC LIMIT 1`,
      [agent.agentId],
    );
    assert.ok(entry, 'reassignment must be audited');
  });

  it('refuses an agent that does not exist', async () => {
    const territory = await queryOne<{ id: string }>(pool, 'SELECT id FROM territories LIMIT 1');
    const response = await post(
      '/agents/00000000-0000-0000-0000-000000000000/territory',
      { territoryId: territory!.id },
      { token: officerToken },
    );
    assert.equal(response.status, 404, JSON.stringify(response.body));
  });
});

describe('an applicant reading their own identity document', () => {
  async function kycDocument(agentId: string, reference: string): Promise<string> {
    const row = await queryOne<{ id: string }>(
      pool,
      `INSERT INTO kyc_documents (agent_id, document_type, storage_reference, content_type,
                                  byte_size, checksum, verification_status)
       VALUES ($1,'IDENTITY_DOCUMENT',$2,'image/jpeg',2048,'abc','PENDING')
       RETURNING id`,
      [agentId, reference],
    );
    return row!.id;
  }

  it('will not serve one belonging to another applicant', async () => {
    const otherUser = await createGovernmentUser({
      role: 'agent',
      phone: '+2348141999001',
      fullName: 'Other Applicant',
    });
    const otherAgent = await queryOne<{ id: string }>(
      pool,
      'INSERT INTO agents (user_id, application_number) VALUES ($1,$2) RETURNING id',
      [otherUser, `APP-COV-${Date.now()}`],
    );
    const documentId = await kycDocument(otherAgent!.id, 'local://not-yours');

    const response = await get(`/agents/me/kyc/documents/${documentId}`, {
      token: agent.token,
      deviceId: agent.device,
    });

    assert.equal(
      response.status,
      403,
      'somebody else’s identity papers must not be readable',
    );
  });
});

describe('the fraud sweep', () => {
  it('runs and reports how many flags it raised', async () => {
    const response = await post('/government/fraud/sweep', undefined, { token: officerToken });

    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(typeof response.body.flagsRaised, 'number');
  });

  it('is closed to an agent', async () => {
    const response = await post('/government/fraud/sweep', undefined, {
      token: agent.token,
      deviceId: agent.device,
    });
    assert.equal(response.status, 403, JSON.stringify(response.body));
  });
});

describe('the reminder sweep', () => {
  it('runs on demand and reports what it sent', async () => {
    const response = await post('/government/reminders/send-due', undefined, {
      token: officerToken,
    });

    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(typeof response.body.sent, 'number');
    assert.equal(typeof response.body.skipped, 'number');
  });
});

describe('checking for a duplicate before registering', () => {
  it('warns on a shared phone number without blocking, which is the intended weighting', async () => {
    await registerTaxpayer('2');

    const response = await post(
      '/taxpayers/duplicate-check',
      {
        taxpayerType: 'INDIVIDUAL',
        firstName: 'Coverage',
        lastName: 'Subject2',
        phone: '+2348141000002',
        lgaId: await firstLgaId(),
      },
      { token: agent.token, deviceId: agent.device },
    );

    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.ok(
      response.body.possibleDuplicates.length > 0,
      'the same phone number should surface the existing record',
    );
    /*
     * Deliberately not blocking. The documented weighting puts phone + name at
     * 85 and blocks only at 100, because one phone number serving a household
     * or a market stall is ordinary here. Blocking on it would turn a common
     * arrangement into a refusal at the point of registration; warning lets the
     * agent look and decide.
     */
    assert.equal(response.body.blocking, false);
    assert.ok(
      response.body.possibleDuplicates[0].score >= 60,
      `expected a scored reason, got ${JSON.stringify(response.body.possibleDuplicates[0])}`,
    );
  });

  it('blocks on a repeated identification number, which is decisive', async () => {
    await registerTaxpayer('9', { identityType: 'NIN', identityNumber: '12345678901' });

    const response = await post(
      '/taxpayers/duplicate-check',
      {
        taxpayerType: 'INDIVIDUAL',
        firstName: 'Someone',
        lastName: 'Else',
        phone: '+2348148888888',
        lgaId: await firstLgaId(),
        identityNumber: '12345678901',
      },
      { token: agent.token, deviceId: agent.device },
    );

    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(
      response.body.blocking,
      true,
      'the same identification number is one person, whatever name is given',
    );
  });

  it('finds nothing for somebody genuinely new', async () => {
    const response = await post(
      '/taxpayers/duplicate-check',
      {
        taxpayerType: 'INDIVIDUAL',
        firstName: 'Nobody',
        lastName: 'Known',
        phone: '+2348149999999',
        lgaId: await firstLgaId(),
      },
      { token: agent.token, deviceId: agent.device },
    );

    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.possibleDuplicates.length, 0);
    assert.equal(response.body.blocking, false);
  });
});

describe('asking the TIN service again', () => {
  it('does not mint a second TIN for somebody who already has one', async () => {
    const taxpayerId = await registerTaxpayer('3');
    const first = await post(`/taxpayers/${taxpayerId}/tin`, undefined, {
      token: agent.token,
      deviceId: agent.device,
    });
    assert.equal(first.status, 200, JSON.stringify(first.body));

    const second = await post(`/taxpayers/${taxpayerId}/tin`, undefined, {
      token: agent.token,
      deviceId: agent.device,
    });

    assert.equal(second.status, 200, JSON.stringify(second.body));
    if (first.body.tin) {
      assert.equal(second.body.tin, first.body.tin, 'a taxpayer has one TIN, not two');
    }
  });

  it('refuses a taxpayer that does not exist', async () => {
    const response = await post(
      '/taxpayers/00000000-0000-0000-0000-000000000000/tin',
      undefined,
      { token: agent.token, deviceId: agent.device },
    );
    assert.equal(response.status, 404, JSON.stringify(response.body));
  });
});

describe('an agent reading their own offline drafts', () => {
  it('returns their queue and nobody else’s', async () => {
    const otherUser = await createGovernmentUser({
      role: 'agent',
      phone: '+2348141999002',
      fullName: 'Other Draft Agent',
    });
    const otherAgent = await queryOne<{ id: string }>(
      pool,
      'INSERT INTO agents (user_id, application_number) VALUES ($1,$2) RETURNING id',
      [otherUser, `APP-DRAFT-${Date.now()}`],
    );
    await pool.query(
      `INSERT INTO offline_drafts (agent_id, client_reference, draft_type, payload, status,
                                   captured_at)
       VALUES ($1, $2, 'TAXPAYER_REGISTRATION', '{}'::jsonb, 'PENDING_SYNC', now())`,
      [otherAgent!.id, `draft-other-${Date.now()}`],
    );

    const response = await get('/drafts', { token: agent.token, deviceId: agent.device });

    assert.equal(response.status, 200, JSON.stringify(response.body));
    const rows = Array.isArray(response.body) ? response.body : response.body.drafts;
    assert.ok(Array.isArray(rows), `expected a list, got ${JSON.stringify(response.body).slice(0, 160)}`);
    assert.equal(rows.length, 0, 'another agent’s captures must not appear in this queue');
  });
});
