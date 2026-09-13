/**
 * What revoking a handset is supposed to settle.
 *
 * The device is what ties a collection to a person. Every agent request carries
 * one, sessions are bound to it, every transaction records it, and
 * DEVICE_VELOCITY — the signal that most often means a phone is being run by
 * somebody it was not issued to — is raised against it. Revocation is the lever
 * an officer pulls when that is what they suspect: it kills the device, ends
 * its sessions immediately, and refuses to let the same handset ever be
 * registered again.
 *
 * Then the agent registers a different handset, and it went live on its own.
 *
 * Onboarding needs a first device to activate without an officer, so
 * `registerDevice` auto-approves one — and it decided which one by counting
 * devices that are APPROVED or ACTIVE. A revoked device is neither. So an agent
 * whose only handset had just been revoked *for cause* counted as having none,
 * their replacement was treated as their first, and it was collecting revenue
 * before anybody had looked at it. The officer's decision lasted as long as it
 * took to register another phone.
 *
 * Registering a first handset during onboarding and registering a replacement
 * after a revocation look identical to a count. They are opposite situations,
 * and only one of them means nobody has ever had a reason to look.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  firstLgaId,
  loginAs,
  pool,
  post,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './helpers';
import { queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';

const ADMIN = '+2348030000900';
let adminToken = '';
let agent = { id: '', token: '', device: '', password: '', phone: '' };

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({ role: 'admin', phone: ADMIN, fullName: 'Device Admin' });
  adminToken = (await loginAs(ADMIN)).accessToken;

  const demo = await seedDemoAgent();
  assert.ok(demo);
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agent = {
    id: demo!.agentId,
    token: session.accessToken,
    device: demo!.deviceIdentifier,
    password: demo!.password,
    phone: demo!.phone,
  };
});

const deviceRow = (identifier: string) =>
  queryOne<{ id: string; status: string; approved_by: string | null }>(
    pool,
    'SELECT id, status, approved_by FROM agent_devices WHERE agent_id = $1 AND device_identifier = $2',
    [agent.id, identifier],
  );

/**
 * The journey a replacement actually takes.
 *
 * The old handset is gone and signing in from it is refused, so the agent
 * opens the app on the new one — a device identifier the platform has never
 * seen — signs in there, and registers it. Nothing else is available to them.
 */
async function registerFrom(identifier: string) {
  const session = await loginAs(agent.phone, agent.password, identifier);
  agent.token = session.accessToken;
  return post(
    '/agents/me/devices',
    { deviceIdentifier: identifier, deviceName: 'Replacement handset' },
    { token: agent.token, deviceId: identifier },
  );
}

const revoke = (deviceId: string) =>
  post(
    `/agents/devices/${deviceId}/revoke`,
    { reason: 'Handset reported as being used by somebody other than the agent.' },
    { token: adminToken },
  );

describe('registering a handset after one was revoked', () => {
  it('does not hand the agent a live device to replace the one taken away', async () => {
    const first = await deviceRow(agent.device);
    assert.equal(first!.status, 'ACTIVE', 'the onboarding handset is live');

    const revoked = await revoke(first!.id);
    assert.equal(revoked.status, 200, JSON.stringify(revoked.body));

    const response = await registerFrom('replacement-handset-000001');
    assert.equal(response.status, 201, JSON.stringify(response.body));

    const replacement = await deviceRow('replacement-handset-000001');
    assert.equal(
      replacement!.status,
      'PENDING',
      'a revoked handset made the next one count as the first, so it went live unlooked at',
    );
    assert.equal(replacement!.approved_by, null);
    assert.match(response.body.message, /awaiting approval/i);
  });

  it('still lets it work once an officer has looked at it', async () => {
    const first = await deviceRow(agent.device);
    await revoke(first!.id);
    await registerFrom('replacement-handset-000002');

    const replacement = await deviceRow('replacement-handset-000002');
    const approved = await post(
      `/agents/devices/${replacement!.id}/approve`,
      {},
      { token: adminToken },
    );
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    assert.equal((await deviceRow('replacement-handset-000002'))!.status, 'ACTIVE');

    /*
     * And the agent can actually work.
     *
     * `agent_clearance.device_registered` is what the collection gate reads,
     * and it is derived: revoking refreshes it, registering refreshes it, and
     * approving did not. So an officer could approve the replacement, watch
     * the device go ACTIVE, and the agent would still be told they are not
     * cleared because no approved device has been registered — with nothing on
     * either screen to explain the disagreement.
     */
    const clearance = await queryOne<{ device_registered: boolean }>(
      pool,
      'SELECT device_registered FROM agent_clearance WHERE agent_id = $1',
      [agent.id],
    );
    assert.equal(clearance!.device_registered, true);

    const working = await loginAs(agent.phone, agent.password, 'replacement-handset-000002');
    const taxpayer = await post(
      '/taxpayers',
      {
        taxpayerType: 'INDIVIDUAL',
        firstName: 'Ngo',
        lastName: 'Bot',
        phone: '+2348037001011',
        address: '2 Yakubu Gowon Way, Jos',
        lgaId: await firstLgaId(),
        consentGiven: true,
        declarationAccepted: true,
      },
      {
        token: working.accessToken,
        deviceId: 'replacement-handset-000002',
        idempotencyKey: 'replacement-works',
      },
    );
    assert.equal(
      taxpayer.status,
      201,
      `the officer approved the handset and the agent was still refused: ${JSON.stringify(taxpayer.body)}`,
    );
  });

  it('leaves the officer who let a handset in on the audit trail', async () => {
    const first = await deviceRow(agent.device);
    await revoke(first!.id);
    await registerFrom('replacement-handset-000003');
    const replacement = await deviceRow('replacement-handset-000003');

    await post(`/agents/devices/${replacement!.id}/approve`, {}, { token: adminToken });

    const entry = await queryOne<{ action: string; actor_id: string | null }>(
      pool,
      `SELECT action, actor_id FROM audit_logs
        WHERE entity_type = 'agent_device' AND entity_id = $1 AND action LIKE '%approv%'
        ORDER BY created_at DESC LIMIT 1`,
      [replacement!.id],
    );
    assert.ok(
      entry,
      'revoking a handset is on the trail and letting one in was not, though only one of ' +
        'them starts revenue being collected',
    );

    const admin = await queryOne<{ id: string }>(pool, 'SELECT id FROM users WHERE phone = $1', [
      ADMIN,
    ]);
    assert.equal(entry!.actor_id, admin!.id);
  });
});

describe('the first handset of a newly approved agent', () => {
  it('still goes live without an officer, because onboarding depends on it', async () => {
    // The control. Making a replacement wait must not make onboarding wait:
    // an agent who has just been approved has nobody to ask yet.
    const first = await deviceRow(agent.device);
    assert.equal(first!.status, 'ACTIVE');
    assert.notEqual(first!.approved_by, null);
  });

  it('makes a second handset wait while the first is live', async () => {
    const response = await post(
      '/agents/me/devices',
      { deviceIdentifier: 'second-handset-000001', deviceName: 'Second handset' },
      { token: agent.token, deviceId: agent.device },
    );
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal((await deviceRow('second-handset-000001'))!.status, 'PENDING');
  });
});
