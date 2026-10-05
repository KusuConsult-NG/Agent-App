/**
 * An agent vouching for their own members.
 *
 * `groups.ts` opens with the reason a membership counts only once the group's
 * leader attests to it: "the agent who registers members is paid commission on
 * collections, so an agent who could also confirm membership would be
 * attesting to the size of their own opportunity". The leader answers through
 * a tokenised link that needs no account.
 *
 * And the link was handed to whoever asked for it. Agents hold
 * `group:register`, which reaches `POST /groups/:id/attestation-request`, and
 * the response carried the link in plain text — the agent app shows it under
 * "send this link to the group leader". Nothing sent it to the leader at all,
 * though the form told the agent the leader "is sent a link". Measured: an
 * agent registered a cooperative, an officer approved it, the agent claimed a
 * member, asked for the link, opened it and confirmed the member themselves.
 * ATTESTED is what `allocations.ts` awards fertiliser and farm inputs on.
 *
 * So the link now goes where the control needs it to: to the leader's phone as
 * the group was registered and approved, by SMS, and to nobody else. The
 * caller is told which number it went to, masked.
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

const LEADER_PHONE = '+2348030000371';

let agent: { token: string; device: string; phone: string };
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
  await createGovernmentUser({ fullName: 'Group Admin', phone: '+2348000000370', role: 'admin' });
  await createGovernmentUser({
    fullName: 'Group Officer',
    phone: '+2348000000371',
    role: 'revenue_officer',
  });
  officer = (await loginAs('+2348000000371')).accessToken;

  const demo = await seedDemoAgent();
  assert.ok(demo);
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agent = { token: session.accessToken, device: demo!.deviceIdentifier, phone: demo!.phone };
  lgaId = await firstLgaId();
});

const asAgent = (idempotencyKey?: string) => ({
  token: agent.token,
  deviceId: agent.device,
  ...(idempotencyKey ? { idempotencyKey } : {}),
});

/** A cooperative an officer has approved, with one member the agent claimed. */
async function approvedGroupWithAClaimedMember(): Promise<{ groupId: string; membershipId: string }> {
  const registered = await post(
    '/groups',
    {
      name: 'Mangu Grain Farmers',
      groupType: 'FARMERS_COOPERATIVE',
      lgaId,
      leaderName: 'Danjuma Pam',
      leaderPhone: LEADER_PHONE,
    },
    asAgent('vouch-group'),
  );
  assert.equal(registered.status, 201, JSON.stringify(registered.body));
  const groupId = registered.body.groupId as string;

  const approved = await post(
    `/groups/${groupId}/review`,
    { decision: 'APPROVE', reason: 'Met the chairman at Mangu market and saw the register.' },
    { token: officer },
  );
  assert.equal(approved.status, 200, JSON.stringify(approved.body));

  const taxpayer = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Claimed',
      lastName: 'Member',
      phone: '+2348030000372',
      address: '9 Grain Market, Mangu',
      lgaId,
      consentGiven: true,
      declarationAccepted: true,
    },
    asAgent('vouch-taxpayer'),
  );
  assert.equal(taxpayer.status, 201, JSON.stringify(taxpayer.body));

  const member = await post(
    `/groups/${groupId}/members`,
    { taxpayerId: taxpayer.body.taxpayerId },
    asAgent('vouch-member'),
  );
  assert.equal(member.status, 201, JSON.stringify(member.body));
  return { groupId, membershipId: member.body.membershipId as string };
}

