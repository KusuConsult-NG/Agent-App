/**
 * An agent sees the cooperatives they registered, and no others.
 *
 * `GET /groups` was gated on `group:read:all` and returned every group in the
 * State. Agents hold that permission — they are the ones who register groups
 * in the field — so the field screen listing "your groups" listed the whole
 * of Plateau: every market association, transport union and farmers'
 * cooperative any agent had ever recorded, with its leader's name and phone
 * number on each row.
 *
 * That is a disclosure, not a display bug. An agent is paid commission on what
 * the people they register later pay, so a directory of every organised group
 * in the State — who leads it, how to reach them, how many members it claims —
 * is a competitive asset handed to somebody with a reason to use it. It also
 * makes the group's leader reachable by a stranger who can truthfully say they
 * are a PSIRS agent.
 *
 * `group:read:all` keeps its name and its meaning, and stays with the officers
 * who genuinely need the whole register. Agents now hold `group:read:own`,
 * which is the vocabulary the rest of the platform already uses for exactly
 * this — `payment:read:own`, `commission:read:own`, `report:read:own`.
 *
 * The detail route is scoped by the same rule. A list filter that a caller can
 * step around by knowing an id is decoration.
 */

import './env';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  firstLgaId,
  get,
  loginAs,
  post,
  resetDatabase,
  startTestServer,
  stopTestServer,
  territoryForLga,
} from './helpers';
import { seedReferenceData } from '../db/seed';

let lgaId = '';
let territoryId = '';
let adminToken = '';
let officerToken = '';
let mine: { token: string; device: string };
let theirs: { token: string; device: string };

