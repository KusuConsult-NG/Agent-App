/**
 * A membership link may answer open questions. It may not overturn settled ones.
 *
 * The attestation invitation is deliberately reusable. A cooperative grows, an
 * agent records new people, and the leader follows the same link again to
 * answer about whoever is new — which is why submitting sets the invitation to
 * `OPENED` rather than spending it, and why the screen shows members already
 * confirmed without asking about them again.
 *
 * The reject path did not respect that boundary:
 *
 *     UPDATE taxpayer_group_members SET status = 'REJECTED' ...
 *      WHERE group_id = $1 AND id = ANY($2)
 *        AND status IN ('PENDING_ATTESTATION', 'ATTESTED')
 *
 * `ATTESTED` on that line means a confirmation could be taken back through the
 * link, at any point in its fourteen days, by anybody holding it. These arrive
 * by SMS to a village chairman's handset; a forwarded message is a forwarded
 * capability. `openAttestation` hands out every member's id, so the caller does
 * not even need to guess one.
 *
 * What that costs is not abstract. `allocations.ts` awards only to a member
 * whose status is `ATTESTED`, so flipping somebody back removes their claim on
 * fertiliser and farm inputs — and the audit entry records the leader's name as
 * the person who did it, because the token is all the endpoint has to go on.
 *
 * The confirm path was already narrowed to `PENDING_ATTESTATION`. This makes
 * the reject path match it. A leader who confirmed somebody in error goes
 * through PSIRS, exactly as a referee who wants to withdraw a response does —
 * a recorded decision is not undone through a public endpoint by whoever kept
 * the message.
 */

