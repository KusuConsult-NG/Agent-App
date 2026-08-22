/**
 * Field capture is bound to the handset it was captured on.
 *
 * An agent registering a taxpayer passes `requireActiveAgent()`, which among
 * other things insists the request came from a device that agent has
 * registered and that PSIRS has not revoked. That is what makes revoking a
 * lost phone actually stop collection from it, rather than merely marking a
 * row.
 *
 * The group routes were added without it. An agent could register a
 * cooperative, record its members, and — worst of the three — stand at a
 * distribution point handing out fertiliser against collection codes, all
 * from any browser they could sign into. The same agent doing the same day's
 * work through `/taxpayers` was held to the device; through `/groups` and
 * `/allocations/collections` they were not.
 *
 * The collection endpoint is the one that matters most. It is the moment
 * public property changes hands, and an agent whose handset has been revoked
 * for exactly that reason should not be able to carry on from a laptop.
 *
 * Officers are untouched: `requireActiveAgent` returns early for anyone who is
 * not an agent, because an officer has no handset to be bound to.
 */

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
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';

let agentToken = '';
let agentDevice = '';
let officerToken = '';
let lgaId = '';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  lgaId = await firstLgaId();

  await createGovernmentUser({
    role: 'admin',
    phone: '+2348030000120',
    fullName: 'Group Officer',
  });
  officerToken = (await loginAs('+2348030000120')).accessToken;

  const demo = await seedDemoAgent();
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agentToken = session.accessToken;
  agentDevice = demo!.deviceIdentifier;
});

const groupBody = (name: string) => ({
  name,
  groupType: 'FARMERS_COOPERATIVE',
  economicSector: 'AGRICULTURE',
  lgaId,
  leaderName: 'Chairman Dalyop Gyang',
  leaderPhone: '+2348099990001',
});

describe('registering a group from the field', () => {
  it('is refused from a device the agent has not registered', async () => {
    const response = await post('/groups', groupBody('Unbound Cooperative'), {
      token: agentToken,
    });

    assert.equal(response.status, 403, JSON.stringify(response.body));
    assert.equal(response.body.error.code, 'DEVICE_NOT_IDENTIFIED');
  });

  it('is allowed from the registered handset', async () => {
    const response = await post('/groups', groupBody('Bound Cooperative'), {
      token: agentToken,
      deviceId: agentDevice,
    });

    assert.equal(response.status, 201, JSON.stringify(response.body));
  });

  it('is allowed for an officer, who has no handset at all', async () => {
    const response = await post('/groups', groupBody('Officer Registered Cooperative'), {
      token: officerToken,
    });

    assert.equal(response.status, 201, JSON.stringify(response.body));
  });
});

describe('recording who belongs', () => {
  async function activeGroup(): Promise<string> {
    const created = await post('/groups', groupBody('Members Cooperative'), {
      token: officerToken,
    });
    await post(
      `/groups/${created.body.groupId}/review`,
      { decision: 'APPROVE', reason: 'Verified against the ministry register.' },
      { token: officerToken },
    );
    return created.body.groupId;
  }

  async function taxpayer(phone: string): Promise<string> {
    const row = await queryOne<{ id: string }>(
      pool,
      `INSERT INTO taxpayers (taxpayer_type, first_name, last_name, phone, address, lga_id,
                              consent_given, declaration_accepted, economic_sector)
       VALUES ('INDIVIDUAL','Member','Candidate',$1,'Village Road',$2,true,true,'AGRICULTURE')
       RETURNING id`,
      [phone, lgaId],
    );
    return row!.id;
  }

  it('is refused from an unregistered device', async () => {
    const groupId = await activeGroup();
    const taxpayerId = await taxpayer('+2348120000001');

    const response = await post(`/groups/${groupId}/members`, { taxpayerId }, { token: agentToken });

    assert.equal(response.status, 403, JSON.stringify(response.body));
    assert.equal(response.body.error.code, 'DEVICE_NOT_IDENTIFIED');
  });

  it('is allowed from the registered handset', async () => {
    const groupId = await activeGroup();
    const taxpayerId = await taxpayer('+2348120000002');

    const response = await post(
      `/groups/${groupId}/members`,
      { taxpayerId },
      { token: agentToken, deviceId: agentDevice },
    );

    assert.equal(response.status, 201, JSON.stringify(response.body));
  });
});

describe('handing out an allocation', () => {
  it('is refused from an unregistered device, whatever the code says', async () => {
    // The code is not the point: the request should not get far enough for the
    // code to matter, which is why an unknown one is used here.
    const response = await post(
      '/allocations/collections',
      { collectionCode: 'ABCDE-12345' },
      { token: agentToken },
    );

    assert.equal(response.status, 403, JSON.stringify(response.body));
    assert.equal(
      response.body.error.code,
      'DEVICE_NOT_IDENTIFIED',
      'a revoked handset must not be able to keep handing out public property',
    );
  });

  it('reaches the code check from the registered handset', async () => {
    const response = await post(
      '/allocations/collections',
      { collectionCode: 'ABCDE-12345' },
      { token: agentToken, deviceId: agentDevice },
    );

    // 404: the device gate passed and the unknown code was then rejected on
    // its own merits, which is what "reaches the check" means.
    assert.equal(response.status, 404, JSON.stringify(response.body));
  });
});
