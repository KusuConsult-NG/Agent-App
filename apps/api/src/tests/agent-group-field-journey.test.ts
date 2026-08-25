/**
 * The payloads the agent's group screens actually send.
 *
 * `groups-and-allocations.test.ts` proves the journey works. It does not prove
 * that the screens built for it send what the API accepts — a form offering a
 * group type the enum rejects, or omitting a field the validator requires, is
 * a screen that cannot be submitted and an agent with no way to tell which of
 * their answers was wrong.
 *
 * So this drives the three field endpoints with exactly the bodies
 * `screens/Groups.tsx` builds, including the optional fields it omits when
 * blank.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  firstLgaId,
  loginAs,
  post,
  get,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './helpers';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';

let agent: { token: string; device: string };
let officer = '';
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
  await createGovernmentUser({ fullName: 'Group Admin', phone: '+2348000000110', role: 'admin' });
  await createGovernmentUser({
    fullName: 'Group Officer',
    phone: '+2348000000111',
    role: 'revenue_officer',
  });
  officer = (await loginAs('+2348000000111')).accessToken;

  const demo = await seedDemoAgent();
  assert.ok(demo);
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agent = { token: session.accessToken, device: demo!.deviceIdentifier };
  lgaId = await firstLgaId();
});

/** Exactly what RegisterGroupScreen posts when the optional fields are blank. */
function minimalBody() {
  return {
    name: 'Bokkos Farmers Cooperative',
    groupType: 'FARMERS_COOPERATIVE',
    lgaId,
    leaderName: 'Musa Danladi',
    leaderPhone: '+2348030000001',
  };
}

describe('an agent works a cooperative from the field screens', () => {
  it('registers one with only the fields the form requires', async () => {
    const response = await post('/groups', minimalBody(), {
      token: agent.token,
      deviceId: agent.device,
      idempotencyKey: 'group-register-1',
    });

    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.ok(response.body.groupId, 'the screen navigates to this id');
    assert.ok(response.body.code, 'the list shows this code');
    assert.match(response.body.message, /officer has to approve it/);
  });

  it('accepts every group type the form offers', async () => {
    // A value the select offers and the enum rejects is an unsubmittable form.
    const OFFERED = [
      'FARMERS_COOPERATIVE', 'MARKET_ASSOCIATION', 'TRANSPORT_UNION', 'ARTISAN_GUILD',
      'TRADERS_ASSOCIATION', 'FISHERIES_GROUP', 'LIVESTOCK_ASSOCIATION', 'OTHER',
    ];
    for (const [index, groupType] of OFFERED.entries()) {
      const response = await post(
        '/groups',
        { ...minimalBody(), name: `Group ${groupType}`, groupType },
        { token: agent.token, deviceId: agent.device, idempotencyKey: `gt-${index}` },
      );
      assert.equal(response.status, 201, `${groupType}: ${JSON.stringify(response.body)}`);
    }
  });

  it('shows the agent the groups they registered', async () => {
    await post('/groups', minimalBody(), {
      token: agent.token,
      deviceId: agent.device,
      idempotencyKey: 'group-register-2',
    });

    // The list screen's request, verbatim.
    const list = await get('/groups?limit=100', { token: agent.token, deviceId: agent.device });
    assert.equal(list.status, 200, JSON.stringify(list.body));
    assert.equal(list.body.groups.length, 1);
    const row = list.body.groups[0];
    // Every column the list renders has to be in the response.
    for (const key of ['id', 'code', 'name', 'group_type', 'status', 'lga_name', 'attested_members']) {
      assert.ok(key in row, `the list screen renders ${key}, which the API did not return`);
    }
  });

  it('refuses members until an officer has approved it, and says so', async () => {
    const registered = await post('/groups', minimalBody(), {
      token: agent.token,
      deviceId: agent.device,
      idempotencyKey: 'group-register-3',
    });
    const groupId = registered.body.groupId as string;

    const detail = await get(`/groups/${groupId}`, { token: agent.token, deviceId: agent.device });
    assert.equal(detail.status, 200, JSON.stringify(detail.body));
    assert.notEqual(
      detail.body.status,
      'ACTIVE',
      'a newly registered group must not be active — the screen hides the member form on this',
    );
    for (const key of ['ward_name', 'community', 'attested_members', 'pending_members', 'leader_name']) {
      assert.ok(key in detail.body, `the detail screen renders ${key}, which the API did not return`);
    }
  });

  it('records a member and asks the leader once the officer approves', async () => {
    const registered = await post('/groups', minimalBody(), {
      token: agent.token,
      deviceId: agent.device,
      idempotencyKey: 'group-register-4',
    });
    const groupId = registered.body.groupId as string;

    const approved = await post(
      `/groups/${groupId}/review`,
      { decision: 'APPROVE', reason: 'Met the cooperative at Bokkos market and confirmed its leadership.' },
      { token: officer },
    );
    assert.equal(approved.status, 200, JSON.stringify(approved.body));

    const taxpayer = await post(
      '/taxpayers',
      {
        taxpayerType: 'INDIVIDUAL',
        firstName: 'Group',
        lastName: 'Member',
        phone: '+2348030000002',
        address: '5 Market Road, Jos',
        lgaId,
        community: 'Bokkos',
        consentGiven: true,
        declarationAccepted: true,
      },
      { token: agent.token, deviceId: agent.device, idempotencyKey: 'group-member-tp' },
    );
    assert.equal(taxpayer.status, 201, JSON.stringify(taxpayer.body));

    // What the member form sends: the picked taxpayer's id, nothing else.
    const member = await post(
      `/groups/${groupId}/members`,
      { taxpayerId: taxpayer.body.taxpayerId },
      { token: agent.token, deviceId: agent.device, idempotencyKey: 'group-member-1' },
    );
    assert.equal(member.status, 201, JSON.stringify(member.body));
    assert.match(
      member.body.message,
      /only once the group leader has confirmed/,
      'the screen shows this message verbatim, so it has to say what it claims',
    );

    // And the attestation request, which the screen sends with an empty body.
    const invite = await post(`/groups/${groupId}/attestation-request`, {}, {
      token: agent.token,
      deviceId: agent.device,
    });
    assert.equal(invite.status, 201, JSON.stringify(invite.body));
    assert.ok(invite.body.invitationUrl, 'the screen shows this link to send to the leader');
  });
});