import './env';
import { after, before, describe, it } from 'node:test';
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
import { query, queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';

let officerToken = '';
let lgaId = '';

before(async () => {
  await startTestServer();
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({
    fullName: 'Attestation Officer',
    phone: '+2348000000140',
    role: 'revenue_officer',
  });
  officerToken = (await loginAs('+2348000000140')).accessToken;
  lgaId = await firstLgaId();
});

after(async () => {
  await stopTestServer();
});


/** A taxpayer row, straight in: registering one is an agent's permission. */
async function taxpayerRow(phone: string, last: string): Promise<string> {
  const row = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO taxpayers (taxpayer_type, first_name, last_name, phone, address, lga_id,
                            consent_given, declaration_accepted, economic_sector)
     VALUES ('INDIVIDUAL','Attested',$1,$2,'Village Road',$3,true,true,'AGRICULTURE')
     RETURNING id`,
    [last, phone, lgaId],
  );
  return row!.id;
}

/** A group, approved, with one member recorded and awaiting the leader. */
async function groupWithPendingMember(suffix: string): Promise<{
  token: string;
  memberId: string;
  taxpayerId: string;
}> {
  const created = await post(
    '/groups',
    {
      name: `Attestation Cooperative ${suffix}`,
      groupType: 'FARMERS_COOPERATIVE',
      lgaId,
      leaderName: 'Musa Danladi',
      leaderPhone: '+2348030000010',
    },
    { token: officerToken, idempotencyKey: `att-group-${suffix}` },
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const groupId = created.body.groupId as string;

  const approved = await post(
    `/groups/${groupId}/review`,
    { decision: 'APPROVE', reason: 'Verified against the ministry register of cooperatives.' },
    { token: officerToken },
  );
  assert.equal(approved.status, 200, JSON.stringify(approved.body));

  const taxpayerId = await taxpayerRow(`+23481200000${suffix.padStart(2, '0')}`, `Member${suffix}`);

  const member = await post(
    `/groups/${groupId}/members`,
    { taxpayerId },
    { token: officerToken, idempotencyKey: `att-member-${suffix}` },
  );
  assert.equal(member.status, 201, JSON.stringify(member.body));

  const invite = await post(`/groups/${groupId}/attestation-request`, {}, { token: officerToken });
  assert.equal(invite.status, 201, JSON.stringify(invite.body));
  const token = (invite.body.invitationUrl as string).split('/group-attestation/')[1]!;

  const view = await get(`/group-attestation/${token}`);
  assert.equal(view.status, 200, JSON.stringify(view.body));
  const pending = (view.body.members as { id: string; status: string }[]).find(
    (m) => m.status === 'PENDING_ATTESTATION',
  );
  assert.ok(pending, 'the member is waiting on the leader');

  return { token, memberId: pending!.id, taxpayerId };
}

async function statusOf(memberId: string): Promise<string> {
  const row = await queryOne<{ status: string }>(
    pool,
    'SELECT status FROM taxpayer_group_members WHERE id = $1',
    [memberId],
  );
  return row!.status;
}

describe('a reused membership link cannot take a confirmation back', () => {
  it('confirms the member the first time, as it should', async () => {
    const { token, memberId } = await groupWithPendingMember('1');

    const confirmed = await post(`/group-attestation/${token}/confirm`, {
      confirmedMemberIds: [memberId],
      rejectedMemberIds: [],
    });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
    assert.equal(confirmed.body.attested, 1);
    assert.equal(await statusOf(memberId), 'ATTESTED');
  });

  it('refuses to reject somebody the leader already confirmed', async () => {
    const { token, memberId } = await groupWithPendingMember('2');

    await post(`/group-attestation/${token}/confirm`, {
      confirmedMemberIds: [memberId],
      rejectedMemberIds: [],
    });
    assert.equal(await statusOf(memberId), 'ATTESTED');

    // The same link again — as anybody the SMS was forwarded to would have it.
    const replay = await post(`/group-attestation/${token}/confirm`, {
      confirmedMemberIds: [],
      rejectedMemberIds: [memberId],
      rejectionReason: 'Taking it back.',
    });

    assert.equal(replay.status, 200, JSON.stringify(replay.body));
    assert.equal(replay.body.rejected, 0, 'nothing settled may be reopened through the link');
    assert.equal(
      await statusOf(memberId),
      'ATTESTED',
      'a confirmation was overturned by re-using the invitation link',
    );
  });

  it('still lets the leader answer about somebody added later', async () => {
    // The reuse this link exists for: a growing cooperative, answered in
    // instalments. Narrowing the reject path must not break it.
    const { token, memberId } = await groupWithPendingMember('3');

    await post(`/group-attestation/${token}/confirm`, {
      confirmedMemberIds: [memberId],
      rejectedMemberIds: [],
    });

    const view = await get(`/group-attestation/${token}`);
    assert.equal(view.status, 200, 'the link still opens for the next round');

    const groupRow = await queryOne<{ group_id: string }>(
      pool,
      'SELECT group_id FROM taxpayer_group_members WHERE id = $1',
      [memberId],
    );
    const laterId = await taxpayerRow('+2348120000099', 'Joiner');
    const added = await post(
      `/groups/${groupRow!.group_id}/members`,
      { taxpayerId: laterId },
      { token: officerToken, idempotencyKey: 'att-member-later' },
    );
    assert.equal(added.status, 201, JSON.stringify(added.body));

    const refreshed = await get(`/group-attestation/${token}`);
    const newlyPending = (refreshed.body.members as { id: string; status: string }[]).find(
      (m) => m.status === 'PENDING_ATTESTATION',
    );
    assert.ok(newlyPending, 'the new member is waiting on the leader');

    const second = await post(`/group-attestation/${token}/confirm`, {
      confirmedMemberIds: [],
      rejectedMemberIds: [newlyPending!.id],
      rejectionReason: 'He farms in the next village.',
    });
    assert.equal(second.status, 200, JSON.stringify(second.body));
    assert.equal(second.body.rejected, 1, 'an outstanding question may still be answered either way');
    assert.equal(await statusOf(newlyPending!.id), 'REJECTED');
  });
});
