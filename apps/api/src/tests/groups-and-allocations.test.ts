/**
 * Reaching farmers through their cooperative, and handing out what there is
 * only so much of.
 *
 * The journey this pins down, end to end: an agent registers a farmers'
 * cooperative; an officer approves it; the agent records who says they belong;
 * the cooperative's chairman confirms the list through a link, with no
 * account; a fertiliser programme aimed at agriculture and at confirmed
 * cooperative members decides who qualifies; an allocation round holds a
 * finite number of bags; and each farmer collects once, against a code.
 *
 * Two rules are enforced by the database rather than by this code, and both
 * are tested here for that reason. Awarding the same person twice in a round
 * is refused by a UNIQUE constraint, and awarding past the round's total is
 * refused by a trigger. An application check would hold right up until two
 * officers issued at the same moment at different collection points, which is
 * exactly the day it matters.
 *
 * The attestation step carries the weight of the whole design. The agent who
 * records members is paid commission on what they collect, so an agent who
 * could also confirm membership would be certifying the size of their own
 * opportunity. Only an ATTESTED membership counts anywhere downstream.
 */

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
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { query, queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';

let officerToken = '';
let agent: { token: string; device: string };
let lgaId = '';
let groupId = '';
let attestToken = '';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

/** A taxpayer in a given sector, with a TIN, so eligibility has something to read. */
async function farmer(name: string, phone: string, sector = 'AGRICULTURE'): Promise<string> {
  const row = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO taxpayers (taxpayer_type, first_name, last_name, phone, address, lga_id,
                            consent_given, declaration_accepted, economic_sector, tin)
     VALUES ('INDIVIDUAL','Farmer',$1,$2,'Village Road',$3,true,true,$4,$5)
     RETURNING id`,
    [name, phone, lgaId, sector, `TIN${phone.slice(-8)}`],
  );
  return row!.id;
}

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  lgaId = await firstLgaId();

  await createGovernmentUser({
    role: 'admin',
    phone: '+2348030000110',
    fullName: 'Agriculture Officer',
  });
  officerToken = (await loginAs('+2348030000110')).accessToken;

  const demo = await seedDemoAgent();
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agent = { token: session.accessToken, device: demo!.deviceIdentifier };

  // An agent meets the cooperative in the field.
  const registered = await post(
    '/groups',
    {
      name: 'Bokkos Maize Farmers Cooperative',
      groupType: 'FARMERS_COOPERATIVE',
      economicSector: 'AGRICULTURE',
      lgaId,
      community: 'Bokkos Central',
      leaderName: 'Chairman Dalyop Gyang',
      leaderPhone: '+2348099990001',
      memberEstimate: 120,
    },
    { token: agent.token, deviceId: agent.device },
  );
  assert.equal(registered.status, 201, JSON.stringify(registered.body));
  groupId = registered.body.groupId;
});

async function approveGroup() {
  const reviewed = await post(
    `/groups/${groupId}/review`,
    { decision: 'APPROVE', reason: 'Cooperative verified against the ministry register.' },
    { token: officerToken },
  );
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body));
}

async function requestAttestation(): Promise<string> {
  const invited = await post(
    `/groups/${groupId}/attestation-request`,
    undefined,
    { token: officerToken },
  );
  assert.equal(invited.status, 201, JSON.stringify(invited.body));
  const token = String(invited.body.invitationUrl).split('/group-attestation/')[1];
  assert.ok(token, `no token in ${invited.body.invitationUrl}`);
  return token;
}

describe('registering an informal-sector group', () => {
  it('starts pending, because an agent saying a cooperative exists is not proof', async () => {
    const detail = await get(`/groups/${groupId}`, { token: officerToken });
    assert.equal(detail.status, 200, JSON.stringify(detail.body));
    assert.equal(detail.body.status, 'PENDING');
    assert.match(detail.body.code, /^GRP-\d{4}-\d{6}$/);
  });

  it('will not take members until an officer has approved it', async () => {
    const taxpayerId = await farmer('One', '+2348100000001');

    const added = await post(
      `/groups/${groupId}/members`,
      { taxpayerId },
      { token: agent.token, deviceId: agent.device },
    );

    assert.equal(added.status, 409, JSON.stringify(added.body));
  });

  it('refuses a ward outside the stated LGA', async () => {
    const otherWard = await queryOne<{ id: string }>(
      pool,
      'SELECT id FROM wards WHERE lga_id <> $1 LIMIT 1',
      [lgaId],
    );

    const response = await post(
      '/groups',
      {
        name: 'Misplaced Group',
        groupType: 'MARKET_ASSOCIATION',
        lgaId,
        wardId: otherWard!.id,
        leaderName: 'Someone Else',
        leaderPhone: '+2348099990002',
      },
      { token: agent.token, deviceId: agent.device },
    );

    assert.equal(response.status, 400, JSON.stringify(response.body));
  });
});

describe('the leader confirms who really belongs', () => {
  it('shows the chairman his list without an account', async () => {
    await approveGroup();
    const taxpayerId = await farmer('Two', '+2348100000002');
    await post(
      `/groups/${groupId}/members`,
      { taxpayerId },
      { token: agent.token, deviceId: agent.device },
    );
    attestToken = await requestAttestation();

    const opened = await get(`/group-attestation/${attestToken}`);

    assert.equal(opened.status, 200, JSON.stringify(opened.body));
    assert.equal(opened.body.groupName, 'Bokkos Maize Farmers Cooperative');
    assert.equal(opened.body.members.length, 1);
    assert.equal(opened.body.members[0].status, 'PENDING_ATTESTATION');
  });

  it('records the confirmation against the leader by name', async () => {
    await approveGroup();
    const confirmed = await farmer('Three', '+2348100000003');
    const disowned = await farmer('Four', '+2348100000004');
    for (const id of [confirmed, disowned]) {
      await post(
        `/groups/${groupId}/members`,
        { taxpayerId: id },
        { token: agent.token, deviceId: agent.device },
      );
    }
    attestToken = await requestAttestation();
    const list = await get(`/group-attestation/${attestToken}`);
    const byName = new Map(
      list.body.members.map((m: { id: string; full_name: string }) => [m.full_name.trim(), m.id]),
    );

    const response = await post(`/group-attestation/${attestToken}/confirm`, {
      confirmedMemberIds: [byName.get('Farmer Three')],
      rejectedMemberIds: [byName.get('Farmer Four')],
      rejectionReason: 'Not known to this cooperative.',
    });

    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.attested, 1);
    assert.equal(response.body.rejected, 1);

    const rows = await query<{ status: string; attested_by_name: string | null }>(
      pool,
      `SELECT status, attested_by_name FROM taxpayer_group_members WHERE group_id = $1
        ORDER BY created_at`,
      [groupId],
    );
    assert.deepEqual(rows.map((r) => r.status), ['ATTESTED', 'REJECTED']);
    assert.equal(rows[0].attested_by_name, 'Chairman Dalyop Gyang');
  });

  it('cannot confirm and reject the same person at once', async () => {
    await approveGroup();
    const taxpayerId = await farmer('Five', '+2348100000005');
    await post(
      `/groups/${groupId}/members`,
      { taxpayerId },
      { token: agent.token, deviceId: agent.device },
    );
    attestToken = await requestAttestation();
    const list = await get(`/group-attestation/${attestToken}`);
    const memberId = list.body.members[0].id;

    const response = await post(`/group-attestation/${attestToken}/confirm`, {
      confirmedMemberIds: [memberId],
      rejectedMemberIds: [memberId],
    });

    assert.equal(response.status, 400, JSON.stringify(response.body));
  });
});

describe('a fertiliser programme, and the bags behind it', () => {
  async function fertiliserProgramme(): Promise<string> {
    const created = await post(
      '/government/programmes',
      {
        name: 'Wet Season Fertiliser Support',
        code: `WSF-${Date.now().toString().slice(-6)}`,
        benefitType: 'AGRICULTURAL_SUBSIDY',
        benefitDescription: 'Subsidised fertiliser for compliant farmers in cooperatives.',
        targetSectors: ['AGRICULTURE'],
        requiresGroupMembership: true,
        targetGroupTypes: ['FARMERS_COOPERATIVE'],
        minimumScore: 0,
        requiresNoArrears: false,
        startDate: '2026-01-01',
        approvalAuthority: 'Plateau State Ministry of Agriculture',
      },
      { token: officerToken },
    );
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const id = created.body.programmeId ?? created.body.id;
    await post(`/government/programmes/${id}/status`, { status: 'ACTIVE' }, { token: officerToken });
    return id;
  }

  async function openRound(programmeId: string, totalQuantity: number, perBeneficiary: number) {
    const created = await post(
      '/allocations/rounds',
      {
        programmeId,
        name: '2026 wet season',
        unit: 'BAG_50KG',
        totalQuantity,
        quantityPerBeneficiary: perBeneficiary,
        collectionPoint: 'Bokkos LGA agricultural store',
        opensAt: new Date(Date.now() - 3600_000).toISOString(),
      },
      { token: officerToken },
    );
    assert.equal(created.status, 201, JSON.stringify(created.body));
    await post(
      `/allocations/rounds/${created.body.roundId}/status`,
      { status: 'OPEN' },
      { token: officerToken },
    );
    return created.body.roundId as string;
  }

  /** A farmer whose membership the chairman has actually confirmed. */
  async function attestedFarmer(name: string, phone: string): Promise<string> {
    const taxpayerId = await farmer(name, phone);
    await post(
      `/groups/${groupId}/members`,
      { taxpayerId },
      { token: agent.token, deviceId: agent.device },
    );
    const token = await requestAttestation();
    const list = await get(`/group-attestation/${token}`);
    assert.equal(list.status, 200, `attestation list: ${JSON.stringify(list.body)}`);
    const pending = list.body.members
      .filter((m: { status: string }) => m.status === 'PENDING_ATTESTATION')
      .map((m: { id: string }) => m.id);
    await post(`/group-attestation/${token}/confirm`, { confirmedMemberIds: pending });
    return taxpayerId;
  }

  it('awards a confirmed member, and refuses one nobody vouched for', async () => {
    await approveGroup();
    const programmeId = await fertiliserProgramme();
    const roundId = await openRound(programmeId, 100, 2);

    const vouched = await attestedFarmer('Six', '+2348100000006');
    const awarded = await post(
      `/allocations/rounds/${roundId}/awards`,
      { taxpayerId: vouched },
      { token: officerToken },
    );
    assert.equal(awarded.status, 201, JSON.stringify(awarded.body));
    assert.match(awarded.body.collectionCode, /^[A-Z0-9]{5}-[A-Z0-9]{5}$/);

    // Recorded by the agent, never confirmed by the chairman.
    const unvouched = await farmer('Seven', '+2348100000007');
    await post(
      `/groups/${groupId}/members`,
      { taxpayerId: unvouched },
      { token: agent.token, deviceId: agent.device },
    );

    const refused = await post(
      `/allocations/rounds/${roundId}/awards`,
      { taxpayerId: unvouched },
      { token: officerToken },
    );
    assert.equal(refused.status, 409, JSON.stringify(refused.body));
    assert.match(refused.body.error.message, /No confirmed membership/i);
  });

  it('will not award the same farmer twice in one round', async () => {
    await approveGroup();
    const programmeId = await fertiliserProgramme();
    const roundId = await openRound(programmeId, 100, 2);
    const taxpayerId = await attestedFarmer('Eight', '+2348100000008');

    const first = await post(
      `/allocations/rounds/${roundId}/awards`,
      { taxpayerId },
      { token: officerToken },
    );
    assert.equal(first.status, 201, JSON.stringify(first.body));

    const second = await post(
      `/allocations/rounds/${roundId}/awards`,
      { taxpayerId },
      { token: officerToken },
    );

    assert.equal(second.status, 409, JSON.stringify(second.body));
    assert.equal(second.body.error.code, 'ALREADY_AWARDED');
  });

  it('will not promise more bags than the round holds', async () => {
    await approveGroup();
    const programmeId = await fertiliserProgramme();
    // Four bags, two each: room for exactly two farmers.
    const roundId = await openRound(programmeId, 4, 2);

    for (const [i, phone] of ['+2348100000011', '+2348100000012'].entries()) {
      const id = await attestedFarmer(`Nine${i}`, phone);
      const ok = await post(
        `/allocations/rounds/${roundId}/awards`,
        { taxpayerId: id },
        { token: officerToken },
      );
      assert.equal(ok.status, 201, JSON.stringify(ok.body));
    }

    const third = await attestedFarmer('Ten', '+2348100000013');
    const overdrawn = await post(
      `/allocations/rounds/${roundId}/awards`,
      { taxpayerId: third },
      { token: officerToken },
    );

    assert.equal(overdrawn.status, 409, JSON.stringify(overdrawn.body));
    assert.equal(overdrawn.body.error.code, 'ROUND_EXHAUSTED');
  });

  it('lets a farmer collect once against their code', async () => {
    await approveGroup();
    const programmeId = await fertiliserProgramme();
    const roundId = await openRound(programmeId, 100, 2);
    const taxpayerId = await attestedFarmer('Eleven', '+2348100000014');
    const awarded = await post(
      `/allocations/rounds/${roundId}/awards`,
      { taxpayerId },
      { token: officerToken },
    );
    const code = awarded.body.collectionCode;

    // The agent at the store records the handover.
    const collected = await post(
      '/allocations/collections',
      { collectionCode: code },
      { token: agent.token, deviceId: agent.device },
    );
    assert.equal(collected.status, 200, JSON.stringify(collected.body));
    assert.match(collected.body.message, /collected 2.00 BAG_50KG/);

    const again = await post(
      '/allocations/collections',
      { collectionCode: code },
      { token: agent.token, deviceId: agent.device },
    );
    assert.equal(again.status, 409, JSON.stringify(again.body));
    assert.equal(again.body.error.code, 'ALREADY_COLLECTED');
  });

  it('reports what is left and what actually reached people', async () => {
    await approveGroup();
    const programmeId = await fertiliserProgramme();
    const roundId = await openRound(programmeId, 100, 2);

    const collectedFarmer = await attestedFarmer('Twelve', '+2348100000015');
    const awaiting = await attestedFarmer('Thirteen', '+2348100000016');
    const first = await post(
      `/allocations/rounds/${roundId}/awards`,
      { taxpayerId: collectedFarmer },
      { token: officerToken },
    );
    await post(
      `/allocations/rounds/${roundId}/awards`,
      { taxpayerId: awaiting },
      { token: officerToken },
    );
    await post(
      '/allocations/collections',
      { collectionCode: first.body.collectionCode },
      { token: agent.token, deviceId: agent.device },
    );

    const summary = await get(`/allocations/rounds/${roundId}`, { token: officerToken });

    assert.equal(summary.status, 200, JSON.stringify(summary.body));
    assert.equal(summary.body.awardedCount, 2);
    assert.equal(summary.body.collectedCount, 1);
    assert.equal(summary.body.remainingQuantity, '96.00');
    assert.equal(summary.body.beneficiariesRemaining, 48);
  });

  it('will not award from a round that is not open', async () => {
    await approveGroup();
    const programmeId = await fertiliserProgramme();
    const created = await post(
      '/allocations/rounds',
      {
        programmeId,
        name: 'Not yet opened',
        unit: 'BAG_50KG',
        totalQuantity: 50,
        quantityPerBeneficiary: 2,
        opensAt: new Date().toISOString(),
      },
      { token: officerToken },
    );
    const taxpayerId = await attestedFarmer('Fourteen', '+2348100000017');

    const response = await post(
      `/allocations/rounds/${created.body.roundId}/awards`,
      { taxpayerId },
      { token: officerToken },
    );

    assert.equal(response.status, 409, JSON.stringify(response.body));
  });
});

// ---------------------------------------------------------------------------

describe('a round in every unit a distribution is measured in', () => {
  /**
   * One of the seven units had ever been stored. The rest are not
   * interchangeable: a round of 400 says nothing on its own, and the
   * difference between four hundred litres of herbicide, four hundred
   * seedlings and four hundred tractor-days is the difference between a
   * distribution that adds up at the collection point and one that does not.
   * The unit is on the award the farmer is shown and on the report the
   * ministry signs off.
   *
   * A round is also closed here. CLOSED is what stops a distribution being
   * topped up without a fresh decision on the record, and the refusal to
   * reopen one had never been reached because no round had ever been closed.
   */
  async function programme(code: string): Promise<string> {
    const created = await post(
      '/government/programmes',
      {
        name: `Input Support ${code}`,
        code: `INP-${code}`,
        benefitType: 'AGRICULTURAL_SUBSIDY',
        benefitDescription: 'Subsidised farm inputs for compliant farmers in cooperatives.',
        targetSectors: ['AGRICULTURE'],
        requiresGroupMembership: true,
        targetGroupTypes: ['FARMERS_COOPERATIVE'],
        minimumScore: 0,
        requiresNoArrears: false,
        startDate: '2026-01-01',
        approvalAuthority: 'Plateau State Ministry of Agriculture',
      },
      { token: officerToken },
    );
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const id = (created.body.programmeId ?? created.body.id) as string;
    await post(`/government/programmes/${id}/status`, { status: 'ACTIVE' }, { token: officerToken });
    return id;
  }

  const UNITS = ['LITRE', 'KILOGRAM', 'TRACTOR_DAY', 'SEEDLING', 'UNIT'] as const;

  it('records each one as what the store will actually hand over', async () => {
    for (const [index, unit] of UNITS.entries()) {
      const programmeId = await programme(`${unit}-${index}`);
      const created = await post(
        '/allocations/rounds',
        {
          programmeId,
          name: `2026 ${unit.toLowerCase().replace('_', ' ')} round`,
          unit,
          totalQuantity: 400,
          quantityPerBeneficiary: 4,
          collectionPoint: 'Bokkos LGA agricultural store',
          opensAt: new Date(Date.now() - 3600_000).toISOString(),
        },
        { token: officerToken },
      );
      assert.equal(created.status, 201, `${unit} was refused: ${JSON.stringify(created.body)}`);

      const stored = await queryOne<{ unit: string; status: string }>(
        pool,
        'SELECT unit, status FROM incentive_allocation_rounds WHERE id = $1',
        [created.body.roundId],
      );
      assert.equal(stored?.unit, unit);
    }
  });

  it('closes a round, and refuses to reopen it', async () => {
    const programmeId = await programme('CLOSE');
    const created = await post(
      '/allocations/rounds',
      {
        programmeId,
        name: '2026 seedling round',
        unit: 'SEEDLING',
        totalQuantity: 200,
        quantityPerBeneficiary: 10,
        collectionPoint: 'Mangu LGA nursery',
        opensAt: new Date(Date.now() - 3600_000).toISOString(),
      },
      { token: officerToken },
    );
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const roundId = created.body.roundId as string;

    await post(`/allocations/rounds/${roundId}/status`, { status: 'OPEN' }, { token: officerToken });
    const closed = await post(
      `/allocations/rounds/${roundId}/status`,
      { status: 'CLOSED' },
      { token: officerToken },
    );
    assert.equal(closed.status, 200, JSON.stringify(closed.body));
    assert.equal(
      (
        await queryOne<{ status: string }>(
          pool,
          'SELECT status FROM incentive_allocation_rounds WHERE id = $1',
          [roundId],
        )
      )?.status,
      'CLOSED',
    );

    // Reopening would let a distribution be topped up without a new decision.
    const reopened = await post(
      `/allocations/rounds/${roundId}/status`,
      { status: 'OPEN' },
      { token: officerToken },
    );
    assert.equal(reopened.status, 409, JSON.stringify(reopened.body));
    assert.equal(reopened.body.error.code, 'ROUND_CLOSED');
  });
});

// ---------------------------------------------------------------------------

describe('a cooperative that turns out to be a front', () => {
  /**
   * `POST /groups/:id/review` has accepted SUSPEND from the beginning and
   * nothing had ever sent it, so the status it writes had never been stored.
   * It is not a label: both eligibility and the award path require
   * `g.status = 'ACTIVE'`, so suspending a group is what stops its members
   * collecting fertiliser today rather than rejecting them one at a time.
   */
  it('is suspended, and its members stop being eligible that moment', async () => {
    const created = await post(
      '/groups',
      {
        name: 'Front Cooperative',
        groupType: 'FARMERS_COOPERATIVE',
        lgaId,
        leaderName: 'Absent Chairman',
        leaderPhone: '+2348030000099',
      },
      { token: officerToken, idempotencyKey: 'front-group' },
    );
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const id = created.body.groupId as string;

    await post(
      `/groups/${id}/review`,
      { decision: 'APPROVE', reason: 'Verified against the ministry register of cooperatives.' },
      { token: officerToken },
    );
    assert.equal(
      (await queryOne<{ status: string }>(pool, 'SELECT status FROM taxpayer_groups WHERE id = $1', [id]))
        ?.status,
      'ACTIVE',
    );

    const suspended = await post(
      `/groups/${id}/review`,
      {
        decision: 'SUSPEND',
        reason: 'None of the eleven names on the list farms in this ward, or anywhere else.',
      },
      { token: officerToken },
    );
    assert.equal(suspended.status, 200, JSON.stringify(suspended.body));

    const row = await queryOne<{ status: string; suspension_reason: string | null }>(
      pool,
      'SELECT status, suspension_reason FROM taxpayer_groups WHERE id = $1',
      [id],
    );
    assert.equal(row?.status, 'SUSPENDED');
    assert.match(row!.suspension_reason!, /farms in this ward/);

    // And reinstating it clears the reason rather than leaving an accusation
    // standing against a group that has been cleared.
    const reinstated = await post(
      `/groups/${id}/review`,
      { decision: 'APPROVE', reason: 'Membership confirmed by the district head after enquiry.' },
      { token: officerToken },
    );
    assert.equal(reinstated.status, 200, JSON.stringify(reinstated.body));
    const after = await queryOne<{ status: string; suspension_reason: string | null }>(
      pool,
      'SELECT status, suspension_reason FROM taxpayer_groups WHERE id = $1',
      [id],
    );
    assert.equal(after?.status, 'ACTIVE');
    assert.equal(after?.suspension_reason, null);
  });
});