/** Take an applicant all the way to ACTIVE, so they can actually collect. */
async function createActiveAgent(params: {
  phone: string;
  fullName: string;
  device: string;
  identityNumber: string;
  refereePhone: string;
}): Promise<{ agentId: string; token: string }> {
  const application = await post('/agents/apply', {
    fullName: params.fullName,
    phone: params.phone,
    password: 'FieldAgent2026',
    address: '1 Test Street, Jos',
    lgaId,
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
      fullName: 'Referee For Group Scope',
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
    { decision: 'APPROVE', reason: 'Group scope fixture: identity and referee both cleared.' },
    { token: adminToken },
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
    { deviceIdentifier: params.device, deviceName: 'Group scope device', pwaVersion: '1.0.0' },
    { token },
  );
  await post(`/agents/${agentId}/activate`, { territoryId }, { token: adminToken });

  token = (await loginAs(params.phone, 'FieldAgent2026', params.device)).accessToken;
  return { agentId, token };
}

async function registerGroup(
  name: string,
  auth: { token: string; deviceId?: string },
  key: string,
): Promise<string> {
  const response = await post(
    '/groups',
    {
      name,
      groupType: 'FARMERS_COOPERATIVE',
      lgaId,
      leaderName: 'Musa Danladi',
      leaderPhone: '+2348030000001',
    },
    { ...auth, idempotencyKey: key },
  );
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.groupId as string;
}

before(async () => {
  await startTestServer();
  await resetDatabase();
  await seedReferenceData();

  await createGovernmentUser({ fullName: 'Group Admin', phone: '+2348000000120', role: 'admin' });
  await createGovernmentUser({
    fullName: 'Group Officer',
    phone: '+2348000000121',
    role: 'revenue_officer',
  });
  adminToken = (await loginAs('+2348000000120')).accessToken;
  officerToken = (await loginAs('+2348000000121')).accessToken;

  lgaId = await firstLgaId();
  territoryId = await territoryForLga(lgaId);

  const a = await createActiveAgent({
    phone: '+2347055000011',
    fullName: 'Group Scope Agent',
    device: 'group-device-00000000001',
    identityNumber: '55566677791',
    refereePhone: '+2347066000011',
  });
  mine = { token: a.token, device: 'group-device-00000000001' };

  const b = await createActiveAgent({
    phone: '+2347055000012',
    fullName: 'Other Group Agent',
    device: 'group-device-00000000002',
    identityNumber: '55566677721',
    refereePhone: '+2347066000012',
  });
  theirs = { token: b.token, device: 'group-device-00000000002' };
});

after(async () => {
  await stopTestServer();
});

describe('one agent’s cooperatives are not another’s to read', () => {
  it('lists only the groups this agent registered', async () => {
    await registerGroup('Bokkos Farmers Cooperative', { token: mine.token, deviceId: mine.device }, 'g-mine-1');
    await registerGroup('Vom Farmers Cooperative', { token: theirs.token, deviceId: theirs.device }, 'g-theirs-1');

    const list = await get('/groups?limit=100', { token: mine.token, deviceId: mine.device });
    assert.equal(list.status, 200, JSON.stringify(list.body));
    const names = (list.body.groups as { name: string }[]).map((g) => g.name);
    assert.deepEqual(names, ['Bokkos Farmers Cooperative']);
  });

  it('still shows an officer the whole register', async () => {
    const list = await get('/groups?limit=100', { token: officerToken });
    assert.equal(list.status, 200, JSON.stringify(list.body));
    const names = (list.body.groups as { name: string }[]).map((g) => g.name).sort();
    assert.deepEqual(names, ['Bokkos Farmers Cooperative', 'Vom Farmers Cooperative']);
  });

  it('refuses to open another agent’s group by id', async () => {
    const otherGroups = await get('/groups?limit=100', { token: officerToken });
    const other = (otherGroups.body.groups as { id: string; name: string }[]).find(
      (g) => g.name === 'Vom Farmers Cooperative',
    );
    assert.ok(other, 'the officer can see the other agent’s group');

    const response = await get(`/groups/${other!.id}`, {
      token: mine.token,
      deviceId: mine.device,
    });
    assert.ok(
      response.status === 403 || response.status === 404,
      `expected a refusal, got ${response.status}: ${JSON.stringify(response.body)}`,
    );
    // The leader's phone number must not be in the body of a refusal either.
    assert.doesNotMatch(JSON.stringify(response.body), /2348030000001/);
  });

  it('refuses to add a member to another agent’s group', async () => {
    // Reading was only half of it. `group:register` admits any active agent,
    // so without narrowing, an agent could attach taxpayers to a cooperative
    // somebody else recorded — and is paid commission on what those members
    // later pay.
    const all = await get('/groups?limit=100', { token: officerToken });
    const other = (all.body.groups as { id: string; name: string }[]).find(
      (g) => g.name === 'Vom Farmers Cooperative',
    )!;

    const response = await post(
      `/groups/${other.id}/members`,
      { taxpayerId: '00000000-0000-4000-8000-000000000001' },
      { token: mine.token, deviceId: mine.device, idempotencyKey: 'cross-member-1' },
    );
    assert.equal(response.status, 404, JSON.stringify(response.body));
  });

  it('refuses to invite the leader of another agent’s group', async () => {
    const all = await get('/groups?limit=100', { token: officerToken });
    const other = (all.body.groups as { id: string; name: string }[]).find(
      (g) => g.name === 'Vom Farmers Cooperative',
    )!;

    const response = await post(`/groups/${other.id}/attestation-request`, {}, {
      token: mine.token,
      deviceId: mine.device,
    });
    assert.equal(response.status, 404, JSON.stringify(response.body));
    // The invitation token must not be minted before the refusal.
    assert.doesNotMatch(JSON.stringify(response.body), /invitationUrl/);
  });

  it('still lets an agent work a group an officer recorded for them', async () => {
    // The handoff `group-device-binding.test.ts` documents: an officer records
    // a large cooperative from a ministry register and an agent enrols its
    // members. Narrowing to strictly-mine broke this, and the agent could not
    // even see the group they had been told to work.
    const officerGroup = await registerGroup(
      'Ministry Register Cooperative',
      { token: officerToken },
      'g-officer-1',
    );

    const list = await get('/groups?limit=100', { token: mine.token, deviceId: mine.device });
    const names = (list.body.groups as { name: string }[]).map((g) => g.name).sort();
    assert.deepEqual(names, ['Bokkos Farmers Cooperative', 'Ministry Register Cooperative']);

    const detail = await get(`/groups/${officerGroup}`, {
      token: mine.token,
      deviceId: mine.device,
    });
    assert.equal(detail.status, 200, JSON.stringify(detail.body));
  });

  it('lets an agent open their own', async () => {
    const list = await get('/groups?limit=100', { token: mine.token, deviceId: mine.device });
    const own = (list.body.groups as { id: string; name: string }[]).find(
      (g) => g.name === 'Bokkos Farmers Cooperative',
    );
    assert.ok(own, 'the agent’s own group is in their list');
    const detail = await get(`/groups/${own!.id}`, { token: mine.token, deviceId: mine.device });
    assert.equal(detail.status, 200, JSON.stringify(detail.body));
    assert.equal(detail.body.name, 'Bokkos Farmers Cooperative');
  });
});