describe('the link that confirms an agent’s claims', () => {
  it('is not handed to the agent who made them', async () => {
    const { groupId } = await approvedGroupWithAClaimedMember();

    const asked = await post(`/groups/${groupId}/attestation-request`, {}, asAgent());
    assert.equal(asked.status, 201, JSON.stringify(asked.body));
    assert.doesNotMatch(
      JSON.stringify(asked.body),
      /group-attestation\//,
      'the agent was given the link that confirms their own members',
    );
    assert.equal(asked.body.invitationUrl, undefined);
  });

  it('goes to the leader’s phone, and the agent is told where, not what', async () => {
    const { groupId } = await approvedGroupWithAClaimedMember();

    const asked = await post(`/groups/${groupId}/attestation-request`, {}, asAgent());
    assert.equal(asked.status, 201, JSON.stringify(asked.body));
    assert.match(asked.body.sentTo, /371$/, 'enough of the number to recognise it');
    assert.ok(!String(asked.body.sentTo).includes(LEADER_PHONE), 'and not the number itself');

    const sms = await queryOne<{ recipient: string; message: string; secret_message: string | null }>(
      pool,
      `SELECT recipient, message, secret_message FROM notifications
        WHERE event = 'GROUP_ATTESTATION_INVITATION' AND entity_id = $1`,
      [groupId],
    );
    assert.ok(sms, 'nothing was sent to the leader');
    assert.equal(sms!.recipient, LEADER_PHONE);
    assert.doesNotMatch(sms!.message, /group-attestation\//, 'the kept copy does not hold the link');

    // And the link the leader receives opens their list.
    const token = /group-attestation\/([\w-]+)/.exec(sms!.secret_message ?? '')?.[1];
    assert.ok(token, `no link in what goes to the leader: ${sms!.secret_message}`);
    const opened = await get(`/group-attestation/${token}`, {});
    assert.equal(opened.status, 200, JSON.stringify(opened.body));
    assert.equal(opened.body.members.length, 1);
  });

  /*
   * The end-to-end form of the first test: whatever the agent was handed, none
   * of it opens the leader's page, so the claim stays a claim.
   *
   * The first version of this only checked the member was still pending after
   * the request — which is also true when the request fails, and was true
   * before the fix, when the agent simply had not used the link yet. It passed
   * against the defect. This one tries every token-shaped string in the
   * response, as the agent could, and requires the request to have worked.
   */
  it('leaves the agent nothing that can confirm their claim', async () => {
    const { groupId, membershipId } = await approvedGroupWithAClaimedMember();
    const asked = await post(`/groups/${groupId}/attestation-request`, {}, asAgent());
    assert.equal(asked.status, 201, JSON.stringify(asked.body));

    const candidates = JSON.stringify(asked.body).match(/[A-Za-z0-9_-]{20,}/g) ?? [];
    for (const candidate of candidates) {
      const opened = await get(`/group-attestation/${candidate}`, {});
      assert.notEqual(opened.status, 200, `${candidate} from the agent's response opened the leader's page`);
    }

    const member = await queryOne<{ status: string }>(
      pool,
      'SELECT status FROM taxpayer_group_members WHERE id = $1',
      [membershipId],
    );
    assert.equal(member!.status, 'PENDING_ATTESTATION');
  });

  /*
   * A request that could not be sent says so.
   *
   * Nobody holds the link any more except the leader's handset, so an
   * invitation with no message behind it is one nobody can ever answer — and a
   * screen saying "sent" would be the same false claim the form made before.
   */
  it('is refused, and nothing is recorded, when no message can carry it', async () => {
    const { groupId } = await approvedGroupWithAClaimedMember();
    await pool.query(
      `UPDATE notification_templates SET status = 'INACTIVE' WHERE event = 'GROUP_ATTESTATION_INVITATION'`,
    );
    try {
      const asked = await post(`/groups/${groupId}/attestation-request`, {}, asAgent());
      assert.equal(asked.status, 503, JSON.stringify(asked.body));
      assert.equal(asked.body.error.code, 'ATTESTATION_NOT_SENT');
    } finally {
      await pool.query(
        `UPDATE notification_templates SET status = 'ACTIVE' WHERE event = 'GROUP_ATTESTATION_INVITATION'`,
      );
    }
    const invitations = await queryOne<{ n: string }>(
      pool,
      'SELECT count(*)::text AS n FROM group_attestation_invitations WHERE group_id = $1',
      [groupId],
    );
    assert.equal(invitations!.n, '0');
  });
});

describe('a leader who is the agent', () => {
  /*
   * The residual route round the control: register the group with your own
   * number as the leader's. The officer approving the group sees the number,
   * but has no reason to know it is the agent's. Refused where it is cheap to.
   */
  it('cannot be registered by that agent', async () => {
    const registered = await post(
      '/groups',
      {
        name: 'Self Led Cooperative',
        groupType: 'FARMERS_COOPERATIVE',
        lgaId,
        leaderName: 'The Agent',
        leaderPhone: agent.phone,
      },
      asAgent('vouch-self-led'),
    );
    assert.equal(registered.status, 400, JSON.stringify(registered.body));
    assert.match(registered.body.error.message, /leader/i);
  });
});
