/**
 * The lever between doing nothing and banning a handset for good.
 *
 * `agent_devices.status` offers SUSPENDED and nothing wrote it, so an officer
 * had exactly one thing they could do about a phone: revoke it. Revocation is
 * final in both directions — the device dies, its sessions end, and that
 * handset can never be registered to that agent again.
 *
 * That is right for a stolen phone and wrong for most of the reasons an
 * officer actually reaches for it. An agent mislays a handset for a week; a
 * DEVICE_VELOCITY flag is raised and somebody wants collection stopped while
 * they look; a phone goes in for repair. In every one of those the officer
 * either bans a working handset for good, or does nothing at all — and the
 * cost of the first falls on the agent, who then needs a new phone and an
 * officer to approve it, so in practice the answer tends to be nothing.
 *
 * Suspension is the same stop with none of the permanence: sessions end at
 * once, the clearance flag drops, the agent cannot collect — and if the phone
 * turns up, an officer puts it back.
 *
 * The agent has to be able to tell the two apart, which they could not: both
 * answered "This device has been revoked and can no longer be used for revenue
 * collection", so an agent whose phone had been paused for a fortnight was
 * being told to go and buy another one.
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
import { queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';

const ADMIN = '+2348030001000';
let adminToken = '';
let agent = { id: '', token: '', device: '', deviceUuid: '', password: '', phone: '' };

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

  captured = 0;
  const demo = await seedDemoAgent();
  assert.ok(demo);
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  const row = await queryOne<{ id: string }>(
    pool,
    'SELECT id FROM agent_devices WHERE agent_id = $1 AND device_identifier = $2',
    [demo!.agentId, demo!.deviceIdentifier],
  );
  agent = {
    id: demo!.agentId,
    token: session.accessToken,
    device: demo!.deviceIdentifier,
    deviceUuid: row!.id,
    password: demo!.password,
    phone: demo!.phone,
  };
});

const suspend = (reason = 'Agent reports the handset mislaid; pausing while it is looked for.') =>
  post(`/agents/devices/${agent.deviceUuid}/suspend`, { reason }, { token: adminToken });

const restore = (reason = 'Handset returned and checked against the agent in person.') =>
  post(`/agents/devices/${agent.deviceUuid}/restore`, { reason }, { token: adminToken });

const revoke = () =>
  post(
    `/agents/devices/${agent.deviceUuid}/revoke`,
    { reason: 'Handset reported stolen.' },
    { token: adminToken },
  );

const deviceStatus = async () =>
  (await queryOne<{ status: string }>(pool, 'SELECT status FROM agent_devices WHERE id = $1', [
    agent.deviceUuid,
  ]))!.status;

const clearedForDevice = async () =>
  (await queryOne<{ device_registered: boolean }>(
    pool,
    'SELECT device_registered FROM agent_clearance WHERE agent_id = $1',
    [agent.id],
  ))!.device_registered;

/** A collection attempt, which is what a paused handset must not manage. */
let captured = 0;
const collect = async (token: string, idempotencyKey: string) => {
  captured += 1;
  return post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Ngo',
      lastName: 'Pam',
      phone: `+23480370010${String(captured).padStart(2, '0')}`,
      address: '2 Yakubu Gowon Way, Jos',
      lgaId: await firstLgaId(),
      consentGiven: true,
      declarationAccepted: true,
    },
    { token, deviceId: agent.device, idempotencyKey },
  );
};

describe('pausing a handset', () => {
  it('stops it collecting, at once', async () => {
    assert.equal((await collect(agent.token, 'pause-before')).status, 201);

    const response = await suspend();
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(await deviceStatus(), 'SUSPENDED');
    assert.equal(await clearedForDevice(), false);

    // The session dies with the device, exactly as revocation's does: a pause
    // that waits for the token to expire is not a pause.
    const after = await get('/agents/me', { token: agent.token, deviceId: agent.device });
    assert.equal(after.status, 401, JSON.stringify(after.body));
  });

  it('tells the agent it is paused, not that they need another phone', async () => {
    await suspend();
    const session = await loginAs(agent.phone, agent.password);
    const refused = await collect(session.accessToken, 'pause-message');

    assert.equal(refused.status, 403, JSON.stringify(refused.body));
    assert.equal(
      refused.body.error.code,
      'DEVICE_SUSPENDED',
      'a paused handset answered DEVICE_REVOKED, so the agent was told to replace a phone ' +
        'that was going to be handed back',
    );
    assert.ok(
      !/revoked/i.test(refused.body.error.message),
      `the message still says revoked: ${refused.body.error.message}`,
    );
  });

  it('is put back by an officer, and the agent works again', async () => {
    await suspend();
    const response = await restore();
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(await deviceStatus(), 'ACTIVE');
    assert.equal(await clearedForDevice(), true);

    const session = await loginAs(agent.phone, agent.password, agent.device);
    assert.equal((await collect(session.accessToken, 'pause-after')).status, 201);
  });

  it('leaves both halves on the audit trail', async () => {
    await suspend();
    await restore();

    const entries = await queryOne<{ actions: string }>(
      pool,
      `SELECT string_agg(action, ',' ORDER BY created_at) AS actions FROM audit_logs
        WHERE entity_type = 'agent_device' AND entity_id = $1`,
      [agent.deviceUuid],
    );
    assert.match(entries!.actions, /device_suspended/);
    assert.match(entries!.actions, /device_restored/);
  });
});

describe('what suspension is not', () => {
  it('does not let a revoked handset back', async () => {
    await revoke();
    const response = await restore();
    assert.notEqual(response.status, 200, 'revocation is the permanent one and stays permanent');
    assert.equal(await deviceStatus(), 'REVOKED');
  });

  it('does not pause a handset that is already gone', async () => {
    await revoke();
    const response = await suspend();
    assert.notEqual(response.status, 200, JSON.stringify(response.body));
    assert.equal(await deviceStatus(), 'REVOKED');
  });

  it('does not restore one nobody paused', async () => {
    const response = await restore();
    assert.notEqual(response.status, 200, JSON.stringify(response.body));
    assert.equal(await deviceStatus(), 'ACTIVE');
  });

  it('does not make the next handset count as a first one', async () => {
    // The same trap revocation had: "first device" must mean the agent has
    // never had one, not that they have none working right now.
    await suspend();
    const session = await loginAs(agent.phone, agent.password, 'while-paused-000001');
    const registered = await post(
      '/agents/me/devices',
      { deviceIdentifier: 'while-paused-000001', deviceName: 'Borrowed handset' },
      { token: session.accessToken, deviceId: 'while-paused-000001' },
    );
    assert.equal(registered.status, 201, JSON.stringify(registered.body));
    assert.equal(registered.body.status, 'PENDING');
  });

  it('is honest about what registering an already-paused handset did', async () => {
    await suspend();
    const session = await loginAs(agent.phone, agent.password);
    const again = await post(
      '/agents/me/devices',
      { deviceIdentifier: agent.device, deviceName: 'Same handset' },
      { token: session.accessToken },
    );
    assert.equal(again.status, 201, JSON.stringify(again.body));
    assert.equal(again.body.status, 'SUSPENDED');
    assert.ok(
      !/active/i.test(again.body.message),
      `a suspended handset was reported as registered and active: ${again.body.message}`,
    );
  });
});
